// The dealing table and the difficulty ladder. Both halves are measurements:
//
//   dealAt(i)   the i-th of the C(13+4-1, 4) = 1820 rank multisets, in the same lexicographic
//               order the 1362/1820 anchor is enumerated in. Sampling over indices rather
//               than four independent ranks is what makes the acceptance rate comparable to
//               that published proportion — 1820 equiprobable hands, not 13^4 weighted ones.
//   measure()   ./solve.js (rationals, exhaustive) plus ./intonly.js (integers only), so a
//               lot carries both what it takes and what a solver that lost the fractions
//               would have said about it.
//   BANDS       four bands defined by the measured pair (cards, exprs). Nothing here is a
//               label somebody felt like; `bandOf` is a function of the numbers.
//
// This runs at build time (tools/bake.mjs) and in tests. The shipped game only reads the
// baked pool — the browser never enumerates, see js/core/library.js.

import { assess } from './solve.js';
import { intSolve } from './intonly.js';
import { rngFrom } from './rng.js';

export const DECK = 13;
export const HAND = 4;

// C(n-lo+m, m): nondecreasing sequences of length m with every value in [lo..DECK].
function countFrom(lo, m) {
  const n = DECK - lo + m;
  let r = 1;
  for (let i = 1; i <= m; i++) r = (r * (n - m + i)) / i;
  return r;
}

export function dealCount() {
  return countFrom(1, HAND);
}

// Index -> ascending deal. Deterministic, exhaustive, and the reason a seed is enough to
// share a hand.
export function dealAt(index) {
  const total = dealCount();
  const i = Math.trunc(index);
  if (!(i >= 0) || i >= total) throw new RangeError(`牌局编号 ${index} 不在 0..${total - 1}`);
  let left = i;
  let min = 1;
  const out = [];
  for (let pos = 0; pos < HAND; pos++) {
    for (let v = min; v <= DECK; v++) {
      const c = countFrom(v, HAND - pos - 1);
      if (left < c) {
        out.push(v);
        min = v;
        break;
      }
      left -= c;
    }
  }
  return out;
}

export function dealIndex(deal) {
  const sorted = deal.slice().sort((a, b) => a - b);
  let idx = 0;
  let min = 1;
  for (let pos = 0; pos < HAND; pos++) {
    for (let v = min; v < sorted[pos]; v++) idx += countFrom(v, HAND - pos - 1);
    min = sorted[pos];
  }
  return idx;
}

export function dealFromSeed(seed) {
  return dealAt(rngFrom(seed).int(dealCount()));
}

// Everything the game prints about one deal, plus the integer-only verdict next to it.
export function measure(deal, opts = {}) {
  const m = assess(deal, opts);
  if (!m.ok) return m;
  const ints = intSolve(deal);
  return {
    ...m,
    intCards: ints.cards,
    intSolvable: ints.solvable,
    // "只有允许分数中间值才可解" —— the two textbook hands land here.
    fraction: m.solvable && !ints.solvable,
  };
}

// The ladder, hardest predicate last. `cards` is the axis: how many of the four cards the
// solver actually needs. `exprs` is the uniqueness axis inside a card count.
export const BANDS = [
  { key: 'spark', label: '火花', note: '两张牌就够', of: (m) => m.cards <= 2 },
  { key: 'open', label: '开阔', note: '三张牌 · 多条路', of: (m) => m.cards === 3 && m.exprs >= 3 },
  { key: 'narrow', label: '窄门', note: '三张牌 · 一两步', of: (m) => m.cards === 3 && m.exprs <= 2 },
  { key: 'solo', label: '独解', note: '四张全用', of: (m) => m.cards === 4 },
];

export function bandOf(m) {
  if (!m.ok || m.cards === null || !m.solvable) return null;
  const hit = BANDS.find((b) => b.of(m));
  return hit ? hit.key : null;
}

// A lot is only offered if the *whole* hand is solvable: that is the question the
// 1362/1820 anchor answers, and it keeps a fourth card that is pure poison out of the pool.
export function isOfferable(m) {
  return m.ok && m.cards !== null && m.solvable;
}

export function makeLot(seed, bandKey, stats) {
  const rng = rngFrom(`${bandKey}|${seed}`);
  const band = BANDS.find((b) => b.key === bandKey);
  const hit = (k) => {
    if (stats) stats[k] = (stats[k] || 0) + 1;
  };
  if (!band) return null;
  const tries = 400;
  for (let t = 0; t < tries; t++) {
    const deal = dealAt(rng.int(dealCount()));
    const m = measure(deal);
    if (!m.ok) { hit('runaway'); continue; }
    if (!isOfferable(m)) { hit(m.cards === null ? 'unsolvable' : 'partialOnly'); continue; }
    if (bandOf(m) !== bandKey) { hit('otherBand'); continue; }
    if (stats) stats.found = (stats.found || 0) + 1;
    return { band: bandKey, deal, metric: m, tries: t + 1 };
  }
  hit('gaveUp');
  return null;
}
