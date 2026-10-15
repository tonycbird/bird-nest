/* Offline at the gym: after one online visit, Body opens and logs with no network.
   Run:  npm run build && npx vite preview --port 4180 &   URL=http://localhost:4180/ node tests/e2e/phase3-offline.e2e.cjs */
const { chromium } = require('playwright');
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('✓', m); };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Los_Angeles' });
  const p = await ctx.newPage();
  await p.goto(process.env.URL || 'http://localhost:4180/');
  await p.evaluate(async () => { await navigator.serviceWorker.ready; });
  await p.waitForTimeout(1500);
  await p.reload(); await p.waitForTimeout(800);
  assert(await p.evaluate(() => !!navigator.serviceWorker.controller), 'service worker controls the app');
  await ctx.setOffline(true);
  await p.reload(); await p.waitForTimeout(800);
  assert(await p.locator('.tabs').count() === 1, 'app opens offline');
  await p.click('.tabs >> text=Body'); await p.waitForTimeout(2000);
  const f = p.frameLocator('iframe.bodyframe');
  assert(await f.locator('h1.ltitle >> text=Workout').count() === 1, 'Body opens offline');
  const fr = p.frames().find((x) => x.url().includes('/body'));
  const fontOk = await fr.evaluate(async () => { await document.fonts.ready; return document.fonts.check('16px "Archivo Variable"'); });
  assert(fontOk, 'fonts are bundled (no network needed)');
  // Log one set offline.
  const today = await fr.evaluate(() => today());
  const wid = await fr.evaluate(() => dayWorkout(today()));
  if (wid) {
    await fr.evaluate(([d, w]) => window.__fit.openWorkout(d, w), [today, wid]); await p.waitForTimeout(400);
    await f.locator('[data-a="openEx"]').first().click(); await p.waitForTimeout(300);
    const row = f.locator('.setrow[data-i="0"]');
    await row.locator('input[data-f="r"]').fill('8'); const w = row.locator('input[data-f="w"]'); if (!(await w.inputValue())) await w.fill('95');
    await row.locator('[data-a="setDone"]').click(); await p.waitForTimeout(900);
    const saved = await p.evaluate(async (mk) => { const r = indexedDB.open('bird-nest'); return await new Promise((res) => { r.onsuccess = () => { r.result.transaction('fit').objectStore('fit').get('logs/' + mk).onsuccess = (e) => res(!!e.target.result); }; }); }, today.slice(0, 7));
    assert(saved, 'a set logged offline is saved in the phone database');
  } else console.log('· rest day — skipped the set log');
  await b.close();
  console.log('\nPhase 3 offline: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
