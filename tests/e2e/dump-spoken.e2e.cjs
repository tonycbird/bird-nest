/* His real dictated dump (Nov 22): a spoken numbered list for Tuesday. It must come out as six clean things for
   Tuesday, and on Tuesday morning they get their times by themselves.
   Run:  npx vite build --mode e2e --outDir <dir> && npx vite preview --outDir <dir> --port 4181 &
         URL=http://localhost:4181/ node tests/e2e/dump-spoken.e2e.cjs */
const { chromium } = require('playwright');
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('✓', m); };
const SHOTS = process.env.SHOTS;
const REAL = "Hello, these are gonna be the tasks that are needed to be done on Tuesday number one is going to be calling Chris Trongale about the leak. Number two is going to be emptying. The baptismal number three is going to be cleaning the cafeteria upstairs number four is going to be cleaning. All of River Tech number five is going to be cleaning the bathrooms and number six is going to be ensuring that the building is good to go until Saturday.";
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', timezoneId: 'America/Los_Angeles' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const shot = async (n) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/spoken-${n}.png` }); };
  await p.clock.install({ time: new Date('2026-11-22T22:18:00Z') }); // Sunday 2:18 PM Pacific
  await p.goto(process.env.URL || 'http://localhost:4181/'); await p.waitForTimeout(1200);
  await p.click('.tabs >> text=Head'); await p.click('button >> text=Start fresh'); await p.waitForTimeout(300);
  await p.click('[aria-label="Quick add"]'); await p.click('.seg >> text=Dump'); await p.waitForTimeout(300);
  await p.fill('textarea.dump', REAL); await p.waitForTimeout(400);
  assert(await p.locator('.pill >> text=6 found').count() === 1, 'six things found while typing');
  await p.click('.flow-foot >> text=Sort'); await p.waitForTimeout(400);
  const heads = await p.locator('.dsec .sec-head').allInnerTexts();
  assert(heads.length === 1 && /^Coming up · 6$/i.test(heads[0].trim()), 'all six are Coming up (Tuesday), nothing in No date yet: ' + heads.join(' | '));
  const titles = await p.locator('.dsec input.d-in').evaluateAll((xs) => xs.map((x) => x.value));
  assert(JSON.stringify(titles) === JSON.stringify(['Call Chris Trongale about the leak', 'Empty the baptismal', 'Clean the cafeteria upstairs', 'Clean all of River Tech', 'Clean the bathrooms', 'Make sure the building is good to go until Saturday']), 'each one said as a thing to do: ' + titles.join(' | '));
  assert(await p.locator('.dsec .t-meta', { hasText: 'Tue' }).count() === 6, 'each on Tuesday');
  await shot('sorted');
  await p.click('.flow-foot >> text=Put away'); await p.waitForTimeout(600);
  assert(await p.locator('.flow').count() === 0, 'nothing for today, so Put away just closes');

  // Tuesday 6:00 AM: the first open of the day gives them their times inside Handyman jobs (7:30–3:30).
  await p.clock.fastForward('39:42:00');
  await p.evaluate(async () => { const db = await new Promise((res) => { const r = indexedDB.open('bird-nest'); r.onsuccess = () => res(r.result); }); await new Promise((res) => { const tx = db.transaction('settings', 'readwrite'); tx.objectStore('settings').put({ key: 'day', value: { workout: false, calendars: null, week: true }, updated_at: new Date().toISOString() }); tx.oncomplete = res; }); });
  await p.reload(); await p.waitForTimeout(2000);
  await p.click('.tabs >> text=Today'); await p.waitForTimeout(500);
  await p.click('.whole-t'); await p.waitForTimeout(300);
  const river = await p.locator('.tr').evaluateAll((xs) => xs.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
  assert(river.some((r) => /^7:30 .*Empty the baptismal/.test(r)), "Tuesday: the first one is at 7:30, when the day's work starts: " + river.join(' | '));
  assert(river.filter((r) => /baptismal|cafeteria|River Tech|bathrooms|building/.test(r)).length === 5, 'all five work things have a time');
  assert(await p.locator('.now-fits >> text=Call Chris Trongale about the leak').count() === 1, 'the call shows in the free time before work');
  await shot('tuesday');

  assert(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log('\nDump-spoken e2e: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
