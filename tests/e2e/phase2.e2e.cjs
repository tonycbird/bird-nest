/* Phase 2 end-to-end checks in a phone-sized Chromium.
   Run:  npm run build && npx vite preview --port 4180 &
         node tests/e2e/make-seed.mjs /tmp/seed.json
         SEED=/tmp/seed.json URL=http://localhost:4180/ node tests/e2e/phase2.e2e.cjs
   Needs Playwright (npx playwright, or a global install). Not part of `npm test`. */
const { chromium } = require('playwright');
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('✓', m); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport:{width:390,height:844}, serviceWorkers:'block', timezoneId:'America/Los_Angeles' });
  const p = await ctx.newPage();
  await p.clock.setFixedTime(new Date('2026-10-15T15:00:00Z'));
  const errs=[]; p.on('pageerror', e=>errs.push('PAGE '+e.message));
  await p.goto((process.env.URL || 'http://localhost:4180/')); await p.waitForTimeout(700);
  // These checks start from an empty River: keep the workout from landing on it by itself (that's tested in phase3).
  await p.evaluate(async () => { const db = await new Promise((res) => { const r = indexedDB.open('bird-nest'); r.onsuccess = () => res(r.result); }); await new Promise((res) => { const tx = db.transaction('settings', 'readwrite'); tx.objectStore('settings').put({ key: 'day', value: { workout: false, calendars: null }, updated_at: new Date().toISOString() }); tx.oncomplete = res; }); });
  await p.reload(); await p.waitForTimeout(700);
  // Quick add from Today tab → lands today, appears in tray
  await p.click('[aria-label="Quick add"]'); await p.keyboard.type('Call Smith ~15m'); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
  assert(await p.locator('.quick [aria-label="Call Smith"]').count() === 1, 'quick add from Today lands in the circles at the top');
  await p.click('.quick [aria-label="Call Smith"]'); await p.click('[aria-label="More actions"]'); await p.click(".menu >> text=Put on today's River"); await p.waitForTimeout(500); await p.mouse.click(195, 30); await p.waitForTimeout(300);
  assert(await p.locator('.tr >> text=Call Smith').count() === 1, 'the task goes on the timeline');
  // finish the block → task done
  for (let i=0;i<3;i++){ const c = p.locator('.tr.open .bc-cur'); if (await c.count()) { await c.first().click(); await p.waitForTimeout(200); } }
  await p.click('.tabs >> text=Head'); await p.waitForTimeout(300);
  // Head first run → Start fresh
  await p.click('button >> text=Start fresh'); await p.waitForTimeout(500);
  await p.click('.hn >> text=Done'); await p.waitForTimeout(300);
  assert(await p.locator('.task.done >> text=Call Smith').count() === 1, 'finishing the River block completed the task (Logbook)');
  // Templates: Handyman Job
  await p.click('.hn >> text=Projects'); await p.click('[aria-label="New project"]'); await p.click('text=From a template'); await p.waitForTimeout(300);
  await p.click('.qd button >> text=Handyman Job'); await p.fill('input[placeholder="Smith bathroom remodel"]', 'Jones deck'); await p.click('text=Create'); await p.waitForTimeout(600);
  assert(await p.locator('h1 >> text=Jones deck').count() === 1, 'template created the project');
  assert(await p.locator('.sec-head >> text=Close out').count() === 1, 'template sections present');
  // Delete project → Trash → restore
  await p.click('[aria-label="Project options"]'); await p.click('.menu >> text=Delete project'); await p.click('.sheet-actions >> text=Delete'); await p.waitForTimeout(500);
  await p.click('[aria-label="Head settings"]'); await p.click('text=Recently deleted'); await p.waitForTimeout(300);
  assert(await p.locator('text=Jones deck').count() >= 1, 'deleted project waits in Recently deleted');
  await p.locator('.kv >> text=Jones deck').locator('xpath=..').locator('button >> text=').first().click().catch(async()=>{ await p.locator('button >> text=').first().click(); });
  await p.waitForTimeout(500);
  await p.click('.hn >> text=Projects');
  assert(await p.locator('.pcard >> text=Jones deck').count() === 1, 'restore brings it back');
  // Day planner tomorrow → put on tomorrow's River
  await p.click('.hn >> text=Today'); await p.click('[aria-label=More]'); await p.click('.menu >> text=Plan tomorrow'); await p.waitForTimeout(300);
  await p.fill('.day-planner input', 'Pick up trailer'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  await p.click("text=Put on tomorrow's River"); await p.waitForTimeout(500);
  await p.click('.flow-foot >> text=Done');
  await p.click('.tabs >> text=Today'); await p.click('[aria-label="Friday Oct 16"]'); await p.waitForTimeout(400);
  assert(await p.locator('.tr >> text=Pick up trailer').count() === 1, "tomorrow's River got the block");
  // Shutdown in the evening → quiet screen on Head
  await p.clock.setFixedTime(new Date('2026-10-16T02:30:00Z')); // 7:30 PM PT Oct 15
  await p.click('.tabs >> text=Head'); await p.click('.hn >> text=Today'); await p.click('.rituals >> text=Shutdown'); await p.waitForTimeout(300);
  for (let i=0;i<3;i++){ const nx = await p.$('.flow-foot .btn'); if (nx) { await nx.click(); await p.waitForTimeout(300);} }
  await p.click('text=Shut down'); await p.waitForTimeout(400);
  await p.click('.tabs >> text=Head'); await p.waitForTimeout(400);
  assert(await p.locator('text=Off for the night').count() === 1, 'after shutdown, Head shows the quiet screen');
  await p.click('text=Open Head anyway'); await p.waitForTimeout(300);
  assert(await p.locator('.hnav').count() === 1, '"Open Head anyway" works');
  console.log(errs.length ? errs.join('\n') : 'no page errors');
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
