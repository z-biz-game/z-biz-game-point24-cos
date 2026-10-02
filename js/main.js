// The shell: hash routes in, canvas out, records in between. Nothing here knows the rules of
// the arithmetic — those live in js/core — and nothing here draws — that is js/view.js.

import {
  clearSelection, combine, createGame, grade, reset, toggle, undo,
} from './core/game.js';
import { BANDS, ALL, bandByKey, bandIn, byId, campaign, dailyLot, levelAt, randomLot, stats as poolStats } from './core/library.js';
import { todayKey } from './core/rng.js';
import { store } from './core/storage.js';
import { displayExpr } from './core/frac.js';
import { rankName } from './view.js';
import { createView } from './view.js';
import { createAnim } from './anim.js';
import { createAudio } from './audio.js';
import { registerSW } from './pwa.js';

const $ = (id) => document.getElementById(id);
const el = {
  modes: $('modes'), totals: $('totals'), crumbs: $('crumbs'), readout: $('readout'),
  shelf: $('shelf'), hintline: $('hintline'), curtain: $('curtain'), stars: $('stars'),
  verdict: $('verdict'), tally: $('tally'), undo: $('undo'), hint: $('hint'),
  restart: $('restart'), share: $('share'), next: $('next'), again: $('again'),
  toast: $('toast'), canvas: $('board'), wipe: $('wipe'),
  pause: $('pause'), mute: $('mute'), fullscreen: $('fullscreen'), help: $('help'),
  tutorial: $('tutorial'), tutorialClose: $('tutorial-close'), hud: $('hud'),
};

// reduceMotion 是真分支，不是一句 CSS：粒子上限、抖动、发牌、涟漪全部要在这里关掉。
const motionQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false, addEventListener: null };
const app = {
  mode: 'home',
  index: 1,
  route: null,
  hand: null,
  game: null,
  hints: 0,
  label: '',
  day: null,
  paused: false,
  reduced: !!motionQuery.matches,
  started: false,
};
if (motionQuery.addEventListener) {
  motionQuery.addEventListener('change', (ev) => {
    app.reduced = !!ev.matches;
    anim.setReducedMotion(() => app.reduced);
    view.redraw();
  });
}

const HANDS = ALL.length;
const audio = createAudio();
const anim = createAnim({ reducedMotion: () => app.reduced });

function clampIndex(n) {
  return Math.min(HANDS, Math.max(1, Number(n) || 1));
}

