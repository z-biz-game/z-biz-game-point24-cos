// Minimal CDP driver for headless playtesting (Node 21+ global WebSocket/fetch).
// env: CDP_PORT (devtools port, default 9340), BASE_URL (page to attach to, default
//      http://127.0.0.1:5180/)
// usage:
//   node playtest.mjs open  <url>          # reuse-or-create our page and navigate
//   node playtest.mjs nav   <url>
//   node playtest.mjs eval  '<js expression>'   # pass `nonav` to skip the reload
//   node playtest.mjs eval  '@boot'         # | @play | @routes | @save | @pointer
//   node playtest.mjs shot  <path.png>
//   node playtest.mjs logs
//
// Every scenario reports { rows, fail } in the same shape as tools/harness.mjs, so
// tools/verify.sh aggregates node suites and browser suites on one line.
const PORT = process.env.CDP_PORT || 9340;
// Which page to attach to. Hard-coding the dev-server port silently evaluates
// against a fresh about:blank tab when pointed at any other origin.
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5180/';
const SHELL_TIMEOUT = Number(process.env.SHELL_TIMEOUT || 30000);
const ORIGIN = new URL(BASE).origin;
const isOurs = (u) => typeof u === 'string' && u.startsWith(ORIGIN);
const cmd = process.argv[2];
const arg = process.argv[3];

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.events = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
        if (globalThis.__printEvents) globalThis.__printEvents(msg);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const info = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new CDP(ws);
  let list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  if (cmd === 'open') {
    for (const t of list) if (t.type === 'page' && isOurs(t.url)) {
      try { await cdp.send('Target.closeTarget', { targetId: t.id || t.targetId }); } catch { /* gone already */ }
    }
    await sleep(300);
    list = [];
  }
  const existing = cmd === 'open' ? null : list.find((t) => t.type === 'page' && isOurs(t.url));
  let targetId, sessionId;
  if (existing) {
    targetId = existing.id || existing.targetId;
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  } else {
    ({ targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' }));
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  }
  const logs = [];
  globalThis.__printEvents = (m) => {
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      const e = m.params.exceptionDetails;
      logs.push(`[EXCEPTION] ${e.exception?.description || e.text}\n  at ${e.url}:${e.lineNumber}`);
    } else if (m.method === 'Log.entryAdded') {
      const e = m.params.entry;
      if (e.level === 'error' || e.source === 'rendering') logs.push(`[log:${e.level}] ${e.text} ${e.url || ''}`);
    }
  };
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Log.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);

  const runJS = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  // Wait on the shell, not on a timer. The page is a module graph fetched over the network:
  // a fixed sleep is long enough for a localhost server and too short for GitHub Pages, where
  // it made an innocent deployment look broken (`window.point24` still undefined, canvas still
  // the unstyled 300x150 default). The floor keeps the local case as fast as it was.
  const waitShell = async (floorMs, budgetMs = SHELL_TIMEOUT) => {
    await sleep(floorMs);
    const deadline = Date.now() + budgetMs;
    for (;;) {
      let ready = false;
      try {
        ready = await runJS('!!(window.point24 && window.point24.state && window.point24.state.id)');
      } catch { ready = false; }
      if (ready) return true;
      if (Date.now() > deadline) return false;
      await sleep(150);
    }
  };

  if (cmd === 'open') {
    await cdp.send('Page.navigate', { url: arg || BASE }, sessionId);
    await waitShell(600);
    console.log('opened ' + (arg || BASE) + '\n' + (logs.join('\n') || '(no console output)'));
  } else if (cmd === 'nav') {
    await cdp.send('Page.navigate', { url: arg }, sessionId);
    await waitShell(400);
    console.log('navigated\n' + (logs.join('\n') || '(no console output)'));
  } else if (cmd === 'eval') {
    if (process.argv[4] !== 'nonav') {
      await cdp.send('Page.navigate', { url: BASE }, sessionId);
      await waitShell(300);
    }
    if (arg && arg.startsWith('@')) {
      const name = arg.slice(1);
      let value = null;
      if (name === 'pointer') {
        value = await pointerScenario(cdp, sessionId, runJS);
      } else if (SCENARIOS[name]) {
        try {
          value = await runJS(SCENARIOS[name]);
        } catch (err) {
          const dumped = await runJS('JSON.stringify(window.__lastRows||[])').catch(() => '[]');
          value = { rows: JSON.parse(dumped) };
          value.rows.push({ test: `@${name} threw`, pass: false, detail: String(err.message).slice(0, 300) });
        }
      } else {
        console.log('unknown scenario ' + name + ' — have ' + Object.keys(SCENARIOS).join(', ') + ', pointer');
        process.exit(1);
      }
      value.fail = (value.rows || []).filter((r) => !r.pass).map((r) => r.test);
      console.log(JSON.stringify(value, null, 2));
    } else {
      try {
        console.log(JSON.stringify(await runJS(arg), null, 2));
      } catch (err) {
        console.log('EVAL THROW: ' + err.message);
      }
    }
    if (logs.length) console.log('--- console ---\n' + logs.join('\n'));
  } else if (cmd === 'shot') {
    await runJS('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    (await import('node:fs')).writeFileSync(arg, Buffer.from(data, 'base64'));
    console.log('wrote ' + arg + ' (' + Math.round(data.length / 1024) + 'kB b64)');
  } else if (cmd === 'logs') {
    await sleep(800);
    console.log(logs.join('\n') || '(none)');
  }
  ws.close();
  process.exit(0);
}

