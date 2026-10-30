/* Money (Phase 6): the summary Claude leaves shows as a circle on Today, a Money screen, and a bill block.
   Run:  npx vite build --outDir <dir> && npx vite preview --outDir <dir> --port 4181 &
         URL=http://localhost:4181/ node tests/e2e/money.e2e.cjs */
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('✓', m); };
const SHOTS = process.env.SHOTS;
const URL0 = process.env.URL || 'http://localhost:4181/';

(async () => {
  const { summarize } = await import(pathToFileURL(path.join(__dirname, '../../claude/tools/money.mjs')).href);
  const data = {
    recurring: [
      { id: 'rent', type: 'expense', name: 'Rent', amount: 1500, dueDay: 2, categoryId: 'rent' },
      { id: 'net', type: 'expense', name: 'Internet', amount: 60, dueDay: 21, categoryId: 'internet' },
      { id: 'phone', type: 'expense', name: 'Phone (T-Mobile for Business)', amount: 94.63, dueDay: 12, categoryId: 'phone' },
      { id: 'elec', type: 'expense', name: 'Electric', amount: 221.39, dueDay: 5, categoryId: 'electric' },
      { id: 'pay', type: 'income', name: 'Payroll', amount: 1976.52, cadence: 'biweekly', anchorDate: '2026-04-03' },
    ],
    categories: [
      { id: 'groceries', name: 'Groceries', group: 'food' }, { id: 'dining-out', name: 'Dining Out', group: 'food' },
      { id: 'fuel', name: 'Fuel', group: 'transport' }, { id: 'household', name: 'Household Supplies', group: 'personal' },
      { id: 'rent', name: 'Rent', group: 'housing' }, { id: 'internet', name: 'Internet', group: 'housing' },
      { id: 'phone', name: 'Phone', group: 'housing' }, { id: 'electric', name: 'Electric', group: 'housing' },
    ],
    groups: [],
    budget: { month: '2026-10', allocations: { groceries: 500, 'dining-out': 250, fuel: 150, household: 125, rent: 1500, internet: 60, phone: 95, electric: 225 }, carryover: {} },
    transactions: [
      { id: 'a', month: '2026-10', date: '2026-10-02', amount: -1500, categoryId: 'rent' },
      { id: 'b', month: '2026-10', date: '2026-10-04', amount: -152.36, categoryId: 'groceries' },
      { id: 'c', month: '2026-10', date: '2026-10-06', amount: -146.85, categoryId: 'dining-out' },
      { id: 'd', month: '2026-10', date: '2026-10-08', amount: -50.03, categoryId: 'fuel' },
      { id: 'e', month: '2026-10', date: '2026-10-09', amount: -12.5 },
    ],
    billMarks: [],
  };
  const summary = summarize(data, '2026-10-21');

  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const errs = [];
  for (const theme of ['light', 'dark']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: SHOTS ? 2 : 1, serviceWorkers: 'block', timezoneId: 'America/Los_Angeles', hasTouch: true });
    await ctx.addInitScript((t) => { try { localStorage.setItem('nest:theme-mode', t); } catch (e) {} }, theme);
    const p = await ctx.newPage();
    await p.clock.install({ time: new Date('2026-10-21T16:00:00Z') }); // Wed 9:00 AM Pacific
    p.on('pageerror', (e) => errs.push(e.message));
    const shot = async (n) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${n}-${theme}.png` }); };
    await p.goto(URL0); await p.waitForTimeout(800);

    if (theme === 'light') {
      // No summary yet: Money says what's coming, nothing breaks
      await p.evaluate(() => { location.hash = ''; });
      await p.evaluate(() => window.dispatchEvent(new Event('nest-test')));
      assert(await p.locator('.qc >> text=left').count() === 0, 'no money circle before the first summary');
    }

    // Claude's morning summary arrives (written straight into the phone's copy, as the sync would)
    await p.evaluate(async (s) => {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('bird-nest'); r.onsuccess = () => res(r.result); r.onerror = rej; });
      await new Promise((res, rej) => { const tx = db.transaction('money', 'readwrite'); tx.objectStore('money').put({ key: 'summary', data: s, updated_at: '2026-10-21T12:02:00Z' }); tx.oncomplete = res; tx.onerror = rej; });
    }, summary);
    await p.reload(); await p.waitForTimeout(900);
    const circle = p.locator('.qc', { hasText: '$348 left' });
    assert(await circle.count() === 1, `${theme}: Today shows groceries left as a circle`);
    const bill = p.locator('.tr', { hasText: 'Pay Internet' });
    assert(await bill.count() === 1, `${theme}: Internet (due today) is a money block on the River`);
    await shot('money-today');

    await circle.click(); await p.waitForTimeout(400);
    assert(await p.locator('.money h1', { hasText: '$348' }).count() === 1, 'Money opens with groceries left');
    assert(await p.locator('.mrow', { hasText: 'Dining Out' }).locator('b', { hasText: '$103' }).count() === 1, 'other envelopes listed with what is left');
    assert(await p.locator('.kv', { hasText: 'Fri, Oct 30' }).count() + await p.locator('.kv', { hasText: 'Oct 30' }).count() >= 1, 'next payday shown');
    assert(await p.locator('.mbill', { hasText: 'Electric' }).locator('.mflag').count() === 1, 'a bill the bank copy should show, unpaid, gets a !');
    assert(await p.locator('.mbill.unseen', { hasText: 'Phone' }).count() === 1, 'a bill after the bank copy ends is quiet, not flagged');
    assert(await p.locator('text=Bank copy through Oct 9.').count() === 1, 'says how far the bank copy goes');
    assert(await p.locator('.kv', { hasText: 'To sort' }).locator('text=1').count() === 1, 'one transaction to sort');
    assert(await p.locator('a[href*="claude.ai/code/artifact"]', { hasText: 'Open Bird Budgeting' }).count() === 1, 'a way to Bird Budgeting');
    assert(!(await p.locator('.money').innerText()).match(/overdue|late|missed/i), 'no naggy words');
    await shot('money-screen');
    assert(await p.locator('.tabs .tab.on', { hasText: 'Money' }).count() === 1, 'Money is a tab');
    await p.click('.tabs >> text=Today'); await p.waitForTimeout(300);
    assert(await p.locator('.t-head').count() === 1, 'the Today tab goes back');

    // Delete the bill block: it stays gone after a reload
    if (theme === 'light') {
      await p.evaluate(async () => {
        const db = await new Promise((res) => { const r = indexedDB.open('bird-nest'); r.onsuccess = () => res(r.result); });
        const all = await new Promise((res) => { const q = db.transaction('blocks').objectStore('blocks').getAll(); q.onsuccess = () => res(q.result); });
        const blk = all.find((x) => x.source_type === 'bill');
        blk.deleted_at = new Date().toISOString();
        await new Promise((res) => { const tx = db.transaction('blocks', 'readwrite'); tx.objectStore('blocks').put(blk); tx.oncomplete = res; });
      });
      await p.reload(); await p.waitForTimeout(900);
      assert(await p.locator('.tr', { hasText: 'Pay Internet' }).count() === 0, 'a deleted bill block stays deleted');
    }
    await ctx.close();
  }
  assert(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  console.log('\nMoney e2e: all passed');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
