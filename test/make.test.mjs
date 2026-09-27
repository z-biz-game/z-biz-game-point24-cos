// js/core/make.js: the dealing space, the band ladder, and the lot search.
//
// Nothing here trusts a label. A band is a predicate over (cards, exprs), so the assertions
// below are "this hand of four sixes is solo because the solver needs all four cards", worked
// out by hand and then checked against the code — not "the code said so, so it is".

import { eq, ok, run, test } from '../tools/harness.mjs';
import { BANDS, bandOf, dealAt, dealCount, dealFromSeed, dealIndex, isOfferable, makeLot, measure } from '../js/core/make.js';
import { rngFrom } from '../js/core/rng.js';

test('the band ladder is four hand-checkable predicates', () => {
  eq(BANDS.map((b) => b.key), ['spark', 'open', 'narrow', 'solo'], 'the ladder, in order');
  eq(bandOf(measure([3, 4, 12, 12])), 'spark', '12+12 spends two cards, so it is a spark');
  eq(bandOf(measure([4, 7, 8, 12])), 'open', 'three cards with nine distinct routes is wide');
  eq(bandOf(measure([3, 3, 7, 7])), 'narrow', 'three cards, and 3*7+3 is the only shape');
  eq(bandOf(measure([6, 6, 6, 6])), 'solo', '6+6+6+6 needs all four, so it is a solo');
  eq(bandOf(measure([1, 1, 1, 1])), null, 'an unsolvable hand belongs to no band');
});

test('a hand is only offered when all four cards are in on it', () => {
  // 1,3,7,11 is the case the predicate exists for: (1+7)*3 = 24 throws a card away, and the
  // 1362/1820 anchor counts all-four solvability, so this hand is not in the game's universe.
  const m = measure([1, 3, 7, 11]);
  eq([m.cards, m.solvable], [3, false], 'subset yes, whole hand no');
  eq(isOfferable(m), false, 'so the pool rejects it');
  eq(isOfferable(measure([3, 3, 7, 7])), true, '3,3,7,7 makes 24 with all four, in fractions');
  eq(isOfferable(measure([1, 1, 1, 1])), false, 'and 1,1,1,1 never does');
});

test('a seed is the whole story about a deal', () => {
  for (const seed of ['daily-2026-09-27', 'a', '', '24']) {
    const once = dealFromSeed(seed);
    const twice = dealFromSeed(seed);
    eq(once, twice, `seed ${JSON.stringify(seed)} replays exactly`);
    eq(once, dealAt(rngFrom(seed).int(dealCount())), 'and it is the index draw, nothing else');
    eq(once.length, 4, 'four cards');
    ok(once.every((v) => Number.isInteger(v) && v >= 1 && v <= 13), `ranks in 1..13: ${once}`);
    ok(dealIndex(once) >= 0 && dealIndex(once) < dealCount(), `the index ${dealIndex(once)} is inside the space`);
    eq(dealAt(dealIndex(once)), once, 'index -> deal -> index is the identity');
  }
  const spread = new Set();
  for (let i = 0; i < 60; i++) spread.add(dealFromSeed(`spread-${i}`).join());
  ok(spread.size > 30, `60 seeds produced only ${spread.size} distinct hands`);
});

test('measure() reads the cards, it does not rearrange them', () => {
  const deal = [7, 3, 7, 3];
  const before = deal.slice();
  const m = measure(deal);
  eq(deal, before, 'the caller keeps its own array');
  eq([m.cards, m.steps, m.exprs], [3, 2, 1], 'and the numbers are order-independent');
  eq(m.plan.length, m.cards - 1, 'a plan of steps = cards-1');
});

test('makeLot finds hands inside the band it was asked for', () => {
  const stats = {};
  for (const band of BANDS) {
    for (const seed of ['one', 'two']) {
      const lot = makeLot(seed, band.key, stats);
      ok(lot, `${band.key}/${seed} found a hand`);
      eq(lot.band, band.key, 'tagged with the band searched');
      eq(bandOf(lot.metric), band.key, 'and the band predicate agrees with the tag');
      eq(isOfferable(lot.metric), true, 'every lot is solvable with all four cards');
      eq(lot.metric.plan.length, lot.metric.cards - 1, 'the shipped plan has exactly cards-1 steps');
      eq(lot.deal, dealAt(dealIndex(lot.deal)), 'the deal is a real member of the 1820');
    }
  }
  eq(makeLot('x', 'no-such-band'), null, 'an unknown band is not silently treated as a default');
  ok(stats.gaveUp === undefined || stats.gaveUp === 0, `some search gave up: ${stats.gaveUp}`);
});

run();
