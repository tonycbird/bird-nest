/* Buzzing (Phase 5): Settings → Buzz, the rest timer and shutdown plans, and opening from a buzz.
   The iPhone's push service can't run here, so permission and the push address are stubbed and
   the helper (/api/push/*) is answered by the test. The helper itself is tested in push-helper.it.mjs.
   Run:  npx vite build --outDir <dir> && npx vite preview --outDir <dir> --port 4181 &
         URL=http://localhost:4181/ node tests/e2e/buzz.e2e.cjs */
const { chromium } = require('playwright');
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('✓', m); };
const SHOTS = process.env.SHOTS;
const URL0 = process.env.URL || 'http://localhost:4181/';

const STUB = () => {
  window.__perm = 'default';
  try { Object.defineProperty(Notification, 'permission', { get: () => window.__perm, configurable: true }); } catch (e) {}
  Notification.requestPermission = async () => (window.__perm = 'granted');
  const sub = { endpoint: 'https://web.push.apple.com/fake-address', options: { applicationServerKey: null }, toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'BPfake', auth: 'fake' } }; }, unsubscribe: async () => { window.__subbed = false; return true; } };
  const pm = { subscribe: async () => { window.__subbed = true; return sub; }, getSubscription: async () => (window.__subbed ? sub : null) };
  try { Object.defineProperty(navigator.serviceWorker, 'ready', { get: () => Promise.resolve({ pushManager: pm }), configurable: true }); } catch (e) {}
};

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: SHOTS ? 2 : 1, serviceWorkers: 'block', timezoneId: 'America/Los_Angeles', hasTouch: true });
  await ctx.addInitScript(() => { try { if (!localStorage.getItem('nest:theme-mode')) localStorage.setItem('nest:theme-mode', 'light'); } catch (e) {} });
  await ctx.addInitScript(STUB);
  const calls = [];
  await ctx.route('**/api/push/**', async (route) => {
    const u = new URL(route.request().url());
    const op = u.pathname.split('/').pop();
    if (op === 'key') return route.fulfill({ json: { key: 'BKZwSlQVDtjTGOIi94ZgiuoNEfRF3gxNpaZXqXXb25BhMSFzXc20WTrT4vPvIcIWFnXplUQK--f3y8HpKfZP6Ps', ready: true } });
    const body = JSON.parse(route.request().postData() || '{}');
    calls.push({ op, body, t: Date.now() });
    return route.fulfill({ json: { ok: true, count: (body.items || []).length } });
  });
  const p = await ctx.newPage();
  await p.clock.install({ time: new Date('2026-10-21T16:00:00Z') }); // Wed 9:00 AM Pacific
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const shot = async (n) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${n}.png` }); };
  const last = (op) => [...calls].reverse().find((c) => c.op === op);
  const waitFor = async (fn, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await p.waitForTimeout(100); } return fn(); };

  await p.goto(URL0); await p.waitForTimeout(800);
  await p.click('[aria-label="Settings"]'); await p.waitForTimeout(300);
  const card = p.locator('.card', { hasText: 'Turn on buzzing' });
  assert(await card.count() === 1, 'Settings has a Buzz card with one button');
  await card.scrollIntoViewIfNeeded(); await shot('buzz-off');

  // Turn on
  await p.click('button >> text=Turn on buzzing');
  const sub = await waitFor(() => last('subscribe'));
  assert(sub && sub.body.sub.endpoint === 'https://web.push.apple.com/fake-address' && /^n_/.test(sub.body.device) && sub.body.key.length >= 32, 'turning on sends this phone\'s push address with its own id and key');
  await p.waitForTimeout(400);
  assert(await p.locator('.kv >> text=Rest timer done').count() === 1 && await p.locator('.kv >> text=Shutdown · 7').count() === 1, 'switches for rest timer and shutdown (7 PM)');
  const sd = await waitFor(() => calls.find((c) => c.op === 'schedule' && c.body.replace === 'shutdown:'));
  assert(sd, 'shutdown week sent');
  const ids = sd.body.items.map((i) => i.id);
  assert(ids[0] === 'shutdown:2026-10-21' && ids.length === 6 && !ids.includes('shutdown:2026-10-26'), 'tonight first, then the week, skipping the off day (Monday): ' + ids.join(' '));
  const first = new Date(sd.body.items[0].at);
  assert(first.toISOString() === '2026-10-22T02:00:00.000Z', 'shutdown at 7:00 PM Pacific');
  assert(sd.body.items[0].url === '/?open=shutdown' && sd.body.items[0].title === 'Shutdown', 'shutdown buzz opens Shutdown');
  await p.locator('.card', { hasText: 'Rest timer done' }).scrollIntoViewIfNeeded(); await shot('buzz-on');

  // Rest timer: start → planned at its end; +15 → moved; skip → cancelled
  const n0 = calls.length;
  const end = await p.evaluate(() => { const e = Date.now() + 90000; window.__nestFit.timer({ on: true, end: e, label: 'Rest', doneAt: 0 }); return e; });
  const rs = await waitFor(() => calls.slice(n0).find((c) => c.op === 'schedule' && c.body.items?.[0]?.id === 'rest'));
  assert(rs && rs.body.items[0].at === end && rs.body.items[0].title === 'Rest done — go' && rs.body.items[0].url === '/?open=body', 'rest timer plans a buzz at its end');
  // the timer redraws every 250 ms: that must not send again
  for (let i = 0; i < 6; i++) await p.evaluate((e) => window.__nestFit.timer({ on: true, end: e, label: 'Rest', doneAt: 0 }), end);
  await p.waitForTimeout(900);
  assert(calls.slice(n0).filter((c) => c.op === 'schedule').length === 1, 'redraws don\'t resend');
  const n1 = calls.length;
  await p.evaluate((e) => window.__nestFit.timer({ on: true, end: e + 15000, label: 'Rest', doneAt: 0 }), end);
  const mv = await waitFor(() => calls.slice(n1).find((c) => c.op === 'schedule'));
  assert(mv && mv.body.items[0].at === end + 15000, '+15 moves the buzz');
  const n2 = calls.length;
  await p.evaluate(() => window.__nestFit.timer({ on: false, end: 0, label: 'Rest', doneAt: 0 }));
  const cx = await waitFor(() => calls.slice(n2).find((c) => c.op === 'cancel'));
  assert(cx && cx.body.ids[0] === 'rest', 'skipping rest cancels the buzz');
  const n3 = calls.length;
  await p.evaluate(() => window.__nestFit.timer({ on: true, end: Date.now() + 40000, label: 'Hold', doneAt: 0 }));
  await p.waitForTimeout(1000);
  assert(!calls.slice(n3).some((c) => c.op === 'schedule'), 'Hold timers don\'t buzz');
  await p.evaluate(() => window.__nestFit.timer({ on: false, end: 0, label: 'Hold', doneAt: 0 }));

  // Switches
  await p.locator('.kv', { hasText: 'Rest timer done' }).locator('input').click(); await p.waitForTimeout(300);
  const n4 = calls.length;
  await p.evaluate(() => window.__nestFit.timer({ on: true, end: Date.now() + 90000, label: 'Rest', doneAt: 0 }));
  await p.waitForTimeout(1000);
  assert(!calls.slice(n4).some((c) => c.op === 'schedule' && c.body.items?.[0]?.id === 'rest'), 'rest switch off: no rest buzz');
  await p.evaluate(() => window.__nestFit.timer({ on: false, end: 0, label: 'Rest', doneAt: 0 }));
  const n5 = calls.length;
  await p.locator('.kv', { hasText: 'Shutdown ·' }).locator('input').click();
  const off = await waitFor(() => calls.slice(n5).find((c) => c.op === 'cancel' && c.body.prefix === 'shutdown:'));
  assert(off, 'shutdown switch off clears the week');
  await p.locator('.kv', { hasText: 'Shutdown ·' }).locator('input').click();
  assert(await waitFor(() => calls.slice(n5).find((c) => c.op === 'schedule' && c.body.replace === 'shutdown:')), 'and back on sends it again');

  // Test + turn off
  await p.click('.card button >> text=Test');
  assert(await waitFor(() => last('test')), 'Test sends a test buzz');
  await p.locator('.toast >> text=Sent').first().waitFor({ timeout: 3000 });
  assert(await p.locator('.toast >> text=Sent').count() >= 1, 'toast says it was sent');
  await p.click('.card button >> text=Turn off');
  assert(await waitFor(() => last('off')), 'Turn off clears this phone from the helper');
  await p.waitForTimeout(300);
  assert(await p.locator('button >> text=Turn on buzzing').count() === 1, 'back to one button');

  // Opening from a buzz
  await p.goto(URL0 + '?open=shutdown'); await p.waitForTimeout(800);
  assert(await p.locator('.flow h2 >> text=Close out today').count() === 1, 'a shutdown buzz opens Shutdown');
  assert(!(await p.evaluate(() => location.search)), 'the address is cleaned up');
  await p.goto(URL0 + '?open=body'); await p.waitForTimeout(800);
  assert(await p.locator('.tab.on >> text=Body').count() === 1, 'a rest buzz opens Body');

  // Dark look
  await p.evaluate(() => localStorage.setItem('nest:theme-mode', 'dark'));
  await p.goto(URL0); await p.waitForTimeout(600);
  await p.click('[aria-label="Settings"]'); await p.waitForTimeout(300);
  await p.locator('.card', { hasText: 'Turn on buzzing' }).scrollIntoViewIfNeeded(); await shot('buzz-off-dark');

  // An iPhone in Safari (not from the Home Screen) is told how
  const ios = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1' });
  const q = await ios.newPage();
  await q.goto(URL0); await q.waitForTimeout(800);
  await q.click('[aria-label="Settings"]'); await q.waitForTimeout(300);
  assert(await q.locator('text=Open Nest from your Home Screen to turn this on.').count() === 1, 'Safari tab: open from the Home Screen first');
  await ios.close();

  assert(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  console.log('\nBuzz e2e: all passed');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
