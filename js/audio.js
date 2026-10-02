// 音效：短促的牌桌声（点牌、落子、非法、算成）。三条硬要求：
//   ① 真静音 = AudioContext.suspend()，且静音态**一个振荡器都不新建**（只把 gain 设 0
//      是假静音：图还在画、节点还在建、CPU 还在烧，探针一眼看穿）。
//   ② 浏览器要求用户手势后才允许出声 ⇒ ctx 懒建，建不了就安静地退化成哑巴。
//   ③ 状态可读：muted / nodes / ctxState 挂出去，供 window.point24 与 harness 取证。

const TONES = {
  pick: { freq: 520, to: 660, dur: 0.07, type: 'triangle', gain: 0.10 },
  step: { freq: 300, to: 470, dur: 0.11, type: 'square', gain: 0.075 },
  bad: { freq: 190, to: 120, dur: 0.14, type: 'sawtooth', gain: 0.085 },
  win: { freq: 620, to: 990, dur: 0.30, type: 'triangle', gain: 0.12 },
  undo: { freq: 440, to: 300, dur: 0.09, type: 'sine', gain: 0.07 },
};

export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;
  let nodes = 0;
  let blocked = 0;

  function ensure() {
    if (ctx) return ctx;
    const Ctor = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = 0.85;
      master.connect(ctx.destination);
    } catch (err) {
      ctx = null;
      master = null;
    }
    return ctx;
  }

  function play(name) {
    const t = TONES[name];
    if (!t) return false;
    if (muted) { blocked++; return false; }
    const c = ensure();
    if (!c) return false;
    if (c.state === 'suspended' && c.resume) { const r = c.resume(); if (r && r.catch) r.catch(() => {}); }
    const now = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = t.type;
    osc.frequency.setValueAtTime(t.freq, now);
    osc.frequency.exponentialRampToValueAtTime(t.to, now + t.dur);
    gain.gain.setValueAtTime(t.gain, now);
    gain.gain.exponentialRampToValueAtTime(0.0005, now + t.dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + t.dur + 0.02);
    nodes++;
    return true;
  }

  return {
    play,
    // 静音：先立旗子（此后 play() 一个节点都不建），再把整条图 suspend 掉。
    mute() {
      muted = true;
      if (ctx && ctx.suspend) { const r = ctx.suspend(); if (r && r.catch) r.catch(() => {}); }
      return muted;
    },
    unmute() {
      muted = false;
      if (ctx && ctx.resume) { const r = ctx.resume(); if (r && r.catch) r.catch(() => {}); }
      return muted;
    },
    toggle() { return muted ? this.unmute() : this.mute(); },
    get muted() { return muted; },
    get nodes() { return nodes; },
    get blocked() { return blocked; },
    get ctxState() { return ctx ? ctx.state : 'none'; },
  };
}
