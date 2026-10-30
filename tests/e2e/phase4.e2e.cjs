/* Phase 4 end-to-end: sign in, the phone's copy goes up, Claude's proposals come down and settle themselves
   (mail tasks into the Inbox, the rest set aside), his own calendar fills the River, shared events stay lines.
   Supabase is faked in the browser (same REST shapes), so this runs with no network.
   Run:  VITE_SUPABASE_URL=https://fake.supabase.co VITE_SUPABASE_ANON_KEY=x VITE_CLOUD=on npx vite build --outDir dist-cloud
         npx vite preview --outDir dist-cloud --port 4183 &
         URL=http://localhost:4183/ node tests/e2e/phase4.e2e.cjs */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('✓', m); };
const SHOTS = process.env.SHOTS || '';
const shot = async (p, n) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, n + '.png') }); } };

const T = '2026-10-17';
const server = {
  rows: new Map(), claimed: 0, otp: 0,
  proposals: [
    { id: 'p-plan', kind: 'day_plan', status: 'pending', needs_google: false, day_key: T, created_at: '2026-10-17T11:45:00Z', updated_at: '2026-10-17T11:45:00Z', reason: 'Legs day, quote due Friday',
      payload: { sentence: 'Legs, then the Smith quote.', blocks: [
        { start: '05:00', end: '06:10', kind: 'body', icon: '🏋', title: 'Legs', steps: [{ label: 'Back Squat', value: '3×8 · 225' }, { label: 'RDL', value: '3×10 · 185' }], source_type: 'workout', source_id: T + '|main' },
        { start: '08:30', end: '09:00', kind: 'head', icon: '🧠', title: 'Smith quote', steps: [{ label: 'Open' }, { label: 'Do 25 min' }, { label: 'Note next step' }] },
      ] } },
    { id: 'p-mail', kind: 'task', status: 'pending', needs_google: false, day_key: T, created_at: '2026-10-17T11:44:00Z', updated_at: '2026-10-17T11:44:00Z', reason: 'Dave asked by email', payload: { title: 'Send Dave the tile quote', due: '2026-10-20', link: 'https://mail.google.com/mail/u/0/#inbox/abc' } },
    { id: 'p-gym', kind: 'calendar_book', status: 'pending', needs_google: true, day_key: T, created_at: '2026-10-17T11:43:00Z', updated_at: '2026-10-17T11:43:00Z', reason: 'No gym event on the calendar', payload: { title: 'Gym · Legs', day: T, start: '05:00', end: '06:10' } },
    { id: 'p-groc', kind: 'grocery', status: 'pending', needs_google: false, day_key: T, created_at: '2026-10-17T11:42:00Z', updated_at: '2026-10-17T11:42:00Z', reason: 'Meal plan needs these', payload: { items: [{ name: 'Spinach', amt: '1 bag' }] } },
  ],
  calendar: [{ google_id: 'g1', day: T, start_time: '12:00', end_time: '13:00', title: 'Dentist', all_day: false, calendar: 'The Heart Staff' }, { google_id: 'g2', day: T, start_time: null, end_time: null, title: 'Payday', all_day: true, calendar: 'anthony@example.com' }, { google_id: 'g3', day: T, start_time: '15:00', end_time: '16:00', title: 'Coffee with Landyn', all_day: false, calendar: 'anthony@example.com' }],
  mail: [{ id: 'm1', received: null, sender: 'Dave Smith', subject: 'Tile quote?', ask: 'Send tile quote', due: null, link: 'https://mail.google.com/x', created_at: '2026-10-17T11:40:00Z', dismissed_at: null }],
};
const session = () => ({ access_token: 'aaa.' + Buffer.from(JSON.stringify({ sub: 'u1', exp: 4102444800 })).toString('base64url') + '.sig', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, refresh_token: 'r', user: { id: 'u1', email: 'anthony@example.com', aud: 'authenticated', role: 'authenticated' } });

