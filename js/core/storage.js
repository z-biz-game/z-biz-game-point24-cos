// Save file. One localStorage key, plain JSON, and a versioned shape so an old save can be
// recognised rather than mistaken for a new one.
//
// Records are keyed by lot id (ids in js/data/lots.js are stable only in the sense that a
// re-bake is a new game — see README), plus a daily log and a band unlock pointer. Everything
// here degrades to memory when localStorage is denied, which it is under file://, in a
// private window, and in every `node --test` run: `window` is not even defined there, so the
// guard has to catch ReferenceError, not just SecurityError.

const KEY = 'point24.save.v1';
const MAX_UNLOCK = 9999;

function blank() {
  return {
    records: {},
    daily: {},
    unlocked: 1,
    tutorial: false,
    stats: { solves: 0, perfect: 0, ops: 0, hints: 0 },
  };
}

let cache = null;
let dropped = 0;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : fallback);

// 第二段：一条记录单独清洗。坏就只丢这一条，其余照常读出 —— 这是"一条垃圾档不能冻死整局"
// 的具体落点，也是 test/storage.test.mjs 逐条取证的对象。
function sanitizeRecord(raw) {
  if (!isObj(raw)) return null;
  const best = Number(raw.best);
  if (raw.best !== undefined && !Number.isFinite(best)) return null;
  const plays = num(raw.plays, 0);
  const rec = {
    solved: raw.solved === true || raw.solved === 1,
    best: Number.isFinite(best) && best >= 0 ? Math.round(best) : null,
    plays: Math.round(plays),
    perfect: raw.perfect === true || raw.perfect === 1,
  };
  if (!rec.solved && !rec.best) rec.solved = !!rec.best;
  return rec;
}

function sanitizeRecords(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const id of Object.keys(raw)) {
    const rec = sanitizeRecord(raw[id]);
    if (rec) out[String(id)] = rec;
    else dropped++;
  }
  return out;
}

function sanitizeDaily(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const day of Object.keys(raw)) {
    const v = raw[day];
    if (isObj(v) && typeof v.id === 'string') {
      out[String(day)] = { id: v.id, at: num(v.at, 0) };
    } else if (typeof v === 'string') {
      out[String(day)] = { id: v, at: 0 };
    } else {
      dropped++;
    }
  }
  return out;
}

function sanitizeStats(raw) {
  const base = blank().stats;
  if (!isObj(raw)) return base;
  for (const k of Object.keys(base)) base[k] = Math.round(num(raw[k], base[k]));
  return base;
}

function read() {
  if (cache) return cache;
  let raw = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch (err) {
    raw = null;
  }
  if (raw) {
    // 第一段：只做"这是不是一份可解析的对象"。解析失败 ⇒ 整份作废、退回空白，但游戏照开。
    try {
      const p = JSON.parse(raw);
      if (isObj(p)) {
        const unlocked = Math.round(num(p.unlocked, 1));
        cache = {
          records: sanitizeRecords(p.records),
          daily: sanitizeDaily(p.daily),
          unlocked: unlocked >= 1 ? Math.min(MAX_UNLOCK, unlocked) : 1,
          tutorial: p.tutorial === true || p.tutorial === 1,
          stats: sanitizeStats(p.stats),
        };
        return cache;
      }
      dropped++;
    } catch (err) {
      // A corrupt save is not worth keeping; start clean rather than crash the shell.
      dropped++;
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
  get tutorialSeen() { return !!read().tutorial; },
  get droppedRecords() { read(); return dropped; },

  seenTutorial() {
    const s = read();
    s.tutorial = true;
    persist();
    return s.tutorial;
  },

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