// #/ · #/daily · #/lot/solo-07
// The hand id is in the URL, so a shared link resolves to the same four cards on another
// device without the receiver needing the sender's save file.
function parseHash(hash = location.hash) {
  const p = String(hash).replace(/^#\/?/, '').split('/').filter(Boolean);
  if (p[0] === 'daily') return { mode: 'daily' };
  if (p[0] === 'lot') return { mode: 'lot', id: p[1] };
  if (p[0] === 'random') return { mode: 'random', band: p[1] || BANDS[0].key, key: p[2] || null };
  return { mode: 'home', index: clampIndex(store.unlocked) };
}

function linkFor(rt) {
  if (rt.mode === 'daily') return '#/daily';
  if (rt.mode === 'random') return `#/random/${rt.band}/${rt.key}`;
  if (rt.mode === 'lot') return `#/lot/${rt.id}`;
  return '#/';
}

function resolve(rt) {
  if (rt.mode === 'daily') {
    const day = todayKey();
    const hand = dailyLot(day);
    return { hand, label: `每日一手 · ${day}`, note: day, day };
  }
  if (rt.mode === 'random') {
    const band = bandByKey(rt.band);
    return { hand: randomLot(`${band.key}|${rt.key}`, band.key), label: `随机 · ${band.label}`, note: band.blurb };
  }
  if (rt.mode === 'lot') {
    const hand = byId(rt.id) || campaign()[0];
    return { hand, label: `牌局 ${hand.id}`, note: bandByKey(hand.band).blurb };
  }
  const hand = levelAt(rt.index - 1);
  return { hand, label: `第 ${rt.index} 手`, note: `共 ${HANDS} 手 · ${bandByKey(hand.band).label}` };
}

const view = createView(el.canvas, {
  onSelect: (i) => pick(i),
  onOp: (op) => press(op),
  anim,
  isPaused: () => app.paused,
  reducedMotion: () => app.reduced,
});

function say(html) {
  el.hintline.innerHTML = html;
}

function stars(n) {
  return '★'.repeat(n) + '☆'.repeat(3 - n);
}

function field(label, value, note, cls = '') {
  return `<div class="${cls}"><dt>${label}</dt><dd>${value}</dd><dt><small>${note}</small></dt></div>`;
}

function renderCrumbs() {
  const band = bandByKey(app.hand.band);
  const rec = store.record(app.hand.id);
  el.crumbs.innerHTML = `${app.label}<b>${band.label}<span class="band"> ${band.blurb}</span></b>`;
  el.readout.innerHTML = [
    field('牌面', app.hand.deal.map(rankName).join(' · '), `全四张可解：${app.hand.solvable ? '是' : '否'}`),
    field('张数', app.hand.cards, '最少需要', 'cards'),
    field('步数', app.game.moves, `认证最少 ${app.hand.steps}`, 'par'),
    field('算式', app.hand.exprs, app.hand.exprs === 1 ? '独解' : '本质不同条数', 'exprs'),
    field('分数', app.hand.fraction ? '必需' : '不必', '整数中间值够不够', app.hand.fraction ? 'warn' : ''),
    field('最佳', rec && rec.best ? rec.best : '—', rec && rec.perfect ? '等于最少' : '你的纪录', 'best'),
  ].join('');
  el.undo.disabled = !app.game.moves || app.game.done;
  el.hint.disabled = app.game.done;
}

function renderTotals() {
  const s = store.stats;
  el.totals.innerHTML = `已解 <b>${Object.values(store.records).filter((r) => r.solved).length}</b>/${HANDS}`
    + ` · 最优 <b>${s.perfect}</b>`
    + ` · 提示 <b>${s.hints}</b>`;
}

function renderShelf() {
  if (app.mode === 'home') {
    let html = '';
    for (const band of BANDS) {
      html += `<p class="band-title">${band.label} · ${band.blurb}</p><div class="band-row">`;
      for (const hand of bandIn(band.key)) {
        const n = ALL.indexOf(hand) + 1;
        const rec = store.record(hand.id);
        const cls = [
          hand.id === app.hand.id ? 'here' : '',
          rec && rec.perfect ? 'perfect' : rec && rec.solved ? 'done' : '',
        ].filter(Boolean).join(' ');
        html += `<button type="button" data-id="${hand.id}" class="${cls}" ${n > store.unlocked ? 'disabled' : ''}>${n}<small>${hand.cards}张</small></button>`;
      }
      html += '</div>';
    }
    el.shelf.innerHTML = html;
    el.shelf.querySelectorAll('button[data-id]').forEach((b) => {
      b.addEventListener('click', () => go(`#/lot/${b.dataset.id}`));
    });
    return;
  }
  if (app.mode === 'random') {
    let html = '<p class="band-title">选一段难度</p>';
    for (const band of BANDS) {
      const on = band.key === app.route.band ? 'here' : '';
      html += `<button type="button" class="${on}" data-band="${band.key}">${band.label}<br><small>${band.blurb}</small></button>`;
    }
    html += '<button type="button" class="wide" data-reroll="1">换一手</button>';
    el.shelf.innerHTML = html;
    el.shelf.querySelectorAll('button[data-band]').forEach((b) => {
      b.addEventListener('click', () => go(`#/random/${b.dataset.band}/${token()}`));
    });
    el.shelf.querySelector('[data-reroll]').addEventListener('click', () => go(`#/random/${app.route.band}/${token()}`));
    return;
  }
  if (app.mode === 'daily') {
    const done = app.day && store.dailyDone(app.day);
    el.shelf.innerHTML = `<p class="band-title">今天这四张对所有人相同${done ? ' · 已解出' : ''}</p>`
      + `<button type="button" class="wide" data-back="1">回到第 ${store.unlocked} 手</button>`;
  } else {
    el.shelf.innerHTML = '<p class="band-title">分享的牌局</p>';
  }
  const back = el.shelf.querySelector('[data-back]');
  if (back) back.addEventListener('click', () => go('#/'));
}

function token() {
  return Math.random().toString(36).slice(2, 8);
}

function render() {
  el.modes.querySelectorAll('button').forEach((b) => {
    b.setAttribute('aria-current', String(b.dataset.mode === app.mode));
  });
  renderCrumbs();
  renderTotals();
  renderShelf();
}

function paintStatus() {
  view.redraw();
  if (app.game.done) return;
  if (app.game.live === false) say('这一堆数已经算不出 <b>24</b> 了 —— 撤销一步或重开');
  else if (app.game.live === null) say('搜索预算耗尽，无法判断是否还可达成');
  else say(`仍可达成 · 最少还需 <b>${app.game.need}</b> 步 · 已点选 ${app.game.sel.length} 个数`);
}

// The one place a step happens: the canvas tap, the replay from a test link, and the baked
// plan all arrive here. Illegal asks (wrong order, division by zero, a slot that is not there)
// are refused by js/core/game.js and never reach the move count.
function commit(i, j, op) {
  const r = combine(app.game, i, j, op);
  if (!r.ok) {
    anim.reject();
    audio.play('bad');
    paintStatus();
    renderCrumbs();
    if (r.reason === 'div0') say('除以零不是一步 —— 没有计数');
    else if (r.reason === 'same') say('同一个数不能和自己运算 —— 没有计数');
    else if (r.reason === 'range') say('先点两个数，再点运算符 —— 没有计数');
    else if (r.reason === 'op') say('不认识的运算符 —— 没有计数');
    return false;
  }
  const at = view.tileCentre(app.game.slots.length - 1);
  anim.merge(at.x, at.y);
  audio.play('step');
  if (app.game.done) finish();
  else {
    paintStatus();
    renderCrumbs();
    say(`第 ${app.game.moves} 步：${displayExpr(app.game.ops[app.game.ops.length - 1].expr)}`);
  }
  return true;
}

function pick(i) {
  const sel = toggle(app.game, i);
  anim.select(i);
  audio.play('pick');
  paintStatus();
  return sel;
}

function press(op) {
  const sel = app.game.sel;
  const i = sel.length > 0 ? sel[0] : -1;
  const j = sel.length > 1 ? sel[1] : -1;
  return commit(i, j, op);
}

function finish() {
  const hand = app.hand;
  const g = app.game;
  const rec = store.solve(hand.id, { moves: g.moves, par: hand.steps, hints: app.hints });
  if (app.day) store.markDaily(app.day, hand.id);
  let nextId = '';
  if (app.mode === 'home' || app.mode === 'lot') {
    const at = ALL.indexOf(hand);
    store.unlock(Math.min(HANDS, at + 2));
    nextId = at + 1 < HANDS ? ALL[at + 1].id : '';
  }
  const gr = grade(g);
  el.stars.textContent = stars(gr.stars);
  el.verdict.textContent = gr.label;
  el.tally.innerHTML = `用了 <b>${g.moves}</b> 步 · 搜索最少 <b>${hand.steps}</b> 步 · 本手有 <b>${hand.exprs}</b> 条本质不同算式`
    + ` · 提示 <b>${app.hints}</b>`
    + (rec.best === g.moves ? '<br>这是这一手的最好成绩' : '');
  el.next.hidden = !nextId;
  el.next.dataset.id = nextId;
  el.curtain.hidden = false;
  const at = view.tileCentre(Math.max(0, app.game.slots.length - 1));
  anim.win(at.x, at.y);
  audio.play('win');
  paintStatus();
  render();
}

function go(hash) {
  if (location.hash === hash) apply();
  else location.hash = hash;
}

function apply() {
  const rt = parseHash();
  app.route = rt;
  app.mode = rt.mode;
  if (rt.mode === 'random' && !rt.key) {
    // A bare #/random/solo would mean a different hand on every visit and an unreproducible
    // link, so the token is minted once and written back into the URL.
    location.replace(`${location.pathname}${location.search}#/random/${rt.band}/${token()}`);
    return;
  }
  const r = resolve(rt);
  if (!r.hand) {
    say('这一档还没有烤好的牌局');
    return;
  }
  app.hand = r.hand;
  app.label = r.label;
  app.day = r.day || null;
  app.index = ALL.indexOf(r.hand) + 1;
  app.game = createGame(r.hand);
  app.hints = 0;
  app.paused = false;
  app.started = true;
  syncPause();
  anim.reset();
  el.curtain.hidden = true;
  view.attach(app.game);
  render();
  paintStatus();
}

let toastTimer = 0;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 1800);
}

