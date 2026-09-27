// The content pipeline. This is where the hands in the game come from — the browser never
// solves a hand, it only picks one.
//
// Two passes, both deterministic:
//
//   1. census: every one of the 1820 rank multisets is measured (rational exhaustive solver
//      + the integer-only negative control). This is what prints the band table, the card
//      distribution, the share of hands whose *only* route needs a fractional intermediate,
//      and the real enumeration cost. It is the same loop as the 1362/1820 anchor test, so a
//      re-bake that stops agreeing with the published number is caught here first.
//   2. pick: per band, seeded sampling with rejection counting, deduped by deal, and every
//      hand re-measured from its serialised `deal` before it is written. A hand whose three
//      numbers do not reproduce exactly is a build failure, not a warning.
//
//   node tools/bake.mjs
//   PER_BAND=20 node tools/bake.mjs
//
// Why this cannot ship as on-tap generation: the census below prints the measured median and
// maximum per-hand enumeration cost. Seconds at the top of the ladder is a fine build step
// and an unacceptable tap.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BANDS, bandOf, dealAt, dealCount, isOfferable, makeLot, measure } from '../js/core/make.js';
import { apply, key } from '../js/core/frac.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PER_BAND = Number(process.env.PER_BAND || 12);

const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 100) / 100;
};
const share = (n, d) => `${((n / d) * 100).toFixed(1)}%`;

// ---- 1. census over the whole space -------------------------------------------------
const total = dealCount();
const costs = [];
const cardsDist = {};
const bandDist = {};
let solvable = 0;
let fraction = 0;
let intOnlyOK = 0;
const t0 = Date.now();
for (let i = 0; i < total; i++) {
  const s = Date.now();
  const m = measure(dealAt(i));
  costs.push(Date.now() - s);
  if (!m.ok) throw new Error(`deal ${i} truncated: ${m.reason}`);
  cardsDist[m.cards === null ? 'unsolvable' : m.cards] = (cardsDist[m.cards === null ? 'unsolvable' : m.cards] || 0) + 1;
  if (m.solvable) solvable++;
  if (m.intSolvable) intOnlyOK++;
  if (m.fraction) fraction++;
  const b = bandOf(m);
  bandDist[b || 'rejected'] = (bandDist[b || 'rejected'] || 0) + 1;
}
const censusMs = Date.now() - t0;

console.log(`census over ${total} deals in ${(censusMs / 1000).toFixed(1)}s`);
console.log(`  可解(全四张) ${solvable}/${total} = ${share(solvable, total)}  <- 公开锚点 1362/1820`);
console.log(`  整数中间值可解 ${intOnlyOK}/${total};其中只有分数才可解 ${fraction} 副`);
console.log(`  最少张数分布 ${JSON.stringify(cardsDist)}`);
console.log(`  难度带 ${Object.entries(bandDist).map(([k, n]) => `${k}:${n}`).join(' ')}`);
console.log(`  单副穷举耗时 中位 ${median(costs)}ms · 最大 ${Math.max(...costs)}ms`);

