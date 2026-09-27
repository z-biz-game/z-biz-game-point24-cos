// A hand in progress: pure state plus the only rules that touch it. No DOM in here, which is
// what lets test/game.test.mjs and the CDP browser suite drive the exact same object the
// screen does.
//
// What a player does: click two numbers, click an operator, and the pair is replaced by the
// result. The rules are therefore *local* — one step is legal iff the two slots exist and the
// division is not by zero. The exhaustive search never runs on a click; the only global
// question the shell asks is `survey()`, and that is a bounded ≤4-number enumeration whose
// measured cost is printed by tools/bake.mjs (median a few ms, hard-capped anyway).

import { OPS, TARGET, apply, canonical, fmt, key, parseKey } from './frac.js';
import { Runaway, canMake, minSteps } from './solve.js';

export function createGame(lot) {
  const targetKey = lot.target || key(TARGET);
  const slots = lot.deal.map((rank, i) => ({ f: parseKey(`${rank}/1`), expr: String(rank), from: [i] }));
  const game = {
    id: lot.id,
    band: lot.band,
    deal: lot.deal.slice(),
    cards: lot.cards,
    par: lot.steps,
    exprs: lot.exprs,
    sample: lot.sample,
    targetKey,
    targetText: fmt(parseKey(targetKey)),
    slots,
    sel: [],
    ops: [],
    history: [],
    moves: 0,
    done: false,
    rejects: 0,
    live: true,
    need: null,
  };
  survey(game);
  return game;
}

// Click a number. A repeat click releases it; a third click keeps the last two, because the
// operand order is the click order and the newest intent wins.
export function toggle(game, i) {
  if (game.done) return game.sel.slice();
  const at = game.sel.indexOf(i);
  if (at >= 0) game.sel.splice(at, 1);
  else game.sel.push(i);
  while (game.sel.length > 2) game.sel.shift();
  return game.sel.slice();
}

export function clearSelection(game) {
  game.sel = [];
  return game.sel.slice();
}

// Is this pair + operator a legal single step? No mutation, no counting: the view asks before
// it even animates, and main.js refuses the click through combine().
export function check(game, i, j, op) {
  if (game.done) return { ok: false, reason: 'done' };
  if (!OPS.includes(op)) return { ok: false, reason: 'op' };
  const a = game.slots[i];
  const b = game.slots[j];
  if (!a || !b) return { ok: false, reason: 'range' };
  if (i === j) return { ok: false, reason: 'same' };
  if (apply(op, a.f, b.f) === null) return { ok: false, reason: 'div0' };
  return { ok: true };
}

// Commit one step: slots i and j are replaced by their result, appended last. Returns false
// and changes nothing (including the reject counter staying honest) when the step is illegal.
export function combine(game, i, j, op) {
  const verdict = check(game, i, j, op);
  if (!verdict.ok) {
    game.rejects++;
    return { ok: false, reason: verdict.reason };
  }
  const a = game.slots[i];
  const b = game.slots[j];
  const v = apply(op, a.f, b.f);
  const expr = canonical(op, a.expr, b.expr);
  const rest = game.slots.filter((_, t) => t !== i && t !== j);
  game.history.push({ slots: game.slots, ops: game.ops.slice(), moves: game.moves, done: game.done });
  game.slots = rest.concat([{ f: v, expr, from: a.from.concat(b.from) }]);
  game.ops.push({ op, left: a.expr, right: b.expr, expr, value: key(v), used: a.from.concat(b.from) });
  game.moves++;
  game.sel = [];
  if (key(v) === game.targetKey) game.done = true;
  survey(game);
  return { ok: true, reason: game.done ? 'win' : 'move' };
}

export function undo(game) {
  const last = game.history.pop();
  if (!last) return false;
  game.slots = last.slots;
  game.ops = last.ops;
  game.moves = last.moves;
  game.done = last.done;
  game.sel = [];
  survey(game);
  return true;
}

export function reset(game) {
  game.slots = game.deal.map((rank, i) => ({ f: parseKey(`${rank}/1`), expr: String(rank), from: [i] }));
  game.ops = [];
  game.history = [];
  game.moves = 0;
  game.done = false;
  game.sel = [];
  survey(game);
}

// Still reachable, and how many operations are left at best. `null` means the budget ran out
// and the shell says so instead of guessing.
export function survey(game, opts = {}) {
  const limit = opts.limit || 40000;
  const values = game.slots.map((s) => s.f);
  try {
    game.live = canMake(values, parseKey(game.targetKey), { limit });
    game.need = minSteps(values, parseKey(game.targetKey), { limit });
  } catch (err) {
    if (!(err instanceof Runaway)) throw err;
    game.live = null;
    game.need = null;
  }
  return { live: game.live, need: game.need };
}

// Ops used against the certified optimum. Three grades, defined here so the tests can assert
// them instead of reading them off markup.
export function grade(game) {
  const over = game.moves - game.par;
  if (over <= 0) return { key: 'perfect', label: '最优解', stars: 3 };
  if (over <= 1) return { key: 'close', label: '差一步', stars: 2 };
  return { key: 'over', label: '绕了路', stars: 1 };
}