function shareLink() {
  const url = `${location.origin}${location.pathname}#/lot/${app.hand.id}`;
  const done = () => toast('链接已复制');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(done, () => toast(url));
  } else {
    toast(url);
  }
}

el.modes.addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-mode]');
  if (!b) return;
  if (b.dataset.mode === 'home') go('#/');
  else if (b.dataset.mode === 'daily') go('#/daily');
  else go(`#/random/${BANDS[0].key}/${token()}`);
});

el.undo.addEventListener('click', () => {
  if (undo(app.game)) {
    paintStatus();
    renderCrumbs();
    if (app.game.moves === 0) say('回到起点');
  }
});

el.hint.addEventListener('click', () => {
  if (!app.hand.sample) {
    say('这一手没有可展示的参考算式');
    return;
  }
  app.hints++;
  audio.play('pick');
  say(`参考算式：<b>${displayExpr(app.hand.sample)}</b>（本手共 ${app.hand.exprs} 条本质不同的最简算式）`);
  renderCrumbs();
});

function restart() {
  reset(app.game);
  app.hints = 0;
  // 复位的不只是牌局：时钟、累加器、粒子、脉冲、抖动、发牌进度全部归零，
  // 否则上一手炸到一半的花色点会飘进新的一手。
  anim.reset();
  if (app.paused) setPaused(false);
  el.curtain.hidden = true;
  view.attach(app.game);
  render();
  say('回到起点');
}