// ---- 2. per-band seeded pick --------------------------------------------------------
const out = [];
const seen = new Set();
for (const band of BANDS) {
  const stats = {};
  const picked = [];
  const tb = Date.now();
  for (let s = 0; picked.length < PER_BAND && s < PER_BAND * 40; s++) {
    const lot = makeLot(`bake-${band.key}-${s}`, band.key, stats);
    if (!lot) break;
    const sig = lot.deal.join(',');
    if (seen.has(sig)) {
      stats.duplicate = (stats.duplicate || 0) + 1;
      continue;
    }
    // Re-measure from the serialised deal: the numbers on screen must be reproducible from
    // the bytes that ship, not from whatever the sampler happened to hold.
    const again = measure(lot.deal);
    for (const f of ['cards', 'steps', 'exprs', 'solvable', 'sample', 'intSolvable', 'fraction']) {
      if (JSON.stringify(again[f]) !== JSON.stringify(lot.metric[f])) {
        throw new Error(`${band.key} ${sig}: ${f} not reproducible (${lot.metric[f]} vs ${again[f]})`);
      }
    }
    if (again.steps !== again.cards - 1) {
      throw new Error(`${band.key} ${sig}: steps ${again.steps} != cards-1 ${again.cards - 1}`);
    }
    if (!again.plan || again.plan.length !== again.cards - 1) {
      throw new Error(`${band.key} ${sig}: plan length ${again.plan && again.plan.length} != cards-1`);
    }
    // And the plan has to actually play out to the target through the same single-step rule
    // the player's clicks go through.
    let slots = again.deal.map((r) => `${r}/1`);
    for (const st of again.plan) {
      const a = { n: Number(slots[st.i].split('/')[0]), d: Number(slots[st.i].split('/')[1]) };
      const b = { n: Number(slots[st.j].split('/')[0]), d: Number(slots[st.j].split('/')[1]) };
      const v = apply(st.op, a, b);
      if (!v) throw new Error(`${band.key} ${sig}: plan step ${JSON.stringify(st)} is an illegal step`);
      slots = slots.filter((_, t) => t !== st.i && t !== st.j).concat([key(v)]);
    }
    if (!slots.includes(again.target)) throw new Error(`${band.key} ${sig}: plan does not reach the target`);
    seen.add(sig);
    picked.push({
      id: `${band.key}-${String(picked.length + 1).padStart(2, '0')}`,
      band: band.key,
      deal: again.deal,
      target: again.target,
      cards: again.cards,
      steps: again.steps,
      exprs: again.exprs,
      solvable: again.solvable,
      intCards: again.intCards,
      intSolvable: again.intSolvable,
      fraction: again.fraction,
      sample: again.sample,
      plan: again.plan,
      nodes: again.nodes,
      cost: 0, // filled in below with the re-measured wall time of this exact deal
    });
    process.stdout.write(`\r${band.key}: ${picked.length}/${PER_BAND}  ${((Date.now() - tb) / 1000).toFixed(1)}s   `);
  }
  process.stdout.write('\n');
  // Measured, not inherited from the sampler: the cost of solving this band's hands.
  const bandCosts = picked.map((p) => p.nodes);
  const wallCosts = [];
  for (const p of picked) {
    const s = Date.now();
    measure(p.deal);
    wallCosts.push(Date.now() - s);
  }
  picked.forEach((p, i) => { p.cost = wallCosts[i]; });
  const uniq = picked.filter((p) => p.exprs === 1).length;
  const rej = Object.entries(stats).filter(([k]) => k !== 'found').map(([k, n]) => `${k}:${n}`).join(' ');
  console.log(
    `band ${band.key}(${band.label}) n=${picked.length}` +
    ` cards=${JSON.stringify(picked.reduce((a, p) => ({ ...a, [p.cards]: (a[p.cards] || 0) + 1 }), {}))}` +
    ` exprs=1:${uniq}/${picked.length}=${share(uniq, Math.max(1, picked.length))}` +
    ` 单副耗时 中位${median(wallCosts)}ms/最大${Math.max(...wallCosts)}ms 状态数 中位${median(bandCosts)}/最大${Math.max(...bandCosts)}` +
    ` 拒绝[${rej || '无'}] 尝试${stats.found || 0}次`,
  );
  if (picked.length < PER_BAND) console.error(`warn: ${band.key} only reached ${picked.length} hands`);
  out.push(...picked);
}

// The band note the UI prints is measured off the hands that actually shipped, so a re-bake
// that lands lighter or heavier says so instead of repeating the generator's wish list.
const meta = BANDS.map((b) => {
  const mine = out.filter((l) => l.band === b.key);
  const lo = Math.min(...mine.map((l) => l.cards));
  const hi = Math.max(...mine.map((l) => l.cards));
  const uniq = mine.filter((l) => l.exprs === 1).length;
  return {
    key: b.key, label: b.label, min: lo, max: hi, n: mine.length,
    unique: uniq,
    blurb: `${lo === hi ? `${lo} 张牌` : `${lo}-${hi} 张牌`} · ${mine.length} 副 · ${uniq} 副独解`,
  };
});

const lines = [
  '// Generated by tools/bake.mjs — the hands in this game are measurements, not opinions.',
  '// `cards`/`steps`/`exprs` are what the exhaustive rational solver in js/core/solve.js',
  '// returns for the `deal` on the same line, and `intSolvable`/`intCards` are the integer-only',
  '// negative control from js/core/intonly.js. Re-run `node tools/bake.mjs` instead of',
  '// hand-editing: test/library.test.mjs re-solves every line and fails if a number drifts.',
  `export const BANDS_META = ${JSON.stringify(meta)};`,
  'export const LOTS = [',
  ...out.map((l) => `  ${JSON.stringify(l)},`),
  '];',
  '',
];
const path = join(root, 'js', 'data', 'lots.js');
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, lines.join('\n'));

const byBand = {};
for (const l of out) byBand[l.band] = (byBand[l.band] || 0) + 1;
console.log(`wrote ${out.length} hands (${Object.entries(byBand).map(([k, n]) => `${k}:${n}`).join(' ')}) -> js/data/lots.js`);
