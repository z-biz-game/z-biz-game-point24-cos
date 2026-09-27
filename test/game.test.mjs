// js/core/game.js — the rule layer under the clicks. Two numbers, one operator, the pair is
// replaced by its result. Every assertion here is legal in the browser and in node, because
// this module has no DOM in it: tools/playtest.mjs drives the same functions through real
// mouse events, and this file drives them directly.

import { eq, ok, run, test } from '../tools/harness.mjs';
import { byId } from '../js/core/library.js';
import { check, clearSelection, combine, createGame, grade, reset, survey, toggle, undo } from '../js/core/game.js';
import { key } from '../js/core/frac.js';

// A synthetic lot: the shell plays hands that never went through tools/bake.mjs too, and the
// rules must not care where the four numbers came from.
const sampleLots = ['spark-01', 'open-01', 'narrow-01', 'solo-01'].map((id) => byId(id));

function hand(deal, extra = {}) {
  return { id: 'synthetic', band: 'narrow', deal, target: '24/1', cards: null, steps: null, exprs: 0, sample: '', plan: [], ...extra };
}

test('a fresh hand knows what it is and whether it is still alive', () => {
  const g = createGame(byId('narrow-01'));
  eq(g.slots.length, 4, 'four number tiles');
  eq(g.slots.map((s) => key(s.f)), g.deal.map((v) => `${v}/1`), 'each tile starts as its own rank over 1');
  eq([g.cards, g.par, g.moves, g.done, g.rejects], [byId('narrow-01').cards, byId('narrow-01').steps, 0, false, 0], 'no moves yet, par from the bake');
  eq([g.live, g.need], [true, g.par], 'the hand is alive and the certified distance is par');
  eq(createGame(hand([1, 1, 1, 1])).live, false, '1,1,1,1 is dead on arrival: the hint says so at once');
});

test('clicking numbers selects them, and a third click keeps the newest pair', () => {
  const g = createGame(byId('solo-01'));
  eq(toggle(g, 0), [0], 'first click');
  eq(toggle(g, 2), [0, 2], 'second click, order kept because order is meaning here');
  eq(toggle(g, 0), [2], 'clicking a selected tile releases it');
  eq(toggle(g, 1), [2, 1], 'a new pair');
  eq(toggle(g, 3), [1, 3], 'a third click drops the oldest, the newest intent wins');
  eq(clearSelection(g), [], 'clear releases everything');
  eq(g.moves, 0, 'selection is not a move');
});

test('an illegal step is refused, counted as a reject, and changes nothing', () => {
  const g = createGame(hand([3, 3, 7, 7]));
  const before = g.slots.map((s) => key(s.f));
  eq(check(g, 0, 0, '+'), { ok: false, reason: 'same' }, 'a tile is not its own operand');
  eq(check(g, 0, 9, '+'), { ok: false, reason: 'range' }, 'there is no ninth tile');
  eq(check(g, 0, 1, '^'), { ok: false, reason: 'op' }, 'no exponentiation, no square root, ever');
  eq(combine(g, 0, 9, '+'), { ok: false, reason: 'range' }, 'combine refuses through the same door');
  eq(g.slots.map((s) => key(s.f)), before, 'the tiles are untouched');
  eq([g.moves, g.rejects], [0, 1], 'one reject, zero moves: a wrong click is never scored as play');
  eq(combine(g, 0, 1, '-').reason, 'move', '3-3 = 0 is legal, though it costs the hand');
  eq(check(g, 0, 2, '/'), { ok: false, reason: 'div0' }, 'dividing by that zero is refused ...');
  eq(combine(g, 0, 2, '/'), { ok: false, reason: 'div0' }, '... and cannot be sneaked through combine');
  eq([g.moves, g.rejects], [1, 2], 'combine bills a reject; check() is a pure question and bills nothing');
});

