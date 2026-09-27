// Save file. One localStorage key, plain JSON, and a versioned shape so an old save can be
// recognised rather than mistaken for a new one.
//
// Records are keyed by lot id (ids in js/data/lots.js are stable only in the sense that a
// re-bake is a new game — see README), plus a daily log and a band unlock pointer. Everything
// here degrades to memory when localStorage is denied, which it is under file://, in a
// private window, and in every `node --test` run: `window` is not even defined there, so the
// guard has to catch ReferenceError, not just SecurityError.

const KEY = 'point24.save.v1';

function blank() {
  return {
    records: {},
    daily: {},
    unlocked: 1,
    stats: { solves: 0, perfect: 0, ops: 0, hints: 0 },
  };
}

let cache = null;

function read() {
  if (cache) return cache;
  let raw = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch (err) {
    raw = null;
  }
  if (raw) {
    try {
      const p = JSON.parse(raw);
      if (p && typeof p === 'object') {
        const base = blank();
        cache = {
          records: p.records && typeof p.records === 'object' ? p.records : base.records,
          daily: p.daily && typeof p.daily === 'object' ? p.daily : base.daily,
          unlocked: Number(p.unlocked) > 0 ? Number(p.unlocked) : base.unlocked,
          stats: { ...base.stats, ...(p.stats || {}) },
        };
        return cache;
      }
    } catch (err) {
      // A corrupt save is not worth keeping; start clean rather than crash the shell.
    }
  }
  cache = blank();
  return cache;
}

function persist() {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cache));
  } catch (err) {
    /* memory-only session */
  }
}

export const store = {
  get records() { return read().records; },
  get stats() { return read().stats; },
  get daily() { return read().daily; },
  get unlocked() { return read().unlocked; },

  record(id) {
    return read().records[id] || null;
  },

  // `par` is the certified fewest operations, so "最优" is a fact about this hand rather than
  // a feeling: you matched the solver.
  solve(id, { moves, par, hints }) {
    const s = read();
    const prev = s.records[id];
    const cur = {
      solved: true,
      best: !prev || !prev.best || moves < prev.best ? moves : prev.best,
      plays: (prev && prev.plays ? prev.plays : 0) + 1,
      perfect: moves <= par || !!(prev && prev.perfect),
    };
    s.records[id] = cur;
    s.stats.solves += 1;
    s.stats.ops += moves;
    s.stats.hints += hints || 0;
    if (moves <= par && !hints) s.stats.perfect += 1;
    persist();
    return cur;
  },

  // Unlocking is monotone: replaying an early hand must never hide the later ones.
  unlock(n) {
    const s = read();
    if (n > s.unlocked) s.unlocked = n;
    persist();
    return s.unlocked;
  },

  markDaily(dateKey, id) {
    const s = read();
    s.daily[dateKey] = { id, at: Date.now() };
    persist();
  },

  dailyDone(dateKey) {
    return read().daily[dateKey] || null;
  },

  // Drop the in-memory mirror and read the key again. The shell does not need this; the test
  // that proves "a save written by this build loads in the next one" does.
  reload() {
    cache = null;
    return read();
  },

  reset() {
    cache = blank();
    try {
      window.localStorage.removeItem(KEY);
    } catch (err) {
      /* nothing was ever persisted */
    }
  },
};
