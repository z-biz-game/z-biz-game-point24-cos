// The negative control: the same exhaustive search over all binary trees, but every value on
// the table must stay an integer (division is only allowed when it divides exactly).
//
// This module exists to be *wrong*. "My solver keeps fractions" is an unfalsifiable claim if
// the only evidence is that the solver says yes; the evidence is that a deliberately weaker
// solver, written separately and sharing no code with ./solve.js, says **no** to exactly the
// two hands the textbooks single out — 3,3,7,7 and 1,5,5,5 — while the rational solver says
// yes with (3+3/7)*7 and (5-1/5)*5. test/intonly.test.mjs asserts both halves of that pair.
//
// It is also the all-four-cards question, which is the classic 24 point rule and the shape
// the 1362/1820 anchor is stated in. `cards` here is the same subset question ./solve.js
// asks, so a hand like 3,3,7,7 reports cards 3 (3*7+3, all integers) with solvable false:
// the fraction is needed only once you insist on using every card.

const DIVISIBLE = (a, b) => b !== 0 && a % b === 0;

// The six ordered reductions of an unordered pair, restricted to exact integer arithmetic.
function step(a, b) {
  const out = [];
  out.push(a + b, a * b, a - b, b - a);
  if (DIVISIBLE(a, b)) out.push(a / b);
  if (DIVISIBLE(b, a)) out.push(b / a);
  return out;
}

function state(nums) {
  return nums.slice().sort((x, y) => x - y).join(',');
}

function pairs(n) {
  const out = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) out.push([i, j]);
  return out;
}

function subsets(nums, k, seen, out) {
  const walk = (from, chosen) => {
    if (chosen.length === k) {
      const sig = chosen.slice().sort((x, y) => x - y).join(',');
      if (!seen.has(sig)) {
        seen.add(sig);
        out.push(chosen.slice());
      }
      return;
    }
    const left = k - chosen.length;
    for (let i = from; i <= nums.length - left; i++) {
      chosen.push(nums[i]);
      walk(i + 1, chosen);
      chosen.pop();
    }
  };
  walk(0, []);
  return out;
}

// value set over full combinations of `nums`, integer intermediates only.
function values(nums, ctx) {
  const k = state(nums);
  const hit = ctx.memo.get(k);
  if (hit) return hit;
  if (++ctx.nodes > ctx.limit) throw new RangeError(`整数枚举超过 ${ctx.limit} 个状态`);
  const set = new Set();
  if (nums.length === 1) set.add(nums[0]);
  else {
    for (const [i, j] of pairs(nums.length)) {
      const rest = [];
      for (let t = 0; t < nums.length; t++) if (t !== i && t !== j) rest.push(nums[t]);
      for (const v of step(nums[i], nums[j])) {
        for (const got of values(rest.concat([v]), ctx)) set.add(got);
      }
    }
  }
  ctx.memo.set(k, set);
  return set;
}

// intSolve([3,3,7,7]) -> { solvable:false, cards:3, values:[...] }
// `target` is an integer, and so is every card: the point of this solver is that it cannot
// hold a fraction, so the type is deliberately narrow rather than permissive.
export function intSolve(deal, target = 24, opts = {}) {
  if (!Number.isInteger(target)) throw new TypeError('整数求解器的目标必须是整数');
  const nums = deal.map((x) => {
    if (!Number.isInteger(x)) throw new TypeError('整数求解器只吃整数牌面');
    return x;
  });
  const ctx = { memo: opts.memo || new Map(), limit: opts.limit || 200000, nodes: 0 };
  let cards = null;
  const seen = new Set();
  const out = [];
  for (let k = 1; k <= nums.length && cards === null; k++) {
    for (const S of subsets(nums, k, seen, out)) {
      if (values(S, ctx).has(target)) {
        cards = k;
        break;
      }
    }
  }
  const all = values(nums, ctx);
  return {
    solvable: all.has(target),
    cards,
    values: [...all].sort((a, b) => a - b),
    nodes: ctx.nodes,
  };
}
