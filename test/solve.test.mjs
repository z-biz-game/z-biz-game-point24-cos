// The exhaustive rational solver. This is the only place difficulty is decided in this game,
// so every expectation below is typed in by hand from arithmetic a person can do on paper —
// none of it is read back out of the code under test.
//
// Hand-derived fixtures, written out:
//   3,3,7,7   3*7 = 21, +3 = 24, so three cards and two operations. The fourth card is only
//             needed by the classic all-four rule: (3+3/7)*7. Nothing else with three of
//             these four cards reaches 24, so exprs = 1.
//   1,5,5,5   5*5 = 25, -1 = 24: three cards, two operations, one expression.
//   1,1,1,1   from four 1s the largest value obtainable is (1+1)*(1+1) = 4, so 24 is out.
//   1,2,3,4   2*3*4 = 24 with three cards; the three trees ((2*3)*4), ((2*4)*3), ((3*4)*2)
//             are the same product but different shapes, and {1,2,3}, {1,2,4}, {1,3,4} all
//             cap out at 12 — so cards 3, steps 2, exprs 3.
//   3,8,13,13 3*8 = 24: two cards, one operation.
//   5,5,5,5   (5*5) - (5/5) = 24 needs all four: cards 4, steps 3, and it is the only shape.

import { eq, ok, run, test } from '../tools/harness.mjs';
import { Runaway, assess, canMake, minSteps, newMemo, planFor, reachable } from '../js/core/solve.js';
import { F, apply, key } from '../js/core/frac.js';

// Play a plan the way the player's clicks do: combine slots i and j, append the result.
function replay(deal, plan) {
  let slots = deal.map((r) => F(r));
  for (const step of plan) {
    const v = apply(step.op, slots[step.i], slots[step.j]);
    ok(v, `plan step ${JSON.stringify(step)} is legal where it is played`);
    slots = slots.filter((_, t) => t !== step.i && t !== step.j).concat([v]);
  }
  return slots.map(key);
}

test('3,3,7,7 needs three cards, two steps, one expression', () => {
  const r = assess([3, 3, 7, 7]);
  eq([r.cards, r.steps, r.exprs], [3, 2, 1], 'hand-written numbers');
  eq(r.sample, '((3*7)+3)', 'the reference line is the one derived above');
  eq(r.solvable, true, 'and the whole hand closes too, through (3+3/7)*7');
  eq(r.ok, true);
});

test('1,5,5,5 needs three cards, two steps, one expression', () => {
  const r = assess([1, 5, 5, 5]);
  eq([r.cards, r.steps, r.exprs], [3, 2, 1]);
  eq(r.sample, '((5*5)-1)', '25 - 1');
  eq(r.solvable, true, 'the classic four-card line is (5-1/5)*5');
});

test('1,1,1,1 is correctly unsolvable', () => {
  const r = assess([1, 1, 1, 1]);
  eq([r.ok, r.cards, r.steps, r.exprs, r.solvable], [true, null, null, 0, false], 'no subset, no whole');
  eq(r.plan, null, 'and there is nothing to play');
});

test('the value set of four 1s tops out at 4 and still contains 1/3', () => {
  const got = reachable([1, 1, 1, 1]).values;
  ok(!got.includes('24/1'), '24 is not among them — this is the negative anchor');
  ok(got.includes('4/1'), '(1+1)*(1+1) is');
  ok(got.includes('1/3'), '1/(1+1+1) is, so fractions are being carried, not truncated');
  ok(got.includes('0/1'), 'and 1-1');
});

test('1,2,3,4 has three distinct minimal expressions', () => {
  const r = assess([1, 2, 3, 4]);
  eq([r.cards, r.steps, r.exprs], [3, 2, 3], 'the three association shapes of 2*3*4');
  eq(r.sample, '((2*3)*4)', 'lexicographically first of the three');
  eq(r.solvable, true, '1*2*3*4 also closes the whole hand');
});

test('3,8,13,13 is solved by a single pair', () => {
  const r = assess([3, 8, 13, 13]);
  eq([r.cards, r.steps, r.exprs], [2, 1, 1], '3*8 = 24, and 24+13-13 is not a shorter idea');
});

test('5,5,5,5 really does need all four cards', () => {
  const r = assess([5, 5, 5, 5]);
  eq([r.cards, r.steps, r.exprs, r.solvable], [4, 3, 1, true]);
  eq(r.sample, '((5*5)-(5/5))', 'the textbook one');
});

