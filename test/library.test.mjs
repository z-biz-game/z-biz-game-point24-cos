// The shipped pool, re-checked. js/data/lots.js is a build artifact of tools/bake.mjs, and a
// build artifact is exactly the kind of file that drifts: someone regenerates with a changed
// solver and the numbers in the data stop meaning what the game prints.
//
// So this suite re-solves every single hand from the serialised `deal` and fails if any of the
// seven reported fields moves. It also holds the architectural claim: the browser-side layer
// looks things up, it does not enumerate.

import { readFileSync } from 'node:fs';
import { eq, ok, run, test } from '../tools/harness.mjs';
import { ALL, BANDS, bandIn, byId, campaign, dailyLot, levelAt, randomLot, stats } from '../js/core/library.js';
import { apply, key, parseKey } from '../js/core/frac.js';
import { bandOf, isOfferable, measure } from '../js/core/make.js';

test('the pool is what the game says it is', () => {
  eq(ALL.length > 0, true, `${ALL.length} hands baked`);
  eq(campaign(), ALL, 'the campaign is the pool, in baked order');
  eq(new Set(ALL.map((l) => l.id)).size, ALL.length, 'ids are unique');
  eq(ALL.every((l) => BANDS.some((b) => b.key === l.band) && l.id.startsWith(l.band)), true, 'every id carries its band');
  eq(ALL.filter((l) => l.band === 'solo').length, bandIn('solo').length, 'bandIn agrees with the pool');
  eq(bandIn('no-such-band'), [], 'an unknown band is simply empty, not everything');
});

test('every baked hand re-solves to the numbers printed beside it', () => {
  for (const lot of ALL) {
    const m = measure(lot.deal);
    eq(m.ok, true, `${lot.id} still measures without running out of budget`);
    eq(
      [m.cards, m.steps, m.exprs, m.solvable, m.intSolvable, m.fraction],
      [lot.cards, lot.steps, lot.exprs, lot.solvable, lot.intSolvable, lot.fraction],
      `${lot.id} ${lot.deal.join(',')} reproduces its baked metrics`,
    );
    eq(m.plan.length, lot.cards - 1, `${lot.id}: the plan is exactly cards-1 steps long`);
    eq(m.sample, lot.sample, `${lot.id}: the sample expression is the baked one`);
  }
});

test('the fewest-steps and fewest-cards answers agree, and the plan plays out', () => {
  for (const lot of ALL) {
    eq(lot.steps, lot.cards - 1, `${lot.id}: ${lot.steps} ops for ${lot.cards} cards`);
    let slots = lot.deal.map((v) => `${v}/1`);
    eq(slots.length, 4, `${lot.id}: the hand starts with four tiles`);
    for (const [n, st] of lot.plan.entries()) {
      const a = parseKey(slots[st.i]);
      const b = parseKey(slots[st.j]);
      ok(a && b, `${lot.id}: plan step ${JSON.stringify(st)} points at two real slots`);
      const v = apply(st.op, a, b);
      ok(v !== null, `${lot.id}: plan step ${JSON.stringify(st)} is legal (no division by zero)`);
      slots = slots.filter((_, t) => t !== st.i && t !== st.j).concat([key(v)]);
      eq(slots.length, 4 - (n + 1), `${lot.id}: step ${n + 1} leaves one fewer tile on the table`);
      ok(n === lot.plan.length - 1 || !slots.includes(lot.target), `${lot.id}: the target appears on the last step only`);
    }
    ok(slots.includes(lot.target), `${lot.id}: playing the baked plan puts ${lot.target} on the table`);
  }
});

test('band tags are re-derivable from the metrics, not remembered from the bake', () => {
  for (const lot of ALL) {
    const m = measure(lot.deal);
    eq(bandOf(m), lot.band, `${lot.id} is still a ${lot.band}`);
    eq(isOfferable(m), true, `${lot.id} is still offered: all four cards make ${lot.target}`);
  }
});

test('lookups are pure functions of their key', () => {
  const first = byId('spark-01');
  eq(first && first.deal, [3, 4, 12, 12], 'spark-01: 12+12, two cards, as baked');
  eq(byId('does-not-exist'), null, 'a bad id resolves to nothing rather than to the first hand');
  eq(levelAt(0), ALL[0], 'levelAt(0) is the top of the ladder');
  eq(levelAt(-1), ALL[ALL.length - 1], 'and negative indices wrap instead of throwing');
  eq(levelAt(ALL.length + 3), ALL[3], 'the campaign cycles');
  for (const seed of ['alpha', 'beta', '2026-09-27']) {
    eq(randomLot(seed, 'solo').band, 'solo', `randomLot(${seed}) stays inside the band`);
    eq(randomLot(seed, 'solo'), randomLot(seed, 'solo'), `and ${seed} always picks the same hand`);
    eq(randomLot(seed, 'no-such-band'), null, 'no hand in an unknown band');
    eq(dailyLot(seed), dailyLot(seed), 'the daily hand is a function of the date key alone');
    ok(ALL.includes(dailyLot(seed)), 'the daily hand comes from the pool');
  }
});

test('the reported shape of the pool is a recount, not a claim', () => {
  const s = stats();
  eq(s.hands, ALL.length, 'stats counts the same hands the game loads');
  for (const band of BANDS) {
    const list = bandIn(band.key);
    const one = s.byBand[band.key];
    eq(one.n, list.length, `${band.key} holds ${list.length} hands`);
    eq([one.cardsMin, one.cardsMax], [band.min, band.max], `${band.key} spans ${band.min}..${band.max} cards`);
    eq([one.stepsMin, one.stepsMax], [band.min - 1, band.max - 1], `${band.key} steps follow from cards`);
    const unique = list.filter((l) => l.exprs === 1).length;
    eq(one.uniqueShare, Math.round((unique / list.length) * 1000) / 1000, `${band.key} uniqueness share`);
  }
});

test('the shipped lookup layer never enumerates', () => {
  // The 1362/1820 search is a build-time cost. If library.js starts importing the solvers, the
  // browser is doing exhaustive work again, and this file is where the regression shows up.
  const lib = readFileSync(new URL('../js/core/library.js', import.meta.url), 'utf8');
  eq(/solve\.js|intonly\.js/.test(lib), false, 'library.js imports neither solver');
  eq(/\.\/data\/lots\.js/.test(lib), true, 'and imports the baked pool instead');
  const leaks = [];
  for (const f of ['library.js', 'make.js', 'solve.js', 'frac.js', 'intonly.js', 'rng.js', 'game.js']) {
    if (/window\.|document\./.test(readFileSync(new URL(`../js/core/${f}`, import.meta.url), 'utf8'))) leaks.push(f);
  }
  eq(leaks, [], `no DOM in the core layer: ${leaks.join(',')}`);
});

run();
