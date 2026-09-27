// js/core/storage.js. The save file has to survive three hostile environments the game actually
// ships into: no `window` at all (this node run), a `window.localStorage` that throws on read
// (file:// and private windows), and a corrupt payload left by an older build.
//
// The fake below is deliberately transparent: it records what was written, so "degrades to
// memory" is something we observe rather than something we hope.

import { execFileSync } from 'node:child_process';
import { eq, ok, run, test } from '../tools/harness.mjs';

const written = [];
let deny = false;
let payload = null;

globalThis.window = {
  localStorage: {
    getItem() {
      if (deny) throw new Error('SecurityError: storage is disabled');
      return payload;
    },
    setItem(_key, value) {
      if (deny) throw new Error('QuotaExceededError');
      payload = String(value);
      written.push(String(value));
    },
    removeItem() {
      if (deny) throw new Error('SecurityError: storage is disabled');
      payload = null;
    },
  },
};

// A payload the parser cannot read: the recovery path has to be taken before the first import.
payload = '{"records": {"broken";';
const { store } = await import('../js/core/storage.js');

function saved() {
  return payload ? JSON.parse(payload) : null;
}

test('a corrupt save starts a clean game instead of a stack trace', () => {
  eq(store.record('anything'), null, 'nothing is readable out of garbage');
  eq(store.unlocked, 1, 'and the campaign starts at level 1');
  eq(store.stats, { solves: 0, perfect: 0, ops: 0, hints: 0 }, 'fresh stats');
  eq(store.daily, {}, 'no daily history');
});

test('best only goes down, plays only go up', () => {
  store.reset();
  eq(store.solve('solo-01', { moves: 5, par: 3, hints: 0 }), { solved: true, best: 5, plays: 1, perfect: false }, 'first write');
  eq(store.solve('solo-01', { moves: 7, par: 3, hints: 0 }).best, 5, 'a worse replay reports the retained best, not its own count');
  eq(store.record('solo-01').best, 5, 'best only ever moves down');
  eq(store.record('solo-01').plays, 2, 'both attempts counted');
  eq(store.solve('solo-01', { moves: 3, par: 3, hints: 0 }).best, 3, 'matching par is a perfect solve');
  eq(store.record('solo-01').perfect, true, 'and the flag sticks once earned');
  eq(store.solve('solo-01', { moves: 9, par: 3, hints: 0 }).best, 3, 'a bad replay cannot dirty the best');
  eq(store.stats.solves, 4, 'every attempt is in the totals');
  eq(store.stats.perfect, 1, 'only the par-or-better, hint-free one is graded perfect');
  eq(store.stats.ops, 5 + 7 + 3 + 9, 'ops accumulate');
});

test('a hint is on the record, and it is what the 最优 counter refuses to credit', () => {
  store.reset();
  const r = store.solve('open-02', { moves: 2, par: 2, hints: 1 });
  eq([r.best, r.perfect], [2, true], 'the run really did use par operations, so the hand reads 等于最少');
  eq(store.stats.perfect, 0, 'but the session 最优 tally does not count a hinted run');
  eq(store.stats.hints, 1, 'and the hint itself is on the totals, where the shell prints it');
});

test('unlocking is monotone', () => {
  store.reset();
  eq(store.unlocked, 1, 'start');
  eq(store.unlock(4), 4, 'clearing hand 3 opens hand 4');
  eq(store.unlock(2), 4, 'replaying an early hand never hides a later one');
  eq(store.unlock(4), 4, 'the same progress twice changes nothing');
  eq(saved().unlocked, 4, 'and the monotone value is the one on disk');
});

test('the daily log keys on the date', () => {
  store.reset();
  eq(store.dailyDone('2026-09-27'), null, 'untouched');
  store.markDaily('2026-09-27', 'narrow-05');
  eq(store.dailyDone('2026-09-27').id, 'narrow-05', 'marked');
  eq(store.dailyDone('2026-09-26'), null, 'yesterday is still its own puzzle');
  store.markDaily('2026-09-27', 'solo-02');
  eq(store.dailyDone('2026-09-27').id, 'solo-02', 'a later day-write overwrites that date only');
});

test('a denied localStorage degrades to memory, loudly nowhere', () => {
  const frozen = payload;
  deny = true;
  store.reset();
  const r = store.solve('spark-01', { moves: 1, par: 1, hints: 0 });
  eq([r.best, r.perfect], [1, true], 'the session still works');
  eq(store.unlock(9), 9, 'unlock still advances in memory');
  eq(store.record('spark-01').plays, 1, 'reads see what writes put there');
  store.markDaily('2026-12-01', 'spark-01');
  eq(store.dailyDone('2026-12-01').id, 'spark-01', 'the daily log keeps working too');
  eq(payload, frozen, 'storage itself was untouched: every write and every clear was swallowed');
  deny = false;
});

test('a save written by this build is readable by the next load', () => {
  store.reset();
  store.solve('solo-04', { moves: 3, par: 3, hints: 0 });
  store.unlock(6);
  const onDisk = saved();
  eq(onDisk.records['solo-04'], { solved: true, best: 3, plays: 1, perfect: true }, 'the shape on disk');
  eq(onDisk.unlocked, 6, 'unlock persisted');
  payload = JSON.stringify(onDisk);
  store.reload();
  eq(store.record('solo-04').best, 3, 'a fresh load reads it back');
  eq(store.unlocked, 6, 'including the ladder position');
  payload = '{ "unlocked": "many", "records": { "x": { "best": 2 } } }';
  store.reload();
  eq(store.unlocked, 1, 'a field that is not a number is discarded, not coerced');
  eq(store.record('x').best, 2, 'while a usable record survives');
  payload = '{"stats":{"solves":7}}';
  store.reload();
  eq(store.stats, { solves: 7, perfect: 0, ops: 0, hints: 0 }, 'a partial stats block is filled in');
  ok(written.length > 3, `the fake saw ${written.length} writes, so persist() really runs`);
});

test('clearing the save really clears it', () => {
  payload = JSON.stringify({ records: { 'a': { best: 1 } }, unlocked: 12, daily: { d: { id: 'x' } }, stats: { solves: 4 } });
  store.reload();
  eq([store.unlocked, store.stats.solves, store.record('a').best], [12, 4, 1], 'loaded the save');
  store.reset();
  eq(store.record('a'), null, 'records gone');
  eq(store.unlocked, 1, 'ladder back to the start');
  eq(store.stats.solves, 0, 'stats zeroed');
  eq(store.daily, {}, 'daily log gone');
  eq(payload, null, 'the key was removed from storage, not just the cache');
});

test('with no window anywhere in sight, the module still imports and still plays', () => {
  // The browser case is a guarded localStorage; the node case is that the identifier does not
  // exist at all. ReferenceError has to be caught too, or `node --test` cannot import core.
  const root = new URL('..', import.meta.url).pathname;
  const out = execFileSync(process.execPath, ['-e', [
    "import('./js/core/storage.js').then((m) => {",
    "  m.store.solve('solo-02', { moves: 4, par: 3, hints: 0 });",
    "  console.log(m.store.unlocked, m.store.record('solo-02').best, m.store.stats.solves, m.store.unlock(3));",
    "});",
  ].join('\n')], { cwd: root, encoding: 'utf8' }).trim();
  eq(out, '1 4 1 3', 'a memory-only session behaves exactly like a guarded one');
});

run();
