# Progress

## Phase 5 — Polish · built Oct 28 (phone check next)
Buzzing on a locked phone, warmer words, small motion, and a speed check.

### Setup (Anthony, once)
1. Push "Phase 5 polish" with GitHub Desktop, and wait for Cloudflare → bird-nest → Deployments to show it finished. (Before this push the site is "static assets only", and Cloudflare won't take a secret.)
2. Cloudflare → Workers & Pages → **bird-nest** → Settings → Variables and Secrets → **Add** → Type **Secret**, name `VAPID_PRIVATE`, value = the one line in `supabase/local/cloudflare-push-secret.txt` on the Mac → Deploy. (The public half is already in `wrangler.jsonc`.)
3. On the iPhone, open Nest from the Home Screen → Settings → Buzz → **Turn on buzzing** → Allow → **Test**, then lock the phone.

### Done
- [x] Buzz (Settings): rest timer done and shutdown, even with the phone locked. A small helper on Cloudflare (`worker/`, one Durable Object per phone) holds the phone's push address and wakes with an alarm on the exact second. Free plan
- [x] Rest timer: plans the buzz when rest starts, moves it on ±15, cancels it on skip. Warm-up timers buzz too ("Walk done — go"); holds don't. Tapping it opens Body
- [x] Shutdown: once each evening at the shutdown time, not on off days, not after you've shut down. Tapping it opens Shutdown
- [x] Push is locked end to end (aes128gcm) and signed (VAPID); the helper only talks to real push services; each phone has its own id and key
- [x] Words: no screen has a paragraph (the audit crawler now checks: over 16 words or 3 sentences); long task titles show two lines in lists
- [x] Voice: "1 earlier", not "1 late"; a clock, not a warning sign; "Skipped", not "Missed"; "Was due", not "Late"; "Make up a workout"; empty Today says "A clear day"; empty groceries say "All stocked"
- [x] Motion: screens ease in, checks pop when you tap them (not when a list just draws), buttons press in. Off when the iPhone asks for less motion
- [x] Speed: warm open draws Today in ~80 ms (Chromium, full speed) and ~350 ms with the CPU slowed 10×; Body loads 1.5 s later so Today paints first
- [x] Tests: 148 unit (web push checked against node:crypto, buzz plans), Buzz e2e (stubbed iPhone push), helper integration test under `wrangler dev` with a fake push service (26 checks, decrypted with http_ece), audit crawler clean

### Phone check (done when)
- [ ] Test buzz arrives on the locked iPhone
- [ ] Rest buzz arrives on time with the phone locked at the gym; skip cancels it
- [ ] Shutdown buzz arrives at the shutdown time; tapping opens Shutdown
- [ ] 7 days on Nest only, without opening the old apps

## Brain dump, rebuilt for project rants · Oct 22
Rant about your jobs and your week, out loud or typed, one long run-on is fine. Nest splits it, writes each thing as a short task, files it, and offers new projects. All on the phone, offline.

- [x] Reads dictation with no punctuation: starts a new thing at "I need…", "we need…", "then…", "they want…", a second verb ("…the kids room print the coloring sheets…"), "every Monday…"
- [x] Short titles: leads ("I'm going to need to"), fillers ("probably", "sometime"), who asked ("Abby wants me to"), reasons ("because…") and conditions ("once they approve") come out; the full words go in the task's notes. "It" becomes the thing ("cut and install them" → "Cut and install the trim boards"). Names, stores, days and books of the Bible get capitals
- [x] Projects: "Backyard:", "For the Jon Wolfe project,", "jon wolfe kitchen backsplash…", "over at the wolfe place" file everything said about it into that project. A message to someone else ("text Abby") doesn't
- [x] New projects: "I want to build a deck for the Smiths…", "New job for the Hendersons…", "Fence for the neighbors: …" → a "New project" card on top (name editable, switch to skip) with its steps in order. "They want it done before Thanksgiving" becomes its deadline. "Get them a quote" → "Get the Hendersons a quote"
- [x] Days: a day said first covers the sentence ("Sunday I need to… and …"), "Tomorrow:" covers the list, "…and then…" keeps the day, "Monday… Wednesday… Friday" stay in order, "this week" / "this month" / "before Thanksgiving" become deadlines, "wednesday night at 7" is 7 PM, "every other week" repeats. A day that's part of a message ("text Aaron and see if he can help Saturday") isn't when to text
- [x] Other: "the deck stain is peeling" / "it's leaking again" go in the notes; feelings go to Thoughts; groceries to Shopping (even "milk bread bananas" with no commas; not "a babysitter" or "Abby's prescription"); building materials said about a job stay a task in the job; "give around an hour" becomes ~1h
- [x] Review screen: new projects first, then your projects, then Today / Coming up / No date yet / Shopping / Someday / Thoughts. Each row shows its day, time, deadline, repeat, estimate and a note mark. → can move a thing into any project or list
- [x] Things with a time land on the River at that time: today's when you put them away, other days by themselves on that day (once; if you take one off, it stays off)
- [x] Tests: 133 unit (32 rant tests from real-style dictation), e2e checks the new project, its steps in order, the deadline, the River block and Undo

## Debug sweep · Oct 22
Walked every screen at 3 phone sizes in light and dark (`tests/e2e/audit.cjs`, about 80 screens each plus random taps), reviewed the code for Today, sync and Head, and ran Anthony's real data through Claude's door (read-only).

### Setup (Anthony, once)
1. Supabase → SQL editor: paste `supabase/migrations/0004_door_per_item.sql` → Run. (Claude's door skips one bad item instead of failing the whole batch.)
2. Supabase → Authentication → Sign In / Providers: check **Allow new users to sign up** is off.
3. Push "Debug sweep" with GitHub Desktop.

### Fixed
- [x] Today stayed on yesterday after midnight; it now follows the clock (and catches up when the phone wakes)
- [x] Blocks that run past midnight showed "1m"; a block with no start time broke the free gaps (start is now required)
- [x] Body's Start button sat under the ＋; Body's "didn't load" card was hidden behind the frame
- [x] Updates no longer reload the app while you're using it: they install when Nest goes to the background, or on Reload / Check for update
- [x] Offline: the start-up rescue no longer wipes the app files (that left nothing to start from)
- [x] Sheets: every picker and the block sheet have a ✕; a scrolled sheet no longer closes from a tap near its top; the task sheet keeps Done in view
- [x] Typing then closing a sheet (swipe, tap outside, Done) now saves what you typed
- [x] Claude tab: a quick double tap on ✓ applied a suggestion twice; a card decided during a refresh came back
- [x] Sync: one row the cloud refuses (a half emoji, NUL) no longer stops everything else; a new phone joining the account gets Body settings from the cloud instead of overwriting them with defaults; ✓/✕ made while signed out wait instead of being dropped; dismissing a flagged email now really reaches the cloud; Claude's "fixed" notes can't be overwritten by an older copy
- [x] Undoing an edit on a finished task-block no longer reopens the task; reopening a done repeating task no longer leaves two copies
- [x] Restoring a backup no longer brings back old Claude suggestions that could be applied twice
- [x] Head: ＋ on a project or area page files there (it went to Inbox); select mode ends when you leave Head (＋ was hidden everywhere); a cancelled bulk picker keeps the selection; a restored task whose project was deleted lands in Inbox (it was invisible); "Anytime" time of day sticks; archiving a project has Undo
- [x] Plan my day: "Later" on a past-due task moves on; Back no longer bounces. Weekly review: changing a project's status no longer skips the next project, and has Undo
- [x] Double taps on Create (templates), Put away (dump), Ramble save, Start my day and 🌊 no longer add things twice
- [x] Checklist steps: the cursor no longer jumps while typing; Repeat "Every N" and Focus minutes can be cleared and retyped
- [x] Brain dump understands how the phone talks: curly ’ (I’m), "I’m going to need to…", "this upcoming Tuesday", "give around one hour" (becomes ~1h), "need a tarp" → "Get tarp", and "…and then take it to the dump" keeps Tuesday. Quick add offers "Looks like a few things · Sort them" for a long dictation, and grows to fit it
- [x] Easier to read: muted text and small teal/orange labels are darker in light mode; the gold "Important" chip uses dark text; Body's picked days read in dark mode
- [x] Easier to tap: checkboxes, ✕ on chips, free-time gaps, back links and step ✕ have bigger touch areas (same look); icon-only buttons all have names
- [x] Emoji that slipped through (🛋 🏡 ☕ 📆 🧾) are Nest icons now; new "weekend" icon
- [x] Tests: 109 unit, SQL tests for 0004, all e2e pass; `testing.e2e.cjs` checks the new dump, the ✕, saving on close and select mode

### Not changed (on purpose)
- The testing flag can sit over a button: drag it anywhere
- Reports aren't in the backup file (they're big and already in the cloud)

## Fixes from Anthony's first reports · Oct 22
- [x] ＋ in the tab bar looked cut in half: the fade above the tab bar was drawn over it. Now the ＋ sits on top.
- [x] "2/7" on the now card looked off-center: the card had five buttons squeezed in. Now three: Start/Resume, "2/7 ⌄", ⋯ (Open in Body / Open task moved to the top of ⋯).
- [x] Idea → done: swipe a task left in any Head list to delete it; Undo in the toast.

## Now: Testing mode + new Brain dump · built Oct 22

### Setup (Anthony, once)
1. Supabase → SQL editor: paste `supabase/migrations/0003_reports.sql` → Run. (Lets Claude read and close your reports.)
2. Push "Testing mode + Brain dump" with GitHub Desktop.
3. iPhone: ⚙ → Testing → turn on **Testing mode**.

- [x] Testing mode: a draggable flag on every screen (above sheets and full-screen flows). Tap → Looks wrong / Stuck / Broken / Idea, a sentence, optional screenshot from Photos
- [x] Each report saves the screen (HTML), the tab and open sheets, the last 20 taps, any errors caught, the look and version. Syncs to the cloud; Claude reads it with `node claude/tools/reports.mjs` and marks it fixed with a note that shows on the phone
- [x] "Stuck" saves and gets you out (reloads to Today; data is safe). "Stuck? Back to Today" on the report sheet too
- [x] Settings → Testing: the switch, the reports list (Open / Fixed / Later), Copy open reports (to paste into a chat)
- [x] No more trapped screens: every bottom sheet closes with a swipe down or a tap on its grab bar; Head projects, areas, settings and trash have a back link
- [x] Brain dump rewritten: one full screen to empty your head (type or talk, run-on is fine), then Nest separates it into Today / Coming up / No date yet / Shopping / Someday / Thoughts; tap a name to fix, → to move, uncheck to leave out, Put away. Draft is kept if the app closes. Also inside Shutdown and Weekly review
- [x] Tests: 101 unit, SQL tests for the reports door, new e2e `testing.e2e.cjs` (dump + testing + sheet close)

## Now: Design overhaul · built Oct 21, waiting on the phone check

Picked on the design canvas: **G** (Bloom timeline + Flow's task circles), colors **Follow the sun**, Nest's own icons.

- [x] Two looks: **Mist** (light, airy) from sunrise to sunset, **Dusk** (soft slate) at night. Sun times worked out on the phone for Coeur d'Alene. ⚙ → Look: Follow the sun / Light / Dark
- [x] One color per life area everywhere: body teal, stretch sky, warm-up peach, head violet, money gold, people green, home pink, rest indigo, calendar gray
- [x] 85 Nest icons drawn for the app (`src/ui/icons.ts`); "coffee" added Oct 22 for coffee meetings (task words, River blocks, calendar lines, block picker in place of the map pin). Any emoji that reaches the screen (old blocks, Claude's plans, toasts, areas) is swapped for a Nest icon by the JSX runtime (`src/jsx`)
- [x] Font: Plus Jakarta Sans (bundled, works offline)
- [x] Today: big date, week tiles with color bars (swipe for other weeks), task circles (Claude, today's workout, Head tasks, late, to sort, Plan), pill timeline, now card with the current step + Start, "2/5 ⌄" opens all steps, free gaps, small faded calendar lines
- [x] Tab bar: Today · Head · ＋ · Body · Claude
- [x] Head, Body (Fitness skin), Claude, Settings, sheets, step player restyled; new home-screen icon
- [x] Tests: 94 unit tests, e2e phase 2/2-bulk/3/3-offline/4 all pass on the new screens

### Design done-check
- [ ] Looks right on the iPhone in daylight and after sunset
- [ ] Home-screen icon updated (delete + re-add the app if iOS keeps the old one)

## Now: Phase 4 — The Claude loop · code done, waiting on Supabase setup + phone check

Built Oct 16–17, 2026.

### Setup (Anthony, once)
1. Supabase → SQL editor: run `supabase/migrations/0002_phase4.sql`, then `supabase/local/0002b_token.sql` (not in git; the door key's hash).
2. Supabase → Authentication → Sign In / Providers → Email: turn off **Confirm email** (free Supabase can't change its emails, so Nest uses email + password).
3. Commit "Phase 4 Claude loop" and push.
4. iPhone: ⚙ → ☁ Connect Claude → First time here → email + password (save it in iPhone Passwords).
5. Supabase → Authentication → Sign In / Providers: turn off "Allow new users to sign up".

### Phase 4 done
- [x] The door: `nest_gateway()` SQL function (snapshot, propose, cache_calendar, add_mail, approved, mark), token checked by hash, tied to Anthony's account on first sign-in
- [x] The phone's copy goes up to `nest_rows` (every table except photos), offline edits wait and go up later; a week of Body plans goes up for Claude
- [x] Nest never waits for sign-in; ☁ Connect lives in ⚙
- [x] ✓ tab: preview, ✓ applies on the phone (day plan replaces the River, task, rollover, recap, groceries, makeup, swap, weekly review, ramble tasks), ✕ declines; calendar bookings wait for the applier; flagged mail with links
- [x] Calendar events on the River as small faded lines; all-day ones as small chips; hold one to make it yours (timed → a block at its time, all-day → a Head task that day); evening recap card
- [x] Four scheduled tasks created (morning 4:45, applier 7:10/10:10/1:10/4:10/7:10, evening 8:40, Sunday 5:50 PM); prompts in `claude/tasks/`
- [x] Tests: SQL tests in Postgres (`tests/sql/`), 88 unit tests, Phase 4 e2e with a fake Supabase

### Phase 4 done-check (from BUILD.md)
- [ ] Three mornings in a row, the plan is waiting by 5:00
- [x] ✓ replaces the River (e2e) — confirm on the phone
- [x] ✕ leaves it alone (e2e)
- [ ] An approved gym booking appears in Google Calendar by the next applier run, and never twice (applier searches first; mark is one-time)
- [x] A declined proposal never reappears the same day (enforced in the database; SQL test)

### Not done in Phase 4 (and why)
- ✎ edit on a proposal → tap a card to preview; edit after ✓ on the River
- Restoring from the cloud adds missing rows only (never overwrites the phone)

---

## Phase 3 — Body (Bird Fitness port) · code done, waiting on Anthony's phone check

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
- Sound/vibration when rest ends while the phone is locked → done in Phase 5 (Settings → Buzz)
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
- Evening shutdown reminder notification → done in Phase 5 (Settings → Buzz)

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
