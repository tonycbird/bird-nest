/* Money in Nest (Phase 7): the numbers come from the bank and Nest's own budget, not Bird Budgeting.
   An envelope opens to change what it gets; "To sort" sorts purchases with a tap and remembers the store.
   Run:  npx vite build --outDir <dir> && npx vite preview --outDir <dir> --port 4181 &
         URL=http://localhost:4181/ node tests/e2e/money-nest.e2e.cjs */
const { chromium } = require('playwright');
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('✓', m); };
const SHOTS = process.env.SHOTS;
const URL0 = process.env.URL || 'http://localhost:4181/';

const at = '2026-10-29T18:00:00Z';
const env = (key, name, group, order) => ({ id: 'env:' + key, kind: 'envelope', key, name, group, order, archived: false, updated_at: at });
const budget = [
  env('groceries', 'Groceries', 'food', 0), env('dining-out', 'Dining Out', 'food', 1), env('coffee', 'Coffee Shops', 'food', 2), env('fuel', 'Fuel', 'transport', 0),
  env('household', 'Household Supplies', 'personal', 2), env('internet', 'Internet', 'housing', 3), env('rent', 'Mortgage / Rent', 'housing', 0), env('income', 'Income', 'income', 9),
  { id: 'plan:2026-10', kind: 'plan', month: '2026-10', amounts: { groceries: 500, 'dining-out': 250, coffee: 50, fuel: 150, household: 125, internet: 65, rent: 1700 }, carry: {}, updated_at: at },
  { id: 'bill:net', kind: 'bill', type: 'expense', name: 'Internet', amount: 65, dueDay: 30, cadence: '', dueMonth: null, anchorDate: '', categoryId: 'internet', updated_at: at },
  { id: 'bill:rent', kind: 'bill', type: 'expense', name: 'Mortgage / Rent', amount: 1670, dueDay: 2, cadence: '', dueMonth: null, anchorDate: '', categoryId: 'rent', updated_at: at },
  { id: 'bill:pay', kind: 'bill', type: 'income', name: 'Payroll', amount: 1573.7, dueDay: 0, cadence: 'biweekly', dueMonth: null, anchorDate: '2026-04-03', categoryId: '', updated_at: at },
  { id: 'label:winco foods', kind: 'label', key: 'winco foods', categoryId: 'groceries', updated_at: at },
  { id: 'prefs', kind: 'prefs', groups: [], setup_made: at, updated_at: at },
];
const t = (id, amount, date, o = {}) => ({ id, item_id: 'i1', account_id: 'joint', date, month: date.slice(0, 7), amount, name: '', merchant: '', pending: false, hint: '', updated_at: at, ...o });
const txns = [
  t('r', -1670, '2026-10-02', { merchant: 'Landlord', hint: 'RENT_AND_UTILITIES_RENT' }),
  t('w', -152.36, '2026-10-27', { merchant: 'WinCo Foods' }),
  t('s', -6.5, '2026-10-26', { merchant: 'Starbucks', hint: 'FOOD_AND_DRINK_COFFEE' }),
  t('p1', -23.4, '2026-10-28', { merchant: 'Pizza Hut' }),
  t('p2', -18.75, '2026-10-21', { merchant: 'Pizza Hut', pending: false }),
  t('v', -40, '2026-10-25', { merchant: 'Venmo', name: 'VENMO PAYMENT TOMMY' }),
  t('biz', -400, '2026-10-20', { account_id: 'biz', merchant: 'Home Depot' }),
];
const status = { ok: true, keys_sandbox: true, keys_production: true, items: [{ item_id: 'i1', env: 'production', inst_name: 'Idaho Central Credit Union', status: 'ok', error: '', update_status: 'HISTORICAL_UPDATE_COMPLETE', last_sync: Date.parse('2026-10-29T15:30:00Z') }],
  accounts: [
    { account_id: 'joint', item_id: 'i1', name: 'Joint Checking', mask: '9123', type: 'depository', subtype: 'checking', current: 324.48, available: 300, updated: 0 },
    { account_id: 'biz', item_id: 'i1', name: 'Small Business Checking', mask: '9381', type: 'depository', subtype: 'checking', current: 0, available: 0, updated: 0 },
    { account_id: 'card', item_id: 'i1', name: 'Credit Card', mask: '5648', type: 'credit', subtype: 'credit card', current: 4949, available: null, updated: 0 },
  ], count: 7, newest: '2026-10-28', seq: 7, prod_used: 1, prod_limit: 10, last_run: 0 };

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const errs = [];
  for (const theme of ['light', 'dark']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: SHOTS ? 2 : 1, serviceWorkers: 'block', timezoneId: 'America/Los_Angeles', hasTouch: true });
    await ctx.addInitScript((th) => { try { localStorage.setItem('nest:theme-mode', th); } catch (e) {} }, theme);
    const p = await ctx.newPage();
    await p.clock.install({ time: new Date('2026-10-29T16:00:00Z') }); // Thu 9:00 AM Pacific
    p.on('pageerror', (e) => errs.push(e.message));
    const shot = async (n) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${n}-${theme}.png` }); };
    await p.goto(URL0); await p.waitForTimeout(800);
    await p.evaluate(async ({ budget, txns, status }) => {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('bird-nest'); r.onsuccess = () => res(r.result); r.onerror = rej; });
      await new Promise((res, rej) => {
        const tx = db.transaction(['budget', 'txns', 'bank'], 'readwrite');
        for (const r of budget) tx.objectStore('budget').put(r);
        for (const r of txns) tx.objectStore('txns').put(r);
        tx.objectStore('bank').put({ key: 'status', data: status, updated_at: '2026-10-29T15:30:00Z' });
        tx.oncomplete = res; tx.onerror = rej;
      });
    }, { budget, txns, status });
    await p.reload(); await p.waitForTimeout(1200);

    const circle = p.locator('.qc', { hasText: '$348 left' });
    assert(await circle.count() === 1, `${theme}: Today's circle is groceries left, worked out from the bank`);
    await circle.click(); await p.waitForTimeout(400);
    assert(await p.locator('.money h1', { hasText: '$348' }).count() === 1, 'Money opens with groceries left');
    assert(await p.locator('a', { hasText: 'Open Bird Budgeting' }).count() === 0, 'no more Bird Budgeting link');
    assert(await p.locator('.money .kv', { hasText: 'To sort' }).locator('text=3').count() === 1, 'three purchases to sort (Pizza Hut ×2, Venmo); Starbucks sorted itself by Plaid\'s category');
    assert(await p.locator('text=Bank · Today').count() === 1, 'says when the bank was last pulled');
    assert(!(await p.locator('.money').innerText()).match(/overdue|late|missed|Bank copy/i), 'no naggy words, no stale bank copy note');
    await shot('nest-money');

    // Sort: one tap each; remembering Pizza Hut sorts the other Pizza Hut too
    await p.locator('button.mtx', { hasText: 'To sort' }).click(); await p.waitForTimeout(400);
    const sheet = p.locator('.msheet');
    assert(await sheet.locator('h2', { hasText: 'Pizza Hut' }).count() === 1 && await sheet.locator('text=To sort · 3').count() === 1, 'the sort sheet starts with the newest');
    assert(await sheet.locator('.mremember', { hasText: 'Remember Pizza Hut' }).locator('input:checked').count() === 1, '"Remember Pizza Hut" is on');
    await shot('nest-sort');
    await sheet.locator('.mchip', { hasText: 'Dining Out' }).click(); await p.waitForTimeout(500);
    assert(await sheet.locator('h2', { hasText: 'Venmo' }).count() === 1 && await sheet.locator('text=To sort · 1').count() === 1, 'the other Pizza Hut sorted itself; Venmo is next');
    assert(await sheet.locator('.mremember').count() === 0, 'Venmo is a one-off: nothing to remember');
    await sheet.locator('.mchip', { hasText: 'Not spending' }).click(); await p.waitForTimeout(600);
    assert(await p.locator('.msheet').count() === 0, 'all sorted: the sheet closes');
    assert(await p.locator('.money .kv', { hasText: 'All sorted' }).count() === 1, 'To sort says all sorted');

    // An envelope: change what it gets
    await p.locator('.mrow', { hasText: 'Dining Out' }).click(); await p.waitForTimeout(400);
    const es = p.locator('.msheet');
    assert(await es.locator('h2', { hasText: 'Dining Out' }).count() === 1 && await es.locator('.kv', { hasText: 'Spent' }).locator('text=$42').count() === 1, 'Dining Out: both Pizza Hut purchases, $42 spent');
    await es.locator('input[aria-label="Dining Out this month"]').fill('300');
    await es.locator('input[aria-label="Dining Out this month"]').press('Enter'); await p.waitForTimeout(600);
    assert(await es.locator('.kv', { hasText: 'Left' }).locator('text=$258').count() === 1, 'changed to $300: $258 left');
    await shot('nest-envelope');
    // Re-sort one of its purchases
    await es.locator('button.mtx', { hasText: 'Pizza Hut' }).first().click(); await p.waitForTimeout(400);
    assert(await p.locator('.msheet h2', { hasText: 'Pizza Hut' }).count() === 1 && await p.locator('.msheet .date', { hasText: 'Sort' }).count() === 1, 'tapping a purchase opens it to re-sort');
    await p.locator('.msheet').last().locator('.sheet-x').click(); await p.waitForTimeout(300);
    await p.locator('.msheet').last().locator('.sheet-x').click(); await p.waitForTimeout(300);
    assert(await p.locator('.money .mrow', { hasText: 'Dining Out' }).locator('text=$258').count() === 1, 'the Money screen shows the new amount');

    // Settings → Bank: Joint Checking is the budget; the business account doesn't count
    if (theme === 'light') {
      await p.click('[aria-label="Back to Today"]'); await p.waitForTimeout(300);
      await p.click('[aria-label="Settings"]'); await p.waitForTimeout(500);
      const card = p.locator('.lbl', { hasText: /^Bank$/ }).locator('xpath=following-sibling::div[1]');
      // (Bank card shows only when cloud is on; the phone-only build skips it)
      if (await card.count()) {
        assert(await card.locator('.kv', { hasText: 'Joint Checking' }).locator('.mtag').count() === 1, 'Joint Checking is marked Budget');
      }
    }
    await ctx.close();
  }
  assert(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  console.log('\nMoney in Nest e2e: all passed');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
