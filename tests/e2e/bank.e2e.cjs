/* Bank (Phase 7): Settings → Bank links a bank through Plaid Link and the purchases come down to the phone.
   The helper (/api/bank/*), Supabase and Plaid's own script are all faked in the browser, so this runs with no network.
   Run with the cloud build (as phase4.e2e.cjs):
         VITE_SUPABASE_URL=https://fake.supabase.co VITE_SUPABASE_ANON_KEY=x VITE_CLOUD=on npx vite build --outDir dist-cloud
         npx vite preview --outDir dist-cloud --port 4183 &
         URL=http://localhost:4183/ node tests/e2e/bank.e2e.cjs */
const { chromium } = require('playwright');
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('✓', m); };
const SHOTS = process.env.SHOTS;

const session = { access_token: 'aaa.' + Buffer.from(JSON.stringify({ sub: 'u1', exp: 4102444800 })).toString('base64url') + '.sig', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, refresh_token: 'r', user: { id: 'u1', email: 'anthony@example.com', aud: 'authenticated', role: 'authenticated' } };

function fakeHelper() {
  const st = { items: [], accounts: [], rows: [], seq: 0, prod_used: 0, calls: [], auth: [] };
  const status = () => ({ ok: true, keys_sandbox: true, keys_production: true, items: st.items, accounts: st.accounts, count: st.rows.filter((r) => !r.removed).length, newest: st.rows.filter((r) => !r.removed).map((r) => r.date).sort().pop() || null, seq: st.seq, prod_used: st.prod_used, prod_limit: 10, last_run: 0 });
  const add = (r) => { st.seq++; st.rows = st.rows.filter((x) => x.id !== r.id); st.rows.push({ ...r, seq: st.seq }); };
  return {
    st,
    async route(route) {
      const req = route.request();
      const op = new URL(req.url()).pathname.split('/').pop();
      const body = JSON.parse(req.postData() || '{}');
      st.calls.push({ op, body }); st.auth.push(req.headers()['authorization'] || '');
      const json = (v, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(v) });
      if (!/^Bearer aaa\./.test(req.headers()['authorization'] || '')) return json({ ok: false, why: 'SIGN_IN' }, 401);
      if (op === 'status') return json(status());
      if (op === 'link') return json({ ok: true, link_token: 'link-' + (body.env || 'update'), prod_used: st.prod_used });
      if (op === 'exchange') {
        const env = body.env;
        const id = env === 'sandbox' ? 'item-practice' : 'item-iccu';
        st.items.push({ item_id: id, env, inst_name: body.institution.name, status: 'ok', error: '', update_status: 'HISTORICAL_UPDATE_COMPLETE', last_sync: Date.now() });
        if (env === 'production') st.prod_used++;
        st.accounts.push({ account_id: id + '-chk', item_id: id, name: 'Joint Checking', mask: '0707', type: 'depository', subtype: 'checking', current: 1523.11, available: 1490.02, updated: Date.now() });
        st.accounts.push({ account_id: id + '-sav', item_id: id, name: 'Savings', mask: '0001', type: 'depository', subtype: 'savings', current: 300, available: 300, updated: Date.now() });
        st.accounts.push({ account_id: id + '-visa', item_id: id, name: 'Visa Platinum', mask: '4410', type: 'credit', subtype: 'credit card', current: 812.4, available: null, updated: Date.now() });
        add({ id: 't1', item_id: id, account_id: id + '-chk', date: '2026-10-27', amount: -152.36, name: 'WINCO FOODS #12', merchant: 'WinCo Foods', pending: 1, pending_id: null, hint: 'FOOD_AND_DRINK_GROCERIES', removed: 0 });
        add({ id: 't2', item_id: id, account_id: id + '-chk', date: '2026-10-16', amount: 1976.52, name: 'PAYROLL', merchant: '', pending: 0, pending_id: null, hint: 'INCOME_WAGES', removed: 0 });
        return json(status());
      }
      if (op === 'changes') {
        const since = Number(body.since) || 0;
        const rows = st.rows.filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq);
        return json({ ok: true, rows, seq: rows.length ? rows[rows.length - 1].seq : since, more: false });
      }
      if (op === 'pull') {
        // the pending WinCo purchase posts under a new id
        if (!st.rows.find((r) => r.id === 't3')) {
          add({ ...st.rows.find((r) => r.id === 't1'), removed: 1 });
          add({ id: 't3', item_id: st.items[0].item_id, account_id: st.items[0].item_id + '-chk', date: '2026-10-28', amount: -152.36, name: 'WINCO FOODS #12', merchant: 'WinCo Foods', pending: 0, pending_id: 't1', hint: 'FOOD_AND_DRINK_GROCERIES', removed: 0 });
        }
        return json(status());
      }
      if (op === 'remove') {
        for (const r of st.rows.filter((x) => x.item_id === body.item_id && !x.removed)) add({ ...r, removed: 1 });
        st.items = st.items.filter((i) => i.item_id !== body.item_id); st.accounts = st.accounts.filter((a) => a.item_id !== body.item_id);
        return json(status());
      }
      return json({ ok: false, why: 'NOT_FOUND' }, 404);
    },
  };
}

