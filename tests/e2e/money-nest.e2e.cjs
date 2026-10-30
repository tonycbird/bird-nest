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
  { id: 'prefs', kind: 'prefs', groups: [], setup_made: at, mixed: { walmart: { groceries: 3, household: 12 } }, updated_at: at },
  // Bird Budgeting's sorting history: one row has a bank twin (Corner Cafe), one doesn't (cash at a market)
  { id: 'history', kind: 'history', entries: [['2026-10-05', -1234, 'dining-out', 'Corner Cafe'], ['2026-10-07', -5000, 'groceries', 'Farmers market']], updated_at: at },
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
  t('hx', -12.34, '2026-10-05', { merchant: 'Corner Cafe' }),
  t('wm', -30, '2026-10-10', { merchant: 'Walmart', name: 'WAL-MART #1234' }),
  t('hd', -80, '2026-10-12', { merchant: 'The Home Depot' }),
  // July–September, for "compared with usual"
  ...[['07', 300, 60, 20], ['08', 320, 80, 25], ['09', 280, 100, 30]].flatMap(([mm, g, d, h]) => [
    t('g' + mm, -g, `2026-${mm}-10`, { merchant: 'WinCo Foods' }), t('d' + mm, -d, `2026-${mm}-12`, { merchant: 'Pizza Place' }), t('h' + mm, -h, `2026-${mm}-14`, { merchant: 'Ace Hardware' })]),
];
budget.push(
  { id: 'label:home depot', kind: 'label', key: 'home depot', categoryId: 'household', updated_at: at },
  ...['07', '08', '09'].flatMap((mm) => [{ id: 'sort:d' + mm, kind: 'sort', txn: 'd' + mm, categoryId: 'dining-out', updated_at: at }, { id: 'sort:h' + mm, kind: 'sort', txn: 'h' + mm, categoryId: 'household', updated_at: at }]),
);
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
    assert(await p.locator('.tabs >> text=Money').count() === 1 && await p.locator('.tabs >> text=Claude').count() === 0, 'Money has its own tab where Claude was');
    await circle.click(); await p.waitForTimeout(400);
    assert(await p.locator('.tabs .tab.on', { hasText: 'Money' }).count() === 1, 'the circle opens the Money tab');
    // The budget first: October runs on the Oct 2 and Oct 16 paychecks (Oct 30's pays November)
    assert(await p.locator('.mmonth', { hasText: 'October' }).count() === 1, 'the month shows at the top');
    assert(await p.locator('.money h1', { hasText: '$307' }).locator('text=left to budget').count() === 1, 'left to budget: $3,147 in − $2,840 planned = $307');
    const hero = p.locator('.mhero');
    assert(await hero.locator('.kv', { hasText: 'In' }).locator('text=2 paychecks').count() === 1 && await hero.locator('text=$3,147').count() === 1, 'in: 2 paychecks, $3,147');
    await hero.locator('button.mtx', { hasText: 'In' }).click(); await p.waitForTimeout(200);
    assert(await hero.locator('.mbill', { hasText: 'Oct 2' }).count() === 1 && await hero.locator('.mbill', { hasText: 'Oct 16' }).count() === 1 && await hero.locator('.mbill', { hasText: 'Oct 30' }).count() === 0, 'tap: the two paychecks; Oct 30 counts for November');
    assert(await p.locator('a', { hasText: 'Open Bird Budgeting' }).count() === 0, 'no more Bird Budgeting link');
    assert(await p.locator('button.mtosort', { hasText: '4 to sort' }).count() === 1, 'four to sort (Pizza Hut ×2, Venmo, Walmart: a store he files two ways); Starbucks sorted itself; Corner Cafe kept its Bird Budgeting envelope');
    const row = (name) => p.locator('.money .mrow', { hasText: name }).first();
    assert(await row('Groceries').locator('text=$348').count() === 1 && await row('Groceries').locator('text=of 500').count() === 1, 'Groceries: $348 of 500 left');
    assert(await p.locator('.lbl', { hasText: 'Housing & Utilities' }).count() === 1 && await row('Mortgage / Rent').locator('.mpaid').count() === 1, 'grouped; the mortgage shows ✓ paid');
    assert(await row('Internet').locator('text=Oct 30').count() === 1, 'a bill not paid yet shows its date');
    assert(await p.locator('.money .mrow', { hasText: 'Income' }).count() === 0, 'income envelopes aren\'t in the budget list');
    assert(await p.locator('text=Bank · Today').count() === 1, 'says when the bank was last pulled');
    assert(!(await p.locator('.money').innerText()).match(/overdue|late|missed|Bank copy/i), 'no naggy words, no stale bank copy note');
    await shot('nest-money');

    // Bills: this paycheck, then the month's bills by date with the paydays in between
    await p.click('.seg >> text=Bills'); await p.waitForTimeout(300);
    const pay = p.locator('.mpay');
    assert(await pay.locator('text=Oct 16 – 29').count() === 1 && await pay.locator('text=Last day').count() === 1, 'this paycheck: Oct 16 – 29, last day');
    assert(await pay.locator('.mpay-hero b', { hasText: '$1,333' }).count() === 1, 'left from this paycheck after everything spent');
    assert(await pay.locator('.mnext', { hasText: 'Short $161' }).count() === 1, 'next paycheck: short $161 (Internet on the 30th + rent on the 2nd)');
    assert(await pay.locator('text=Keep $161 of this paycheck for Mortgage / Rent on Nov 2.').count() === 1, 'says what to hold back, and for what');
    const bl = p.locator('.lbl', { hasText: 'October bills' }).locator('xpath=following-sibling::div[1]');
    const lines = await bl.locator('.kv').allInnerTexts();
    assert(lines[0].includes('Oct 2') && lines[0].includes('Payday') && lines[1].includes('Mortgage') && lines[2].includes('Oct 16'), 'by date: payday, then the bills it pays');
    assert(await bl.locator('.kv', { hasText: 'Paid 1 of 2' }).count() === 1, 'paid 1 of 2');
    await shot('nest-bills');
    await p.click('.seg >> text=Budget'); await p.waitForTimeout(300);

    // Compared with usual (July–September): Household is ahead (Home Depot $80 vs a usual $25); Groceries and Dining aren't
    await p.locator('button.mtx', { hasText: 'Compared with usual' }).click(); await p.waitForTimeout(300);
    const tr = p.locator('.msheet');
    assert(await tr.locator('.mrow', { hasText: 'Household Supplies' }).locator('.mtag', { hasText: 'ahead' }).count() === 1 && await tr.locator('.mrow', { hasText: 'Household Supplies' }).locator('text=usual $25').count() === 1, 'Household Supplies: ahead of a usual $25');
    assert(await tr.locator('.mrow', { hasText: 'Groceries' }).locator('.mtag').count() === 0 && await tr.locator('.mrow', { hasText: 'Groceries' }).locator('text=usual $300').count() === 1, 'Groceries: usual $300 (the middle of 280, 300, 320), not ahead');
    assert(await tr.locator('text=October so far').count() === 1, 'month so far vs usual by now');
    await shot('nest-trends');
    await tr.locator('.sheet-x').click(); await p.waitForTimeout(300);

    // Sort: one tap each; remembering Pizza Hut sorts the other Pizza Hut too
    await p.locator('button.mtosort').click(); await p.waitForTimeout(400);
    const sheet = p.locator('.msheet');
    assert(await sheet.locator('h2', { hasText: 'Pizza Hut' }).count() === 1 && await sheet.locator('text=To sort · 4').count() === 1, 'the sort sheet starts with the newest');
    assert(await sheet.locator('.mremember', { hasText: 'Remember Pizza Hut' }).locator('input:checked').count() === 1, '"Remember Pizza Hut" is on');
    await shot('nest-sort');
    await sheet.locator('.mchip', { hasText: 'Dining Out' }).click(); await p.waitForTimeout(500);
    assert(await sheet.locator('h2', { hasText: 'Venmo' }).count() === 1 && await sheet.locator('text=To sort · 2').count() === 1, 'the other Pizza Hut sorted itself; Venmo is next');
    assert(await sheet.locator('.mremember').count() === 0, 'Venmo is a one-off: nothing to remember');
    await sheet.locator('.mchip', { hasText: 'Not spending' }).click(); await p.waitForTimeout(600);
    assert(await sheet.locator('h2', { hasText: 'Walmart' }).count() === 1, 'Walmart is asked, even though "walmart" is a Groceries keyword');
    assert(await sheet.locator('.mremember', { hasText: 'Always this for Walmart' }).locator('input:checked').count() === 0 && await sheet.locator('text=sorted this store more than one way').count() === 1, 'a store he files two ways isn\'t remembered unless he says so');
    assert((await sheet.locator('.mchip').first().innerText()).includes('Household') && (await sheet.locator('.mchip').nth(1).innerText()).includes('Groceries'), 'his past picks for Walmart come first (Household 12×, Groceries 3×)');
    await sheet.locator('.mchip', { hasText: 'Groceries' }).first().click(); await p.waitForTimeout(600);
    assert(await p.locator('.msheet').count() === 0, 'all sorted: the sheet closes');
    assert(await p.locator('button.mtosort').count() === 0, 'nothing left to sort: the chip goes');

    // An envelope: change what it gets
    await row('Dining Out').click(); await p.waitForTimeout(400);
    const es = p.locator('.msheet');
    assert(await es.locator('h2', { hasText: 'Dining Out' }).count() === 1 && await es.locator('.kv', { hasText: 'Spent' }).locator('text=$54').count() === 1, 'Dining Out: both Pizza Hut purchases and Corner Cafe (from history), $54 spent');
    assert(await es.locator('.kv', { hasText: 'Usual month' }).locator('text=$80').count() === 1, 'and its usual month');
    await es.locator('input[aria-label="Dining Out planned"]').fill('300');
    await es.locator('input[aria-label="Dining Out planned"]').press('Enter'); await p.waitForTimeout(600);
    assert(await es.locator('.kv', { hasText: 'Left' }).locator('text=$246').count() === 1, 'changed to $300: $246 left');
    await shot('nest-envelope');
    // Re-sort one of its purchases
    await es.locator('button.mtx', { hasText: 'Pizza Hut' }).first().click(); await p.waitForTimeout(400);
    assert(await p.locator('.msheet h2', { hasText: 'Pizza Hut' }).count() === 1 && await p.locator('.msheet .date', { hasText: 'Sort' }).count() === 1, 'tapping a purchase opens it to re-sort');
    await p.locator('.msheet').last().locator('.sheet-x').click(); await p.waitForTimeout(300);
    await p.locator('.msheet').last().locator('.sheet-x').click(); await p.waitForTimeout(300);
    assert(await row('Dining Out').locator('text=$246').count() === 1, 'the Money screen shows the new amount');
    assert(await row('Groceries').locator('text=$318').count() === 1, 'groceries left now counts the Walmart run: $318');
    assert(await p.locator('.money h1', { hasText: '$257' }).count() === 1, 'left to budget: $50 more planned → $257');

    // Suggested budget: bills as they are, everyday at the usual month; Use it, with undo
    await p.locator('button', { hasText: 'Suggested budget' }).click(); await p.waitForTimeout(400);
    const sg = p.locator('.msheet');
    assert(await sg.locator('.msug', { hasText: 'Mortgage / Rent' }).locator('.mwhy', { hasText: 'bill' }).count() === 1 && await sg.locator('.msug', { hasText: 'Mortgage / Rent' }).locator('b', { hasText: '$1,670' }).count() === 1, 'the mortgage at its bill, $1,670 (was $1,700)');
    assert(await sg.locator('.msug', { hasText: 'Groceries' }).locator('b', { hasText: '$300' }).count() === 1 && await sg.locator('.msug', { hasText: 'Groceries' }).locator('.mwhy', { hasText: 'usual' }).count() === 1, 'groceries at the usual month');
    assert(await sg.locator('.msug', { hasText: 'Household Supplies' }).locator('b', { hasText: '$80' }).count() === 1 && await sg.locator('.msug', { hasText: 'Household Supplies' }).locator('.mwhy', { hasText: 'spent so far' }).count() === 1, 'never less than what\'s already gone this month (Home Depot $80, usual $25)');
    assert(await sg.locator('.kv', { hasText: 'Left to budget' }).locator('text=$942').count() === 1 && await sg.locator('text=Give the rest a job.').count() === 1, 'no Emergency Fund envelope here: what\'s left waits for a job');
    await shot('nest-suggest');
    await sg.locator('button', { hasText: 'Use it' }).click(); await p.waitForTimeout(600);
    assert(await p.locator('.money h1', { hasText: '$942' }).count() === 1, 'in use: the month runs on the suggested plan');
    await p.locator('.toast button', { hasText: 'Undo' }).click(); await p.waitForTimeout(600);
    assert(await p.locator('.money h1', { hasText: '$257' }).count() === 1, 'undo: his own plan is back');

    // Next month: planned ahead from the suggestion, no further
    await p.locator('button[aria-label="Next month"]').click(); await p.waitForTimeout(500);
    assert(await p.locator('.mmonth', { hasText: 'November' }).count() === 1 && await p.locator('text=Suggested from your bills and usual spending.').count() === 1, 'November: the suggested plan until he changes it');
    assert(await p.locator('button[aria-label="Next month"]').isDisabled(), 'no further than next month');
    await shot('nest-november');
    await p.locator('button[aria-label="Previous month"]').click(); await p.waitForTimeout(400);

    // Empty envelopes fold away (here every envelope has a plan, so there's nothing to fold)
    assert(await p.locator('button.mempty').count() === 0, 'every envelope has a job: no empty ones to show');
    // Purchases, searchable
    await p.locator('button.mtx', { hasText: 'Purchases' }).click(); await p.waitForTimeout(300);
    const ps = p.locator('.msheet');
    assert(await ps.locator('button.mtx').count() === 9, 'every purchase on the budget account this month (not the business one)');
    await ps.locator('input[aria-label="Search purchases"]').fill('pizza'); await p.waitForTimeout(200);
    assert(await ps.locator('button.mtx').count() === 2 && await ps.locator('text=2 · $42 out').count() === 1, 'search "pizza": 2 purchases, $42 out');
    await ps.locator('input[aria-label="Search purchases"]').fill('not spending'); await p.waitForTimeout(200);
    assert(await ps.locator('button.mtx', { hasText: 'Venmo' }).count() === 1, 'search by envelope works too');
    await shot('nest-purchases');
    await ps.locator('.sheet-x').click(); await p.waitForTimeout(300);

    // Settings → Bank: Joint Checking is the budget; the business account doesn't count
    if (theme === 'light') {
      await p.click('.tabs >> text=Today'); await p.waitForTimeout(300);
      await p.click('[aria-label="Settings"]'); await p.waitForTimeout(500);
      const card = p.locator('.lbl', { hasText: /^Bank$/ }).locator('xpath=following-sibling::div[1]');
      // (Bank card shows only when cloud is on; the phone-only build skips it)
      if (await card.count()) {
        assert(await card.locator('.kv', { hasText: 'Joint Checking' }).locator('.mtag').count() === 1, 'Joint Checking is marked Budget');
        const bc = card.locator('button', { hasText: 'Bird Budgeting' });
        assert(await bc.locator('text=1 of 2 matched').count() === 1, 'Bird Budgeting check: 1 of 2 matched over the dates both have');
        await bc.click(); await p.waitForTimeout(300);
        assert(await p.locator('.msheet .kv', { hasText: 'Farmers market' }).count() === 1, 'the one only in Bird Budgeting is listed by name');
        await shot('nest-birdcheck');
        await p.locator('.msheet .sheet-x').click(); await p.waitForTimeout(200);
      }
    }
    await ctx.close();
  }
  assert(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  console.log('\nMoney in Nest e2e: all passed');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
