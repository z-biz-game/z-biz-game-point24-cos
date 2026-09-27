// The exhaustive solver. This is where every difficulty number in the game comes from, so
// the claim it has to survive is a public one: of the 1820 rank multisets drawn from 1..13,
// exactly 1362 can be made into 24. test/anchor.test.mjs runs all 1820 through here.
//
// Semantics, stated precisely because three different questions get asked of it:
//
//   enumerate(items)  every value reachable by combining ALL of `items` into one number with
//                     binary + - * / over the rationals. Trees are enumerated as unordered
//                     bipartitions of the multiset, so both non-commutative directions of -
//                     and / are visited without doubling the whole search.
//   solvable          the deal used *whole* — the classic 24-point question, and the one the
//                     1362/1820 anchor is about.
//   cards             the fewest cards that suffice, allowing the rest to stay in the pocket.
//                     This is this repo's difficulty axis, not a flavour number.
//   steps             fewest operations, computed by a separate 0-1 BFS over value multisets
//                     (./solve.js:minSteps) and reconciled against cards - 1. Two code paths,
//                     one number.
//   exprs             structurally distinct expressions at the `cards` optimum, modulo
//                     commutativity of + and * only. One expression is the "unique solution"
//                     proof of this repo: fewer is harder.
//
// Everything is memoised on the sorted multiset of fraction keys and every entry point is
// hard-capped: an enumeration that runs away raises Runaway rather than returning a wrong
// "unsolvable". Silently truncating would be the one way to fake the 1362 number.

import { OPS, TARGET, apply, canonical, fmt, key, toFrac } from './frac.js';

export class Runaway extends Error {}

const EMPTY_EXPRS = new Set();

export function newMemo() {
  return new Map();
}

function makeCtx(opts = {}, strings = true) {
  return {
    memo: opts.memo || new Map(),
    limit: opts.limit || 200000,
    exprLimit: opts.exprLimit || 256,
    exprTotal: opts.exprTotal || 400000,
    strings: strings && opts.strings !== false,
    nodes: 0,
    writes: 0,
  };
}

function stateKey(items) {
  return items.map(key).sort().join(',');
}

// Unordered bipartitions into two non-empty halves, deduped by the *multiset* pair they
// produce. With four cards there are at most 7 index splits and fewer multiset splits, which
// is the whole reason a 1820-hand sweep is seconds rather than minutes.
function bipartitions(items) {
  const n = items.length;
  const all = (1 << n) - 1;
  const seen = new Set();
  const out = [];
  for (let m = 1; m < all; m++) {
    const c = all ^ m;
    if (m > c) continue;
    const A = [];
    const B = [];
    for (let i = 0; i < n; i++) (m & (1 << i) ? A : B).push(items[i]);
    const sig = stateKey(A) + '::' + stateKey(B);
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push([A, B]);
  }
  return out;
}

// valueKey -> { f, exprs:Set<string> } over full combinations of `items`.
function enumerate(items, ctx) {
  const sk = stateKey(items);
  const hit = ctx.memo.get(sk);
  if (hit) return hit;
  if (++ctx.nodes > ctx.limit) throw new Runaway(`枚举超过 ${ctx.limit} 个状态`);
  const out = new Map();
  if (items.length === 1) {
    out.set(key(items[0]), { f: items[0], exprs: ctx.strings ? new Set([fmt(items[0])]) : EMPTY_EXPRS });
  } else {
    for (const [A, B] of bipartitions(items)) {
      const fa = enumerate(A, ctx);
      const fb = enumerate(B, ctx);
      for (const ra of fa.values()) {
        for (const rb of fb.values()) {
          const links = [
            ['+', ra.f, rb.f, ra.exprs, rb.exprs],
            ['-', ra.f, rb.f, ra.exprs, rb.exprs],
            ['-', rb.f, ra.f, rb.exprs, ra.exprs],
            ['*', ra.f, rb.f, ra.exprs, rb.exprs],
            ['/', ra.f, rb.f, ra.exprs, rb.exprs],
            ['/', rb.f, ra.f, rb.exprs, ra.exprs],
          ];
          for (const [op, x, y, sx, sy] of links) {
            const v = apply(op, x, y);
            if (!v) continue;
            const k = key(v);
            let row = out.get(k);
            if (!row) {
              row = { f: v, exprs: ctx.strings ? new Set() : EMPTY_EXPRS };
              out.set(k, row);
            }
            if (!ctx.strings) continue;
            for (const a of sx) {
              for (const b of sy) {
                if (row.exprs.size >= ctx.exprLimit) break;
                if (++ctx.writes > ctx.exprTotal) throw new Runaway(`表达式枚举超过 ${ctx.exprTotal} 条`);
                row.exprs.add(canonical(op, a, b));
              }
            }
          }
        }
      }
    }
  }
  ctx.memo.set(sk, out);
  return out;
}

// All k-element sub-multisets of `items`, deduped, in a deterministic order.
function subsetsOf(items, k) {
  const n = items.length;
  const out = [];
  const seen = new Set();
  const walk = (from, chosen) => {
    if (chosen.length === k) {
      const sig = stateKey(chosen);
      if (!seen.has(sig)) {
        seen.add(sig);
        out.push(chosen.slice());
      }
      return;
    }
    const left = k - chosen.length;
    for (let i = from; i <= n - left; i++) {
      chosen.push(items[i]);
      walk(i + 1, chosen);
      chosen.pop();
    }
  };
  walk(0, []);
  return out;
}