// Plaid Link, faked: "signs in" right away and hands back a public token, or backs out when asked to.
const FAKE_PLAID = `window.Plaid = { create(o) { return { open() { window.__plaidOpened = (window.__plaidOpened || 0) + 1; window.__plaidToken = o.token;
  setTimeout(() => window.__plaidExit ? o.onExit(null, {}) : o.onSuccess('public-' + (o.token.includes('production') ? 'production' : 'sandbox') + '-e2e', { institution: { institution_id: 'ins_x', name: o.token.includes('production') ? 'Idaho Central Credit Union' : 'First Platypus Bank' } }), 150); }, destroy() {} }; } };`;

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const errs = [];
  for (const theme of ['light', 'dark']) {
    const helper = fakeHelper();
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: SHOTS ? 2 : 1, serviceWorkers: 'block', timezoneId: 'America/Los_Angeles' });
    await ctx.addInitScript(([s, t]) => { try { localStorage.setItem('sb-fake-auth-token', JSON.stringify(s)); localStorage.setItem('nest:theme-mode', t); } catch (e) {} }, [session, theme]);
    await ctx.route(/fake\.supabase\.co/, (route) => {
      const u = new URL(route.request().url());
      const json = (v, s = 200) => route.fulfill({ status: s, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, body: JSON.stringify(v) });
      if (route.request().method() === 'OPTIONS') return json({});
      if (u.pathname === '/rest/v1/rpc/nest_claim_gateway') return json(true);
      if (u.pathname.startsWith('/rest/v1/money_summary')) return json(null);
      if (u.pathname.startsWith('/rest/v1/')) return json(route.request().method() === 'POST' ? [] : []);
      return json({});
    });
    await ctx.route('**/api/bank/**', (r) => helper.route(r));
    await ctx.route('https://cdn.plaid.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: FAKE_PLAID }));
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    const shot = async (n) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${n}-${theme}.png`, fullPage: false }); };
    await p.goto(process.env.URL || 'http://localhost:4183/'); await p.waitForTimeout(900);
    await p.click('[aria-label="Settings"]'); await p.waitForTimeout(500);
    const card = p.locator('.lbl', { hasText: /^Bank$/ }).locator('xpath=following-sibling::div[1]');
    await card.scrollIntoViewIfNeeded();
    assert(await card.locator('button', { hasText: 'Connect ICCU' }).count() === 1 && await card.locator('button', { hasText: 'Try the practice bank' }).count() === 1, `${theme}: Bank card offers ICCU and the practice bank`);
    await shot('bank-empty');

    if (theme === 'light') {
      // Back out of Plaid: nothing is linked
      await p.evaluate(() => { window.__plaidExit = true; });
      await card.locator('button', { hasText: 'Try the practice bank' }).click(); await p.waitForTimeout(700);
      assert(helper.st.items.length === 0 && await card.locator('button', { hasText: 'Try the practice bank' }).count() === 1, 'closing Plaid links nothing');
      await p.evaluate(() => { window.__plaidExit = false; });
    }

    await card.locator('button', { hasText: 'Try the practice bank' }).click(); await p.waitForTimeout(1200);
    assert(helper.st.calls.some((c) => c.op === 'link' && c.body.env === 'sandbox') && helper.st.calls.some((c) => c.op === 'exchange' && c.body.public_token === 'public-sandbox-e2e' && c.body.institution.name === 'First Platypus Bank'), 'practice link: token from the helper, Plaid signs in, public token goes back');
    assert(helper.st.auth.every((a) => a.startsWith('Bearer aaa.')), 'every bank call carries the Supabase session');
    assert(await card.locator('text=First Platypus Bank').count() === 1 && await card.locator('text=· practice').count() === 1, 'the practice bank shows, marked practice');
    assert(await card.locator('.kv', { hasText: 'Joint Checking ··0707' }).locator('text=$1,523').count() === 1, 'its checking balance shows');
    assert(await card.locator('.kv', { hasText: 'Savings' }).count() === 0 && await card.locator('button', { hasText: '＋2 more accounts' }).count() === 1, 'only checking shows; the other accounts fold into one line');
    await shot('bank-linked');
    await card.locator('button', { hasText: '＋2 more accounts' }).click(); await p.waitForTimeout(200);
    assert(await card.locator('.kv', { hasText: 'Visa Platinum ··4410' }).locator('text=−$812').count() === 1, 'tap: all accounts, a card balance shows as owed');
    let txns = await p.evaluate(async () => { const db = await new Promise((r) => { const q = indexedDB.open('bird-nest'); q.onsuccess = () => r(q.result); }); return await new Promise((r) => { const q = db.transaction('txns').objectStore('txns').getAll(); q.onsuccess = () => r(q.result); }); });
    assert(txns.length === 2 && txns.find((t) => t.id === 't1').amount === -152.36 && txns.find((t) => t.id === 't1').month === '2026-10', 'purchases are on the phone');
    assert(await card.locator('.kv', { hasText: 'Purchases' }).locator('text=2 · newest 10/27').count() === 1, 'count and newest date');

    // Nest sorts the pending purchase; when it posts under a new id, it keeps the category
    await p.evaluate(async () => { const db = await new Promise((r) => { const q = indexedDB.open('bird-nest'); q.onsuccess = () => r(q.result); }); await new Promise((r) => { const tx = db.transaction('txns', 'readwrite'); const s = tx.objectStore('txns'); const g = s.get('t1'); g.onsuccess = () => { s.put({ ...g.result, category: 'groceries' }); }; tx.oncomplete = r; }); });
    // …and his pick in the budget (that's what Money sorts by) moves with it too
    await p.evaluate(async () => { const db = await new Promise((r) => { const q = indexedDB.open('bird-nest'); q.onsuccess = () => r(q.result); }); await new Promise((r) => { const tx = db.transaction('budget', 'readwrite'); tx.objectStore('budget').put({ id: 'sort:t1', kind: 'sort', txn: 't1', categoryId: 'groceries', updated_at: '2026-10-28T00:00:00Z' }); tx.oncomplete = r; }); });
    await card.locator('button', { hasText: 'Pull now' }).click(); await p.waitForTimeout(800);
    const moved = await p.evaluate(async () => { const db = await new Promise((r) => { const q = indexedDB.open('bird-nest'); q.onsuccess = () => r(q.result); }); return await new Promise((r) => { const q = db.transaction('budget').objectStore('budget').get('sort:t3'); q.onsuccess = () => r(q.result); }); });
    assert(moved && moved.categoryId === 'groceries', 'his pick on the pending purchase moves to the posted one');
    txns = await p.evaluate(async () => { const db = await new Promise((r) => { const q = indexedDB.open('bird-nest'); q.onsuccess = () => r(q.result); }); return await new Promise((r) => { const q = db.transaction('txns').objectStore('txns').getAll(); q.onsuccess = () => r(q.result); }); });
    assert(!txns.find((t) => t.id === 't1') && txns.find((t) => t.id === 't3')?.category === 'groceries' && txns.find((t) => t.id === 't3').pending === false, 'pending → posted keeps the category Nest gave it');

    // Real bank: a confirm step first, then the ICCU link
    await card.locator('button', { hasText: 'Connect ICCU' }).click(); await p.waitForTimeout(300);
    assert(await card.locator('text=Uses 1 of your 10 free bank links (0 used).').count() === 1, 'connecting ICCU says it uses 1 of the 10');
    await shot('bank-confirm');
    await card.locator('button', { hasText: 'Continue' }).click(); await p.waitForTimeout(1200);
    assert(helper.st.calls.some((c) => c.op === 'exchange' && c.body.env === 'production' && c.body.institution.name === 'Idaho Central Credit Union'), 'ICCU links with the production env');
    assert(await card.locator('button', { hasText: 'Connect ICCU' }).count() === 0, 'once ICCU is linked, the button goes away');

    // Remove the practice bank: its purchases leave the phone
    await card.locator('.bank-item', { hasText: 'First Platypus Bank' }).locator('button', { hasText: 'Remove' }).click(); await p.waitForTimeout(800);
    txns = await p.evaluate(async () => { const db = await new Promise((r) => { const q = indexedDB.open('bird-nest'); q.onsuccess = () => r(q.result); }); return await new Promise((r) => { const q = db.transaction('txns').objectStore('txns').getAll(); q.onsuccess = () => r(q.result); }); });
    assert(txns.every((t) => t.item_id === 'item-iccu') && await card.locator('text=First Platypus Bank').count() === 0, 'removing the practice bank takes its purchases off the phone');
    assert(await card.locator('.bank-item', { hasText: 'ICCU' }).locator('button', { hasText: 'Remove' }).count() === 0, 'a real bank has no Remove button');
    await shot('bank-iccu');
    await ctx.close();
  }
  assert(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  console.log('\nBank e2e: all passed');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
