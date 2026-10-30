/* Testing mode + Brain dump, end to end in a phone-sized Chromium.
   Run:  npm run build && npx vite preview --port 4180 &
         URL=http://localhost:4180/ node tests/e2e/testing.e2e.cjs */
const { chromium } = require('playwright');
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('✓', m); };
const SHOTS = process.env.SHOTS;
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: SHOTS ? 2 : 1, serviceWorkers: 'block', timezoneId: 'America/Los_Angeles', hasTouch: true });
  await ctx.addInitScript(() => { try { if (!localStorage.getItem('nest:theme-mode')) localStorage.setItem('nest:theme-mode', 'light'); } catch (e) {} });
  const p = await ctx.newPage();
  await p.clock.install({ time: new Date('2026-10-21T16:00:00Z') }); // Wed 9:00 AM Pacific
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const shot = async (n) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${n}.png` }); };
  await p.goto(process.env.URL || 'http://localhost:4180/'); await p.waitForTimeout(700);
  // These checks start from an empty River: keep the workout from landing on it by itself (that's tested in phase3).
  await p.evaluate(async () => { const db = await new Promise((res) => { const r = indexedDB.open('bird-nest'); r.onsuccess = () => res(r.result); }); await new Promise((res) => { const tx = db.transaction('settings', 'readwrite'); tx.objectStore('settings').put({ key: 'day', value: { workout: false, calendars: null }, updated_at: new Date().toISOString() }); tx.oncomplete = res; }); });
  await p.reload(); await p.waitForTimeout(700);
  await p.click('.tabs >> text=Head'); await p.click('button >> text=Start fresh'); await p.waitForTimeout(400);

  // ---- Brain dump ----
  await p.click('[aria-label="Quick add"]'); await p.waitForTimeout(200);
  await p.click('.seg >> text=Dump'); await p.waitForTimeout(300);
  assert(await p.locator('.flow >> text=Empty your head').count() === 1, 'Dump opens full screen');
  await p.fill('textarea.dump', "call dave about the smith quote tomorrow, I need to pay avista today and also we're out of milk, eggs and diapers. Maybe someday build a garden box. Greek reading due friday. I'm stressed about money");
  await p.waitForTimeout(400);
  assert(await p.locator('.flow-foot >> text=Sort 8').count() === 1, 'live count: 8 found');
  await shot('dump-write');
  await p.click('.flow-foot >> text=Sort'); await p.waitForTimeout(300);
  const heads = await p.locator('.dsec .sec-head').allInnerTexts();
  assert(['Today', 'Coming up', 'Shopping', 'Someday', 'Thoughts'].every((h) => heads.some((x) => x.toLowerCase().startsWith(h.toLowerCase()))), 'sorted into sections: ' + heads.join(', '));
  await shot('dump-sorted');
  // Move "Build a garden box" to No date yet
  await p.click('[aria-label="Move Build a garden box"]'); await p.click('.menu >> text=No date yet'); await p.waitForTimeout(200);
  assert((await p.locator('.dsec', { hasText: 'No date yet' }).locator('input.d-in').evaluateAll((els) => els.map((e) => e.value))).includes('Build a garden box'), 'moving an item works');
  // Leave one out
  await p.locator('.drow').filter({ has: p.locator('input.d-in') }).nth(await p.locator('input.d-in').evaluateAll((els) => els.findIndex((e) => e.value === 'Eggs'))).locator('.ck').click();
  await p.click('.flow-foot >> text=Put away'); await p.waitForTimeout(500);
  assert(await p.locator('.flow').count() === 0, 'Put away closes the dump');
  const counts = await p.evaluate(async () => { const r = indexedDB.open('bird-nest'); return await new Promise((res) => { r.onsuccess = () => { const q = r.result.transaction('tasks').objectStore('tasks').getAll(); q.onsuccess = () => res(q.result.map((t) => ({ title: t.title, when: t.when, grocery: !!t.grocery, someday: !!t.someday }))); }; }); });
  const has = (t) => counts.find((x) => x.title === t);
  assert(has('Pay Avista')?.when === '2026-10-21', 'today item has today');
  assert(has('Call Dave about the smith quote')?.when === '2026-10-22', 'tomorrow item dated');
  assert(has('Milk')?.grocery && has('Diapers')?.grocery && !has('Eggs'), 'shopping went to the list, the unchecked one stayed out');
  assert(counts.some((x) => x.title.startsWith('Thoughts') && x.someday), 'thoughts saved together in Someday');
  assert(await p.evaluate(() => localStorage.getItem('nest-dump-draft')) === null, 'draft cleared after putting away');

  // ---- Testing mode ----
  await p.click('.tabs >> text=Today'); await p.click('[aria-label="Settings"]'); await p.waitForTimeout(300);
  await p.locator('.kv', { hasText: 'Testing mode' }).locator('input').click(); await p.waitForTimeout(600);
  assert(await p.locator('.tflag').count() === 1, 'flag shows when Testing mode is on');
  // Open a flow, then report from inside it
  await p.click('.tabs >> text=Head'); await p.click('.rituals >> text=Plan'); await p.waitForTimeout(400);
  await p.click('.tflag'); await p.waitForTimeout(300);
  assert(await p.locator('.tsheet').count() === 1, 'flag opens the report sheet above a full-screen flow');
  await shot('report-sheet');
  await p.click('.tsheet >> text=Stuck'); await p.fill('.tsheet textarea', 'Plan screen has no way back');
  await p.click('.tsheet >> text=Save + get me out'); await p.waitForTimeout(1500);
  assert(await p.locator('.flow').count() === 0 && await p.locator('.t-head').count() === 1, '"get me out" lands back on Today');
  await p.click('[aria-label="Settings"]'); await p.waitForTimeout(300);
  assert(await p.locator('.trow >> text=Plan screen has no way back').count() === 1, 'report listed in Settings');
  const rep = await p.evaluate(async () => { const r = indexedDB.open('bird-nest'); return await new Promise((res) => { r.onsuccess = () => { const q = r.result.transaction('reports').objectStore('reports').getAll(); q.onsuccess = () => res(q.result[0]); }; }); });
  assert(rep.kind === 'stuck' && rep.ctx.tab === 'head' && rep.ctx.overlay === 'plan' && rep.dom && rep.dom.includes('Plan my day'), 'report saved the screen, tab and open flow');
  assert(rep.trail.some((t) => /Plan/.test(t.what)), 'report saved the last taps');
  await shot('settings-reports');
  await p.click('.trow-main'); await p.click('.trow-more >> text=Fixed'); await p.waitForTimeout(300);
  assert(await p.locator('.lbl >> text=Reports · 0 open').count() === 1, 'marking fixed updates the count');

  // ---- Sheets close with a swipe down ----
  await p.click('.gear[aria-label="Back to Today"]'); await p.waitForTimeout(300);
  await p.click('text=Sample day'); await p.waitForTimeout(500);
  await p.click('.tr >> nth=1 >> .bc-main'); await p.waitForTimeout(200);
  await p.locator('.tr.open [aria-label^="More for"]').click(); await p.waitForTimeout(300);
  const box = await p.locator('.sheet').boundingBox();
  await p.touchscreen.tap(box.x + box.width / 2, box.y + 8); await p.waitForTimeout(500);
  assert(await p.locator('.sheet').count() === 0, 'tapping the grab bar closes a sheet');

  // ---- Swipe left to delete in Head (with Undo) ----
  await p.click('.tabs >> text=Head'); await p.click('.hn >> text=Today'); await p.waitForTimeout(300);
  const row = p.locator('.swipe .task', { hasText: 'Pay avista' });
  const rb = await row.boundingBox();
  const y = rb.y + rb.height / 2;
  await p.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    const t = (cx) => [new Touch({ identifier: 1, target: el, clientX: cx, clientY: y })];
    el.dispatchEvent(new TouchEvent('touchstart', { touches: t(x), bubbles: true }));
    for (let i = 1; i <= 8; i++) el.dispatchEvent(new TouchEvent('touchmove', { touches: t(x - i * 20), bubbles: true }));
    el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: t(x - 160), bubbles: true }));
  }, { x: rb.x + rb.width - 30, y });
  await p.waitForTimeout(700);
  assert(await p.locator('.task', { hasText: 'Pay avista' }).count() === 0, 'swiping a task left deletes it');
  await p.click('.toast >> text=Undo'); await p.waitForTimeout(500);
  assert(await p.locator('.task', { hasText: 'Pay avista' }).count() === 1, 'Undo brings it back');
  await shot('head-after-undo');

  // ---- Debug round fixes ----
  // A long dictated quick add offers the dump, and the dump sorts it the way it was said.
  await p.click('[aria-label="Quick add"]'); await p.waitForTimeout(200);
  await p.fill('textarea.qa-input', 'I\u2019m going to need to pick up the leaves from Sam\u2019s house this upcoming Tuesday. I\u2019m going to need a tarp and ratchet straps and then take it to the dump after give around one hour of loading and dump trip.');
  await p.waitForTimeout(200);
  assert(await p.locator('.qa-many').count() === 1, 'quick add notices several things and offers to sort them');
  await p.click('.qa-many'); await p.waitForTimeout(300);
  await p.click('.flow-foot >> text=Sort'); await p.waitForTimeout(300);
  const dumped = await p.locator('input.d-in').evaluateAll((els) => els.map((e) => e.value));
  assert(dumped.includes("Pick up the leaves from Sam's house") && dumped.includes('Get a tarp and ratchet straps') && dumped.includes('Take the leaves to the dump'), 'dictation sorted into 3 things: ' + dumped.join(' | '));
  await p.click('.flow [aria-label="Close"]'); await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.removeItem('nest-dump-draft'));

  // A rant about jobs: a new project with its steps, an existing project, a timed thing on today's River.
  await p.evaluate(async () => {
    const db = await new Promise((res) => { const r = indexedDB.open('bird-nest'); r.onsuccess = () => res(r.result); });
    const areas = await new Promise((res) => { const q = db.transaction('areas').objectStore('areas').getAll(); q.onsuccess = () => res(q.result); });
    await new Promise((res) => { const tx = db.transaction('projects', 'readwrite'); tx.objectStore('projects').put({ id: 'pJon', name: 'Jon Wolfe Project', areaId: areas[0].id, status: 'active', sections: [], order: 1, createdAt: Date.now(), client: { name: 'Jon Wolfe' }, notes: '', outcome: '', description: '', photos: [], color: null, start: null, deadline: null, completedAt: null }); tx.oncomplete = res; });
    db.close();
  });
  await p.reload(); await p.waitForTimeout(900);
  await p.click('[aria-label="Quick add"]'); await p.click('.seg >> text=Dump'); await p.waitForTimeout(300);
  await p.fill('textarea.dump', "new job for the Hendersons replace the front door and the storm door they want it done before thanksgiving need to measure first and get them a quote. tomorrow I gotta go to home depot for the jon wolfe job then start framing the closet. greek quiz today at 7 pm");
  await p.waitForTimeout(400);
  await p.click('.flow-foot >> text=Sort'); await p.waitForTimeout(400);
  assert(await p.locator('.dproj-name').evaluate((e) => e.value) === 'Henderson job', 'the dump offers a new project, named for the client');
  const stepNames = await p.locator('.dproj input.d-in:not(.dproj-name)').evaluateAll((els) => els.map((e) => e.value));
  assert(stepNames.length === 3, 'its three steps sit under it: ' + stepNames.join(' | '));
  assert(await p.locator('.dsec .sec-head', { hasText: /Jon Wolfe Project/i }).count() === 1, 'things for an existing project are grouped under it');
  await p.locator('.dproj-name').fill('Henderson doors');
  await shot('dump-projects');
  await p.click('.flow-foot >> text=Put away'); await p.waitForTimeout(800);
  const after = await p.evaluate(async () => {
    const r = indexedDB.open('bird-nest');
    return await new Promise((res) => { r.onsuccess = () => { const tx = r.result.transaction(['tasks', 'projects', 'blocks']); const out = {}; let n = 3;
      const done = () => { if (--n === 0) res(out); };
      tx.objectStore('tasks').getAll().onsuccess = (e) => { out.tasks = e.target.result; done(); };
      tx.objectStore('projects').getAll().onsuccess = (e) => { out.projects = e.target.result; done(); };
      tx.objectStore('blocks').getAll().onsuccess = (e) => { out.blocks = e.target.result; done(); }; }; });
  });
  const hp = after.projects.find((x) => x.name === 'Henderson doors');
  assert(hp && hp.deadline === '2026-11-26', 'the new project was made, with its deadline');
  const steps = after.tasks.filter((t) => t.projectId === hp.id).sort((a, b) => a.order - b.order).map((t) => t.title);
  assert(JSON.stringify(steps) === JSON.stringify(['Replace the front door and the storm door', 'Measure', 'Get the Hendersons a quote']), 'its steps are in order: ' + steps.join(' | '));
  assert(after.tasks.filter((t) => t.projectId === 'pJon').length === 2, 'two things went into the Jon Wolfe project');
  const quiz = after.tasks.find((t) => t.title === 'Greek quiz');
  assert(quiz && quiz.time === '19:00' && after.blocks.some((b) => b.source_id === quiz.id && b.start === '19:00' && !b.deleted_at), 'a thing with a time today is on the River at that time');
  await p.click('.toast >> text=Undo'); await p.waitForTimeout(800);
  const undone = await p.evaluate(async () => { const r = indexedDB.open('bird-nest'); return await new Promise((res) => { r.onsuccess = () => { const q = r.result.transaction('projects').objectStore('projects').getAll(); q.onsuccess = () => res(q.result.filter((x) => x.name === 'Henderson doors').length); }; }); });
  assert(undone === 0, 'Undo takes the new project back too');
  await p.click('.tabs >> text=Head'); await p.click('.hn >> text=Today'); await p.waitForTimeout(300);

  // Every picker sheet has a ✕.
  await p.locator('.swipe .task', { hasText: 'Pay avista' }).click(); await p.waitForTimeout(300);
  await p.locator('.pr-main', { hasText: 'Repeat' }).click(); await p.waitForTimeout(300);
  assert(await p.locator('.sheet.has-x .sheet-x').count() >= 1, 'picker sheet shows a close ✕');
  await p.locator('.sheet.has-x .sheet-x').last().click(); await p.waitForTimeout(300);
  assert(await p.locator('.sheet.has-x').count() === 0 && await p.locator('.sheet.tall').count() === 1, '✕ closes only the picker');

  // Typing in notes, then closing the task without leaving the field first, still saves.
  await p.click('.notes-empty'); await p.waitForTimeout(150);
  await p.keyboard.type('Gate code 4411');
  await p.locator('.scrim').last().click({ position: { x: 10, y: 10 } }); await p.waitForTimeout(500);
  const notes = await p.evaluate(async () => { const r = indexedDB.open('bird-nest'); return await new Promise((res) => { r.onsuccess = () => { const q = r.result.transaction('tasks').objectStore('tasks').getAll(); q.onsuccess = () => res(q.result.find((t) => t.title === 'Pay Avista')?.notes); }; }); });
  assert(notes === 'Gate code 4411', 'notes typed before closing the task are saved');

  // Select mode ends when you leave Head (the ＋ comes back).
  await p.click('[aria-label="Select tasks"]'); await p.waitForTimeout(200);
  assert(await p.locator('[aria-label="Quick add"]').count() === 0, 'select mode hides ＋ in Head');
  await p.click('.tabs >> text=Today'); await p.waitForTimeout(300);
  assert(await p.locator('[aria-label="Quick add"]').count() === 1, 'leaving Head ends select mode');

  assert(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log('\nTesting + Dump e2e: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
