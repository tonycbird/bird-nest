/* Phase 2 end-to-end checks in a phone-sized Chromium.
   Run:  npm run build && npx vite preview --port 4180 &
         node tests/e2e/make-seed.mjs /tmp/seed.json
         SEED=/tmp/seed.json URL=http://localhost:4180/ node tests/e2e/phase2.e2e.cjs
   Needs Playwright (npx playwright, or a global install). Not part of `npm test`. */
const { chromium } = require('playwright');
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('✓', m); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, serviceWorkers:'block', timezoneId:'America/Los_Angeles' });
  const p = await ctx.newPage();
  await p.clock.setFixedTime(new Date('2026-10-15T15:00:00Z'));
  const errs=[]; p.on('pageerror', e=>errs.push('PAGE '+e.message));
  await p.goto((process.env.URL || 'http://localhost:4180/')); await p.waitForTimeout(700);
  await p.click('.tabs >> text=Head');
  await p.setInputFiles('input[type=file]', (process.env.SEED || 'seed.json')); await p.waitForTimeout(900);
  await p.click('.hn >> text=Inbox');
  await p.click('[aria-label="Select tasks"]');
  await p.click('.task >> text=Replace porch light'); await p.click('.task >> text=Ask pastor about camp dates');
  await 
  await p.click('.bulkbar [aria-label=Done]'); await p.waitForTimeout(500);
  assert(await p.locator('.task >> text=Replace porch light').count() === 0, 'bulk done clears both from Inbox');
  assert(await p.locator('.bulkbar').count() === 0, 'bulk bar closes after acting');
  console.log(errs.length ? errs.join('\n') : 'no page errors');
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
