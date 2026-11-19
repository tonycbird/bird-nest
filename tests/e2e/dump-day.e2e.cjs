/* The morning dump gives today a shape (Nov 19): from the Morning card, talk it out, Nest sorts it, today's work
   things get their own times inside Work, a call waits for the drive, a home thing for free time, a rehearsal
   said with its time lands at that time. "Your day" shows it; ↑ ↓ swap; the Now card then walks him through.
   Run:  npx vite build --mode e2e --outDir <dir> && npx vite preview --outDir <dir> --port 4181 &
         URL=http://localhost:4181/ node tests/e2e/dump-day.e2e.cjs */
const { chromium } = require('playwright');
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('✓', m); };
const SHOTS = process.env.SHOTS;
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', timezoneId: 'America/Los_Angeles' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const shot = async (n) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/dump-${n}.png` }); };
  await p.clock.install({ time: new Date('2026-11-19T13:05:00Z') }); // Thursday 5:05 AM Pacific
  await p.goto(process.env.URL || 'http://localhost:4181/'); await p.waitForTimeout(1500);
  // His gym is at 6; the test Body's is at 5. Keep the workout out of this one (coach and phase3 cover it).
  await p.evaluate(async () => { const db = await new Promise((res) => { const r = indexedDB.open('bird-nest'); r.onsuccess = () => res(r.result); }); await new Promise((res) => { const tx = db.transaction('settings', 'readwrite'); tx.objectStore('settings').put({ key: 'day', value: { workout: false, calendars: null, week: true }, updated_at: new Date().toISOString() }); tx.oncomplete = res; }); const all = await new Promise((res) => { const q = db.transaction('blocks').objectStore('blocks').getAll(); q.onsuccess = () => res(q.result); }); await new Promise((res) => { const tx = db.transaction('blocks', 'readwrite'); for (const x of all) if (x.source_type === 'workout' || /\|gym$/.test(x.source_id || '')) tx.objectStore('blocks').delete(x.id); tx.oncomplete = res; }); });
  await p.reload(); await p.waitForTimeout(1200);
  await p.click('.tabs >> text=Head'); await p.click('button >> text=Start fresh'); await p.waitForTimeout(300);
  await p.click('.tabs >> text=Today'); await p.waitForTimeout(500);

  assert(await p.locator('.now h2').innerText() === 'Morning', '5 AM: Now is Morning');
  await p.click('.now-dump'); await p.waitForTimeout(400);
  assert(await p.locator('.flow[aria-label="Brain dump"]').count() === 1, '"Empty your head" opens the dump');
  await p.fill('textarea.dump', 'order furnace filters for the sanctuary 30 min, walk the roof with bobby for an hour, call thomas about dec 2 details, mow the lawn, dance rehearsal tonight 6-7, email the alarm company');
  await p.click('.flow-foot >> text=Sort'); await p.waitForTimeout(400);
  assert(await p.locator('.sec-head', { hasText: 'Today' }).count() === 1 && await p.locator('.sec-head', { hasText: 'No date yet' }).count() === 0, 'before noon, things with no day are for today');
  await shot('sorted');
  await p.click('.flow-foot >> text=Put away'); await p.waitForTimeout(900);

  assert(await p.locator('.flow h2 >> text=Your day').count() === 1, '"Your day" comes next');
  const rows = await p.locator('.pl-row.new').evaluateAll((xs) => xs.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
  assert(rows.length === 3, '3 work things got a time: ' + rows.join(' | '));
  assert(/^8:00 Order furnace filters/.test(rows[0]) && /^8:30 Walk the roof/.test(rows[1]) && /^9:30 Email the alarm company/.test(rows[2]), 'in the order said, from 8:00 when work starts, each as long as said');
  assert(await p.locator('.pl-row', { hasText: 'Call Thomas about dec 2 details' }).locator('text=On the drive').count() === 1, 'the call waits for the drive');
  assert(await p.locator('.pl-row', { hasText: 'Mow the lawn' }).locator('text=Free time').count() === 1, 'the lawn waits for free time');
  assert(await p.locator('.pl-row', { hasText: 'Dance rehearsal' }).locator('.pl-t >> text=6:00').count() === 1, 'the rehearsal is on at 6:00');
  await shot('your-day');
  await p.click('[aria-label="Later: Order furnace filters for the sanctuary"]'); await p.waitForTimeout(400);
  const rows2 = await p.locator('.pl-row.new .pl-name').allInnerTexts();
  assert(rows2[0] === 'Walk the roof with Bobby' && rows2[1] === 'Order furnace filters for the sanctuary', '↓ swaps it with the next one');
  await p.click('.flow-foot >> text=Looks good'); await p.waitForTimeout(400);
  assert(await p.locator('.flow').count() === 0, 'Looks good closes it');

  // 7:45: the call shows on the drive. 8:05: the roof walk is now; Done ticks it.
  await p.clock.fastForward('02:40:00'); await p.waitForTimeout(800);
  assert(await p.locator('.now-fits', { hasText: 'On the drive' }).locator('text=Call Thomas').count() === 1, '7:45: the call is on the drive');
  await p.clock.fastForward('00:20:00'); await p.waitForTimeout(800);
  assert(await p.locator('.now h2').innerText() === 'Walk the roof with Bobby', '8:05: Now is the roof walk');
  await shot('now-task');
  await p.click('.now-acts >> text=Done'); await p.waitForTimeout(500);
  assert(await p.locator('.now h2').innerText() === 'Work', 'done: back to Work');
  // 9:35: the filters (8:30–9:00) ran over without a tick → slid to the next open time.
  await p.clock.fastForward('01:30:00'); await p.waitForTimeout(1200);
  await p.click('.whole-t'); await p.waitForTimeout(300);
  const filt = await p.locator('.tr', { hasText: 'Order furnace filters' }).locator('.bc-main small').innerText();
  assert(/^10:00/.test(filt), 'a task that ran over slid to the next open time: ' + filt);
  // 6:10 PM: rehearsal.
  await p.clock.fastForward('08:35:00'); await p.waitForTimeout(1000);
  assert(await p.locator('.now h2').innerText() === 'Dance rehearsal', '6:10 PM: Now is the rehearsal');
  await shot('rehearsal');

  // A thrown-at-me thing, said with its time: quick add reads "6-7" as a time and a length.
  await p.click('[aria-label="Quick add"]'); await p.keyboard.type('Pick up costumes tomorrow 5-5:30'); await p.waitForTimeout(300);
  assert(await p.locator('.qa >> text=5–5:30pm').count() >= 1, 'quick add shows the range it read (5–5:30pm)');
  await p.keyboard.press('Enter'); await p.waitForTimeout(500);
  const t = await p.evaluate(async () => { const r = indexedDB.open('bird-nest'); return await new Promise((res) => { r.onsuccess = () => { const q = r.result.transaction('tasks').objectStore('tasks').getAll(); q.onsuccess = () => res(q.result.find((x) => x.title === 'Pick up costumes')); }; }); });
  assert(t && t.when === '2026-11-20' && t.time === '17:00' && t.est === 30, 'saved for tomorrow at 5 PM for 30 minutes');

  assert(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log('\nDump-day e2e: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
