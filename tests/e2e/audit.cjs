/* Whole-app audit. Walks every screen, sheet, menu and flow at phone sizes in light and dark,
   then pokes at random buttons. On every screen it checks for:
     errors · screens with no way out · sideways scrolling · text cut off without "…" · low contrast
     · buttons too small to tap · buttons hidden under something · emoji that slipped through.
   Run:  npm run build && npx vite preview --port 4180 &
         node tests/e2e/make-seed.mjs /tmp/seed.json
         SEED=/tmp/seed.json OUT=/tmp/audit URL=http://localhost:4180/ node tests/e2e/audit.cjs
   Options: SIZES=390x844,375x667  THEMES=light,dark  MONKEY=150 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = process.env.URL || 'http://localhost:4180/';
const OUT = process.env.OUT || '/tmp/audit';
const SEED = process.env.SEED;
const SIZES = (process.env.SIZES || '375x667,390x844,430x932').split(',').map((s) => s.split('x').map(Number));
const THEMES = (process.env.THEMES || 'light,dark').split(',');
const MONKEY = Number(process.env.MONKEY ?? 150);
fs.mkdirSync(OUT, { recursive: true });

/* ---------- the checks, run inside the page (or the Body frame) ---------- */
function checks() {
  const out = [];
  const W = innerWidth, H = innerHeight;
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05 && r.bottom > 0 && r.top < H && r.right > 0 && r.left < W; };
  const label = (el) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.className || el.tagName).toString().replace(/\s+/g, ' ').trim().slice(0, 50);
  const where = (el) => { const r = el.getBoundingClientRect(); return `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)}`; };
  // The top layer: an open overlay limits what can be touched.
  const inFrame = window.top !== window; // in the Body frame, .flow is the main screen, not an overlay
  const layers = [...document.querySelectorAll(inFrame ? '.tscrim, .scrim, .player, .lightbox' : '.tscrim, .scrim, .flow, .player, .lightbox, #rescue')].filter(vis);
  const top = layers[layers.length - 1] || null;
  const scope = top || document.body;

  // 1) Sideways scroll
  const sw = document.scrollingElement ? document.scrollingElement.scrollWidth : document.body.scrollWidth;
  if (sw > W + 1) {
    const wide = [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.right > W + 1 && r.width > 0 && getComputedStyle(e).position !== 'fixed'; }).slice(0, 4).map((e) => `${e.tagName.toLowerCase()}.${(e.className || '').toString().split(' ')[0]} → ${Math.round(e.getBoundingClientRect().right)}px`);
    out.push({ kind: 'overflow', msg: `page is ${sw}px wide on a ${W}px screen`, detail: wide.join('; ') });
  }
  // 2) Interactive things: unlabeled, too small, covered
  const inter = [...scope.querySelectorAll('button, a[href], [role=button], input:not([type=hidden]), textarea, select')].filter(vis);
  for (const el of inter) {
    if (el.closest('[hidden]')) continue;
    const r = el.getBoundingClientRect();
    const text = (el.textContent || '').trim();
    if (el.tagName === 'BUTTON' && !text && !el.getAttribute('aria-label') && !el.title) out.push({ kind: 'unlabeled', msg: `icon button with no name`, detail: `${el.className} @ ${where(el)}` });
    const inlineLink = el.tagName === 'A' && getComputedStyle(el).display === 'inline';
    // Count an invisible ::after touch ring (inset:-10px) as part of the target.
    const ring = getComputedStyle(el, '::after'); let gw = 0, gh = 0;
    if (ring.content !== 'none' && ring.position === 'absolute') { gw = -(parseFloat(ring.left) || 0) - (parseFloat(ring.right) || 0); gh = -(parseFloat(ring.top) || 0) - (parseFloat(ring.bottom) || 0); }
    if (!inlineLink && (r.width + Math.max(0, gw) < 30 || r.height + Math.max(0, gh) < 30) && el.type !== 'checkbox' && el.type !== 'file') out.push({ kind: 'small', msg: `"${label(el)}" is ${Math.round(r.width)}×${Math.round(r.height)}`, detail: el.className.toString() });
    // Covered: the middle of the button belongs to something else.
    const cx = Math.min(W - 1, Math.max(0, r.left + r.width / 2)), cy = Math.min(H - 1, Math.max(0, r.top + r.height / 2));
    if (cy < 0 || cy >= H) continue;
    // Scrolled out of its own box (a sideways chip row, a list inside a scroll area) isn't "covered".
    let clippedOut = false;
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') { const q = e.getBoundingClientRect(); if (cx < q.left || cx > q.right || cy < q.top || cy > q.bottom) { clippedOut = true; break; } }
    }
    if (clippedOut) continue;
    // Below the fold behind a fixed bar is fine while the page can still scroll down to it.
    const canScrollMore = () => { const se = document.querySelector('.scroller') || document.scrollingElement; return se.scrollTop + se.clientHeight < se.scrollHeight - 2; };
    const hit = document.elementFromPoint(cx, cy);
    if (hit && hit !== el && !el.contains(hit) && !hit.contains(el) && !(el.tagName === 'INPUT' && el.labels && [...el.labels].some((l) => l.contains(hit)))) {
      const cover = hit.closest('.tabs, .tflag, .toast, .timer-pill, .bulkbar, .scrim, .flow-foot, nav, header') || hit;
      // A bar pinned to the top or bottom over content that can still scroll out from under it is fine.
      let pinned = false;
      for (let e = cover; e && e !== document.body; e = e.parentElement) { const ps = getComputedStyle(e).position; if (ps === 'fixed' || ps === 'sticky') { pinned = true; break; } }
      const se = document.querySelector('.scroller') || document.scrollingElement;
      if (pinned && ((r.top > H * 0.5 && canScrollMore()) || (r.top < H * 0.5 && se.scrollTop > 0))) continue;
      out.push({ kind: 'covered', msg: `"${label(el)}" is under ${(cover.className || cover.tagName).toString().split(' ')[0]}`, detail: where(el) });
    }
  }
  // 3) Way out of an overlay
  if (top) {
    const outs = [...top.querySelectorAll('button, a')].filter(vis).filter((b) => /^(close|back|cancel|done|skip|not now|stuck\? back to today)$/i.test((b.getAttribute('aria-label') || b.textContent || '').trim()) || /close|back|cancel/i.test(b.getAttribute('aria-label') || ''));
    const sheet = top.querySelector('.sheet');
    const scrimTap = top.classList.contains('scrim') && sheet && sheet.getBoundingClientRect().top > 60;
    const swipe = top.classList.contains('scrim') && sheet && !sheet.classList.contains('qa-sheet');
    if (!outs.length && !scrimTap && !swipe && !top.classList.contains('lightbox')) out.push({ kind: 'trap', msg: `open "${(top.getAttribute('aria-label') || top.className).toString().slice(0, 40)}" has no Close/Back and no tap-outside`, detail: '' });
    if (top.classList.contains('scrim') && sheet && !outs.length && !scrimTap) out.push({ kind: 'trap-ish', msg: 'sheet fills the screen; only a swipe on its top edge closes it', detail: (sheet.querySelector('h2')?.textContent || '').slice(0, 40) });
  }
  // 4) Text cut off without an ellipsis
  for (const el of [...scope.querySelectorAll('b, span, small, button, div, p, h1, h2, label')].filter(vis)) {
    if (!el.firstChild || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const cs = getComputedStyle(el);
    if ((cs.overflow === 'hidden' || cs.overflowX === 'hidden') && cs.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 2 && cs.webkitLineClamp === 'none') out.push({ kind: 'clipped', msg: `"${label(el)}" is cut off`, detail: `${el.className} ${el.scrollWidth}>${el.clientWidth}` });
    // A one-word button label that wrapped onto two lines
    if (el.tagName === 'BUTTON' && cs.whiteSpace !== 'nowrap') { const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3; const rects = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).flatMap((n) => { const rg = document.createRange(); rg.selectNodeContents(n); return [...rg.getClientRects()]; }); const lines = new Set(rects.map((x) => Math.round(x.top))).size; if (lines > 1 && el.textContent.trim().split(/\s+/).length <= 3) out.push({ kind: 'wrapped', msg: `button "${label(el)}" wraps onto ${lines} lines`, detail: el.className.toString() }); }
  }
  // 5) Contrast
  const lum = (c) => { const m = c.match(/[\d.]+/g); if (!m) return null; let [r, g, b, a = 1] = m.map(Number); if (/^color\(srgb/.test(c)) { r *= 255; g *= 255; b *= 255; } if (a < 0.5) return null; const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.backgroundImage !== 'none') return null; const m = cs.backgroundColor.match(/[\d.]+/g); if (m && (m[3] === undefined || +m[3] > 0.6)) return cs.backgroundColor; } return getComputedStyle(document.documentElement).backgroundColor; };
  let low = 0; const lows = [];
  for (const el of [...scope.querySelectorAll('*')].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)).filter(vis)) {
    const cs = getComputedStyle(el); if (+cs.opacity < 0.95 || el.closest('.done, .off, .skipped, [disabled], .gone')) continue;
    const bg = bgOf(el); if (!bg) continue;
    const a = lum(cs.color), b = lum(bg); if (a == null || b == null) continue;
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    if (ratio < 3) { low++; if (lows.length < 6) lows.push(`"${label(el).slice(0, 30)}" ${ratio.toFixed(2)}:1 (${cs.color} on ${bg})`); }
  }
  if (low) out.push({ kind: 'contrast', msg: `${low} text item(s) under 3:1`, detail: lows.join(' · ') });
  // 6) Emoji that slipped through
  const tw = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  const em = []; let n;
  while ((n = tw.nextNode())) { if (/\p{Extended_Pictographic}/u.test(n.textContent) && n.parentElement && vis(n.parentElement) && !/^[✓✕→←↑↓×·•…⋯]+$/.test(n.textContent.trim())) em.push(n.textContent.trim().slice(0, 30)); }
  if (em.length) out.push({ kind: 'emoji', msg: `${em.length} raw emoji on screen`, detail: [...new Set(em)].slice(0, 5).join(' | ') });
  // 7) Words (Phase 5): no paragraphs, no nagging. Only Nest's own words: what you typed doesn't count.
  const isBlock = (e) => /^(block|flex|grid|table|list-item)$/.test(getComputedStyle(e).display);
  const mine = (e) => e.closest('input, textarea, [contenteditable], .notes, .t-notes, .note-body, .d-in, .report-text, .trow, .lightbox, .qa-mirror');
  const paras = [], nags = [];
  for (const el of [...scope.querySelectorAll('p, div, span, small, li, label, h2, h3')].filter(vis)) {
    if (!isBlock(el) || mine(el) || [...el.children].some(isBlock) || getComputedStyle(el).webkitLineClamp !== 'none') continue;
    const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const words = text.split(' ').length, sentences = (text.match(/[.!?](\s|$)/g) || []).length;
    if (words > 16 || sentences > 2) paras.push(`${words}w: "${text.slice(0, 90)}"`);
    if (/\b(missed|overdue|failed|you forgot|forgot to|fell behind|behind on|should have|you didn'?t|lazy|don'?t forget|you need to|must)\b/i.test(text)) nags.push(`"${text.slice(0, 90)}"`);
  }
  if (paras.length) out.push({ kind: 'paragraph', msg: `${paras.length} block(s) of text too long`, detail: [...new Set(paras)].join(' | ') });
  if (nags.length) out.push({ kind: 'voice', msg: `${nags.length} naggy line(s)`, detail: [...new Set(nags)].join(' | ') });
  return out;
}

