// The negative control. js/core/intonly.js is a deliberately weaker solver: same exhaustive
// search over all binary trees, but every value on the table has to stay an integer. It shares
// no search code with the rational solver — only the idea of the recursion.
//
// The claim being tested is not "the rational solver is strong". It is the falsifiable one:
// the integer solver says NO to precisely the two hands the textbooks use to show why
// fractions matter, and the rational solver says YES to both with the published expressions.

import { eq, ok, run, test } from '../tools/harness.mjs';
import { intSolve } from '../js/core/intonly.js';
import { assess, reachable } from '../js/core/solve.js';
import { dealAt, dealCount, dealIndex, measure } from '../js/core/make.js';

test('3,3,7,7: the integer-only solver calls it unsolvable', () => {
  const r = intSolve([3, 3, 7, 7]);
  eq(r.solvable, false, 'no all-integer route through all four cards exists');
  eq(r.cards, 3, 'but 3*7+3 = 24 is available with three of them, in integers');
  eq(r.values.includes(24), false, 'the full-hand value set has no 24 in it');
});

test('1,5,5,5: the integer-only solver calls it unsolvable', () => {
  const r = intSolve([1, 5, 5, 5]);
  eq(r.solvable, false, '5*5-1 spends three cards; the fourth cannot be absorbed by integers');
  eq(r.cards, 3, 'which is exactly what cards = 3 says');
  eq(r.values.includes(24), false, 'not in the all-four value set either');
});

test('...and the rational solver solves both, so the pair is evidence', () => {
  for (const deal of [[3, 3, 7, 7], [1, 5, 5, 5]]) {
    const m = assess(deal);
    eq(m.solvable, true, `${deal.join(',')} : rational exhaustive search says yes`);
    eq(intSolve(deal).solvable, false, `${deal.join(',')} : integer-only says no`);
  }
  ok(reachable([3, 3, 7, 7]).values.includes('3/7'), 'the route it found runs through 3/7');
  ok(reachable([1, 5, 5, 5]).values.includes('1/5'), 'and the other one through 1/5');
});

test('1,1,1,1 is unsolvable for both solvers — the negative is not the interesting one', () => {
  eq(intSolve([1, 1, 1, 1]).solvable, false);
  eq(intSolve([1, 1, 1, 1]).cards, null, 'not even a subset works, so cards is null too');
  eq(assess([1, 1, 1, 1]).solvable, false, 'the rational solver agrees here, which is the point');
});

test('hands that never needed fractions stay solvable for the weak solver as well', () => {
  // 1*2*3*4 = 24 keeps every intermediate whole, and 2*3*4 alone does it in three cards.
  eq(intSolve([1, 2, 3, 4]).solvable, true, '1*2*3*4');
  eq(intSolve([1, 2, 3, 4]).cards, 3, '2*3*4 makes the minimum subset three cards');
  eq(intSolve([5, 5, 5, 5]).solvable, true, '(5*5)-(5/5) divides exactly, so integers suffice');
  eq(intSolve([5, 5, 5, 5]).cards, 4, 'and it needs all four');
  eq(intSolve([3, 8, 13, 13]).cards, 2, '3*8 is a pair');
  eq(intSolve([6, 6, 6, 6]).solvable, true, '6+6+6+6');
  eq(intSolve([6, 6, 6, 6]).cards, 4, 'no three sixes reach 24: 6+6+6, 6*6-6, 6*6/6, (6+6)*6 are 18/30/6/72');
});

test('exact division only: every value the weak solver returns is an integer', () => {
  for (const deal of [[1, 3, 7, 11], [2, 5, 9, 13], [1, 1, 2, 2]]) {
    const r = intSolve(deal);
    ok(r.values.every(Number.isInteger), `${deal.join(',')} produced ${r.values.filter((v) => !Number.isInteger(v))}`);
    ok(r.values.length > 3, `${deal.join(',')} : the set is not degenerate`);
  }
  // Members built by hand, not read off the implementation:
  eq(intSolve([1, 1, 2, 2]).values.includes(9), true, '(1+2)*(2+1) = 9 is the ceiling of this hand');
  eq(intSolve([1, 1, 2, 2]).values.includes(24), false, '9 is the ceiling, so 24 is out of reach');
  eq(intSolve([1, 1, 2, 2]).cards, null, 'which is why the minimum subset is undefined here');
  eq(assess([1, 1, 2, 2]).solvable, false, 'the rational solver agrees: fractions do not rescue it');
  eq(intSolve([1, 3, 7, 11]).values.includes(24), false, 'all four integers never land on 24 ...');
  eq(intSolve([1, 3, 7, 11]).cards, 3, '... although (1+7)*3 does it with three of them');
});

test('the weak solver refuses non-integers instead of coercing them', () => {
  let card = null;
  let target = null;
  try {
    intSolve([1, 2, 3, 7.5]);
  } catch (err) {
    card = err.constructor.name;
  }
  try {
    intSolve([1, 2, 3, 4], 24.5);
  } catch (err) {
    target = err.constructor.name;
  }
  eq([card, target], ['TypeError', 'TypeError'], 'a float slipping in would silently weaken the negative control');
});

test('the famous hands are found by name in the index space, not assumed', () => {
  eq(dealAt(dealIndex([3, 3, 7, 7])), [3, 3, 7, 7], 'dealAt/dealIndex agree on 3,3,7,7');
  eq(dealAt(dealIndex([1, 5, 5, 5])), [1, 5, 5, 5], 'and on 1,5,5,5');
  eq(dealIndex([5, 1, 5, 5]), dealIndex([1, 5, 5, 5]), 'the index is of the multiset, not of the order dealt');
  eq(dealIndex([7, 7, 3, 3]), dealIndex([3, 3, 7, 7]), 'same again for the other textbook hand');
});

test('a hand-worked fraction census over {1,3,5,7}', () => {
  // Multisets of 4 cards drawn from 4 ranks: C(4+4-1,4) = 35 hands, all present in the 1820
  // index space. Both textbook hands live in this subspace, so the count of hands that need a
  // fraction is small enough for a reader to re-derive it by hand — and it is exactly 2.
  const pool = [1, 3, 5, 7];
  const list = [];
  for (let a = 0; a < dealCount(); a++) {
    const d = dealAt(a);
    if (d.every((v) => pool.includes(v))) list.push(d);
  }
  eq(list.length, 35, 'the subspace has 35 hands');
  const measured = list.map((d) => ({ deal: d, m: measure(d) }));
  eq(measured.filter((x) => x.m.solvable).length, 20, '20 of them make 24 over the rationals');
  eq(measured.filter((x) => x.m.intSolvable).length, 18, 'the integer-only solver manages 18');
  const needFraction = measured.filter((x) => x.m.fraction).map((x) => x.deal.join()).sort();
  eq(needFraction, ['1,5,5,5', '3,3,7,7'], 'so the two hands that need fractions are precisely the famous pair');
  for (const d of list) {
    eq(intSolve(d).solvable, measure(d).intSolvable, `${d.join(',')} : measure() reports the weak solver honestly`);
  }
});

run();
