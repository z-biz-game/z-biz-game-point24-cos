// Canvas renderer + hit testing + 唯一的 rAF 循环。这一层拥有像素和点击，不判定任何规则：
// 一次 tap 只把槽位下标或运算符交给 main.js，合法性只在 js/core/game.js 里判。
// 几何通过 numberPoint()/keyPoint() 公布，所以浏览器套件按玩家会点的位置去点，而不是
// 直接捅 commit()。
//
// 时间只在 js/anim.js 里流；这里负责把帧 dt 交给它（暂停时整条仿真冻结，一帧都不推进），
// 再把仿真结果画出来。循环只在仿真还有东西要动时挂着 —— 这局游戏本质是事件驱动的，
// 静止时不该空转，也保证自报 hidden 的无头 Chrome 每次 commit 都照样画出来。

import { displayExpr, fmt } from './core/frac.js';
import { animSnapshot } from './anim.js';

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

function ease(t) {
  const k = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - k, 3);
}

export function createView(canvas, { onSelect, onOp, anim, isPaused, reducedMotion } = {}) {
  const ctx = canvas.getContext('2d');
  let game = null;
  let geom = { w: 320, h: 320, tileW: 60, tileH: 78, tileY: 40, keyY: 240, keyH: 46, ox: 16 };
  let raf = 0;
  let lastTs = 0;
  let feltPattern = null;
  const pips = { img: null, ready: false };

  // 纹理与贴图：加载失败就退回纯色，绝不让画面缺一块就整盘不画。
  function loadTexture(src, onLoad) {
    if (typeof Image !== 'function') return;
    const im = new Image();
    im.addEventListener('load', () => onLoad(im));
    im.src = src;
  }
  loadTexture('img/felt.png', (im) => {
    try { feltPattern = ctx.createPattern(im, 'repeat'); } catch (err) { feltPattern = null; }
    draw();
  });
  loadTexture('img/pips.png', (im) => {
    pips.img = im;
    pips.ready = true;
  });

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

  // 画布内的牌心：粒子从哪儿炸开。
  function tileCentre(i) {
    const b = tileBox(i);
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }

  function hit(ev) {
    const box = canvas.getBoundingClientRect();
    // CSS 尺寸与位图尺寸不是一回事：手机上 canvas 被拉伸过，直接用 offsetX 会点 A 打 B。
    const scale = box.width ? geom.w / box.width : 1;
    const x = (ev.clientX - box.left) * scale;
    const y = (ev.clientY - box.top) * (geom.h / box.height);
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
    if (paused()) return;
    const h = hit(ev);
    if (h.kind === 'num' && onSelect) onSelect(h.i);
    else if (h.kind === 'op' && onOp) onOp(h.op);
    if (h.kind !== 'void') schedule();
    if (ev.preventDefault) ev.preventDefault();
  }

  function drawTile(i) {
    const b = tileBox(i);
    const slot = game.slots[i];
    const picked = game.sel.includes(i);
    const isTarget = slot && slot.expr !== undefined && game.done && i === game.slots.length - 1;
    const sim = anim ? anim.sim : null;
    const reduce = reducedMotion && reducedMotion();
    let x = b.x;
    let y = b.y;
    let w = b.w;
    let h = b.h;
    if (sim && !reduce) {
      // 发牌：从左到右错开 90ms 落桌；选中：整张牌抬起 4px。
      const gate = ease((sim.deal - i * 0.14) / 0.6);
      if (gate < 1) {
        y += (1 - gate) * -h * 0.55;
        x += (1 - gate) * (geom.w * 0.06) * (i % 2 ? 1 : -1);
      }
      y -= sim.lift[i] * 5;
      h += sim.pulse[i] * 3;
    }
    ctx.save();
    ctx.globalAlpha = sim && !reduce ? Math.max(0.15, ease(sim.deal - i * 0.1)) : 1;
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = picked || isTarget ? 16 : 8;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = isTarget ? SELECTED : picked ? '#fff6df' : slot && slot.from.length > 1 ? MERGED : CARD;
    roundRect(ctx, x, y, w, h, 10);
    ctx.fill();
    ctx.restore();

    if (picked || isTarget) {
      ctx.strokeStyle = SELECTED;
      ctx.lineWidth = 3;
      roundRect(ctx, x - 2, y - 2, w + 4, h + 4, 12);
      ctx.stroke();
    }

    const f = slot.f;
    const whole = f.d === 1;
    const fresh = slot.from.length === 1 && Number.isInteger(f.n) && f.d === 1;
    ctx.fillStyle = CARD_INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (fresh) {
      ctx.font = `700 ${Math.round(h * 0.42)}px ui-rounded, "Helvetica Neue", sans-serif`;
      ctx.fillText(rankName(f.n), x + w / 2, y + h * 0.46);
    } else if (whole) {
      ctx.font = `700 ${Math.round(h * 0.36)}px ui-rounded, "Helvetica Neue", sans-serif`;
      ctx.fillText(String(f.n), x + w / 2, y + h * 0.46);
    } else {
      // A real fraction: numerator over bar over denominator, because the whole point of this
      // engine is that 3/7 stays 3/7 and does not become 0.42857142857.
      ctx.font = `700 ${Math.round(h * 0.26)}px ui-rounded, "Helvetica Neue", sans-serif`;
      ctx.fillText(String(f.n), x + w / 2, y + h * 0.28);
      ctx.strokeStyle = CARD_INK;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.28, y + h * 0.46);
      ctx.lineTo(x + w * 0.72, y + h * 0.46);
      ctx.stroke();
      ctx.fillText(String(f.d), x + w / 2, y + h * 0.64);
    }

    ctx.fillStyle = CARD_SOFT;
    ctx.font = `${Math.round(h * 0.13)}px ui-monospace, monospace`;
    ctx.fillText(
      fresh ? `牌 ${rankName(f.n)}` : `${slot.from.length} 张`,
      x + w / 2,
      y + h * 0.87,
    );
    if (!fresh) {
      ctx.fillStyle = SELECTED_DARK;
      ctx.font = `${Math.round(h * 0.12)}px ui-monospace, monospace`;
      ctx.fillText(fmt(f), x + w / 2, y + 12);
    }
  }

  function drawKey(index) {
    const b = keyBox(index);
    const armed = !!game && !game.done && game.sel.length === 2 && !paused();
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
    if (paused()) {
      ctx.fillStyle = SELECTED;
      ctx.fillText('已暂停 · 按 P 继续', geom.w - PAD, PAD + 12);
    } else if (game.done) {
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
    if (paused()) {
      ctx.fillStyle = SELECTED;
      ctx.fillText('暂停中 —— 仿真已冻结，撤销/重开仍可用', geom.w / 2, geom.keyY - 40);
    } else if (game.sel.length === 1) {
      ctx.fillStyle = SELECTED;
      ctx.fillText('再点一个数，然后点运算符', geom.w / 2, geom.keyY - 22);
    }
  }

  function drawParticles() {
    if (!anim || !pips.ready || reducedMotion && reducedMotion()) return;
    const parts = anim.sim.particles;
    if (!parts.length) return;
    const fw = pips.img.width / 4;
    for (const p of parts) {
      const k = 1 - p.age / p.life;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, k));
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      const s = p.size * (0.6 + 0.4 * k);
      ctx.drawImage(pips.img, p.frame * fw, 0, fw, pips.img.height, -s / 2, -s / 2, s, s);
      ctx.restore();
    }
  }

  function draw() {
    ctx.clearRect(0, 0, geom.w, geom.h);
    const sim = anim ? anim.sim : null;
    const reduce = reducedMotion && reducedMotion();
    ctx.save();
    if (sim && sim.shake > 0.02 && !reduce) {
      ctx.translate((Math.sin(sim.clock * 62) * sim.shake * 6), Math.cos(sim.clock * 47) * sim.shake * 2);
    }
    roundRect(ctx, 0, 0, geom.w, geom.h, 14);
    ctx.clip();
    ctx.fillStyle = feltPattern || FELT;
    ctx.fillRect(-12, -12, geom.w + 24, geom.h + 24);
    if (!game) { ctx.restore(); return; }
    drawStatus();
    for (let i = 0; i < game.slots.length; i++) drawTile(i);
    drawLog();
    for (let k = 0; k < OPS.length; k++) drawKey(k);
    drawParticles();
    if (sim && sim.flash > 0.02 && !reduce) {
      ctx.fillStyle = `rgba(224,166,60,${(sim.flash * 0.3).toFixed(3)})`;
      ctx.fillRect(0, 0, geom.w, geom.h);
    }
    ctx.restore();
  }

  function paused() {
    return !!(isPaused && isPaused());
  }

  // —— 唯一的帧循环 ——
  function frame(ts) {
    raf = 0;
    const t = Number(ts);
    const dt = lastTs ? (t - lastTs) / 1000 : 0;
    lastTs = t;
    if (!paused() && anim) anim.advance(dt);
    draw();
    schedule();
  }

  function schedule() {
    if (raf) return;
    if (!anim || paused()) return;
    if (!anim.isBusy()) { lastTs = 0; return; }
    raf = requestAnimationFrame(frame);
  }

  canvas.addEventListener('pointerdown', down);

  return {
    attach(next) {
      game = next;
      measure();
      schedule();
    },
    detach() {
      game = null;
    },
    measure,
    redraw() { draw(); schedule(); },
    // 暂停/继续都要显式收放循环：暂停时 rAF 一帧都不该再推进仿真。
    setRunning(on) {
      if (on) schedule();
      else if (raf) { cancelAnimationFrame(raf); raf = 0; }
      draw();
    },
    snapshot: () => (anim ? animSnapshot(anim.sim) : {}),
    tileCentre,
    numberPoint,
    keyPoint,
    slots: () => (game ? game.slots.length : 0),
  };
}

export { rankName };
