// THE anchor. Of the 13^4 ordered draws there are C(13+4-1, 4) = 1820 distinct rank
// multisets, and exactly 1362 of them can be made into 24 over the rationals. That number is
// published in every 24-point write-up, so it is the one thing here that cannot be measured
// by the solver grading itself: this file enumerates all 1820 hands through js/core/solve.js
// and requires the count to land on 1362. If fractional intermediates were lost anywhere —
// float arithmetic, a `d !== 1` filter, a top-down search that forgets a partition — the
// number drops and this suite goes red. It runs in a couple of seconds, so it stays in CI.

import { eq, ok, run, test } from '../tools/harness.mjs';
import { BANDS, bandOf, dealAt, dealCount, dealIndex, measure } from '../js/core/make.js';
import { assess, canMake, newMemo } from '../js/core/solve.js';

const EXPECT_SOLVABLE = 1362; // published value, typed in by hand
const EXPECT_HANDS = 1820; // C(16, 4) = 16*15*14*13/24

test('the space really is 1820 multisets', () => {
  eq(dealCount(), EXPECT_HANDS, 'closed form C(13+4-1, 4)');
  eq(16 * 15 * 14 * 13 / 24, 1820, 'arithmetic checked without the binomial helper');
  eq(dealCount() < 13 ** 4, true, 'and smaller than the 28561 ordered draws');
});

test('all 1820 hands enumerated: exactly 1362 make 24', () => {
  const memo = newMemo();
  const t = Date.now();
  let hands = 0;
  let solvable = 0;
  for (let i = 0; i < dealCount(); i++) {
    hands++;
    if (canMake(dealAt(i), 24, { memo })) solvable++;
  }
  const ms = Date.now() - t;
  eq(hands, EXPECT_HANDS, 'the sweep covered the whole space, not a sample of it');
  eq(solvable, EXPECT_SOLVABLE, `1362/1820 — got ${solvable} in ${ms}ms`);
  ok(ms < 30000, `a full sweep in ${ms}ms is cheap enough to keep in CI`);
  ok(memo.size > 1000, `the memo earned its keep: ${memo.size} multiset states`);
});

test('the anchor hands, stated the way the literature states them', () => {
  eq(canMake([3, 3, 7, 7]), true, '(3+3/7)*7 needs a fractional intermediate');
  eq(canMake([1, 5, 5, 5]), true, '(5-1/5)*5 likewise');
  eq(canMake([1, 1, 1, 1]), false, 'and four aces are the standard no');
  eq(canMake([5, 5, 5, 5]), true, '(5*5)-(5/5)');
});

test('dealAt enumerates in lexicographic multiset order and inverts exactly', () => {
  eq(dealAt(0), [1, 1, 1, 1], 'the first hand');
  eq(dealAt(dealCount() - 1), [13, 13, 13, 13], 'the last hand');
  eq(dealAt(1), [1, 1, 1, 2], 'and the second one is the same three aces plus a two');
  let bad = 0;
  for (let i = 0; i < dealCount(); i++) {
    const d = dealAt(i);
    if (dealIndex(d) !== i) bad++;
    if (d.length !== 4 || d.some((v) => v < 1 || v > 13)) bad += 100;
    for (let t = 1; t < d.length; t++) if (d[t] < d[t - 1]) bad += 1000;
  }
  eq(bad, 0, 'every index round-trips and every deal is ascending');
});

test('a deterministic subsample: assess and canMake never disagree', () => {
  const memo = newMemo();
  let checked = 0;
  let solvable = 0;
  for (let i = 0; i < dealCount(); i += 11) {
    const deal = dealAt(i);
    const m = assess(deal, { memo });
    eq(m.ok, true, `${deal.join(',')} : the cap did not fire`);
    eq(m.solvable, canMake(deal, 24, { memo }), `${deal.join(',')} : the two entry points agree`);
    if (m.cards !== null) {
      eq(m.steps, m.cards - 1, `${deal.join(',')} : steps is cards - 1`);
      ok(m.exprs >= 1, `${deal.join(',')} : at least one expression at the optimum`);
      eq(m.plan.length, m.cards - 1, `${deal.join(',')} : the plan is that long`);
      ok(m.cards <= 4 && m.exprs <= 64, `${deal.join(',')} : inside the hand-size budget`);
    } else {
      eq(m.exprs, 0, `${deal.join(',')} : nothing to count`);
    }
    const band = bandOf(m);
    if (m.solvable) {
      ok(band !== null, `${deal.join(',')} : an offerable hand lands in a band (${band})`);
      eq(BANDS.filter((b) => b.of(m)).length, 1, `${deal.join(',')} : exactly one band claims it`);
      solvable++;
    } else {
      eq(band, null, `${deal.join(',')} : a hand the whole four cannot make is never offered`);
    }
    checked++;
  }
  ok(checked === 166, `subsample size ${checked}`);
  ok(solvable > 90 && solvable < 160, `subsample solvable share ${solvable}/${checked}`);
});

test('measure() carries the integer-only verdict next to the rational one', () => {
  const m = measure([3, 3, 7, 7]);
  eq([m.solvable, m.intSolvable, m.fraction], [true, false, true], 'the pair that proves fractions survived');
  eq([m.cards, m.intCards], [3, 3], 'three cards suffice for both solvers, integer 3*7+3 included');
  eq(measure([1, 5, 5, 5]).fraction, true, 'likewise for 1,5,5,5');
  eq(measure([1, 2, 3, 4]).fraction, false, 'a hand that never needed a fraction says so');
  eq(measure([1, 1, 1, 1]).fraction, false, 'and an unsolvable hand is not counted as a fraction case');
});

run();