// The one suite a page-side script cannot run: real input. Everything below goes through
// Chrome's own mouse and keyboard over CDP, so what gets asserted is the pointer-to-step
// wiring in js/view.js rather than the arithmetic behind it.
async function pointerScenario(cdp, sessionId, runJS) {
  const rows = [];
  const rec = (name, pass, detail) => rows.push({
    test: name, pass: !!pass,
    detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)),
  });
  const mouse = async (x, y) => {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }, sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }, sessionId);
    await sleep(40);
  };
  const key = (k) => cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown', text: k, key: k, code: 'Key' + k.toUpperCase(), windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0),
  }, sessionId);
  const state = () => runJS('window.point24.state');

  // Where the mouse has to land for one step of the baked plan.
  const clickNumber = async (i) => {
    const p = await runJS(`window.point24.numberPoint(${i})`);
    if (!p) return null;
    await mouse(p.x, p.y);
    return p;
  };
  const clickOp = async (op) => {
    const p = await runJS(`window.point24.keyPoint(${JSON.stringify(op)})`);
    if (!p) return null;
    await mouse(p.x, p.y);
    return p;
  };

  const ids = await runJS(`['board','readout','shelf','hintline','curtain','stars','verdict','tally','undo','hint','restart','share','next','again','wipe','modes','totals','crumbs','toast'].map((i) => [i, !!document.getElementById(i)])`);
  rec('every control the shell reaches for exists', ids.every(([, on]) => on), Object.fromEntries(ids));

  await runJS(`window.point24.load('#/lot/spark-01'); 'ok'`);
  await sleep(200);
  const start = await state();
  const plan = await runJS('window.point24.plan()');
  rec('a shared hand loads with a certified plan', start.id === 'spark-01' && plan.length === start.steps, { id: start.id, steps: start.steps, plan: plan.length });

  // Operator before any number: the click order is the rule, so this must not be a move.
  const beforeOp = await clickOp('+');
  const jumped = await state();
  rec('an operator clicked before two numbers is refused and not counted',
    jumped.moves === 0 && jumped.rejects === 1 && beforeOp && beforeOp.w > 0, { moves: jumped.moves, rejects: jumped.rejects });

  // The same tile twice is not a pair.
  await clickNumber(0);
  const one = await state();
  rec('one number tile is a selection, not a step', one.sel.length === 1 && one.moves === 0, { sel: one.sel });
  await clickNumber(0);
  const off = await state();
  rec('clicking the same tile again releases it', off.sel.length === 0 && off.moves === 0, { sel: off.sel });
  await clickNumber(0);
  await clickNumber(0);
  await clickOp('*');
  const same = await state();
  rec('one tile clicked twice releases itself and cannot be an operand pair',
    same.moves === 0 && same.sel.length === 0 && same.rejects === 2, { moves: same.moves, sel: same.sel, rejects: same.rejects });

  // Blank felt: nothing to pick up. One pixel in from the canvas edge is left of every tile
  // box (the layout pads by PAD), so this is a guaranteed miss.
  const voidPoint = await runJS(`(() => {
    const c = document.getElementById('board').getBoundingClientRect();
    return { x: Math.round(c.left + 1), y: Math.round(c.top + 4) };
  })()`);
  await mouse(voidPoint.x, voidPoint.y);
  rec('clicking the felt outside every tile changes nothing', (await state()).moves === 0, voidPoint);

  // Now play the baked plan with real clicks, one move per three clicks.
  let played = 0;
  const log = [];
  for (const st of plan) {
    await clickNumber(st.i);
    await clickNumber(st.j);
    await clickOp(st.op);
    const after = await state();
    played++;
    log.push({ step: st, moves: after.moves, slots: after.slots.slice() });
    if (after.moves !== played) {
      rec(`click sequence ${played} counted as exactly one move`, false, log);
      played = -1;
      break;
    }
  }
  if (played > 0) rec('the mouse plays the whole certified plan, one move per triple-click', played === plan.length, log);

  const win = await state();
  rec('the hand closes on the target', win.done && win.moves === win.steps && win.slots.includes('24/1'), { moves: win.moves, steps: win.steps, slots: win.slots });
  rec('the win card goes up with three stars', win.curtain
    && (await runJS(`document.getElementById('stars').textContent`)) === '★★★'
    && (await runJS(`document.getElementById('verdict').textContent`)) === '最优解',
  await runJS(`({ stars: document.getElementById('stars').textContent, verdict: document.getElementById('verdict').textContent })`));
  const record = await runJS(`window.point24.store.record('spark-01')`);
  rec('the mouse run is on record at par', !!record && record.best === win.steps && record.perfect === true, record);

  // Division by zero, produced by hand and then asked for with the mouse.
  await runJS(`document.getElementById('restart').click(); 'ok'`);
  await sleep(150);
  await runJS(`window.point24.load('#/lot/spark-01'); 'ok'`);
  await sleep(150);
  await clickNumber(2);            // 12
  await clickNumber(3);            // 12
  await clickOp('-');              // -> 0, legal, and it poisons the hand
  const zeroed = await state();
  rec('12-12 puts an exact zero on the table', zeroed.moves === 1 && zeroed.slots.includes('0/1'), { moves: zeroed.moves, slots: zeroed.slots });
  const before = await state();
  await clickNumber(0);            // 3
  await clickNumber(2);            // 0
  await clickOp('/');              // 3/0 -> refused
  const divided = await state();
  rec('dividing by that zero costs nothing but a reject',
    divided.moves === before.moves && divided.rejects === before.rejects + 1 && divided.done === false,
    { moves: divided.moves, rejects: divided.rejects });
  rec('and the hint says the hand is dead instead of guessing', divided.live === false && divided.need === null, { live: divided.live, need: divided.need, line: await runJS(`document.getElementById('hintline').textContent`) });

  // A fractional hand drawn through the mouse. solo-01 is 7,8,8,13 and its only minimal line
  // is 21 / (7/8) = 24, so a fraction has to survive on the table and then divide the whole
  // number side of the hand. An engine that rounded to 0.875 would still print 24 here; the
  // point of the click sequence is that the tile the player sees is the ratio 7/8 exactly.
  await runJS(`window.point24.load('#/lot/solo-01'); 'ok'`);
  await sleep(180);
  const solo = await state();
  const soloPlan = await runJS('window.point24.plan()');
  rec('a four-card hand announces three operations of par', solo.id === 'solo-01' && solo.cards === 4 && solo.steps === 3 && soloPlan.length === 3, { steps: solo.steps, plan: soloPlan });
  await clickNumber(soloPlan[0].i);
  await clickNumber(soloPlan[0].j);
  await clickOp(soloPlan[0].op);
  const half = await state();
  rec('7/8 sits on the table as an exact ratio, not as 0.875',
    half.moves === 1 && half.slots.includes('7/8'), { slots: half.slots });
  for (const st of soloPlan.slice(1)) {
    await clickNumber(st.i);
    await clickNumber(st.j);
    await clickOp(st.op);
  }
  const afterFrac = await state();
  rec('dividing 21 by that fraction closes the hand at par',
    afterFrac.done && afterFrac.moves === 3 && afterFrac.slots.includes('24/1'),
    { moves: afterFrac.moves, slots: afterFrac.slots, live: afterFrac.live });
  // The negative control, on the panel rather than in a test log: spark-11 (2,3,5,12) is the
  // baked hand whose *whole hand* solvability needs a fraction, so the readout has to say the
  // integer-only solver would have lost it — while the two-card route it plays is integer.
  // The shelf gates that hand behind the campaign ladder, so the scenario unlocks up to it
  // first (store.unlock only ever raises) — the click below stays a real click.
  await runJS(`window.point24.store.unlock(11); 'ok'`);
  await runJS(`window.point24.load('#/'); 'ok'`);
  await sleep(200);
  const shelfBtn = await runJS(`!!document.querySelector('#shelf button[data-id="spark-11"]')`);
  rec('the campaign shelf lists the unlocked hands for a real click', shelfBtn, { unlocked: (await state()).unlocked });
  await runJS(`document.querySelector('#shelf button[data-id="spark-11"]').click(); 'ok'`);
  await sleep(200);
  const sharp = await state();
  rec('the hand that needs fractions is labelled as one',
    sharp.id === 'spark-11' && sharp.fraction === true && /分数/.test(await runJS(`document.getElementById('readout').textContent`))
      && /必需/.test(await runJS(`document.getElementById('readout').textContent`)),
  { id: sharp.id, fraction: sharp.fraction, readout: await runJS(`document.getElementById('readout').textContent`) });
  const sharpBefore = await state();
  await clickNumber(0);
  await clickNumber(3);
  await clickOp('*');
  const sharpWin = await state();
  rec('and it still closes in one click triple at two cards',
    sharpWin.done && sharpWin.moves === 1 && sharpWin.slots.includes('24/1') && sharpBefore.moves === 0, sharpWin.slots);

  // Keyboard shortcuts the panel advertises. The mouse block above ends on spark-11, a
  // one-step hand: playing its whole plan wins, the curtain goes up and the shell disables
  // undo/hint, so a key press there would measure nothing. open-01 takes two certified steps,
  // so its first move leaves the hand unfinished and mid-run keys are testable.
  await runJS(`window.point24.load('#/lot/open-01'); 'ok'`);
  await sleep(150);
  await runJS(`window.point24.play(window.point24.plan().slice(0, 1)); 'ok'`);
  const kMoves = (await state()).moves;
  await key('u');
  await sleep(160);
  rec('the u key undoes', (await state()).moves === kMoves - 1, { before: kMoves, after: (await state()).moves });
  await key('h');
  await sleep(160);
  rec('the h key asks for a hint', (await state()).hints === 1, (await state()).hints);
  await key('r');
  await sleep(160);
  const r = await state();
  rec('the r key restarts, hints and all', r.moves === 0 && r.hints === 0 && !r.curtain, r);

  return { rows };
}