test('dividing by zero on a fraction tile is caught the same way', () => {
  const g = createGame(hand([1, 5, 5, 5]));
  combine(g, 0, 1, '/');            // 1/5
  combine(g, 0, 2, '-');            // 5 - 1/5 = 24/5
  eq(g.slots.map((s) => key(s.f)), ['5/1', '24/5'], 'the intermediate is an exact rational');
  eq(check(g, 1, 1, '/').reason, 'same', 'a fraction tile is still not its own operand');
  eq(check(g, 1, 0, '/').ok, true, '(24/5)/5 is a perfectly legal, perfectly useless step');
  const h = createGame(hand([2, 4, 4, 8]));
  combine(h, 1, 2, '-');            // 4-4 = 0
  eq(key(h.slots[2].f), '0/1', 'zero is representable');
  eq(check(h, 0, 2, '/').reason, 'div0', 'and dividing 2 by it is refused');
});

test('the baked plan wins in exactly cards-1 moves', () => {
  for (const lot of sampleLots) {
    const g = createGame(lot);
    for (const st of lot.plan) {
      const r = combine(g, st.i, st.j, st.op);
      ok(r.ok, `${lot.id} step ${JSON.stringify(st)}: ${r.reason}`);
    }
    eq([g.done, g.moves, g.rejects], [true, lot.cards - 1, 0], `${lot.id}: won in ${lot.cards - 1} moves with no refuses`);
    eq(key(g.slots[g.slots.length - 1].f), lot.target, `${lot.id}: the last tile is the target`);
    eq(grade(g).key, 'perfect', `${lot.id}: matched the certified optimum`);
  }
});



test('the hint follows the position, including off the cliff', () => {
  const g = createGame(byId('spark-01'));      // 3,4,12,12: 12+12 wins at once
  eq([g.live, g.need], [true, 1], 'alive, one operation from the target');
  combine(g, 2, 3, '-');                        // 12-12 = 0, legal, and fatal
  eq([g.done, g.live, g.need], [false, false, null], 'a dead position says dead, it does not guess');
  eq(g.slots.map((s) => key(s.f)), ['3/1', '4/1', '0/1'], 'the zero tile is on the table');
  eq(survey(g), { live: false, need: null }, 'survey is idempotent about it');
  undo(g);
  eq([g.slots.map((s) => key(s.f)), g.moves, g.live, g.need], [['3/1', '4/1', '12/1', '12/1'], 0, true, 1], 'undo restores tiles, count and hint');
  eq(undo(g), false, 'nothing left to undo');
});

test('grades are a fact about par, not a mood', () => {
  const g = createGame(byId('solo-01'));
  eq(g.par, 3, 'a four-card hand is three operations');
  eq(grade({ par: 3, moves: 3 }).key, 'perfect', 'at par');
  eq(grade({ par: 3, moves: 4 }).key, 'close', 'one over');
  eq(grade({ par: 3, moves: 9 }).key, 'over', 'three over is three stars short, not a failure to hide');
  eq(grade({ par: 3, moves: 2 }).key, 'perfect', 'and the solver says two is impossible anyway');
});

test('a fractional win is exact, not approximately 24', () => {
  const g = createGame(hand([1, 5, 5, 5], { cards: 3, steps: 2 }));
  combine(g, 0, 1, '/');
  combine(g, 0, 2, '-');
  combine(g, 0, 1, '*');
  eq(g.done, true, 'the (5-1/5)*5 line closes the hand');
  eq(g.moves, 3, 'three operations, one more than the 3-card subset par of 2');
  eq(grade(g).key, 'close', 'one operation over the certified optimum reads as 差一步, never as 最优解');
  eq(grade(g).stars, 2, 'two stars, because the par line exists and this was not it');
  eq(key(g.slots[0].f), '24/1', 'exactly 24/1: 1/3*3 === 1 is the same arithmetic');
  eq(g.ops.map((o) => o.value), ['1/5', '24/5', '24/1'], 'the operation log keeps every intermediate as a fraction');
  reset(g);
  eq([g.slots.map((s) => key(s.f)), g.moves, g.done, g.ops.length], [['1/1', '5/1', '5/1', '5/1'], 0, false, 0], 'reset puts the hand back on the table');
});

run();
