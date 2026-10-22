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
  assert(has('Pay avista')?.when === '2026-10-21', 'today item has today');
  assert(has('Call dave about the smith quote')?.when === '2026-10-22', 'tomorrow item dated');
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

  assert(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log('\nTesting + Dump e2e: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
