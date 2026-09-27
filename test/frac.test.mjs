// Rational arithmetic. Everything the game claims about (3+3/7)*7 rests on this file being
// exact, so the expectations are typed in by hand from fraction rules a person can do on
// paper — not read back out of the implementation.

import { eq, ok, run, test } from '../tools/harness.mjs';
import { F, OPS, apply, canonical, displayExpr, fmt, gcd, key, parseKey, toFrac } from '../js/core/frac.js';

test('F normalises sign and gcd by hand', () => {
  eq(F(4, 6), { n: 2, d: 3 }, '4/6 = 2/3');
  eq(F(4, -6), { n: -2, d: 3 }, 'the sign always ends up on top');
  eq(F(-4, -6), { n: 2, d: 3 }, 'double negative cancels');
  eq(F(0, 7), { n: 0, d: 1 }, 'zero lands on 0/1 and nowhere else');
  eq(F(24), { n: 24, d: 1 }, 'an integer keeps d = 1');
});

test('division by zero returns null instead of throwing or producing Infinity', () => {
  eq(apply('/', F(5), F(0)), null, '5 / 0 is not a number');
  eq(apply('/', F(0), F(0)), null, 'nor is 0 / 0');
  eq(F(1, 0), null, 'and a zero denominator cannot even be built');
});

test('1/3*3 is exactly 1 — the reason floats are banned', () => {
  const third = F(1, 3);
  eq(apply('*', third, F(3)), { n: 1, d: 1 }, 'no epsilon, no 0.9999999999999997');
  eq(key(apply('*', third, F(3))), '1/1', 'and the canonical key is the integer key');
  ok(0.1 + 0.2 !== 0.3, 'the float world this file refuses to join');
});

test('the six binary moves of the game', () => {
  const a = F(3, 7);
  const b = F(3);
  eq(apply('+', a, b), { n: 24, d: 7 }, '3/7 + 3');
  eq(apply('-', a, b), { n: -18, d: 7 }, '3/7 - 3');
  eq(apply('-', b, a), { n: 18, d: 7 }, 'and the other direction, which is a different move');
  eq(apply('*', a, b), { n: 9, d: 7 }, '3/7 * 3');
  eq(apply('/', a, b), { n: 1, d: 7 }, '3/7 / 3');
  eq(apply('/', b, a), { n: 7, d: 1 }, '3 / (3/7) = 7 — this is the step that closes (3+3/7)*7');
  eq(apply('%', a, b), null, 'an operator outside the four is not a move');
});

test('the whole hand (3+3/7)*7 evaluates exactly to 24/1', () => {
  const three = F(3);
  const seven = F(7);
  const inner = apply('/', three, seven);
  eq(inner, { n: 3, d: 7 }, '3/7');
  const sum = apply('+', three, inner);
  eq(sum, { n: 24, d: 7 }, '3 + 3/7');
  eq(apply('*', sum, seven), { n: 24, d: 1 }, 'times 7 closes exactly on the integer 24');
});

test('keys round-trip through parseKey', () => {
  for (const f of [F(-5, 3), F(8), F(0), F(24, 7)]) {
    eq(parseKey(key(f)), f, `${fmt(f)} survives the string form`);
  }
  eq(parseKey('24/1'), F(24), 'the target key parses');
});

test('toFrac takes a rank or a fraction without a float in between', () => {
  eq(toFrac(7), { n: 7, d: 1 });
  eq(toFrac(F(2, 4)), { n: 1, d: 2 }, 'already-normalised input passes through untouched');
});

test('gcd is the ordinary Euclidean one', () => {
  eq([gcd(12, 18), gcd(7, 5), gcd(0, 9), gcd(-12, 18)], [6, 1, 9, 6], 'signs in, magnitudes out');
});

test('canonical quotients commutativity but not associativity', () => {
  eq(canonical('+', '3', '7'), '(3+7)', 'plus keeps the order it was given');
  eq(canonical('+', '7', '3'), '(3+7)', 'and the swapped spelling collapses onto it');
  eq(canonical('*', '(2*3)', '4'), '((2*3)*4)', 'children sort as strings');
  eq(canonical('-', '25', '1'), '(25-1)', 'minus is ordered');
  eq(canonical('/', '3', '7'), '(3/7)', 'divide is ordered');
  ok(canonical('*', '(2*3)', '4') !== canonical('*', '2', '(3*4)'), '(2*3)*4 and 2*(3*4) stay two different trees');
});

test('displayExpr only changes glyphs, never structure', () => {
  eq(displayExpr('((3+3/7)*7)'), '((3+3÷7)×7)', 'the canvas reads as arithmetic');
  eq(displayExpr('(25-1)'), '(25−1)', 'minus becomes a real minus sign');
  eq(OPS.length, 4, 'four operators are on the keyboard');
  eq(OPS, ['+', '-', '*', '/'], 'and they are exactly + - * /');
});

run();