test('steps is computed by a second search and agrees with cards - 1', () => {
  for (const deal of [[3, 3, 7, 7], [1, 5, 5, 5], [1, 2, 3, 4], [3, 8, 13, 13], [5, 5, 5, 5], [4, 4, 10, 4]]) {
    const r = assess(deal);
    const via = minSteps(deal);
    eq(via, r.steps, `${deal.join(',')} : 0-1 BFS says ${via}, subset search says ${r.steps}`);
    eq(r.steps, r.cards - 1, `${deal.join(',')} : steps is cards minus one`);
  }
});

test('a plan plays out through single legal steps and lands on 24', () => {
  for (const deal of [[3, 3, 7, 7], [1, 5, 5, 5], [1, 2, 3, 4], [3, 8, 13, 13], [5, 5, 5, 5], [4, 4, 10, 4], [6, 6, 6, 6]]) {
    const r = assess(deal);
    ok(r.plan && r.plan.length === r.cards - 1, `${deal.join(',')} : ${r.plan && r.plan.length} steps for cards ${r.cards}`);
    ok(replay(deal, r.plan).includes('24/1'), `${deal.join(',')} : the replay reaches the target`);
  }
});

test('planFor answers on its own and says null when nothing works', () => {
  eq(planFor([3, 8, 13, 13]).length, 1, 'one click for a pair that already multiplies');
  eq(planFor([1, 1, 1, 1]), null, 'nothing to suggest on a dead hand');
  eq(replay([3, 3, 7, 7], planFor([3, 3, 7, 7])).includes('24/1'), true, 'and the standalone plan is executable');
});

test('a zero card is carried through the enumeration without crashing it', () => {
  // Hand check: the largest value obtainable from {0,1,2,3} is 3*(2+1) = 9 — every partition
  // of the four cards tops out below that ({3,0}x{2,1} gives 3*3 = 9, {3,2,1}x{0} gives 9,
  // {3,2}x{1,0} gives 8, {3,2,0}x{1} gives 7) — so 24 is out of reach and a 0 operand only
  // ever shows up where a division by it would be illegal.
  const r = assess([0, 1, 2, 3]);
  eq([r.ok, r.cards, r.solvable, r.plan], [true, null, false, null], 'no subset, no whole hand, nothing to play');
  eq(reachable([0, 1, 2, 3]).values.includes('24/1'), false, 'the full-combination value set agrees');
  ok(reachable([0, 1, 2, 3]).values.includes('9/1'), 'and 9 is the top of it');
});

test('the solver is a function of its input: no mutation, same answer twice', () => {
  const deal = [3, 3, 7, 7];
  const before = deal.slice();
  const a = assess(deal);
  eq(deal, before, 'the input array is untouched');
  const b = assess(deal);
  eq([b.cards, b.steps, b.exprs, b.sample, b.nodes], [a.cards, a.steps, a.exprs, a.sample, a.nodes], 'same deal, same search, same numbers');
  eq(canMake(deal), true, 'and the anchor predicate agrees with assess');
});

test('a hard cap raises Runaway instead of quietly answering unsolvable', () => {
  let threw = null;
  try {
    reachable([1, 2, 3, 4], { limit: 1 });
  } catch (err) {
    threw = err;
  }
  ok(threw instanceof Runaway, `expected Runaway, got ${threw && threw.constructor.name}`);
  const capped = assess([1, 2, 3, 4], { limit: 2 });
  eq([capped.ok, capped.truncated], [false, true], 'assess reports that it did not finish');
  ok(!('cards' in capped), 'and it refuses to print a number it did not earn');
});

test('four-of-a-kind hands: only 3,4,5,6,12 make 24', () => {
  // Hand check, four copies of v:
  //   3: 3*3*3-3 = 24   4: 4*4+4+4 = 24   5: (5*5)-(5/5) = 24   6: 6+6+6+6 = 24
  //   12: 12+12+12-12 = 24
  // every other v fails: 4v, 2v^2, v^2+2v, v^3-v, v^3-v^2, 3v^2 and (v+-1)v are all short of
  // 24 or overshoot, and v = 1, 2, 7, 8, 9, 10, 11, 13 were checked case by case.
  const memo = newMemo();
  const t = Date.now();
  const kinds = [];
  for (let v = 1; v <= 13; v++) if (canMake([v, v, v, v], 24, { memo })) kinds.push(v);
  eq(kinds, [3, 4, 5, 6, 12], 'the shared memo sweep');
  ok(Date.now() - t < 5000, 'and thirteen hands take well under a second');
});

test('a target other than 24 works through the same engine', () => {
  eq(canMake([6, 2], 3), true, '6/2 = 3');
  eq(canMake([6, 2], 4), true, '6-2 = 4, so the same pair answers a second question too');
  eq(canMake([6, 2], 10), false, 'and 10 is not reachable from those two');
  eq(assess([2, 3], { target: F(6) }).cards, 2, '2*3 for a target of 6');
});

run();
