// 精修波次的回归锁。三件事各钉一颗钉子，都是"行为成立"而不是"字符串命中"：
//   ① 动画仿真在 30/60/120Hz 下、同样虚拟时长必须走到同一末态（定步长累加器），
//      并且用"将 accum += 1/60"的复现法证明这把尺不是空跑；
//   ② 静音是真静音：AudioContext 被 suspend，且静音态一个振荡器都不新建；
//   ③ 存档两段式解码：一条垃圾记录只丢那一条，null / 缺字段 / 类型错 / 越界值都不许抛。
import { test } from 'node:test';
import assert from 'node:assert/strict';

// —— ② / ③ 要在 import 前就把 window 摆好（audio.js / storage.js 读的是全局 window）——
let suspendCalls = 0;
let resumeCalls = 0;
let oscCalls = 0;
const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} });
globalThis.window = {
  AudioContext: function FakeAudioContext() {
    const node = () => ({ connect: (d) => d, disconnect() {}, start() {}, stop() {}, gain: param(), frequency: param(), type: 'sine' });
    return {
      state: 'running', currentTime: 0, destination: {},
      createOscillator: () => { oscCalls++; return node(); },
      createGain: () => node(),
      resume: () => { resumeCalls++; this.state = 'running'; return Promise.resolve(); },
      suspend: () => { suspendCalls++; this.state = 'suspended'; return Promise.resolve(); },
    };
  },
  localStorage: (() => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
  })(),
};

const { createAnim, SIM_STEP } = await import('../js/anim.js');
const { createAudio } = await import('../js/audio.js');
const { store } = await import('../js/core/storage.js');

// 自己的 LCG：绝不用 Math.random，否则三档比的是两次不同的抽样。
function lcg(seed) {
  let s = seed & 0x7fffffff;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

function snapshot(sim) {
  let x = 0;
  let y = 0;
  for (const p of sim.particles) { x += p.x; y += p.y; }
  return {
    steps: sim.steps, clock: +sim.clock.toFixed(9), accum: +sim.accum.toFixed(9),
    deal: +sim.deal.toFixed(9), shake: +sim.shake.toFixed(9), flash: +sim.flash.toFixed(9),
    particles: sim.particles.length, sumX: +x.toFixed(4), sumY: +y.toFixed(4),
    pulse: +sim.pulse.reduce((a, b) => a + b, 0).toFixed(9),
    lift: +sim.lift.reduce((a, b) => a + b, 0).toFixed(9),
  };
}

// 事件按 **sim 步号** 触发而不是按帧号：按帧号在 30/120Hz 下会因取整差一步，凭空造出发散。
function run(fps, seconds) {
  const anim = createAnim({ random: lcg(0x2f6e2b1) });
  const dt = 1 / fps;
  const frames = Math.round(seconds * fps);
  let evAt = 60;
  for (let f = 0; f < frames; f++) {
    anim.advance(dt);
    while (anim.sim.steps >= evAt) { anim.select(0); anim.merge(300, 200); evAt += 120; }
  }
  return snapshot(anim.sim);
}

test('定步长累加器：30/60/120Hz 同样虚拟时长走到同一末态', () => {
  const a = run(30, 3);
  const b = run(60, 3);
  const c = run(120, 3);
  assert.equal(a.steps, b.steps, `步数 ${a.steps} vs ${b.steps}`);
  assert.equal(b.steps, c.steps, `步数 ${b.steps} vs ${c.steps}`);
  assert.deepEqual(a, c);
  assert.deepEqual(b, c);
  assert.ok(a.steps > 300 && a.particles > 0, `仿真确实在跑：steps=${a.steps} particles=${a.particles}`);
});

test('阴性对照：把累加器改成定长 1/60 必须发散（尺子不是空跑）', () => {
  const steps = [30, 60, 120].map((fps) => {
    // 与 run() 同一条流，只是把 advance(dt) 换成 advance(1/60)：帧长信息被丢掉。
    const anim = createAnim({ random: lcg(0x2f6e2b1) });
    const frames = Math.round(3 * fps);
    let evAt = 60;
    for (let f = 0; f < frames; f++) {
      anim.advance(1 / 60);
      while (anim.sim.steps >= evAt) { anim.select(0); anim.merge(300, 200); evAt += 120; }
    }
    return anim.sim.steps;
  });
  const ratio = Math.max(...steps) / Math.min(...steps);
  assert.deepEqual(steps, [180, 360, 720], `实测 ${steps}`);
  assert.ok(ratio > 3.6, `步数发散比 ${ratio.toFixed(2)} 应当远超 3.6 的判阈`);
});

test('静音是真静音：suspend 被调，且静音态不新建任何振荡器', () => {
  const audio = createAudio();
  assert.equal(audio.play('pick'), true);
  const nodesBefore = oscCalls;
  assert.ok(nodesBefore >= 1, '未静音时应当真的建了振荡器');
  assert.equal(audio.mute(), true);
  assert.equal(suspendCalls >= 1, true, 'mute 必须 suspend AudioContext');
  for (let i = 0; i < 5; i++) assert.equal(audio.play('step'), false, '静音态 play() 应当直接拒绝');
  assert.equal(oscCalls, nodesBefore, `静音后不得新建振荡器：${oscCalls} vs ${nodesBefore}`);
  assert.equal(audio.blocked, 5);
  assert.equal(audio.unmute(), false);
  assert.equal(resumeCalls >= 1, true, '解除静音必须 resume');
  assert.equal(audio.play('win'), true);
});

test('存档两段式解码：一条垃圾只丢那一条，不抛异常', () => {
  const KEY = 'point24.save.v1';
  const good = { solved: true, best: 3, plays: 2, perfect: true };
  const raw = JSON.stringify({
    records: {
      ok1: good,
      nully: null,                                   // 垃圾 1：整条 null
      partial: { plays: 'many' },                    // 垃圾 2：类型错 + 缺 best
      weird: 42,                                     // 垃圾 3：根本不是对象
      ok2: { solved: true, best: 4 },                // 缺 plays，应当补 0 而不是丢
    },
    daily: { '2026-01-01': { id: 'solo-01', at: 5 }, broken: null },
    unlocked: -7,                                    // 越界值
    stats: { solves: 'lots', perfect: -3, ops: 9, hints: 1 },
  });
  globalThis.window.localStorage.setItem(KEY, raw);
  store.reload();
  assert.equal(store.record('ok1').best, 3, '好记录必须活下来');
  assert.equal(store.record('ok2').plays, 0, '缺字段补默认值而不是整条丢');
  assert.equal(store.record('nully'), null);
  assert.equal(store.unlocked, 1, `越界 unlocked 要夹回 1，实测 ${store.unlocked}`);
  assert.equal(store.stats.solves, 0, '类型错的 stats 退回默认');
  assert.equal(store.stats.ops, 9, 'stats 里的好字段不受坏字段牵连');
  assert.ok(store.droppedRecords >= 3, `坏记录计数应当 ≥3，实测 ${store.droppedRecords}`);
  // 整份是垃圾也不能崩：JSON 都解不开时退回空白存档。
  globalThis.window.localStorage.setItem(KEY, '{ not json');
  store.reload();
  assert.deepEqual(store.records, {});
  assert.equal(store.unlocked, 1);
});
