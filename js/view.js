// Canvas renderer + hit testing. This file owns pixels and clicks and decides nothing about
// legality: a tap hands main.js a slot index or an operator, and js/core/game.js is the only
// place a step is judged. The geometry is published through numberPoint()/keyPoint() so the
// browser suite can press where a player would press instead of poking commit().


/* ---------- 帧率无关（dt）---------- */
/* 本仓**没有逐帧运动**，所以「帧率无关」这一项在本仓是空命题而不是缺陷：源码自己写着这件事：js/main.js:361 的注释 "Deliberately no requestAnimationFrame loop: this game is entirely event-driven"；代码里确实一次都没排，js/view.js 的重绘全部由 pointerdown / click / keydown 触发
   没有自续期的 requestAnimationFrame 循环，屏上就没有「每帧推进」的量，帧率也就无从影响它。
   写这段备案是为了让账上分得开"查过、确实不需要"与"没人查过"——不是为了让判据变绿。

   规矩：**哪天在本仓加了逐帧动画循环，必须先删掉这段备案**，并让循环体消费 rAF 自带的
   时间戳（或自己取 performance.now()），把动画进度写成绝对截止；只按帧累加位置的一律不算。 */
import { displayExpr, fmt } from './core/frac.js';

const PAD = 16;
const GAP = 10;
const OPS = ['+', '-', '*', '/'];
const GLYPH = { '+': '+', '-': '−', '*': '×', '/': '÷' };
const NAMES = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };

const FELT = '#15201f';
const FELT_EDGE = '#243230';
const CARD = '#f3efe4';
const CARD_INK = '#1d2320';
const CARD_SOFT = '#6d6a5f';
const SELECTED = '#e0a63c';
const SELECTED_DARK = '#8a6414';
const MERGED = '#cfe0ea';
const KEY_BG = '#232c33';
const KEY_LIVE = '#3c4a55';
const GOOD = '#5fbf7c';
const BAD = '#d9605a';

