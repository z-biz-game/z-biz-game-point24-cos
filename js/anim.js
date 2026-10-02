// 动画仿真层：唯一持有"时间"的地方。刻意不碰 DOM、不读时钟、不用 Math.random ——
// 输入只有 (帧 dt, 事件)，输出只有可读的状态表，所以 /tmp 里的对拍 harness 能把同一份
// 代码分别按 30/60/120Hz 喂同样的虚拟秒数，逐字段比末态。
//
// 帧率无关靠**定步长累加器**做到，而不是靠把 dt 乘进每一行：
//   advance(elapsed) 把帧时间攒进 accum，攒满一个 SIM_STEP 才 step() 一次，
//   step() 里拿到的 dt 恒等于 SIM_STEP ⇒ 位移/阻尼/概率与真实帧率彻底解耦。
// 直接把帧 dt 乘进粒子位移反而是缺陷：一帧 33ms 与 8ms 会走出不同的轨迹。

export const SIM_STEP = 1 / 120;
const MAX_FRAME = 0.25; // 切后台回来的一坨时间不补帧，最多推进 250ms
const GRAVITY = 620;
const DRAG_PER_60 = 0.955;
const PULSE_DECAY_PER_60 = 0.86;
const SHAKE_DECAY_PER_60 = 0.80;
const DEAL_SPEED = 2.6;
const MAX_PARTICLES = 220;

export function createAnim(opts = {}) {
  const random = opts.random || Math.random;
  const sim = {
    clock: 0,
    steps: 0,
    accum: 0,
    deal: 0,
    dealing: false,
    shake: 0,
    flash: 0,
    pulse: [0, 0, 0, 0],
    lift: [0, 0, 0, 0],
    particles: [],
    merged: 0,
    won: 0,
  };
  let reduced = typeof opts.reducedMotion === 'function' ? opts.reducedMotion : () => false;

  function resetSim() {
    sim.clock = 0;
    sim.steps = 0;
    sim.accum = 0;
    sim.deal = 0;
    sim.dealing = true;
    sim.shake = 0;
    sim.flash = 0;
    sim.pulse = [0, 0, 0, 0];
    sim.lift = [0, 0, 0, 0];
    sim.particles.length = 0;
    sim.merged = 0;
    sim.won = 0;
  }

  function spawnBurst(n, cx, cy) {
    if (reduced()) return;
    for (let k = 0; k < n; k++) {
      if (sim.particles.length >= MAX_PARTICLES) sim.particles.shift();
      const a = random() * Math.PI * 2;
      const sp = 120 + random() * 260;
      sim.particles.push({
        x: cx, y: cy,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120,
        life: 0.9 + random() * 0.5,
        age: 0,
        spin: (random() - 0.5) * 9,
        rot: random() * Math.PI,
        size: 9 + random() * 11,
        frame: Math.floor(random() * 4) % 4,
      });
    }
  }

  // —— 事件入口：view 只负责在合适的时机喊一声，数值全在这里长 ——
  const api = {
    sim,
    // 重开/换一手：时钟、累加器、粒子、脉冲、抖动、发牌全部归零，不只是重新发牌。
    reset() { resetSim(); },
    setReducedMotion(fn) { reduced = typeof fn === 'function' ? fn : () => !!fn; },
    isBusy() {
      return sim.dealing || sim.shake > 0.02 || sim.flash > 0.02 || sim.particles.length > 0
        || sim.pulse.some((p) => p > 0.02) || sim.lift.some((p) => p > 0.02);
    },
    deal() { sim.deal = 0; sim.dealing = true; },
    select(i) { if (sim.pulse[i] !== undefined) sim.pulse[i] = 1; },
    reject() { if (!reduced()) sim.shake = 1; },
    merge(cx, cy) {
      sim.merged++;
      spawnBurst(14, cx, cy);
    },
    win(cx, cy) {
      sim.won++;
      sim.flash = 1;
      spawnBurst(46, cx, cy);
    },
    // 一帧的时间预算：秒。累加器把它切成定步长，所以 30/60/120Hz 走同一条轨迹。
    advance(elapsed) {
      let e = Number(elapsed);
      if (!Number.isFinite(e) || e <= 0) return 0;
      if (e > MAX_FRAME) e = MAX_FRAME;
      sim.accum += e;
      let n = 0;
      while (sim.accum >= SIM_STEP) {
        sim.accum -= SIM_STEP;
        step(SIM_STEP);
        n++;
      }
      return n;
    },
  };

  function step(dt) {
    sim.clock += dt;
    sim.steps++;
    if (sim.dealing) {
      sim.deal += dt * DEAL_SPEED;
      if (sim.deal >= 1) { sim.deal = 1; sim.dealing = false; }
    }
    const drag = Math.pow(DRAG_PER_60, dt * 60);
    const decay = Math.pow(PULSE_DECAY_PER_60, dt * 60);
    const shakeK = Math.pow(SHAKE_DECAY_PER_60, dt * 60);
    for (let i = 0; i < sim.pulse.length; i++) sim.pulse[i] *= decay;
    for (let i = 0; i < sim.lift.length; i++) {
      const want = sim.pulse[i] > 0.35 ? 1 : 0;
      sim.lift[i] += (want - sim.lift[i]) * (1 - Math.pow(0.72, dt * 60));
    }
    sim.shake *= shakeK;
    sim.flash *= decay;
    const parts = sim.particles;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.age += dt;
      if (p.age >= p.life) { parts.splice(i, 1); continue; }
      p.vy += GRAVITY * dt;
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
    }
  }

  resetSim();
  return api;
}

// 给 harness 与 HUD 用的紧凑读数：只放会被逐帧改写的量，字段名保持稳定。
export function animSnapshot(sim) {
  let px = 0;
  let py = 0;
  for (const p of sim.particles) { px += p.x; py += p.y; }
  return {
    animClock: Math.round(sim.clock * 1e6) / 1e6,
    simSteps: sim.steps,
    accum: Math.round(sim.accum * 1e9) / 1e9,
    deal: Math.round(sim.deal * 1e6) / 1e6,
    shake: Math.round(sim.shake * 1e6) / 1e6,
    flash: Math.round(sim.flash * 1e6) / 1e6,
    particles: sim.particles.length,
    particleSumX: Math.round(px * 1e4) / 1e4,
    particleSumY: Math.round(py * 1e4) / 1e4,
    pulseSum: Math.round(sim.pulse.reduce((a, b) => a + b, 0) * 1e6) / 1e6,
    liftSum: Math.round(sim.lift.reduce((a, b) => a + b, 0) * 1e6) / 1e6,
    merged: sim.merged,
    won: sim.won,
  };
}