/* ---------- seed data ---------- */
async function seed(p) {
  // Start from an empty River (the sample day below fills it); the workout landing by itself is tested in phase3.
  await p.evaluate(async () => { const db = await new Promise((res) => { const r = indexedDB.open('bird-nest'); r.onsuccess = () => res(r.result); }); await new Promise((res) => { const tx = db.transaction('settings', 'readwrite'); tx.objectStore('settings').put({ key: 'day', value: { workout: false, calendars: null }, updated_at: new Date().toISOString() }); tx.oncomplete = res; }); });
  await p.reload(); await p.waitForTimeout(700);
  await p.click('.tabs >> text=Head'); await p.waitForTimeout(300);
  if (SEED) { await p.setInputFiles('input[type=file]', SEED); await p.waitForTimeout(900); }
  await p.click('.tabs >> text=Today'); await p.waitForTimeout(300);
  await p.click('text=Sample day'); await p.waitForTimeout(600);
  await p.click('[aria-label="Mark Warm up + stretch done"]').catch(() => {}); await p.waitForTimeout(300);
  await p.evaluate(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('bird-nest'); r.onsuccess = () => res(r.result); r.onerror = rej; });
    const put = (store, row) => new Promise((res, rej) => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(row); tx.oncomplete = res; tx.onerror = rej; });
    const now = new Date().toISOString();
    await put('calendar', { id: 'c1', day: '2026-10-21', start: '12:00', end: '13:00', title: 'Dentist', all_day: false });
    await put('calendar', { id: 'c2', day: '2026-10-21', start: '15:30', end: '16:00', title: 'Department Lead Meeting with a very long name that goes on', all_day: false });
    await put('calendar', { id: 'c3', day: '2026-10-21', start: null, end: null, title: 'Payday', all_day: true });
    // Like the real calendar: several all-day items, two events at the same hour, a long one overlapping another.
    await put('calendar', { id: 'c4', day: '2026-10-21', start: null, end: null, title: 'JO & Raydeane Sabbatical', all_day: true });
    await put('calendar', { id: 'c5', day: '2026-10-21', start: null, end: null, title: 'Rischa Off', all_day: true });
    await put('calendar', { id: 'c6', day: '2026-10-21', start: '07:00', end: '08:00', title: 'Morning Prayer', all_day: false });
    await put('calendar', { id: 'c7', day: '2026-10-21', start: '07:00', end: '08:00', title: 'Missional Mastermind', all_day: false });
    await put('calendar', { id: 'c8', day: '2026-10-21', start: '16:00', end: '20:00', title: 'Market at The Heart', all_day: false });
    await put('calendar', { id: 'c9', day: '2026-10-21', start: '19:00', end: '20:30', title: 'Heart Young Adults', all_day: false });
    const P = (id, kind, payload, reason) => put('proposals', { id, kind, payload, reason, status: 'pending', needs_google: kind === 'calendar_book', created_at: now, updated_at: now, day_key: '2026-10-21' });
    await P('pp1', 'day_plan', { sentence: 'Legs, then the Smith quote.', blocks: [{ start: '05:30', end: '06:30', kind: 'body', icon: '🏋', title: 'Legs', steps: [{ label: 'Squat', value: '4×5' }] }, { start: '15:00', end: '15:45', kind: 'head', icon: 'doc', title: 'Smith quote', steps: [] }] }, 'Gym day and the quote is due.');
    await P('pp2', 'grocery', { items: [{ name: 'Eggs', amt: '5 dozen' }, { name: 'Rice' }] }, 'You are low on eggs and rice.');
    await P('pp3', 'task', { title: 'Reply to Dave about the quote', when: '2026-10-21', link: 'https://mail.google.com/x' }, 'Dave asked yesterday.');
    await P('pp4', 'calendar_book', { title: 'Gym', day: '2026-10-22', start: '05:00', end: '06:30' }, 'Book the gym.');
    // Phase 6: a money summary like the real one (made-up numbers)
    await put('money', { key: 'summary', updated_at: now, data: { v: 1, as_of: now, month: '2026-10', today: '2026-10-21',
      left: { total: 1056.4, budget: 4389.84, spent: 3333.44 },
      categories: [{ id: 'groceries', name: 'Groceries', budget: 500, spent: 152.36, left: 347.64 }, { id: 'dining-out', name: 'Dining Out', budget: 250, spent: 146.85, left: 103.15 },
        { id: 'fuel', name: 'Fuel', budget: 150, spent: 50.03, left: 99.97 }, { id: 'household', name: 'Household Supplies and Other Very Long Envelope Names', budget: 125, spent: 162.42, left: -37.42 }],
      groceries: { id: 'groceries', name: 'Groceries', budget: 500, spent: 152.36, left: 347.64 },
      payday: { date: '2026-10-30', amount: 1976.52 },
      before_payday: { total: 441.02, bills: [{ id: 'e', name: 'Electric', date: '2026-10-05', amount: 221.39, late: true, unseen: false },
        { id: 'p', name: 'T-Mobile for Business', date: '2026-10-20', amount: 94.63, late: false, unseen: true }, { id: 'n', name: 'Internet', date: '2026-10-21', amount: 65, late: false, unseen: false },
        { id: 'w', name: 'Water & Sewer', date: '2026-10-28', amount: 60, late: false, unseen: false }] },
      bank_through: '2026-10-09', overdue: 1, unseen: 1, due_today: [{ id: 'n', name: 'Internet', amount: 65 }], paid_this_month: { count: 7, total: 2156.05 }, to_sort: 3 } });
    await put('mail', { id: 'm1', received: now, sender: 'Dave Smith', subject: 'Quote for the bathroom', ask: 'Send the quote', due: null, link: 'https://mail.google.com/y', created_at: now, dismissed_at: null });
    db.close();
  });
  await p.reload(); await p.waitForTimeout(1200);
  // A block that runs past midnight.
  await p.click('.tl-foot >> text=Block'); await p.waitForTimeout(200);
  await p.fill('.sheet input[placeholder="Block name"]', 'Night shift');
  await p.fill('.sheet input[aria-label="Start"]', '22:30'); await p.fill('.sheet input[aria-label="End"]', '00:30');
  await p.click('.sheet >> text=Save'); await p.waitForTimeout(300);
  // A long dictated line saved as one task (what really happened on the phone).
  await p.click('[aria-label="Quick add"]'); await p.waitForTimeout(200);
  await p.fill('textarea.qa-input', LONG);
  await p.keyboard.press('Enter'); await p.waitForTimeout(400);
}
const LONG = 'I\u2019m going to need to pick up the leaves from Sam\u2019s house this upcoming Tuesday. I\u2019m going to need a tarp and ratchet straps and then take it to the dump after give around one hour of loading and dump trip.';