function rankName(rank) {
  return NAMES[rank] || String(rank);
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function createView(canvas, { onSelect, onOp } = {}) {
  const ctx = canvas.getContext('2d');
  let game = null;
  let geom = { w: 320, h: 320, tileW: 60, tileH: 78, tileY: 40, keyY: 240, keyH: 46, ox: 16 };

  // One row of up to four tiles, one row of four operator keys, and the arithmetic between
  // them. Everything is derived from the canvas box so a phone and a 1180px desktop agree.
  // Height is a budget, not a wish: the tile row scales off the width (1.32 * tileW), and on
  // a wide/short canvas that alone runs past the key row. If tile and key boxes overlap,
  // hit() checks tiles first and every operator click is silently eaten as a tile pick — the
  // @pointer suite burned on exactly this. So the tile height is clamped to whatever is
  // left after the header, the log strip and the key row take their share.
  function measure() {
    const box = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const W = Math.max(220, Math.round(box.width));
    const H = Math.max(260, Math.round(box.height));
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const tileW = Math.floor((W - PAD * 2 - GAP * 3) / 4);
    const header = PAD + 34;
    const keyH = Math.min(Math.max(38, Math.round(tileW * 1.32 * 0.55)), Math.max(38, Math.round(H * 0.15)));
    const logH = Math.max(30, Math.min(88, Math.round(H * 0.16)));
    const tileH = Math.min(Math.round(tileW * 1.32), Math.max(120, H - header - keyH - logH - PAD));
    geom = {
      w: W,
      h: H,
      tileW,
      tileH,
      tileY: header,
      keyY: H - PAD - keyH,
      keyH,
      ox: PAD,
      cell: tileW + GAP,
    };
    draw();
  }

  function tileBox(i) {
    const n = game ? game.slots.length : 4;
    const total = n * geom.tileW + (n - 1) * GAP;
    const left = Math.round((geom.w - total) / 2);
    return { x: left + i * (geom.tileW + GAP), y: geom.tileY, w: geom.tileW, h: geom.tileH };
  }

  function keyBox(index) {
    const w = Math.floor((geom.w - PAD * 2 - GAP * 3) / 4);
    return { x: PAD + index * (w + GAP), y: geom.keyY, w, h: geom.keyH };
  }

  function toClient(cx, cy) {
    const box = canvas.getBoundingClientRect();
    return { x: Math.round(box.left + cx), y: Math.round(box.top + cy) };
  }

  // Client-space centre of the i-th number as it stands right now.
  function numberPoint(i) {
    if (!game || i < 0 || i >= game.slots.length) return null;
    const b = tileBox(i);
    return { ...toClient(b.x + b.w / 2, b.y + b.h / 2), w: b.w, h: b.h };
  }

  // Client-space centre of an operator key.
  function keyPoint(op) {
    const idx = OPS.indexOf(op);
    if (idx < 0) return null;
    const b = keyBox(idx);
    return { ...toClient(b.x + b.w / 2, b.y + b.h / 2), w: b.w, h: b.h };
  }

  function hit(ev) {
    const box = canvas.getBoundingClientRect();
    const x = ev.clientX - box.left;
    const y = ev.clientY - box.top;
    if (game) {
      for (let i = 0; i < game.slots.length; i++) {
        const b = tileBox(i);
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return { kind: 'num', i };
      }
      for (let k = 0; k < OPS.length; k++) {
        const b = keyBox(k);
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return { kind: 'op', op: OPS[k] };
      }
    }
    return { kind: 'void' };
  }

  function down(ev) {
    const h = hit(ev);
    if (h.kind === 'num' && onSelect) onSelect(h.i);
    else if (h.kind === 'op' && onOp) onOp(h.op);
    ev.preventDefault();
  }

  function drawTile(i) {
    const b = tileBox(i);
    const slot = game.slots[i];
    const picked = game.sel.includes(i);
    const isTarget = slot && slot.expr !== undefined && game.done && i === game.slots.length - 1;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = picked || isTarget ? 16 : 8;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = isTarget ? SELECTED : picked ? '#fff6df' : slot && slot.from.length > 1 ? MERGED : CARD;
    roundRect(ctx, b.x, b.y, b.w, b.h, 10);
    ctx.fill();
    ctx.restore();

    if (picked || isTarget) {
      ctx.strokeStyle = SELECTED;
      ctx.lineWidth = 3;
      roundRect(ctx, b.x - 2, b.y - 2, b.w + 4, b.h + 4, 12);
      ctx.stroke();
    }

    const f = slot.f;
    const whole = f.d === 1;
    const fresh = slot.from.length === 1 && Number.isInteger(f.n) && f.d === 1;
    ctx.fillStyle = CARD_INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (fresh) {
      ctx.font = `700 ${Math.round(b.h * 0.42)}px ui-rounded, "Helvetica Neue", sans-serif`;
      ctx.fillText(rankName(f.n), b.x + b.w / 2, b.y + b.h * 0.46);
    } else if (whole) {
      ctx.font = `700 ${Math.round(b.h * 0.36)}px ui-rounded, "Helvetica Neue", sans-serif`;
      ctx.fillText(String(f.n), b.x + b.w / 2, b.y + b.h * 0.46);
    } else {
      // A real fraction: numerator over bar over denominator, because the whole point of this
      // engine is that 3/7 stays 3/7 and does not become 0.42857142857.
      ctx.font = `700 ${Math.round(b.h * 0.26)}px ui-rounded, "Helvetica Neue", sans-serif`;
      ctx.fillText(String(f.n), b.x + b.w / 2, b.y + b.h * 0.28);
      ctx.strokeStyle = CARD_INK;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.x + b.w * 0.28, b.y + b.h * 0.46);
      ctx.lineTo(b.x + b.w * 0.72, b.y + b.h * 0.46);
      ctx.stroke();
      ctx.fillText(String(f.d), b.x + b.w / 2, b.y + b.h * 0.64);
    }

    ctx.fillStyle = CARD_SOFT;
    ctx.font = `${Math.round(b.h * 0.13)}px ui-monospace, monospace`;
    ctx.fillText(
      fresh ? `牌 ${rankName(f.n)}` : `${slot.from.length} 张`,
      b.x + b.w / 2,
      b.y + b.h * 0.87,
    );
    if (!fresh) {
      ctx.fillStyle = SELECTED_DARK;
      ctx.font = `${Math.round(b.h * 0.12)}px ui-monospace, monospace`;
      ctx.fillText(fmt(f), b.x + b.w / 2, b.y + 12);
    }
  }

  function drawKey(index) {
    const b = keyBox(index);
    const armed = !!game && !game.done && game.sel.length === 2;
    ctx.fillStyle = armed ? KEY_LIVE : KEY_BG;
    roundRect(ctx, b.x, b.y, b.w, b.h, 9);
    ctx.fill();
    ctx.strokeStyle = armed ? SELECTED : 'rgba(226,232,240,0.14)';
    ctx.lineWidth = armed ? 2 : 1;
    ctx.stroke();
    ctx.fillStyle = armed ? '#f6e7c4' : '#9fb0bd';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(b.h * 0.52)}px ui-rounded, "Helvetica Neue", sans-serif`;
    ctx.fillText(GLYPH[OPS[index]], b.x + b.w / 2, b.y + b.h / 2);
  }

  function drawStatus() {
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `600 13px ui-rounded, "Helvetica Neue", sans-serif`;
    ctx.fillStyle = '#cfe0d8';
    ctx.fillText(`目标 ${game.targetText}`, PAD, PAD + 12);

    ctx.textAlign = 'right';
    if (game.done) {
      ctx.fillStyle = GOOD;
      ctx.fillText(`算到了 · 用了 ${game.moves} 步 · 最少 ${game.par} 步`, geom.w - PAD, PAD + 12);
    } else if (game.live === false) {
      ctx.fillStyle = BAD;
      ctx.fillText('这堆数算不出目标了 · 撤销或重开', geom.w - PAD, PAD + 12);
    } else if (game.live === null) {
      ctx.fillStyle = '#d9b060';
      ctx.fillText('搜索预算耗尽 · 无法判断', geom.w - PAD, PAD + 12);
    } else {
      ctx.fillStyle = GOOD;
      ctx.fillText(
        `仍可达成 · 最少还需 ${game.need === null ? '?' : game.need} 步`,
        geom.w - PAD,
        PAD + 12,
      );
    }
  }

  function drawLog() {
    const top = geom.tileY + geom.tileH + 14;
    const lines = [];
    for (const op of game.ops) lines.push(displayExpr(op.expr));
    if (game.sample && game.done) lines.push(`参考：${displayExpr(game.sample)}`);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `500 13px ui-monospace, monospace`;
    ctx.fillStyle = 'rgba(226,232,240,0.72)';
    const room = Math.max(0, Math.floor((geom.keyY - top - 10) / 18));
    for (let i = 0; i < Math.min(lines.length, room); i++) {
      ctx.fillText(lines[i], geom.w / 2, top + i * 18);
    }
    if (game.sel.length === 1) {
      ctx.fillStyle = SELECTED;
      ctx.fillText('再点一个数，然后点运算符', geom.w / 2, geom.keyY - 22);
    }
  }

  function draw() {
    ctx.clearRect(0, 0, geom.w, geom.h);
    ctx.fillStyle = FELT;
    roundRect(ctx, 0, 0, geom.w, geom.h, 14);
    ctx.fill();
    ctx.strokeStyle = FELT_EDGE;
    ctx.lineWidth = 2;
    ctx.stroke();
    if (!game) return;
    drawStatus();
    for (let i = 0; i < game.slots.length; i++) drawTile(i);
    drawLog();
    for (let k = 0; k < OPS.length; k++) drawKey(k);
  }

  canvas.addEventListener('pointerdown', down);

  return {
    attach(next) {
      game = next;
      measure();
    },
    detach() {
      game = null;
    },
    measure,
    redraw: draw,
    numberPoint,
    keyPoint,
    slots: () => (game ? game.slots.length : 0),
  };
}

export { rankName };
