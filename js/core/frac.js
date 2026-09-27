// Exact rational arithmetic. Every value in this game is {n, d} in lowest terms with d > 0,
// so 1/3*3 is *exactly* 1 and nothing anywhere needs an epsilon comparison.
//
// This file exists because floats lose the puzzle: in IEEE doubles 3*(1/3) is not 24/8 in
// general, and a solver that compares `v === 24` after a division silently drops the whole
// family of hands that only close through a fractional intermediate — (3+3/7)*7 and
// (5-1/5)*5 being the two famous ones. The negative control lives in ./intonly.js.

export function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

// F(n, d) -> normalised fraction, or null when d === 0. Zero always lands on {0, 1}.
export function F(n, d = 1) {
  if (d === 0) return null;
  let num = n;
  let den = d;
  if (den < 0) {
    num = -num;
    den = -den;
  }
  const g = gcd(num, den) || 1;
  return { n: num / g, d: den / g };
}

export const TARGET = F(24);

// The four binary operations the game allows. Subtraction and division are *not* split into
// two entries: the caller picks an ordered pair, which is where the two non-commutative
// directions come from. Adding `b-a` as a seventh op would double the branching of every
// search for no extra expressive power.
export const OPS = ['+', '-', '*', '/'];

export function apply(op, a, b) {
  switch (op) {
    case '+': return F(a.n * b.d + b.n * a.d, a.d * b.d);
    case '-': return F(a.n * b.d - b.n * a.d, a.d * b.d);
    case '*': return F(a.n * b.n, a.d * b.d);
    case '/': return a.n === 0 ? null : F(a.n * b.d, a.d * b.n);
    default: return null;
  }
}

// A fraction as a Map/Set key. `${n}/${d}` is unique because F() normalises signs and gcd.
export function key(f) {
  return `${f.n}/${f.d}`;
}

export function parseKey(s) {
  const i = s.indexOf('/');
  return F(Number(s.slice(0, i)), Number(s.slice(i + 1)));
}

// Accept either a plain number or an already-normalised fraction, so callers can hand the
// solver `[3, 3, 7, 7]` or a mid-game board of fractions.
export function toFrac(x) {
  if (x && typeof x === 'object' && typeof x.n === 'number' && typeof x.d === 'number') return x;
  return F(x, 1);
}

export function fmt(f) {
  return f.d === 1 ? String(f.n) : `${f.n}/${f.d}`;
}

// Canonical expression text. `+` and `*` get their children sorted, so the two spellings an
// unordered pair produces collapse into one string; `-` and `/` keep the order the player
// chose. Two strings are equal iff the trees are equal modulo commutativity — associativity
// is *not* folded away, and that is deliberate: (2*3)*4 and 2*(3*4) are two ways to think
// about the hand, and the `exprs` number the game prints counts them separately.
export function canonical(op, a, b) {
  if (op === '+' || op === '*') {
    const sym = op === '+' ? '+' : '*';
    return a <= b ? `(${a}${sym}${b})` : `(${b}${sym}${a})`;
  }
  return `(${a}${op}${b})`;
}

// The same tree, typeset for the canvas: ASCII operators in, glyphs out, with the fractions
// inside leaves left alone.
export function displayExpr(text) {
  return text.replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−');
}