/* ---------- the walk: every screen, from a fresh load each time ---------- */
const go = async (p, tab) => { await p.goto(URL); await p.waitForTimeout(650); if (tab) { await p.click(`.tabs >> text=${tab}`); await p.waitForTimeout(400); } };
const headView = async (p, v) => { await go(p, 'Head'); await p.click(`.hn >> text=${v}`); await p.waitForTimeout(300); };
const STEPS = [
  ['today', async (p) => { await go(p); }],
  ['today-bottom', async (p) => { await go(p); await p.evaluate(() => { const se = document.querySelector('.scroller'); if (se) se.scrollTop = se.scrollHeight; else scrollTo(0, document.body.scrollHeight); }); await p.waitForTimeout(200); }],
  ['today-all-steps', async (p) => { await go(p); await p.click('.tr.open [aria-label^="Show all"]'); }],
  ['today-block-menu', async (p) => { await go(p); await p.click('.tr.open [aria-label^="More for"]'); }],
  ['today-other-block', async (p) => { await go(p); await p.locator('.tr:not(.open):not(.cal) .bc-main').nth(1).click(); }],
  ['today-tomorrow', async (p) => { await go(p); await p.locator('.wd').nth(3).click(); }],
  ['today-empty-day', async (p) => { await go(p); await p.locator('.wd').nth(6).click(); }],
  ['block-sheet-new', async (p) => { await go(p); await p.click('.tl-foot >> text=Block'); }],
  ['block-sheet-gap', async (p) => { await go(p); await p.click('.tl-gap button'); }],
  ['step-player', async (p) => { await go(p); await p.click('.tr.open .go'); }],
  ['step-player-done', async (p) => { await go(p); await p.click('.tr.open .go'); for (let i = 0; i < 6; i++) { const b = p.locator('.pbig'); if (await b.count()) { await b.click(); await p.waitForTimeout(150); } } }],
  ['quick-add', async (p) => { await go(p); await p.click('[aria-label="Quick add"]'); await p.keyboard.type('Call Smith tomorrow 3pm @Phone ~15m'); }],
  ['quick-add-grocery', async (p) => { await go(p); await p.click('[aria-label="Quick add"]'); await p.click('.seg >> nth=-1'); }],
  ['quick-add-many', async (p) => { await go(p); await p.click('[aria-label="Quick add"]'); await p.fill('textarea.qa-input', LONG); await p.waitForTimeout(200); }],
  ['dump-real', async (p) => { await go(p); await p.click('[aria-label="Quick add"]'); await p.fill('textarea.qa-input', LONG); await p.click('.qa-many'); await p.waitForTimeout(300); await p.click('.flow-foot >> text=Sort'); await p.waitForTimeout(200); }],
  ['today-night', async (p) => { await go(p); await p.locator('.tr', { hasText: 'Night shift' }).first().scrollIntoViewIfNeeded(); await p.waitForTimeout(150); }],
  ['dump-write', async (p) => { await go(p); await p.click('[aria-label="Quick add"]'); await p.click('.seg >> text=Dump'); await p.fill('textarea.dump', 'call dave tomorrow, pay avista today, out of milk eggs and diapers, maybe someday build a garden box, I am tired'); }],
  ['dump-sorted', async (p) => { await go(p); await p.click('[aria-label="Quick add"]'); await p.click('.seg >> text=Dump'); await p.fill('textarea.dump', 'call dave tomorrow, pay avista today, out of milk eggs and diapers, maybe someday build a garden box, I am tired'); await p.click('.flow-foot >> text=Sort'); }],
  ['dump-sorted-bottom', async (p) => { await go(p); await p.click('[aria-label="Quick add"]'); await p.click('.seg >> text=Dump'); await p.fill('textarea.dump', 'call dave tomorrow, pay avista today, out of milk eggs and diapers, maybe someday build a garden box, I am tired'); await p.click('.flow-foot >> text=Sort'); await p.locator('.flow-body').evaluate((e) => { e.scrollTop = 99999; }); await p.waitForTimeout(150); }],
  ['money', async (p) => { await go(p, 'Money'); }],
  ['money-bottom', async (p) => { await go(p, 'Money'); await p.evaluate(() => { const se = document.querySelector('.scroller'); if (se) se.scrollTop = se.scrollHeight; else scrollTo(0, document.body.scrollHeight); }); }],
  ['settings', async (p) => { await go(p); await p.click('[aria-label="Settings"]'); }],
  ['settings-bottom', async (p) => { await go(p); await p.click('[aria-label="Settings"]'); await p.evaluate(() => { const se = document.querySelector('.scroller'); if (se) se.scrollTop = se.scrollHeight; else scrollTo(0, document.body.scrollHeight); }); }],
  ['settings-trash', async (p) => { await go(p); await p.click('[aria-label="Settings"]'); await p.click('button >> text=Show'); await p.evaluate(() => { const se = document.querySelector('.scroller'); if (se) se.scrollTop = se.scrollHeight; else scrollTo(0, document.body.scrollHeight); }); }],
  ['testing-flag', async (p) => { await go(p); await p.click('[aria-label="Settings"]'); await p.locator('.kv', { hasText: 'Testing mode' }).locator('input').click(); await p.waitForTimeout(500); await p.click('.tabs >> text=Today'); }],
  ['testing-report', async (p) => { await go(p); await p.click('.tflag'); }],
  ...['Inbox', 'Today', 'Ahead', 'Anytime', 'Projects', 'Waiting', 'Someday', 'Groceries', 'Done', 'Find'].map((v) => ['head-' + v.toLowerCase(), async (p) => { await headView(p, v); }]),
  ['head-today-more', async (p) => { await headView(p, 'Today'); await p.click('[aria-label=More]'); }],
  ['head-select', async (p) => { await headView(p, 'Inbox'); await p.click('[aria-label="Select tasks"]'); await p.locator('.task').first().click(); }],
  ['head-settings', async (p) => { await go(p, 'Head'); await p.click('[aria-label="Head settings"]'); }],
  ['head-settings-bottom', async (p) => { await go(p, 'Head'); await p.click('[aria-label="Head settings"]'); await p.evaluate(() => { const se = document.querySelector('.scroller'); if (se) se.scrollTop = se.scrollHeight; else scrollTo(0, document.body.scrollHeight); }); }],
  ['project', async (p) => { await headView(p, 'Projects'); await p.locator('.pcard').first().click(); }],
  ['project-bottom', async (p) => { await headView(p, 'Projects'); await p.locator('.pcard').first().click(); await p.evaluate(() => { const se = document.querySelector('.scroller'); if (se) se.scrollTop = se.scrollHeight; else scrollTo(0, document.body.scrollHeight); }); }],
  ['project-menu', async (p) => { await headView(p, 'Projects'); await p.locator('.pcard').first().click(); await p.click('[aria-label="Project options"]'); }],
  ['area', async (p) => { await headView(p, 'Projects'); await p.locator('.proj-row').first().click(); }],
  ['task-detail', async (p) => { await headView(p, 'Today'); await p.locator('.task').first().click(); }],
  ['task-detail-bottom', async (p) => { await headView(p, 'Today'); await p.locator('.task').first().click(); await p.locator('.sheet.tall').evaluate((e) => { e.scrollTop = 99999; }); }],
  ['task-more', async (p) => { await headView(p, 'Today'); await p.locator('.task').first().click(); await p.click('[aria-label="More actions"]'); }],
  ...['When', 'Deadline', 'Repeat', 'List', 'Contexts', 'Estimate', 'Energy', 'Priority', 'Waiting'].map((f) => ['picker-' + f.toLowerCase(), async (p) => { await headView(p, 'Today'); await p.locator('.task').first().click(); await p.locator('.pr-main', { hasText: f }).first().click(); }]),
  ...['Dump', 'Process', 'Plan', 'Now', 'Ramble', 'Review', 'Shutdown'].map((r) => ['flow-' + r.toLowerCase(), async (p) => { await headView(p, 'Today'); await p.click(`.rituals >> text=${r}`); }]),
  ...['Plan', 'Review', 'Shutdown', 'Process'].map((r) => ['flow-' + r.toLowerCase() + '-steps', async (p) => { await headView(p, 'Today'); await p.click(`.rituals >> text=${r}`); for (let i = 0; i < 8; i++) { const b = p.locator('.flow-foot .btn').last(); if (!(await b.count()) || !(await b.isEnabled())) break; await b.click(); await p.waitForTimeout(250); if (!(await p.locator('.flow').count())) break; } }]),
  ['focus', async (p) => { await headView(p, 'Today'); await p.locator('.task').first().click(); await p.click('[aria-label="Focus"]'); }],
  ['body-workout', async (p) => { await go(p, 'Body'); await p.waitForTimeout(2500); }],
  ['body-workout-bottom', async (p) => { await go(p, 'Body'); await p.waitForTimeout(2500); await p.frameLocator('iframe.bodyframe').locator('body').evaluate(() => scrollTo(0, document.body.scrollHeight)); await p.waitForTimeout(300); }],
  ...['Stretch', 'Meals', 'Setup'].map((s) => ['body-' + s.toLowerCase(), async (p) => { await go(p, 'Body'); await p.waitForTimeout(2500); await p.click(`.body-head .hn >> text=${s}`); await p.waitForTimeout(500); }]),
  ['body-logger', async (p) => { await go(p, 'Body'); await p.waitForTimeout(2500); const fr = p.frames().find((x) => x.url().includes('/body')); await fr.evaluate(() => { const d = '2026-10-21'; const pl = window.__fit.plan(d); const m = pl.blocks.find((b) => b.key === 'main'); if (m && m.wid) window.__fit.openWorkout(d, m.wid); else window.__fit.openToday(d); }); await p.waitForTimeout(600); }],
  ['body-logger-bottom', async (p) => { await go(p, 'Body'); await p.waitForTimeout(2500); const fr = p.frames().find((x) => x.url().includes('/body')); await fr.evaluate(() => { const d = '2026-10-21'; const pl = window.__fit.plan(d); const m = pl.blocks.find((b) => b.key === 'main'); if (m && m.wid) window.__fit.openWorkout(d, m.wid); }); await p.waitForTimeout(600); await fr.evaluate(() => scrollTo(0, document.body.scrollHeight)); await p.waitForTimeout(300); }],
  ['body-stretch-session', async (p) => { await go(p, 'Body'); await p.waitForTimeout(2500); const fr = p.frames().find((x) => x.url().includes('/body')); await fr.evaluate(() => window.__fit.openStretch('2026-10-21', 's2')); await p.waitForTimeout(600); }],
];