// —— 暂停：仿真冻结的开关。累加器一帧都不再推进，牌局状态原样留着 ——
function setPaused(on) {
  const next = !!on;
  if (next === app.paused) return app.paused;
  app.paused = next;
  syncPause();
  return app.paused;
}

function syncPause() {
  if (el.pause) {
    el.pause.textContent = app.paused ? '继续' : '暂停';
    el.pause.setAttribute('aria-pressed', String(app.paused));
  }
  view.setRunning(!app.paused);
  view.redraw();
}

function syncMute() {
  if (!el.mute) return;
  el.mute.textContent = audio.muted ? '音效：关' : '音效：开';
  el.mute.setAttribute('aria-pressed', String(!audio.muted));
}

el.restart.addEventListener('click', restart);
el.again.addEventListener('click', restart);
el.next.addEventListener('click', () => go(`#/lot/${el.next.dataset.id || app.hand.id}`));
el.share.addEventListener('click', shareLink);
el.undo.addEventListener('click', () => audio.play('undo'));
if (el.pause) el.pause.addEventListener('click', () => setPaused(!app.paused));
if (el.mute) el.mute.addEventListener('click', () => { audio.toggle(); syncMute(); });

// 全屏绑到 HUD 上真实存在的 #fullscreen；iOS Safari 不支持 requestFullscreen，
// 这里如实提示而不是静默失败。
function toggleFullscreen() {
  const doc = document;
  if (doc.fullscreenElement || doc.webkitFullscreenElement) {
    const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
    if (exit) exit.call(doc);
    return 'exit';
  }
  const target = el.hud || doc.documentElement;
  const req = target.requestFullscreen || target.webkitRequestFullscreen;
  if (!req) { toast('这个浏览器不支持全屏（iOS Safari 请用系统菜单）'); return 'unsupported'; }
  const p = req.call(target);
  if (p && p.catch) p.catch(() => toast('全屏被浏览器拒绝了'));
  return 'enter';
}
if (el.fullscreen) el.fullscreen.addEventListener('click', () => toggleFullscreen());
document.addEventListener('fullscreenchange', () => {
  if (el.fullscreen) el.fullscreen.setAttribute('aria-pressed', String(!!document.fullscreenElement));
});

function showTutorial(on) {
  if (!el.tutorial) return;
  el.tutorial.hidden = !on;
  if (el.help) el.help.setAttribute('aria-expanded', String(!!on));
}
function toggleTutorial() { showTutorial(el.tutorial && el.tutorial.hidden); }
if (el.help) el.help.addEventListener('click', toggleTutorial);
if (el.tutorialClose) el.tutorialClose.addEventListener('click', () => showTutorial(false));
if (el.tutorial) {
  el.tutorial.addEventListener('click', (ev) => { if (ev.target === el.tutorial) showTutorial(false); });
}
// 首次访问自动讲一遍玩法；看过就不再打扰，这个标记本身也进存档。
function maybeTeach() {
  if (store.tutorialSeen || !el.tutorial) return;
  showTutorial(true);
}
function dismissTutorial() {
  showTutorial(false);
  store.seenTutorial();
}

// Wiping the save is the one destructive thing this game can do, so it asks twice instead of
// firing on a stray click.
let wipeArmed = false;
el.wipe.addEventListener('click', () => {
  if (!wipeArmed) {
    wipeArmed = true;
    toast('再点一次会清空本机全部成绩');
    setTimeout(() => { wipeArmed = false; }, 4000);
    return;
  }
  store.reset();
  wipeArmed = false;
  toast('存档已清空');
  apply();
});

