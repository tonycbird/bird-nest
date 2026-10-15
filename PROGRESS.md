# Progress

## Now: Phase 3 — Body (Bird Fitness port) · code done, waiting on Anthony's phone check

Built Oct 15, 2026.

### Phone check (Anthony)
1. Commit "Phase 3 Body" in GitHub Desktop and push. Cloudflare deploys in ~1 min.
2. Open Nest on the iPhone → tap "New version ↻" if it shows.
3. Old Bird Fitness → Settings → Export backup. Nest → ⚙ → 🏋 Body → ⬆ Import Bird Fitness backup.
4. Body tab: check your program, last weights and PRs look right.
5. Today: 🏋 tray → 🌊 Add. At the gym, log a set with Wi-Fi off. Lock the phone during rest, unlock, check the timer.

### Phase 3 done
- [x] Bird Fitness runs inside Nest's Body tab (`body.html` + `src/body/`), old code unchanged except `window.claude` → `window.nest`
- [x] Its data lives in Nest's database (`fit` table), in Nest backups, and imports from a Bird Fitness backup (Nest ⚙ or Fitness Setup)
- [x] Nest look: paper and ink, teal for Body, Archivo and Fraunces, light and dark
- [x] Everything from the old app: Today flow, rotation and next workout, logger with warm-up sets, plate math, PRs, swaps, missed workout + makeup, rest timer, stretch player + dose + streak, meal plan, macros, water, recipes, add food, staff lunch, batch prep, taste learning, progress charts, bodyweight, volume, calendar, Sunday recap, gym barcode card
- [x] River: 🏋 tray → 🌊 Add puts 🔥 Warm-up, 🏋 the workout (one step per lift, with today's target, max 7) and 🧘 Cool-down on the River. Rest days get the stretch session
- [x] Logging a lift in Body ticks its River step; finishing the session finishes the block; finishing Warm-up on the River checks it off in Body
- [x] 🏋 Log / Open on a River block jumps to the logger or stretch session
- [x] Rest timer keeps going while you're on Today (⏱ pill), and runs on end time, so a locked phone doesn't stop it
- [x] Groceries: 🛒 One list → 🧠 Send adds the week's Fitness groceries to Head's grocery list (no duplicates; pantry spices skipped)
- [x] Tests: 76 unit tests, e2e for Body (`tests/e2e/phase3.e2e.cjs`) incl. parity with the old app, offline e2e (`phase3-offline.e2e.cjs`)

### Phase 3 done-check (from BUILD.md)
- [x] A full workout logs offline at the gym (automated offline test) — "and syncs" is Phase 4 (phone-only until then)
- [x] Plate math and PRs match the old app on the same input (automated: plates, rounding, targets, warm-ups, PRs, time estimates, 3-week rotation)
- [~] The rest timer survives locking the phone — end-time timer, tested with a jumped clock; confirm on the iPhone
- [x] Groceries merge into one list

### Not done in Phase 3 (and why)
- Sound/vibration when rest ends while the phone is locked → needs push (Phase 5). On unlock it shows "Rest done — go"
- Two-way grocery ticks (Head ✓ → Fitness ✓) → one list lives in Head now; say if you want the Fitness checkboxes to follow
- River ticks on lifts don't log sets (they need reps and weight) → use 🏋 Log

---

## Phase 2 — Head (Clearhead port) · done (phone-checked)

Built overnight Oct 15, 2026 (night shift, in Claude's cloud workspace; copied into the repo when the Mac woke).

### Morning check (Anthony)
1. Commit "Phase 1 + Phase 2" in GitHub Desktop and push.
2. When Cloudflare is ready: open the app on the iPhone → Head tab → ⬆ Import Clearhead (Clearhead → Settings → Export JSON first).
3. Check the counts it shows match Clearhead. Then tap 🌅 Plan → ▶ Start my day and see today land on the River.

### Phase 2 done
- [x] Clearhead core ported verbatim (`src/head/core/clearhead.js`): dates, repeat rules, task model + selectors, notes, Quick Add parser, ramble splitter
- [x] Parity tests against Clearhead's own outputs: 26 Quick Add lines, 7 repeat rules, typed dates, ramble splitting, estimates, groceries, notes (`tests/clearhead-parity.test.ts`)
- [x] Store on Dexie with Clearhead's rules: history, reschedule counting, repeat rollover, trash groups (30 days), templates, photos (`src/head/store.ts`)
- [x] Import a Clearhead backup (Head ⚙ or first run). Adds/updates by id, never deletes, safe twice; shows file vs Nest counts
- [x] Lists: Inbox, Today (groups + from earlier + done today), Upcoming (days/weeks/months + repeat previews), Anytime (filters), Someday, Waiting (follow-up text/email/copy), Logbook, Recently deleted, Search
- [x] Projects (cards, next step, stalled), Project view (outcome, client card, sections, notes, photos, complete/hold/archive/template), Areas, Groceries (by aisle/store, clear checked, 🌊 shopping block)
- [x] Task detail: notes with checkboxes, checklist, when/deadline/repeat/list/contexts/estimate/energy/priority/important/waiting, job details + materials, photos, activity, "keeps getting pushed" box
- [x] Quick Add with live highlighting + token chips, Brain dump, Groceries; global ＋ on Today and Head
- [x] Flows: Process Inbox (swipe), Plan My Day (4 steps → River), Weekly Review (7 steps), Shutdown (4 steps + tomorrow planner), Day planner, Focus (end-time timer), What now, Templates, Ramble (on-device sort), Quiet screen
- [x] Bulk select: done / when / move / tag / flag / to top / delete
- [x] River bridge: task → block with steps (checklist, else note checkboxes, else 3 steps); finishing the block finishes the task; undo undoes both; groceries → one shopping block; "Fits today" tray under the River
- [x] Tests: 65 unit tests + 2 e2e scripts (`tests/e2e/`), build passes, no artifact APIs

### Not ported yet (and why)
- Google Calendar events on Today/Upcoming → Phase 4 (calendar_cache from Claude's tasks)
- Claude's smarter ramble sort → Phase 4 (scheduled task proposal). On-device sort works now
- Drag-to-reorder → use ☑ select → ⤒ to the top for now
- Command palette (keyboard) and the 3-screen onboarding → low value on a phone; say if you want them
- Evening shutdown reminder notification → Phase 5 (push). The Shutdown nudge shows in Head after shutdown time

### Phase 2 done-check (from BUILD.md)
- [x] Every Clearhead box ticked (except the Phase 4 items above)
- [x] Import counts match — checked on the iPhone
- [x] Quick Add gives the same result as the old app on 20+ sample lines (26, automated)

---

## Phase 1 — Shell + River · done (phone-checked)
- [x] Today River: blocks + steps, auto-complete, Next line, step player, block menu, edit sheet, sample day, copy day
- [x] Quiet mode + ⓘ, backup/restore, River trash, undo on everything
- [x] Afternoon times marked "p"; tab bar above River icons

## Phase 0 — Spike · part 1 done
- [x] Skeleton, PWA, tokens, icons, 6-digit-code sign-in (off until Phase 4), gateway, migration 0001 (run in Supabase), legacy copies
- [x] Cloudflare deploy → iPhone install check (https://bird-nest.tonyc-bird.workers.dev)
- [ ] Hello test scheduled task (Phase 4)