/* ---------- random taps ---------- */
async function monkey(p, n, log) {
  const avoid = /reset app files|sign out|delete|trash|import|restore|back up|backup|choose file|check for update|reload|get me out|back to today|copy/i;
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < n; i++) {
    const els = await p.$$('button:visible, [role=button]:visible, a[href="#"]:visible, .chip:visible');
    if (!els.length) { await go(p); continue; }
    const el = els[Math.floor(rnd() * els.length)];
    const name = ((await el.getAttribute('aria-label')) || (await el.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (avoid.test(name)) continue;
    await el.click({ timeout: 1500 }).catch(() => {});
    await p.waitForTimeout(120);
    log.push(name);
    if (i % 25 === 24) { await go(p); }
  }
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const report = [];
  for (const [w, h] of SIZES) for (const theme of THEMES) {
    const tag = `${w}-${theme}`;
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, serviceWorkers: 'block', timezoneId: 'America/Los_Angeles', hasTouch: true, acceptDownloads: true });
    await ctx.addInitScript((t) => { try { localStorage.setItem('nest:theme-mode', t); } catch (e) {} }, theme);
    const p = await ctx.newPage();
    await p.clock.install({ time: new Date('2026-10-21T12:42:00Z') });
    let errs = [];
    p.on('pageerror', (e) => errs.push('PAGE ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errs.push('CONSOLE ' + m.text().slice(0, 200)); });
    p.on('dialog', (d) => d.dismiss().catch(() => {}));
    await p.goto(URL); await p.waitForTimeout(800);
    await seed(p);
    let i = 0;
    for (const [name, run] of STEPS) {
      i++;
      errs = [];
      let failed = null;
      try { await run(p); await p.waitForTimeout(350); } catch (e) { failed = e.message.split('\n')[0].slice(0, 160); }
      let found = [];
      try { found = await p.evaluate(checks); } catch (e) { found = [{ kind: 'check-failed', msg: e.message.slice(0, 120) }]; }
      const fr = name.startsWith('body') ? p.frames().find((x) => x.url().includes('/body')) : null;
      if (fr) { try { found.push(...(await fr.evaluate(checks)).map((f) => ({ ...f, msg: '[Body] ' + f.msg }))); } catch (e) { /* frame not ready */ } }
      const file = `${tag}-${String(i).padStart(2, '0')}-${name}.png`;
      await p.screenshot({ path: path.join(OUT, file) }).catch(() => {});
      const row = { size: `${w}x${h}`, theme, step: name, file, failed, errors: errs, found };
      report.push(row); fs.appendFileSync(path.join(OUT, 'report.jsonl'), JSON.stringify(row) + '\n');
    }
    // Random taps, watching for errors and traps.
    errs = [];
    const log = [];
    await go(p);
    await monkey(p, MONKEY, log);
    const trapped = await p.evaluate(checks).then((f) => f.filter((x) => x.kind === 'trap')).catch(() => []);
    await p.screenshot({ path: path.join(OUT, `${tag}-zz-monkey-end.png`) }).catch(() => {});
    const mrow = { size: `${w}x${h}`, theme, step: 'monkey', file: `${tag}-zz-monkey-end.png`, failed: null, errors: errs, found: trapped, taps: log.slice(-30) };
    report.push(mrow); fs.appendFileSync(path.join(OUT, 'report.jsonl'), JSON.stringify(mrow) + '\n');
    await ctx.close();
  }
  await b.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  // Summary
  const by = {};
  for (const r of report) {
    for (const f of r.found) { const k = f.kind + ' · ' + f.msg.replace(/\d+(?=×)/g, 'N'); (by[k] ??= new Set()).add(r.step + '@' + r.size + '/' + r.theme); }
    if (r.failed) (by['step-failed · ' + r.step + ': ' + r.failed] ??= new Set()).add(r.size + '/' + r.theme);
    for (const e of r.errors) (by['error · ' + e] ??= new Set()).add(r.step + '@' + r.size + '/' + r.theme);
  }
  const lines = Object.entries(by).sort().map(([k, v]) => `${k}\n    ${[...v].slice(0, 6).join(', ')}${v.size > 6 ? ` +${v.size - 6} more` : ''}`);
  fs.writeFileSync(path.join(OUT, 'summary.txt'), lines.join('\n'));
  console.log(`${report.length} screens checked, ${Object.keys(by).length} kinds of finding → ${OUT}/summary.txt`);
})().catch((e) => { console.error(e); process.exit(1); });