window.addEventListener('hashchange', apply);
window.addEventListener('resize', () => view.measure());
window.addEventListener('keydown', (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const k = ev.key;
  const lower = String(k).toLowerCase();
  if (k === 'Escape') {
    if (el.tutorial && !el.tutorial.hidden) dismissTutorial();
    else if (!el.curtain.hidden) el.curtain.hidden = true;
    else if (app.game.sel.length) { clearSelection(app.game); paintStatus(); }
  } else if (k === 'Enter') {
    if (el.tutorial && !el.tutorial.hidden) dismissTutorial();
    else if (!el.curtain.hidden) el.next.hidden ? el.again.click() : el.next.click();
    else if (!app.game.moves) say('点两个数，再点一个运算符');
  } else if (k >= '1' && k <= '4') {
    if (app.paused) { say('暂停中 —— 按 P 或空格继续'); return; }
    pick(Number(k) - 1);
    view.redraw();
  } else if (k === '+' || k === '-' || k === '*' || k === '/') {
    if (app.paused) { say('暂停中 —— 按 P 或空格继续'); return; }
    press(k);
  } else if (k === ' ' || lower === 'p') {
    setPaused(!app.paused);
  } else if (lower === 'r') {
    restart();
  } else if (lower === 'm') {
    audio.toggle();
    syncMute();
  } else if (lower === 'f') {
    toggleFullscreen();
  } else if (k === '?' || lower === 'h' && ev.shiftKey || lower === 't') {
    toggleTutorial();
  } else if (lower === 'u') {
    el.undo.click();
  } else if (lower === 'h') {
    el.hint.click();
  }
  if ([' ', 'ArrowUp', 'ArrowDown'].includes(k)) ev.preventDefault();
});

view.measure();
syncMute();
registerSW();
// Deliberately no always-on requestAnimationFrame loop: this game is event-driven, so a tab
// that reports itself hidden (headless Chrome does) still paints every committed step. The
// loop in js/view.js only stays mounted while js/anim.js still has something to move.
apply();
maybeTeach();

window.point24 = {
  version: 1,
  get state() {
    return {
      mode: app.mode,
      label: app.label,
      id: app.hand && app.hand.id,
      band: app.hand && app.hand.band,
      index: app.index,
      deal: app.hand ? app.hand.deal.slice() : null,
      cards: app.hand && app.hand.cards,
      steps: app.hand && app.hand.steps,
      exprs: app.hand && app.hand.exprs,
      fraction: app.hand && app.hand.fraction,
      moves: app.game && app.game.moves,
      rejects: app.game && app.game.rejects,
      sel: app.game ? app.game.sel.slice() : [],
      live: app.game && app.game.live,
      need: app.game && app.game.need,
      done: !!(app.game && app.game.done),
      hints: app.hints,
      unlocked: store.unlocked,
      solved: Object.values(store.records).filter((r) => r.solved).length,
      curtain: !el.curtain.hidden,
      paused: app.paused,
      muted: audio.muted,
      reducedMotion: app.reduced,
      tutorial: !!(el.tutorial && !el.tutorial.hidden),
      fullscreen: !!document.fullscreenElement,
      audioNodes: audio.nodes,
      audioBlocked: audio.blocked,
      ctxState: audio.ctxState,
      slots: app.game ? app.game.slots.map((s) => `${s.f.n}/${s.f.d}`) : [],
    };
  },
  get anim() { return view.snapshot(); },
  // 对拍入口：不经 rAF，直接把一帧的时间预算喂进仿真（harness 用它钉死三档帧率）。
  tick(dt) { return anim.advance(dt); },
  setPaused(on) { return setPaused(on); },
  toggleMute() { audio.toggle(); syncMute(); return audio.muted; },
  toggleFullscreen() { return toggleFullscreen(); },
  showTutorial(on) { if (on) showTutorial(true); else dismissTutorial(); return !el.tutorial.hidden; },
  resetAnim() { anim.reset(); return view.snapshot(); },
  get pool() { return poolStats(); },
  load(hash) { go(hash); return app.hand && app.hand.id; },
  hand() { return app.hand; },
  // Where a number tile and an operator key sit right now, in client pixels: what an
  // automated finger needs instead of guessing at the layout.
  numberPoint(i) { return view.numberPoint(i); },
  keyPoint(op) { return view.keyPoint(op); },
  clearPicks() { return clearSelection(app.game); },
  pick(i) { return pick(i); },
  press(op) { return press(op); },
  // The baked certification for this hand: the click sequence that solves it in `steps` ops.
  plan() { return app.hand ? (app.hand.plan || []).map((s) => ({ ...s })) : []; },
  // Play a plan through the same commit() a finger uses.
  play(steps) {
    for (const s of steps || []) commit(s.i, s.j, s.op);
    return app.game.moves;
  },
  hintOnce() { el.hint.click(); return { hints: app.hints, line: el.hintline.textContent }; },
  store,
};
