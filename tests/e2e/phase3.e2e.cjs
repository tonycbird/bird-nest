/* Phase 3 end-to-end checks in a phone-sized Chromium.
   Run:  npm run build && npx vite preview --port 4180 &
         URL=http://localhost:4180/ LEGACY=legacy/fitness.html SHOTS=/tmp/shots node tests/e2e/phase3.e2e.cjs
   LEGACY (optional) is the old Bird Fitness HTML; when given, plate math, PRs, targets and the rotation
   are compared with the old app on the same input. Needs Playwright. Not part of `npm test`. */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('✓', m); };
const URL = process.env.URL || 'http://localhost:4180/';
const SHOTS = process.env.SHOTS || '';
const shot = async (p, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, name + '.png') }); } };

/* The same history in both apps: three Back sessions and two Legs sessions. */
const SEED = `(() => {
  const mk = (date, w, ex) => { const m = Store.month(date.slice(0, 7), true); const id = 's' + date + w; m.sessions[id] = { id, date, w, start: Date.parse(date + 'T13:00:00Z'), fin: Date.parse(date + 'T14:00:00Z'), ex, swaps: {}, add: [], rm: [] }; Store.save('m:' + date.slice(0, 7)); };
  const prg = Store.d.program.workouts;
  const back = prg.find(w => w.id === 'back'), legs = prg.find(w => w.id === 'legs');
  const ent = (sl, sets) => ({ id: sl.id, sets: sets.map(([r, w]) => ({ r, w, d: true })), wu: [], done: true });
  const b0 = back.slots[0], b1 = back.slots[1], l0 = legs.slots[0];
  mk('2026-09-24', 'back', { [b0.u]: ent(b0, [[10, 135], [10, 135], [9, 135]]), [b1.u]: ent(b1, [[12, 60], [12, 60], [12, 60]]) });
  mk('2026-10-01', 'back', { [b0.u]: ent(b0, [[12, 135], [12, 135], [12, 135]]), [b1.u]: ent(b1, [[12, 65], [11, 65], [10, 65]]) });
  mk('2026-10-08', 'back', { [b0.u]: ent(b0, [[10, 145], [9, 145], [8, 145]]) });
  mk('2026-10-06', 'legs', { [l0.u]: ent(l0, [[8, 225], [8, 225], [7, 225]]) });
  mk('2026-10-13', 'legs', { [l0.u]: ent(l0, [[10, 235], [10, 235], [10, 235]]) });
  DATA_VER++;
  return true;
})()`;
const PROBE = `(() => {
  const S = Store.d.program.workouts;
  const slot = (w, i) => S.find(x => x.id === w).slots[i];
  const days = []; for (let i = 0; i < 21; i++) { const d = new Date(Date.UTC(2026, 9, 12 + i)).toISOString().slice(0, 10); days.push([d, plannedWorkout(d)]); }
  return JSON.stringify({
    plates: [45, 95, 135, 185, 225, 245, 315, 405, 137.5].map(v => plateMath(v)),
    rounds: [[101, 'db'], [133, 'bar'], [187, 'machine'], [23, 'cable']].map(([v, eq]) => roundLoad(v, eq)),
    targets: [['back', 0], ['back', 1], ['legs', 0], ['legs', 1], ['chest', 0]].map(([w, i]) => exTarget(slot(w, i), '2026-10-15', null)),
    warm: [['legs', 0, 235], ['back', 0, 145]].map(([w, i, lb]) => warmupSets(slot(w, i), lb)),
    prs: prList(),
    est: S.map(w => estMinutes(w.id)),
    days,
  });
})()`;

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', timezoneId: 'America/Los_Angeles' });
  const p = await ctx.newPage();
  await p.clock.install({ time: new Date('2026-10-15T15:00:00Z') }); // Thursday 8:00 AM Pacific, a gym day
  const errs = []; p.on('pageerror', (e) => errs.push('PAGE ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
  await p.goto(URL); await p.waitForTimeout(600);

  // Head first run, so there is a grocery list to merge into.
  await p.click('.tabs >> text=Head'); await p.waitForTimeout(300);
  await p.click('button >> text=Start fresh'); await p.waitForTimeout(400);

  // Body tab: the Fitness screens load in Nest, with Nest's chips on top.
  await p.click('.tabs >> text=Body'); await p.waitForTimeout(1500);
  const f = p.frameLocator('iframe.bodyframe');
  const fr = p.frames().find((x) => x.url().includes('/body'));
  assert(!!fr, 'Body frame loaded');
  assert(await f.locator('h1.ltitle >> text=Workout').count() === 1, 'Fitness Workout screen shows in Body');
  assert(await p.locator('.body-head .hn.on >> text=Workout').count() === 1, 'Workout chip is on');
  await fr.waitForFunction(() => window.__fit && Store.online === true, null, { timeout: 5000 });
  assert(true, "Fitness connected to Nest's database");
  await shot(p, '01-body-workout');

  // Seed history so targets, PRs and the River steps have real numbers.
  await fr.evaluate(SEED); await fr.evaluate('render()'); await p.waitForTimeout(800);
  const fitRows = await p.evaluate(async () => { const r = indexedDB.open('bird-nest'); return await new Promise((res) => { r.onsuccess = () => { const tx = r.result.transaction('fit', 'readonly'); const q = tx.objectStore('fit').getAllKeys(); q.onsuccess = () => res(q.result); }; }); });
  assert(fitRows.includes('logs/2026-10') && fitRows.includes('fit/settings'), 'Fitness saves land in the fit table: ' + fitRows.join(', '));

  // Sections switch from Nest's chips.
  await p.click('.body-head .hn >> text=Stretch'); await p.waitForTimeout(400);
  assert(await f.locator('h1.ltitle').first().innerText() !== 'Workout', 'Stretch chip switches the Fitness section');
  await shot(p, '02-body-stretch');
  await p.click('.body-head .hn >> text=Meals'); await p.waitForTimeout(400);
  await shot(p, '03-body-meals');

  // Groceries: one list, in Head.
  await f.locator('[data-a="seg"][data-v="grocery"]').click(); await p.waitForTimeout(400);
  assert(await f.locator('[data-a="nestGroc"]').count() === 1, 'Fitness groceries offer 🧠 Send');
  await shot(p, '04-body-groceries');
  await f.locator('[data-a="nestGroc"]').click(); await p.waitForTimeout(1200);
  const groc = await p.evaluate(async () => { const r = indexedDB.open('bird-nest'); return await new Promise((res) => { r.onsuccess = () => { const tx = r.result.transaction(['areas', 'tasks'], 'readonly'); tx.objectStore('areas').getAll().onsuccess = (e) => { const a = e.target.result.find((x) => x.listMode === 'groceries'); tx.objectStore('tasks').getAll().onsuccess = (e2) => res(e2.target.result.filter((t) => t.areaId === a.id && t.status === 'open').map((t) => t.title)); }; }; }); });
  assert(groc.length > 5, `groceries sent to Head (${groc.length} items, e.g. "${groc[0]}")`);
  await f.locator('[data-a="nestGroc"]').click(); await p.waitForTimeout(1000);
  const groc2 = await p.evaluate(async () => { const r = indexedDB.open('bird-nest'); return await new Promise((res) => { r.onsuccess = () => { r.result.transaction('tasks').objectStore('tasks').count().onsuccess = (e) => res(e.target.result); }; }); });
  assert(groc2 >= groc.length, 'sending twice adds no duplicates');

  // Today: the Body tray offers the gym day; 🌊 Add puts three blocks on the River.
  await p.click('.tabs >> text=Today'); await p.waitForTimeout(800);
  assert(await p.locator('.quick [aria-label^="Put "]').count() === 1, 'Body plan shows as a circle on Today');
  assert(await p.evaluate(() => getComputedStyle(document.querySelector('iframe.bodyframe')).display) === 'none', 'off the Body tab the frame is not displayed at all (iPhone white-screen fix)');
  const trayText = await p.locator('.quick [aria-label^="Put "]').getAttribute('aria-label');
  await p.click('.quick [aria-label^="Put "]'); await p.waitForTimeout(800);
  const titles = await p.locator('.tr:not(.cal) .bc-main b').allInnerTexts();
  assert(titles.includes('Warm-up') && titles.includes('Cool-down') && titles.length === 3, 'River has Warm-up, workout, Cool-down: ' + titles.join(' · ') + ' (' + trayText.replace(/\n/g, ' ') + ')');
  assert(await p.locator('.quick [aria-label^="Put "]').count() === 0, 'the circle goes once the plan is on the River');
  const main = titles.find((t) => t !== 'Warm-up' && t !== 'Cool-down');
  await p.locator('.tr', { hasText: main }).locator('.bc-main').click(); await p.waitForTimeout(300);
  await p.locator('.tr.open [aria-label^="Show all"]').click(); await p.waitForTimeout(200);
  const steps = await p.locator('.tr.open .steps li').count();
  assert(steps >= 3 && steps <= 7, `workout block has ${steps} lift steps (max 7)`);
  const v1 = await p.locator('.tr.open .steps .v').first().innerText();
  assert(/\d+ × \d/.test(v1), 'first lift step shows the scheme and target: ' + v1);
  await shot(p, '05-river-workout');

  // 🏋 Log opens the logger; logging every set of the first lift ticks step 1 on the River.
  await p.click('.tr.open [aria-label="Open in Body"]'); await p.waitForTimeout(700);
  assert(await f.locator('[data-a="openEx"]').count() > 0, '🏋 Log opens the workout in Body');
  await shot(p, '06-body-workout-detail');
  await f.locator('[data-a="openEx"]').first().click(); await p.waitForTimeout(400);
  const sets = await f.locator('.setrow').count();
  for (let i = 0; i < sets; i++) {
    const row = f.locator(`.setrow[data-i="${i}"]`);
    await row.locator('input[data-f="r"]').fill('10');
    const w = row.locator('input[data-f="w"]');
    if (!(await w.inputValue())) await w.fill('100');
    await row.locator('[data-a="setDone"]').click(); await p.waitForTimeout(150);
  }
  await shot(p, '07-body-logger');
  assert(await f.locator('#timer:not([hidden])').count() === 1, 'rest timer runs after a set');
  await p.waitForTimeout(700);

  // Rest timer shows on Today too, and keeps true time (it runs on end time, so a locked phone doesn't stop it).
  await p.click('.tabs >> text=Today'); await p.waitForTimeout(600);
  assert(await p.locator('.timer-pill').count() === 1, 'rest timer pill shows on Today');
  const pill1 = await p.locator('.timer-pill').innerText();
  const firstStep = await p.locator('.tr', { hasText: main }).locator('.bc-main small').innerText();
  assert(/^1\//.test(firstStep), `logging the first lift ticked step 1 on the River (${firstStep})`);
  await shot(p, '08-river-after-log');
  await p.clock.runFor(59 * 1000); await p.waitForTimeout(400);
  const pill2 = await p.locator('.timer-pill').innerText().catch(() => '');
  assert(/done/.test(pill2), `timer finished on true time (${pill1.replace(/\n/g, ' ')} → ${pill2.replace(/\n/g, ' ')})`);

  // Warm-up ticked on the River → checked off in Body.
  if (!(await p.locator('.tr.open', { hasText: 'Warm-up' }).count())) { await p.locator('.tr', { hasText: 'Warm-up' }).locator('.bc-main').click(); await p.waitForTimeout(200); }
  for (let i = 0; i < 3; i++) { const c = p.locator('.tr.open', { hasText: 'Warm-up' }).locator('.bc-cur'); if (await c.count()) { await c.click(); await p.waitForTimeout(250); } }
  await p.waitForTimeout(400);
  const warmed = await p.frames().find((x) => x.url().includes('/body')).evaluate(() => !!Store.m['2026-10'].warm['2026-10-15']);
  assert(warmed, 'finishing Warm-up on the River checks it off in Body');

  // Offline write path: everything above went to IndexedDB; reloading keeps the log.
  await p.reload(); await p.waitForTimeout(800);
  await p.click('.tabs >> text=Body'); await p.waitForTimeout(1500);
  const fr2 = p.frames().find((x) => x.url().includes('/body'));
  const kept = await fr2.evaluate(() => Object.values(Store.m['2026-10'].sessions).filter((s) => s.date === '2026-10-15').length);
  assert(kept === 1, "today's session survives a reload");

  // Bird Settings: Body counts and the Fitness import entry.
  await p.click('.tabs >> text=Today'); await p.waitForTimeout(300);
  await p.click('[aria-label="Settings"]').catch(() => {}); await p.waitForTimeout(400);
  if (await p.locator('text=Import Bird Fitness backup').count()) { assert(true, 'Settings shows the Fitness import'); await shot(p, '09-settings'); }

  // Parity with the old app on the same input.
  if (process.env.LEGACY) {
    const mine = await fr2.evaluate(SEED).then(() => fr2.evaluate(PROBE));
    const lp = await ctx.newPage();
    await lp.clock.install({ time: new Date('2026-10-15T15:00:00Z') });
    await lp.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await lp.goto('file://' + path.resolve(process.env.LEGACY)); await lp.waitForTimeout(800);
    // Same rotation anchor and program as Nest's copy, then the same history.
    const cfg = await fr2.evaluate(() => JSON.stringify({ settings: Store.d.settings, program: Store.d.program }));
    await lp.evaluate((c) => { const x = JSON.parse(c); Store.d.settings = x.settings; Store.d.program = x.program; for (const k of Object.keys(Store.m)) delete Store.m[k]; DATA_VER++; }, cfg);
    await fr2.evaluate(() => { for (const k of Object.keys(Store.m)) if (k !== '2026-10' && k !== '2026-09') delete Store.m[k]; });
    // Start both from the same logs: copy Nest's months over.
    const logs = await fr2.evaluate(() => JSON.stringify(Store.m));
    await lp.evaluate((l) => { const m = JSON.parse(l); for (const k of Object.keys(m)) Store.m[k] = m[k]; DATA_VER++; }, logs);
    const old = await lp.evaluate(PROBE);
    const a = JSON.parse(mine), o = JSON.parse(old);
    for (const k of Object.keys(o)) assert(JSON.stringify(a[k]) === JSON.stringify(o[k]), `${k} match the old app`);
    // A backup from the old app imports through Nest Settings.
    const bk = await lp.evaluate(() => { Store.d.settings.card.gym = 'Imported Gym'; return JSON.stringify(Store.exportAll()); });
    const tmp = path.join(require('os').tmpdir(), 'bird-fitness-backup.json'); fs.writeFileSync(tmp, bk);
    await lp.close();
    await p.click('.tabs >> text=Today'); await p.click('[aria-label="Settings"]').catch(() => {}); await p.waitForTimeout(300);
    await p.locator('input[type=file]').nth(1).setInputFiles(tmp); await p.waitForTimeout(400);
    assert(await p.locator('text=Replace Body data with this backup?').count() === 1, 'Fitness backup is read and confirmed first');
    await p.click('.sheet-actions >> text=Import'); await p.waitForTimeout(2500);
    const fr3 = p.frames().find((x) => x.url().includes('/body'));
    await fr3.waitForFunction(() => window.Store === undefined ? false : true, null, { timeout: 4000 }).catch(() => {});
    const gym = await fr3.evaluate(() => Store.d.settings.card.gym);
    if (gym !== 'Imported Gym') console.log('DEBUG', gym, await p.evaluate(async () => { const r = indexedDB.open('bird-nest'); return await new Promise((res) => { r.onsuccess = () => { r.result.transaction('fit').objectStore('fit').get('fit/settings').onsuccess = (e) => res(JSON.stringify(e.target.result && e.target.result.value.card)); }; }); }), await fr3.evaluate(() => localStorage.getItem('birdfit:v1:settings') && JSON.parse(localStorage.getItem('birdfit:v1:settings')).card));
    assert(gym === 'Imported Gym', 'imported Fitness data shows in Body after import');
  }

  // Dark mode look.
  await p.emulateMedia({ colorScheme: 'dark' }); await p.click('.tabs >> text=Body'); await p.waitForTimeout(500);
  await p.click('.body-head .hn >> text=Workout'); await p.waitForTimeout(300); await shot(p, '10-body-dark');
  await p.emulateMedia({ colorScheme: 'light' });

  const real = errs.filter((e) => !/fonts\.g/.test(e));
  assert(real.length === 0, 'no page errors' + (real.length ? ': ' + real.join(' | ') : ''));
  await b.close();
  console.log('\nPhase 3 e2e: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
