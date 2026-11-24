/* Today as a coach (Nov 19): his usual week fills the River, Now/Next/Later follow the clock, tasks show up
   where they fit, and the week changes from the River ("Every Wednesday", "Not on Wednesdays").
   Run:  npx vite build --mode e2e --outDir <dir> && npx vite preview --outDir <dir> --port 4181 &
         URL=http://localhost:4181/ node tests/e2e/coach.e2e.cjs */
const { chromium } = require('playwright');
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('✓', m); };
const SHOTS = process.env.SHOTS;
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', timezoneId: 'America/Los_Angeles' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const shot = async (n) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/coach-${n}.png` }); };
  await p.clock.install({ time: new Date('2026-11-18T15:45:00Z') }); // Wednesday 7:45 AM Pacific
  await p.goto(process.env.URL || 'http://localhost:4181/'); await p.waitForTimeout(1500);

  // 7:45 on a Wednesday: driving to work, Work next.
  assert(await p.locator('.now h2').innerText() === 'Drive to work', 'Now: Drive to work');
  assert(/7:40–8:00/.test(await p.locator('.now-kick').innerText()), 'with its time and what is left');
  assert(await p.locator('.nx', { hasText: 'Work' }).locator('.nx-l >> text=Next').count() === 1, 'Next: Work at 8:00');
  // A call lands in the drive by itself.
  await p.click('[aria-label="Quick add"]'); await p.keyboard.type('Call Dave back'); await p.keyboard.press('Enter'); await p.waitForTimeout(600);
  assert(await p.locator('.now-fits', { hasText: 'On the drive' }).locator('text=Call Dave back').count() === 1, 'a call shows up on the drive');
  await shot('drive');
  await p.click('.now-fits [aria-label="Done: Call Dave back"]'); await p.waitForTimeout(500);
  assert(await p.locator('.now-fits >> text=Call Dave back').count() === 0, 'ticked: done and gone');

  // 9:45: at work. Nothing else crowds in.
  await p.clock.fastForward('02:00:00'); await p.waitForTimeout(800);
  assert(await p.locator('.now h2').innerText() === 'Work', 'Now: Work');
  assert(await p.locator('.now-fits').count() === 0, 'no tasks at work');

  // 7:30 PM: study, with its steps; Start opens step by step.
  await p.clock.fastForward('09:45:00'); await p.waitForTimeout(800);
  assert(await p.locator('.now h2').innerText() === 'Study', 'Now: Study');
  assert(await p.locator('.now-steps li').count() === 3, 'its three steps show');
  await p.locator('.now-steps .now-row').first().click(); await p.waitForTimeout(300);
  assert(await p.locator('.now-steps .now-row.ok').count() === 1, 'a step ticks in place');
  await shot('study');

  // Change Study to 7:45 and keep it every Wednesday.
  await p.click('.whole-t'); await p.waitForTimeout(300);
  await p.locator('.tr', { hasText: 'Study' }).locator('.bc-main').click(); await p.waitForTimeout(300);
  assert(await p.locator('.menu >> text=Every Wednesday').count() === 0, "the week's own block doesn't offer 'Every Wednesday'");
  await p.click('.menu >> text=Change time or steps'); await p.waitForTimeout(300);
  await p.fill('input[aria-label="Start"]', '19:45'); await p.click('.sheet-actions >> text=Save'); await p.waitForTimeout(400);
  await p.locator('.tr', { hasText: 'Study' }).locator('.bc-main').click(); await p.waitForTimeout(300);
  await p.click('.menu >> text=Every Wednesday'); await p.waitForTimeout(500);
  assert(await p.locator('.toast >> text=Every Wednesday').count() === 1, 'kept for every Wednesday');
  await p.click('[aria-label="Settings"]'); await p.waitForTimeout(400);
  assert(await p.locator('.kv', { hasText: 'Wed' }).locator('text=/study 7:45/').count() === 1, 'Settings → Your day shows Wednesday with study at 7:45');
  assert(await p.locator('.kv', { hasText: 'Thu' }).locator('text=/study 7:30/').count() === 1, 'Thursday is unchanged');
  await shot('settings-week');
  await p.click('text=Back to the week you first gave'); await p.waitForTimeout(500);
  assert(await p.locator('.kv', { hasText: 'Wed' }).locator('text=/study 7:30/').count() === 1, 'and back to the week he first gave');
  await p.click('[aria-label="Back to Today"]'); await p.waitForTimeout(500);

  // Not on Wednesdays: Wind down goes off the week and off today.
  await p.click('.whole-t'); await p.waitForTimeout(300);
  await p.locator('.tr', { hasText: 'Wind down' }).locator('.bc-main').click(); await p.waitForTimeout(300);
  await p.click('.menu >> text=Not on Wednesdays'); await p.waitForTimeout(500);
  assert(await p.locator('.tr', { hasText: 'Wind down' }).count() === 0, '"Not on Wednesdays" takes it off today');
  await p.click('.toast >> text=Undo'); await p.waitForTimeout(500);
  assert(await p.locator('.tr', { hasText: 'Wind down' }).count() === 1, 'Undo puts it back');

  // 9:30 PM: done for today, tomorrow's first block named.
  await p.clock.fastForward('02:00:00'); await p.waitForTimeout(800);
  assert(await p.locator('.now h2').innerText() === 'Done for today', 'after Wind down: done for today');
  assert(await p.locator('.now-p >> text=Tomorrow starts 4:30 with Morning.').count() === 1, "tomorrow's start is named");
  await shot('night');

  // Shutdown: 7 PM Thursday, Start shutdown opens the Shutdown flow.
  await p.clock.fastForward('21:35:00'); await p.waitForTimeout(1500);
  assert(await p.locator('.now h2').innerText() === 'Shutdown', 'Thursday 7 PM: Shutdown');
  await p.click('.now-acts >> text=Start shutdown'); await p.waitForTimeout(500);
  assert(await p.locator('.flow-foot').count() === 1, 'Start shutdown opens the Shutdown flow');

  // Not a usual day: tap the date, make tomorrow (Friday) a day off; the River for tomorrow changes; back to usual.
  await p.keyboard.press('Escape').catch(() => {}); await p.goto(process.env.URL || 'http://localhost:4181/'); await p.waitForTimeout(1200);
  await p.click('.t-day'); await p.waitForTimeout(300);
  assert(await p.locator('.sheet h2 >> text=Not a usual day?').count() === 1, 'tapping the date asks what kind of day');
  await p.locator('.dk').nth(1).locator('.dk-c', { hasText: 'Day off' }).click(); await p.waitForTimeout(500);
  assert(await p.locator('.dk').nth(1).locator('.dk-c.on', { hasText: 'Day off' }).count() === 1, 'tomorrow is marked a day off');
  await p.click('.sheet-x'); await p.waitForTimeout(200);
  await p.click('.whole-t'); await p.click('.whole-day'); await p.waitForTimeout(400);
  const fri = await p.locator('.tr .bc-main b').allInnerTexts();
  assert(fri.includes('Day off') && !fri.includes('Work'), "tomorrow's River is a day off: " + fri.join(', '));
  await p.click('.t-day'); await p.locator('.dk').nth(1).locator('.dk-c', { hasText: 'Usual' }).click(); await p.waitForTimeout(500); await p.click('.sheet-x');
  const fri2 = await p.locator('.tr .bc-main b').allInnerTexts();
  assert(fri2.includes('Work') && !fri2.includes('Day off'), 'and back to usual');

  assert(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log('\nCoach e2e: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