async function fakeSupabase(route) {
  const req = route.request(); const u = new URL(req.url()); const m = req.method(); const p = u.pathname;
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, body: JSON.stringify(body) });
  if (m === 'OPTIONS') return json({});
  if (p === '/auth/v1/signup') { server.otp++; return json(session()); }
  if (p === '/auth/v1/token') return json(session());
  if (p === '/auth/v1/logout') return json({});
  if (p === '/rest/v1/rpc/nest_claim_gateway') { server.claimed++; return json(true); }
  if (p === '/rest/v1/nest_rows' && m === 'POST') { for (const r of JSON.parse(req.postData() || '[]')) server.rows.set(r.tbl + '|' + r.id, r); return json([], 201); }
  if (p === '/rest/v1/nest_rows') return json([]);
  if (p === '/rest/v1/proposals' && m === 'PATCH') {
    const id = (u.searchParams.get('id') || '').replace('eq.', ''); const body = JSON.parse(req.postData() || '{}');
    const row = server.proposals.find((x) => x.id === id); if (row) Object.assign(row, body); return json([], 204);
  }
  if (p === '/rest/v1/proposals') return json(server.proposals);
  if (p === '/rest/v1/calendar_cache') return json(server.calendar);
  if (p === '/rest/v1/mail_items' && m === 'PATCH') return json([], 204);
  if (p === '/rest/v1/mail_items') return json(server.mail);
  return json({ message: 'not faked: ' + m + ' ' + p }, 404);
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', timezoneId: 'America/Los_Angeles' });
  await ctx.route(/fake\.supabase\.co/, fakeSupabase);
  const p = await ctx.newPage();
  await p.clock.install({ time: new Date('2026-10-17T12:00:00Z') });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(process.env.URL || 'http://localhost:4183/'); await p.waitForTimeout(800);

  // Nest opens straight to Today, signed out. Nothing is locked.
  assert(await p.locator('.tabs').count() === 1 && await p.locator('text=Welcome home.').count() === 0, 'Nest opens without signing in');
  await p.click('.tabs >> text=Head'); await p.click('button >> text=Start fresh'); await p.waitForTimeout(300);
  await p.click('.tabs >> text=Today'); await p.click('text=Sample day'); await p.waitForTimeout(400);
  const before = await p.locator('.tr:not(.cal) .bc-main b').allInnerTexts();

  // The tab bar is Today · Head · ＋ · Body · Money; Claude is connected from Settings.
  assert(await p.locator('.tabs >> text=Money').count() === 1 && await p.locator('.tabs >> text=Claude').count() === 0, 'Money has the Claude tab\'s place');
  await p.click('[aria-label="Settings"]'); await p.waitForTimeout(300);
  await p.click('text=Connect Claude');
  await p.click('text=First time here');
  await p.fill('input[type=email]', 'anthony@example.com'); await p.fill('input[type=password]', 'correct horse battery');
  await p.click('text=Make account'); await p.waitForTimeout(2500);
  assert(server.otp === 1, 'account made with email + password');
  await shot(p, '40-settings-connected');
  assert(await p.locator('.lbl', { hasText: /^Claude$/ }).locator('xpath=following-sibling::div[1]').locator('.kv >> text=anthony@example.com').count() === 1, 'Settings shows connected');
  assert(await p.locator('.lbl', { hasText: 'Your day' }).locator('xpath=following-sibling::div[1]').locator('.kv', { hasText: 'The Heart Staff' }).locator('input:not(:checked)').count() === 1, 'Your day: his calendars listed, a shared one off by default');
  assert(server.claimed >= 1, "Claude's door claimed for this account");
  const tbls = new Set([...server.rows.values()].map((r) => r.tbl));
  assert(['blocks', 'steps', 'areas', 'settings', 'derived'].every((t) => tbls.has(t)), 'the phone copy went up: ' + [...tbls].join(','));
  assert(server.rows.has('derived|prefs'), 'prefs for Claude went up');

  // Claude's suggestions came down and settled themselves: no approving, no Claude section.
  await p.click('[aria-label="Back to Today"]'); await p.waitForTimeout(1200);
  assert(await p.locator('.qc >> text=Claude').count() === 0, 'no Claude circle on Today');
  const st = (id) => server.proposals.find((x) => x.id === id).status;
  for (let i = 0; i < 30 && server.proposals.some((x) => x.status === 'pending'); i++) await p.waitForTimeout(200); // the decisions go up in the background
  assert(st('p-mail') === 'applied', 'the mail task went straight in (marked applied)');
  assert(st('p-plan') === 'declined' && st('p-gym') === 'declined', 'the day plan and the gym booking were set aside');
  assert(['applied', 'declined'].includes(st('p-groc')), 'groceries settled too (' + st('p-groc') + ')');
  const after = await p.locator('.tr:not(.cal) .bc-main b').allInnerTexts();
  assert(before.every((x) => after.includes(x)) && !after.includes('Smith quote'), `the River wasn't replaced (${after.join(', ')})`);
  // His own calendar's event became a block by itself; the shared one stays a small line.
  assert(await p.locator('.tr:not(.calline) .bc-main b', { hasText: 'Coffee with Landyn' }).count() === 1, 'his own event is on the River by itself');
  assert(await p.locator('.calline >> text=Dentist').count() === 1, 'a shared event shows as a small line');
  assert(await p.locator('.allday >> text=Payday').count() === 1, 'all-day item shows as a small chip');
  await shot(p, '42-river-fills-itself');
  // A quick tap only says how; holding makes it yours.
  await p.locator('.calline', { hasText: 'Dentist' }).click(); await p.waitForTimeout(300);
  assert(await p.locator('.toast >> text=Hold to make it yours').count() === 1, 'a tap explains: hold');
  assert(await p.locator('.calline', { hasText: 'Dentist' }).count() === 1, 'a tap alone does nothing');
  const hold = async (loc) => { const bx = await loc.boundingBox(); await p.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2); await p.mouse.down(); await p.waitForTimeout(800); await p.mouse.up(); await p.waitForTimeout(500); };
  await hold(p.locator('.calline', { hasText: 'Dentist' }));
  assert(await p.locator('.calline', { hasText: 'Dentist' }).count() === 0 && await p.locator('.tr:not(.calline) .bc-main b', { hasText: 'Dentist' }).count() === 1, 'holding a calendar line makes it a block');
  await hold(p.locator('.calchip', { hasText: 'Payday' }));
  assert(await p.locator('.calchip', { hasText: 'Payday' }).count() === 0, 'holding an all-day chip accepts it');
  const payday = await p.evaluate(async () => { const r = indexedDB.open('bird-nest'); return await new Promise((res) => { r.onsuccess = () => { const q = r.result.transaction('tasks').objectStore('tasks').getAll(); q.onsuccess = () => res(q.result.find((t) => t.title === 'Payday')); }; }); });
  assert(payday && payday.calId, 'the all-day item is a task for the day');
  await shot(p, '43-calendar-accepted');

  // Head got the mail task with its link.
  await p.click('.tabs >> text=Head'); await p.waitForTimeout(300);
  await p.click('.hn >> text=Inbox'); await p.waitForTimeout(300);
  assert(await p.locator('text=Send Dave the tile quote').count() >= 1, 'mail task is in the Head Inbox');

  // Offline: the app keeps working, edits wait, then go up.
  await ctx.setOffline(true);
  await p.click('.tabs >> text=Today'); await p.waitForTimeout(200);
  if (!(await p.locator('.tr.open', { hasText: 'Legs' }).count())) await p.locator('.tr', { hasText: 'Legs' }).locator('.bc-main').click();
  await p.locator('.tr.open .bc-cur').first().click(); await p.waitForTimeout(300);
  const stepsBefore = [...server.rows.values()].filter((r) => r.tbl === 'steps' && r.data.done_at).length;
  await ctx.setOffline(false);
  await p.evaluate(() => window.dispatchEvent(new Event('online'))); await p.waitForTimeout(1500);
  const stepsAfter = [...server.rows.values()].filter((r) => r.tbl === 'steps' && r.data.done_at).length;
  assert(stepsAfter > stepsBefore, 'a step ticked offline went up when back online');

  assert(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log('\nPhase 4 e2e: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