// Fewest cards of `items` that can be combined into `tk` (using all of the chosen ones).
function minSubset(items, tk, ctx) {
  for (let k = 1; k <= items.length; k++) {
    for (const S of subsetsOf(items, k)) {
      if (enumerate(S, ctx).has(tk)) return k;
    }
  }
  return null;
}

// Every legal first reduction of a multiset, in a fixed order. Indices are recorded in
// operand order — `op` is applied as items[i] op items[j] — because a step here is something
// a player clicks, and for `-` and `/` which side is which is the whole difference. The two
// commutative operators are visited once per unordered pair.
function reductions(items) {
  const out = [];
  const n = items.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      for (const op of OPS) {
        if ((op === '+' || op === '*') && j < i) continue;
        const v = apply(op, items[i], items[j]);
        if (!v) continue;
        const rest = [];
        for (let t = 0; t < n; t++) if (t !== i && t !== j) rest.push(items[t]);
        out.push({ i, j, op, v, rest: rest.concat([v]) });
      }
    }
  }
  return out;
}

function planWith(items, tk, ctx, guard) {
  if (items.some((v) => key(v) === tk)) return [];
  if (guard <= 0 || items.length < 2) return null;
  let best = null;
  for (const r of reductions(items)) {
    const k = minSubset(r.rest, tk, ctx);
    if (k === null) continue;
    if (!best || k < best.k) best = { k, r };
    if (k === 1) break;
  }
  if (!best) return null;
  const tail = planWith(best.r.rest, tk, ctx, guard - 1);
  if (!tail) return null;
  return [{ i: best.r.i, j: best.r.j, op: best.r.op }, ...tail];
}

// A reduction sequence a player can actually click: step {i, j, op} means "combine slot i
// with slot j in that order", where the slots are positions in the array *as it stands at
// that moment*, the result being appended. `null` means the position cannot reach the target.
export function planFor(values, target = TARGET, opts = {}) {
  const items = values.map(toFrac);
  const ctx = makeCtx(opts, false);
  return planWith(items, key(toFrac(target)), ctx, items.length);
}

// 0-1 BFS over value multisets with two actions: combine two numbers (cost 1) and put one
// card back in the pocket (cost 0). Independent of the subset enumeration above by
// construction — it never asks "which subset", it asks "how many operations" — which is what
// makes it a real cross-check of `cards - 1` rather than a restatement of it.
export function minSteps(values, target = TARGET, opts = {}) {
  const limit = opts.limit || 200000;
  const items = values.map(toFrac);
  const tk = key(toFrac(target));
  if (items.some((v) => key(v) === tk)) return 0;
  const start = items.slice().sort((a, b) => (key(a) < key(b) ? -1 : 1));
  const dist = new Map([[stateKey(start), 0]]);
  const deque = [start];
  let head = 0;
  let popped = 0;
  while (head < deque.length) {
    const cur = deque[head++];
    const d = dist.get(stateKey(cur));
    if (++popped > limit) throw new Runaway(`步数搜索超过 ${limit} 个状态`);
    const moves = [];
    for (let t = 0; t < cur.length; t++) {
      const drop = cur.slice();
      drop.splice(t, 1);
      if (drop.length) moves.push({ items: drop, cost: 0 });
    }
    for (const r of reductions(cur)) moves.push({ items: r.rest, cost: 1 });
    for (const m of moves) {
      if (m.cost === 1 && m.items.some((v) => key(v) === tk)) return d + 1;
      const k = stateKey(m.items);
      const nd = d + m.cost;
      if (dist.has(k) && dist.get(k) <= nd) continue;
      dist.set(k, nd);
      if (m.cost === 0) deque.splice(head, 0, m.items);
      else deque.push(m.items);
    }
  }
  return null;
}

// The value set of a position, with the number of states the enumeration touched. Used by the
// shell to say whether the cards on the table can still make the target.
export function reachable(values, opts = {}) {
  const ctx = makeCtx(opts, false);
  const map = enumerate(values.map(toFrac), ctx);
  return { values: [...map.keys()].sort(), nodes: ctx.nodes, memo: ctx.memo.size };
}

// The anchor predicate: these numbers, used whole, make the target.
export function canMake(values, target = TARGET, opts = {}) {
  const ctx = makeCtx(opts, false);
  return enumerate(values.map(toFrac), ctx).has(key(toFrac(target)));
}

// Everything the game prints about one deal, in one call.
export function assess(deal, opts = {}) {
  const items = deal.map(toFrac);
  const t = toFrac(opts.target || TARGET);
  const tk = key(t);
  const ctx = makeCtx(opts, true);
  try {
    let cards = null;
    const exprs = new Set();
    for (let k = 1; k <= items.length && cards === null; k++) {
      for (const S of subsetsOf(items, k)) {
        const row = enumerate(S, ctx).get(tk);
        if (!row) continue;
        cards = k;
        for (const e of row.exprs) exprs.add(e);
      }
    }
    const solvable = enumerate(items, ctx).has(tk);
    const plan = cards === null ? null : planWith(items, tk, ctx, items.length);
    return {
      ok: true,
      truncated: false,
      deal: items.map((f) => f.n),
      target: tk,
      cards,
      steps: cards === null ? null : minSteps(items, t, { limit: ctx.limit }),
      exprs: cards === null ? 0 : exprs.size,
      sample: cards === null ? null : [...exprs].sort()[0],
      solvable,
      plan: plan || null,
      nodes: ctx.nodes,
    };
  } catch (err) {
    if (!(err instanceof Runaway)) throw err;
    return { ok: false, truncated: true, reason: err.message, nodes: ctx.nodes };
  }
}