// In-page suites. Each returns { rows: [{ test, pass, detail }] }.
const PRELUDE = `(async () => {
  const g = window.point24;
  const rows = [];
  const rec = (name, pass, detail) => rows.push({ test: name, pass: !!pass, detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)) });
  window.__lastRows = rows;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const D = (id) => document.getElementById(id);
`;

const SCENARIOS = {
  boot: `${PRELUDE}
    rec('the shell boots straight into a hand', g && g.version === 1 && g.state.mode === 'home' && !!g.state.id, g && g.state);
    const c = D('board');
    rec('the canvas has real pixels', c.width > 0 && c.height > 0 && !!c.getContext('2d'), { w: c.width, h: c.height });
    const lit = (() => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 0) n++;
      return n;
    })();
    rec('the four cards were actually painted', lit > 50, { litSamples: lit });
    rec('the page is titled for the game', /^二十四点 · POINT 24$/.test(document.title), document.title);
    rec('a favicon is declared, so no /favicon.ico 400s the console', !!document.querySelector('link[rel="icon"]'), document.querySelector('link[rel=icon]') && document.querySelector('link[rel=icon]').href.slice(0, 24));
    const pool = g.pool;
    rec('the baked pool loaded', pool && pool.hands >= 32, pool && pool.hands);
    rec('every band reports a measured range', Object.values(pool.byBand).every((b) => b.n > 0 && b.cardsMin <= b.cardsMax && b.stepsMin === b.cardsMin - 1), pool.byBand);
    const s = g.state;
    rec('the hand on the table is four whole numbers', s.deal.length === 4 && s.slots.length === 4 && s.slots.every((k) => k.endsWith('/1')), s.slots);
    rec('the browser re-checks the hand and agrees with par', s.live === true && s.need === s.steps, { need: s.need, steps: s.steps, cards: s.cards });
    rec('the baked plan is exactly steps long', g.plan().length === s.steps, { plan: g.plan().length, steps: s.steps });
    rec('the panel prints cards, steps and distinct expressions', /张数/.test(D('readout').textContent) && /步数/.test(D('readout').textContent) && /算式/.test(D('readout').textContent), D('readout').textContent);
    rec('the solver answers at once, it does not enumerate on click', typeof g.state.need === 'number', { need: g.state.need });
    return { rows };
  })()`,

  play: `${PRELUDE}
    g.store.reset();
    g.load('#/lot/open-01'); await sleep(160);
    const open = g.state;
    rec('open-01 loads as a three-card hand', open.id === 'open-01' && open.cards === 3 && open.steps === 2, { cards: open.cards, steps: open.steps });

    // Wrong order: an operator first is not a step.
    g.press('+');
    rec('an operator with nothing selected is refused, not counted', g.state.moves === 0 && g.state.rejects === 1, { moves: g.state.moves, rejects: g.state.rejects });
    g.pick(0);
    g.press('*');
    rec('one number and an operator is still not a pair', g.state.moves === 0 && g.state.rejects === 2, { moves: g.state.moves, rejects: g.state.rejects });
    g.clearPicks();

    // There and back: legal, and it costs two moves.
    const home = g.state.slots.slice();
    const first = g.plan()[0];
    g.play([first]);
    const moved = g.state.moves;
    rec('a committed step replaces two tiles with one', moved === 1 && g.state.slots.length === 3 && g.state.sel.length === 0, { slots: g.state.slots, sel: g.state.sel });
    D('undo').click(); await sleep(120);
    rec('undo puts the four tiles back and the count to zero', g.state.moves === 0 && g.state.slots.length === 4 && g.state.slots.join() === home.join(), { slots: g.state.slots });

    // The certified line, played to the end.
    g.play(g.plan());
    await sleep(120);
    rec('the plan wins in exactly steps operations', g.state.done && g.state.moves === open.steps, { moves: g.state.moves, steps: open.steps });
    rec('three stars and the 最优解 verdict at par', D('stars').textContent === '★★★' && D('verdict').textContent === '最优解' && !D('curtain').hidden, { stars: D('stars').textContent, verdict: D('verdict').textContent });
    rec('the win card offers the next hand', !D('next').hidden, D('next').dataset.id);
    const tidy = g.store.record('open-01');
    rec('at par the record is earned', tidy.best === open.steps && tidy.perfect === true && tidy.plays === 1, tidy);

    // One step over par: this hand is also solvable with all four cards, which is what the
    // pool promises, and that route is three operations long.
    D('restart').click(); await sleep(120);
    g.play([{ i: 3, j: 2, op: '-' }, { i: 1, j: 2, op: '*' }, { i: 1, j: 0, op: '-' }]);
    await sleep(120);
    rec('the all-four route wins one operation over par', g.state.done && g.state.moves === 3, { moves: g.state.moves, done: g.state.done, slots: g.state.slots });
    rec('one over reads as 差一步, two stars', D('stars').textContent === '★★☆' && D('verdict').textContent === '差一步', { stars: D('stars').textContent, verdict: D('verdict').textContent });
    const sloppy = g.store.record('open-01');
    rec('a slower replay does not move the best', sloppy.best === open.steps && sloppy.plays === 2, sloppy);

    // A hint bills itself and nothing else.
    D('restart').click(); await sleep(120);
    const flawless = g.store.stats.perfect;
    const h = g.hintOnce();
    rec('the hint prints a reference expression', h.hints === 1 && /参考算式/.test(h.line), h);
    g.play(g.plan()); await sleep(120);
    rec('a hinted par run bills the hint but not the 最优 tally',
      g.store.stats.hints === 1 && g.store.stats.perfect === flawless && g.store.record('open-01').perfect === true,
      { hints: g.store.stats.hints, perfect: g.store.stats.perfect, record: g.store.record('open-01') });
    D('restart').click(); await sleep(120);
    rec('重开 clears the count, the card and the hints', g.state.moves === 0 && g.state.hints === 0 && !g.state.curtain && D('curtain').hidden, g.state);
    return { rows };
  })()`,

  routes: `${PRELUDE}
    g.store.reset();
    g.load('#/'); await sleep(150);
    rec('#/ opens the campaign at the unlocked hand', g.state.mode === 'home' && g.state.index === 1, g.state);
    g.load('#/lot/solo-07'); await sleep(150);
    rec('#/lot/<id> opens that hand', g.state.id === 'solo-07' && g.state.mode === 'lot' && g.state.cards === 4, g.state);
    g.load('#/lot/not-a-hand'); await sleep(150);
    rec('an unknown hand id falls back instead of blanking the board', g.state.mode === 'lot' && g.state.id === 'spark-01' && g.state.steps >= 1, g.state);

    g.load('#/'); await sleep(150);
    const at = g.state.index;
    g.load('#/nope/nonsense'); await sleep(150);
    rec('a route nobody defined is the campaign, not a blank screen', g.state.mode === 'home' && g.state.index === at, { at, now: g.state.index });

    g.load('#/daily'); await sleep(150);
    const daily = g.state.id;
    rec('#/daily is a daily hand with a date in the label', g.state.mode === 'daily' && /^每日一手 · \\d{4}-\\d{2}-\\d{2}$/.test(g.state.label), g.state.label);
    g.load('#/'); await sleep(150);
    g.load('#/daily'); await sleep(150);
    rec('and it is the same four cards twice', g.state.id === daily, { first: daily, again: g.state.id });

    for (const band of Object.keys(g.pool.byBand)) {
      g.load('#/'); await sleep(120);
      g.load('#/random/' + band + '/fixedseed'); await sleep(140);
      const id = g.state.id;
      g.load('#/'); await sleep(120);
      g.load('#/random/' + band + '/fixedseed'); await sleep(140);
      rec('#/random/' + band + ' stays in its band and repeats itself', g.state.band === band && g.state.id === id, { band: g.state.band, id: g.state.id, want: id });
    }
    g.load('#/random/open'); await sleep(220);
    rec('a bare #/random mints a token into the URL', /^#\\/random\\/open\\/[a-z0-9]+$/.test(location.hash), location.hash);
    g.load('#/random/no-such-band/xyz'); await sleep(160);
    rec('an unknown band falls back to the first one', g.state.band === 'spark' && !!g.state.id, g.state.band);

    const shared = g.state.id;
    g.load('#/'); await sleep(120);
    g.load('#/lot/' + shared); await sleep(120);
    rec('a shared #/lot link resolves to the same deal', g.state.id === shared && g.state.deal.length === 4, { id: g.state.id, deal: g.state.deal });
    return { rows };
  })()`,

  save: `${PRELUDE}
    const KEY = 'point24.save.v1';
    g.store.reset();
    g.load('#/'); await sleep(160);
    rec('a wiped save is empty', Object.keys(g.store.records).length === 0 && g.store.unlocked === 1, { unlocked: g.store.unlocked, raw: localStorage.getItem(KEY) });
    rec('the wipe really removed the key', localStorage.getItem(KEY) === null, localStorage.getItem(KEY));

    g.play(g.plan()); await sleep(160);
    const id = g.state.id;
    const raw = JSON.parse(localStorage.getItem(KEY));
    rec('the solve reaches localStorage, not only memory', !!(raw && raw.records[id] && raw.records[id].best === g.state.steps), raw && Object.keys(raw.records || {}));
    rec('the save file has the versioned shape', ['records', 'daily', 'unlocked', 'stats'].every((k) => k in raw) && raw.stats.solves === 1, raw && Object.keys(raw));
    rec('clearing the first hand unlocks the second', g.store.unlocked === 2 && raw.unlocked === 2, { unlocked: g.store.unlocked });
    const next = document.querySelector('#shelf button[data-id="' + g.hand().id + '"]');
    rec('the shelf marks the hand just solved', !!next && /done|perfect/.test(next.className), next && next.className);

    // Re-open the hand that was just solved. Going through '#/' would land on hand #2 —
    // solving #1 unlocked it — and hand #2 has no record at all, so this would measure
    // nothing instead of "an unfinished run leaves the record alone".
    g.load('#/lot/' + id); await sleep(140);
    const open = g.store.record(g.state.id);
    g.play([{ i: 0, j: 1, op: '+' }]);
    await sleep(120);
    rec('an unfinished run does not touch the record', !!open && g.store.record(g.state.id).plays === open.plays && g.state.done === false, { open, now: g.store.record(g.state.id), state: g.state });
    D('undo').click(); await sleep(120);
    rec('undo steps back to the four original tiles', g.state.moves === 0 && g.state.slots.length === 4, g.state.slots);

    g.store.reload();
    rec('a reload reads the same numbers back', g.store.unlocked === 2 && Object.keys(g.store.records).length === 1, { unlocked: g.store.unlocked, records: Object.keys(g.store.records) });

    localStorage.setItem('point24.save.v1', '{"records": broken');
    g.store.reload();
    rec('a corrupt save degrades to a clean slate, not a stack trace', g.store.unlocked === 1 && Object.keys(g.store.records).length === 0, g.store.stats);

    g.store.reset();
    g.load('#/daily'); await sleep(160);
    const day = g.state.label.split(' · ')[1];
    g.play(g.plan()); await sleep(160);
    const mark = g.store.dailyDone(day);
    rec('today is logged once solved', !!mark && mark.id === g.state.id, { day, mark });
    rec('the shelf says today is done', /已解出/.test(D('shelf').textContent), D('shelf').textContent.slice(0, 80));
    rec('and the daily solve did not move the campaign ladder', g.store.unlocked === 1, g.store.unlocked);

    D('wipe').click(); await sleep(80);
    rec('the first click only arms it', g.store.unlocked === 1 && localStorage.getItem(KEY) !== null, 'armed');
    g.load('#/'); await sleep(120);
    g.play(g.plan()); await sleep(120);
    D('wipe').click(); await sleep(200);
    rec('清空存档 takes two clicks and clears everything',
      Object.keys(g.store.records).length === 0 && g.store.unlocked === 1 && localStorage.getItem(KEY) === null,
      { records: Object.keys(g.store.records), unlocked: g.store.unlocked, key: localStorage.getItem(KEY) });
    return { rows };
  })()`,
};

main().catch((err) => {
  console.error('playtest failed: ' + ((err && err.stack) || err));
  process.exit(1);
});
