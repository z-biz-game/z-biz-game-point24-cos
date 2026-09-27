// The shipped hand pool. The game picks hands from here; it never deals-and-solves at
// runtime, and that is a measured decision — tools/bake.mjs holds the numbers.
//
// Everything below is a pure lookup over js/data/lots.js, which is why the daily hand and a
// shared #/lot/<id> link are reproducible without any state: the pool is fixed, and the seed
// only chooses an index.

import { BANDS_META, LOTS } from '../data/lots.js';
import { hashSeed } from './rng.js';

// Display-side band table (label / note / measured range). The generation side, with its
// search budgets, lives in js/core/make.js and is not needed once the hands are baked.
export const BANDS = BANDS_META;

export const ALL = LOTS.map((row) => ({ ...row }));

function pick(list, seed, salt) {
  if (!list.length) return null;
  return list[hashSeed(`${salt}|${seed}`) % list.length];
}

export function bandByKey(key) {
  return BANDS.find((b) => b.key === key) || BANDS[0];
}

export function bandIn(key) {
  return ALL.filter((l) => l.band === key);
}

export function byId(id) {
  return ALL.find((l) => l.id === id) || null;
}

// The campaign: every baked hand, easiest band first and inside a band by the two numbers
// that mean something — fewest cards, then fewest distinct solutions. That is exactly the
// order tools/bake.mjs wrote them in.
export function campaign() {
  return ALL;
}

export function levelAt(index) {
  return ALL[((index % ALL.length) + ALL.length) % ALL.length];
}

// Endless play inside one band. A seed picks, so a shared link stays honest.
export function randomLot(seed, bandKey) {
  const list = bandKey ? bandIn(bandKey) : ALL;
  return pick(list, seed, 'random');
}

// One hand per calendar day, the same for everyone.
export function dailyLot(dateKey) {
  return pick(ALL, dateKey, 'daily');
}

function median(sorted) {
  const m = sorted.length >> 1;
  return sorted.length % 2 ? sorted[m] : Math.round(((sorted[m - 1] + sorted[m]) / 2) * 100) / 100;
}

// What the shipped pool actually contains, measured rather than claimed. A re-bake that
// quietly lands lighter or heavier shows up here rather than in a paragraph of prose.
export function stats() {
  const byBand = {};
  for (const l of ALL) {
    const s = byBand[l.band] || (byBand[l.band] = {
      n: 0, cardsMin: Infinity, cardsMax: 0, stepsMin: Infinity, stepsMax: 0,
      unique: 0, byCards: {}, costs: [],
    });
    s.n++;
    if (l.cards < s.cardsMin) s.cardsMin = l.cards;
    if (l.cards > s.cardsMax) s.cardsMax = l.cards;
    if (l.steps < s.stepsMin) s.stepsMin = l.steps;
    if (l.steps > s.stepsMax) s.stepsMax = l.steps;
    if (l.exprs === 1) s.unique++;
    s.byCards[l.cards] = (s.byCards[l.cards] || 0) + 1;
    s.costs.push(l.cost);
  }
  for (const s of Object.values(byBand)) {
    s.costMed = median(s.costs.slice().sort((a, b) => a - b));
    s.costMax = Math.max(...s.costs);
    s.uniqueShare = Math.round((s.unique / s.n) * 1000) / 1000;
    delete s.costs;
  }
  return { hands: ALL.length, byBand };
}
