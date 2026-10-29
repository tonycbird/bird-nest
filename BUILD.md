<!-- Source of truth: https://claude.ai/code/artifact/8026fda9-ba48-4715-921d-a9e2fd1917d7 (exported Oct 15, 2026). If they differ, ask Anthony which wins. -->

# Bird Nest — App Build Prompt

Oct 15, 2026 · @Anthony Bird

## How to use this prompt

This doc is the brief for building Bird Nest as a real app. It is not an artifact. Claude builds it in a code repo, one phase per session.

1. Make a new GitHub repo called `bird-nest`.
2. Save this whole doc in the repo root as `BUILD.md`.
3. Open a Claude session that can work in that repo. That means Claude Code, or Cowork linked to your computer.
4. Paste the starter prompt below.
5. Each new session uses the same starter prompt. Only the phase number changes.

```markdown
Read BUILD.md, PROGRESS.md and DECISIONS.md in full before touching code.
We are on Phase <N>.
1. Run the done-check for the previous phase. If it fails, fix that first.
2. Re-read section "Ways this will go wrong" and name the 3 rows most likely to bite this phase.
3. Build only this phase. Anything else goes in IDEAS.md.
4. Finish by running this phase's done-check, updating PROGRESS.md, and telling me in plain short sentences what to test on my iPhone.
```

**Rules for whoever builds this:**

- This doc wins over a passing idea. Only Anthony changes it.
- Keep three files current. `PROGRESS.md` holds what's done and what's next. `DECISIONS.md` holds each choice and why. `IDEAS.md` is the parking lot.
- Write chat replies to Anthony in plain, short sentences. The app's UI is where symbols belong.

**Read these first:**

- [Bird Nest concept page](https://claude.ai/artifact/N39gmDtiyp9yfSARiNMGsT): the look, the River, the Blend, the costs.
- [Clearhead build prompt](https://claude.ai/artifact/WTxKgJvKTjgVHgY3VfBdE5): how the head side was specced.
- The current Clearhead and Bird Fitness sources. They get copied into `legacy/` in Phase 0, and their logic is ported from there.

## What we are building

Bird Nest is one installable app for Anthony's day. It merges Clearhead and Bird Fitness. Clearhead is the head side: tasks, projects, planning. Bird Fitness is the body side: workouts, stretching, meals. Money joins later.

**What it is:**

- A web app with its own address. It installs on Anthony's iPhone home screen, opens full screen and works offline.
- It is built in a code repo, deployed to free hosting, and keeps data in its own database.
- It is just for Anthony. Nothing is shared.
- Claude is the brain. It is not inside the app. Claude runs on a schedule, on Anthony's existing plan. It reads his mail and calendar through Claude's connectors and leaves proposals. He taps ✓ to accept them.

**What it is not:**

- Not a Claude artifact. It has no `window.claude`, no artifact database and no `sample` calls.
- Not a paid AI app. It makes no API calls that cost money.
- Not the budget, yet. Bird Budgeting keeps running on its own until the last phase.

### The design: the Blend

The Blend is the River timeline with Quiet color discipline and a Warm voice.

- **River.** The home screen is today as one vertical timeline of blocks, from wake to bed.
- **Quiet.** Only three colors carry meaning: brass for money, teal for body, violet for head. Everything else is ink and paper. Type is Fraunces for display and Archivo for UI. Copy the exact tokens from the concept page `:root`.
- **Warm.** One kind sentence sits on top, like "Legs today. Avista is due Friday. Bed by 10." It never scolds or streak-shames.

### The core idea: blocks with steps

Anthony works best when the app tells him exactly what to do and he follows it. So every block holds numbered steps.

1. One step is **now**. It is highlighted.
2. Tapping it marks it done. Done steps fade, and the next step becomes now.
3. When the last step is done, the block completes itself and the next block opens.
4. The top line always says what is next: "Next up: Legs, step 2 of 6."

Example day, the same one as the concept page:

| Time | Block | Kind | Steps (sample) |
| --- | --- | --- | --- |
| 5:00 | Warm up + stretch | Body | Bike 5 min · Hip openers · Band pull-aparts |
| 5:15 | Legs | Body | Squat 3×5 · RDL 3×8 · Lunges 2×10 · Calves |
| 6:10 | Cool-down | Body | Walk 3 min · Quads · Log weight |
| 7:30 | Avista bill | Money (later) | Open app · Pay $ · Mark paid |
| 8:00 | Commute | Life | Podcast queued · Leave by 8:05 |
| 17:30 | Winco run | Life | List is ready · Aisles in order · Check off |
| 19:30 | Study | Head | Focus 25 · Break 5 · Focus 25 |
| 21:30 | Wind down | Head | Shutdown · Tomorrow's top 3 · Phone away |

## Non-negotiables

If a choice breaks one of these, stop and ask Anthony.

1. **It is an app.** It has its own URL, a home-screen icon, its own database, and offline use. If any artifact API shows up in the code, that is a bug.
2. **It costs $0 a month.** Use free tiers only. The only thinking is in Claude scheduled tasks on Anthony's current plan.
3. **Port, don't reinvent.** Every feature in the carry-over checklist survives unless Anthony cuts it by name. The logic is copied from `legacy/` and is not rewritten from memory.
4. **Steps, not paragraphs.** Each block is a set of numbered steps. A step label is 6 words or fewer, and a block has 7 steps at most. Symbols and numbers go first, and details sit behind ⓘ.
5. **Claude proposes, Anthony approves.** Nothing gets booked, sent, archived or deleted outside the app without a ✓.
6. **Mail is read-only.** The app never sends email. It stores only a summary line and a link, never the email body.
7. **Just Anthony.** There is one user, one login and no sharing.
8. **Budget waits.** There are no money tables or screens before Phase 6. Bird Budgeting stays live and untouched.
9. **Everything can be undone.** Every action shows Undo for 10 seconds. Deletes go to Trash, which is a soft delete.
10. **His data is his.** A one-tap JSON backup is in Settings from Phase 1 on.
11. **Offline first.** The app has to work in the gym at 5 AM with no signal. It syncs later without losing or doubling anything.
12. **Test on the real phone.** A phase is not done until it has been checked on Anthony's iPhone from the home-screen icon.

## Architecture

&#91;embedded content: Bird Nest architecture · sources, Claude, gateway, database, phone\]

Claude never touches the phone. It reads Google through its connectors, writes proposals through one narrow door, and waits. The phone keeps its own copy and works without signal. Anthony's ✓ is the only thing that turns a proposal into a change.

**Why this shape:**

- **$0.** Hosting, the database and the Edge Function all fit free tiers. Claude's thinking runs on the plan he already pays for.
- **Safe.** The client holds only the anon key behind RLS. The gateway token lives only in the scheduled tasks.
- **Offline.** Dexie is the source the UI reads. Supabase is the backup and the meeting point with Claude.
- **No Google login in the app.** Connectors handle Google, so there are no expiring tokens and no app review.

## Data model

The phone keeps a full local copy in IndexedDB through Dexie, and the UI reads only from that. Changes queue in an outbox and sync to Supabase Postgres. That is why the gym works offline.

**Rules for every table:**

- `id` is a uuid made on the device.
- Every table also has `user_id`, `created_at`, `updated_at` and `deleted_at`. Deleting fills `deleted_at`. Rows are never hard-deleted.
- Row-level security is on for every table: `user_id = auth.uid()`.
- A day is a text key, `YYYY-MM-DD`, computed in the time zone set in Settings. Never use `toISOString()` for a day.
- Times of day are `HH:MM` text plus the day key. Real instants, like a set's finish time, are `timestamptz`.
- Imported rows keep `legacy_id`, which makes a re-import safe.
- Sync is last-write-wins per row by `updated_at`. Every outbox op has an `op_id` so a retry never doubles a row.

### Tables

| Table | Holds | Key fields |
| --- | --- | --- |
| settings | One row of preferences | tz, wake, bed, gym\_days, macro targets, water target, quiet\_mode |
| days | One row per day | day, sentence, energy, plan\_status, shutdown\_done, recap |
| blocks | The River | day, start, end, kind (body / head / life / money), title, source\_type, source\_id, sort, status |
| steps | Numbered steps in a block | block\_id, n, label, value, done\_at |
| areas | Life areas | name, sort |
| projects | Projects | area\_id, name, notes, deadline, status |
| tasks | Every to-do | title, notes, list (inbox / today / anytime / someday / waiting), when\_day, deadline, project\_id, area\_id, contexts\[\], estimate\_min, repeat\_rule, waiting\_on, checklist jsonb, done\_at |
| templates | Reusable task sets and day blocks | name, kind, body jsonb |
| attachments | Photos and comments | parent\_type, parent\_id, kind, url or text |
| exercises | Exercise library | name, muscle, equipment, swap\_group, plate\_loaded |
| workouts | The rotation | name, order, exercise plan jsonb (sets, reps, rest) |
| sessions | A workout done | day, workout\_id, started\_at, ended\_at, notes |
| sets | Every logged set | session\_id, exercise\_id, n, weight, reps, rpe, warmup |
| prs | Personal records | exercise\_id, kind, value, day |
| stretch\_logs | Stretch sessions | day, routine, minutes |
| bodyweight | Weigh-ins | day, lbs |
| foods, recipes | Food library | name, macros, serving, ingredients jsonb |
| meal\_plans, meal\_logs | Plans and what was eaten | day, slot, food\_id or recipe\_id, qty |
| water\_logs | Water | day, oz |
| grocery\_items | One shared grocery list | name, qty, aisle, source (meal / task / manual), checked |
| calendar\_cache | Google events copied by Claude, read-only | day, start, end, title, google\_id |
| mail\_items | Mail Claude flagged | received, from, subject, ask, due, link (no body) |
| proposals | Claude's suggestions | kind, payload jsonb, reason, status (pending / approved / declined / applied / failed), needs\_google, expires\_at |
| rules | Preferences Anthony approved | kind, match, action |
| audit | Every change, for undo | table, row\_id, before jsonb, after jsonb, by (anthony / claude) |

Money tables are not created until Phase 6. They are listed in Budget to come.

## Screens

There are four tabs at the bottom: **Today**, **Head**, **Body** and **✓**. Money (Phase 6) is a brass circle on Today that opens a Money screen, not a fifth tab. Settings sits behind the gear. A global ＋ opens Quick Add from anywhere.

### Today, the River

1. **Top line.** It shows the warm sentence, then the Now line: "Next up: Legs · step 2 of 6".
2. **Approvals chip.** If anything is waiting, "✓ 3" sits here and links to the ✓ tab.
3. **The River.** Blocks sit on one vertical line by time. The color dot shows the kind and the time is on the left. Calendar events show as thin, locked blocks.
4. **Tap a block.** Its steps open in place. Tap the now step to tick it. The block auto-completes and the next one opens.
5. **Long-press a block.** You can move it, shorten it, skip it, or send it to tomorrow.
6. **Fits today tray.** Below the River sit the tasks with no time slot, sorted by estimate. Drag one onto a gap.
7. **Plan my day.** This is Clearhead's PlanMyDay, ported. It builds the River from the calendar, the workout rotation and Today tasks. Claude's morning proposal can replace this with one ✓.

### Step player

The step player is a full-screen view of one block. It shows one big step, a big ✓, and the next step faded underneath. The rest timer and the plate math live here during a workout. Focus mode is the step player for a head block.

### Head

The Clearhead lists are ported as they are: Inbox, Today, Upcoming, Anytime, Someday, Waiting, Logbook, Trash, Projects and Areas. The rituals are Process Inbox, Weekly Review, Shutdown, What Now, Ramble and Quiet screen.

### Body

The Body tab has four segments: **Lift**, **Stretch**, **Eat** and **Progress**. Lift covers the rotation, logger, PRs and swaps. Stretch covers the player, dose and streak. Eat covers the plan, macros, water and recipes. Progress covers the charts, bodyweight and volume. Every Fitness feature is ported.

### ✓ Approvals

This is one list of Claude's proposals, newest first. Each card shows a symbol, a one-line what and a one-line why. It has three buttons: **✓**, **✎** and **✕**. Kinds of proposal:

- Day plan. Approving it replaces today's River.
- New task from a mail item.
- Calendar booking, such as a gym slot. After ✓ it reads "booking within the hour".
- Workout swap or makeup plan.
- Grocery list from the meal plan.
- Tasks split out of a ramble.
- Evening recap, which moves undone items to tomorrow.

### Grocery list

There is one list for meals, tasks and manual items, sorted by aisle. It becomes the steps of the "Winco run" block.

### Settings

Settings holds the time zone, wake and bed times, gym days, targets, quiet mode, backup and restore, the app version with an update button, and sign out.

## Feature carry-over checklist

Tick an item only when it has been checked side by side with the old app, using the same input. Port each item from the function of the same name in `legacy/`.

### From Clearhead (Head)

- [ ] Inbox, Today, Upcoming, Anytime, Someday, Waiting, Logbook and Trash
- [ ] Projects and Areas, with progress
- [ ] Templates
- [ ] Repeat editor (RepeatEditor), with every rule type it supports
- [ ] Quick Add, with every token `parseQuickAdd` understands
- [ ] Process Inbox (ProcessInbox)
- [ ] Plan My Day (PlanMyDay) and the Day Planner. These now produce River blocks.
- [ ] Weekly Review
- [ ] Focus mode, which now runs through the step player
- [ ] Shutdown ritual, which becomes the "Wind down" block steps
- [ ] Quiet screen
- [ ] Ramble or Brain Dump, by voice
- [ ] What Now
- [ ] Grocery list, merged with Fitness groceries
- [ ] Client card and Handy block
- [ ] Calendar view, read from `calendar_cache`
- [ ] Estimates and contexts
- [ ] Photos and comments on tasks
- [ ] Offline outbox, which becomes the app-wide sync

### From Bird Fitness (Body)

- [ ] Workout rotation and the next-workout pick
- [ ] Set logger, with warm-up sets
- [ ] Plate math
- [ ] PRs and PR detection
- [ ] Exercise swaps
- [ ] Missed workout and makeup plan
- [ ] Rest timer
- [ ] Stretch player, dose and streak
- [ ] Meal plan, macros and water
- [ ] Recipes, Add food and Staff lunch
- [ ] Batch prep
- [ ] Taste model
- [ ] Progress charts, bodyweight and volume
- [ ] Fitness calendar
- [ ] Check-in recaps
- [ ] Gym barcode card, which must work offline
- [ ] Home-screen install guide, which becomes the real install prompt

### Features that used artifact powers, and what replaces them

| Old power | Used for | In Bird Nest |
| --- | --- | --- |
| `sample` (Claude in the page) | Ramble parsing, What Now, Taste model, recaps | **Rule-based on the device** for the instant answer: line splitting, the Quick Add parser, score by context, energy and estimate. **Claude scheduled task** for the smart version, which arrives as a proposal |
| `mcp` Google Calendar | Calendar view, PlanMyDay | `calendar_cache`, which Claude fills each morning and evening |
| `downloads` | Backups and exports | A normal file download, or the iOS share sheet |
| Artifact `db` | All storage | Dexie on the device plus Supabase |
| `user` | Who is viewing | Supabase auth, with one allowed email |

## The daily Claude loop

Claude never runs inside the app. It runs as **scheduled tasks** on Anthony's plan. It reads Gmail and Google Calendar through Claude's connectors, and it talks to the app through one small door.

### The door: `claude-gateway`

The door is one Supabase Edge Function. It has five actions:

| Action | Does | Can't |
| --- | --- | --- |
| `snapshot` | Returns today and tomorrow: blocks, open tasks, next workout, meal plan, grocery list, pending proposals, rules | Read old history, attachments or settings secrets |
| `propose` | Inserts proposal rows with status pending | Change any other table |
| `cache_calendar` | Replaces `calendar_cache` for a date range | Touch tasks or blocks |
| `add_mail` | Inserts `mail_items`, as a summary and link only | Store an email body |
| `approved` / `mark` | Lists approved proposals that need Google, and marks them applied or failed | Approve anything itself |

The door checks a long random token, which is a Supabase secret, so the client never sees it. Rotate it from Settings. The service-role key never leaves Supabase.

### The four tasks

| Task | When (local time) | Reads | Writes |
| --- | --- | --- | --- |
| Morning plan | Daily 4:45 | Calendar for today +2, Gmail for the last 24 h, snapshot | Day-plan proposal, warm sentence, mail items, task proposals, calendar cache |
| Applier | 7:10, 10:10, 13:10, 16:10, 19:10 | Approved proposals | Google Calendar events, then marks them applied or failed |
| Evening recap | Daily 20:40 | Snapshot, calendar for tomorrow | Recap, roll-over proposal, tomorrow's workout or makeup, grocery proposal |
| Weekly prep | Sunday 17:50 | Snapshot plus the last 7 days of sessions and tasks | Weekly Review prompts, next week's rough River |

Each run uses some of Anthony's plan usage. Start with these four. Add more only if he asks.

### Morning plan prompt

```markdown
You are Bird Nest's morning planner for Anthony. Work in short steps. Never send email. Never create, edit or delete calendar events in this task.
1. POST {"action":"snapshot"} to <GATEWAY_URL> with header x-nest-token: <TOKEN>. If it fails, stop and write one line saying why. Do not guess app data.
2. Google Calendar: list events today through +2 days, all of his calendars. POST them with action cache_calendar.
3. Gmail: search the last 24 hours, excluding promotions and social. For each message that asks Anthony to DO something or has a date, POST add_mail with from, subject, a 6-word ask, a due date if stated, and a link. No bodies.
4. Build today's River. Respect calendar events as fixed. Gym blocks go on gym days at the time in settings, using the next workout in the rotation. Fit Today tasks into gaps by estimate. Every block gets 2 to 7 numbered steps of 6 words or fewer. Steps for a workout come from the workout plan. Steps for a head block come from the task checklist, or else are "Open · Do 25 min · Note next step".
5. Write one warm sentence of 12 words or fewer naming the day's anchor. No guilt, no streak talk.
6. POST propose with kind day_plan (blocks, steps, sentence, and a one-line reason). One task proposal per actionable mail item.
7. Reply with 3 short lines: what you proposed, anything odd, anything that failed.
```

### Applier prompt

```markdown
You are Bird Nest's applier. Only act on proposals Anthony already approved.
1. POST {"action":"approved"} to <GATEWAY_URL> with header x-nest-token: <TOKEN>.
2. For each item with needs_google = true: do exactly what payload says in Google Calendar (create or update only, never delete unless payload.kind is calendar_delete AND status is approved).
3. Before creating, search the calendar for an event with the same title within 15 min of the start. If found, do not create a duplicate. Mark it applied with a note.
4. POST mark with applied or failed plus a one-line note for each.
5. If nothing is approved, end silently.
```

### Evening recap prompt

```markdown
You are Bird Nest's evening recap for Anthony.
1. POST snapshot (same door and token). Google Calendar: list tomorrow's events and POST cache_calendar.
2. Count what got done today: blocks done, steps done, workout logged or not, water and macros against targets.
3. Propose kind recap: 3 lines max, warm, one win first.
4. Propose kind rollover: undone Today tasks go to tomorrow, unless he has rolled one over 3+ times, then suggest Someday instead.
5. If today's workout was missed, propose kind makeup using the old Fitness makeup rules. Don't double legs on back-to-back days.
6. If tomorrow has a grocery block or the meal plan needs items, propose kind grocery with aisle-sorted items.
7. Reply with 3 short lines.
```

The weekly prep prompt follows the same pattern. It proposes `weekly_review` and a rough plan for next week. Store all four prompts in the repo as `claude/tasks/*.md` so they are versioned. Store `<GATEWAY_URL>` and `<TOKEN>` only in the scheduled task, never in git.

## Migration from the two artifacts

The old apps stay alive until Bird Nest proves itself. Nothing old is ever deleted.

1. **Copy the code.** Save the current Clearhead and Bird Fitness HTML into `legacy/clearhead.html` and `legacy/fitness.html`. This is reference only and never ships.
2. **Map the shapes.** Write `scripts/MAPPING.md`, a table of each old collection and field, the new table and column, and any transform.
3. **Export the data.** Use each app's own backup button first. If a backup misses anything, read the missing collections once through the artifact data tool, and say up front which collections it will read. Save the exports to `migration/raw/`, which is in .gitignore and never committed.
4. **Import with a script.** `scripts/import-clearhead.ts` and `scripts/import-fitness.ts` upsert by `legacy_id`, so running them twice changes nothing. Run them against a fresh dev Supabase project first.
5. **Prove the counts.** The script prints old count, new count and match for every collection. It also prints 10 random items side by side, open tasks by list, all PRs, and the latest bodyweight. Anything that doesn't match blocks the import.
6. **Run it for real.** Back up first. Run it once against the real project, then check the counts again.
7. **Run both apps for two weeks.** Log in both. Anthony picks the moment Bird Nest wins, and the old apps then become read-only. Their links stay. The Bird Nest import can be re-run until then.

| Old app | Old store | New tables |
| --- | --- | --- |
| Clearhead | Its db collections (tasks, projects, areas, templates, comments, photos) | tasks, projects, areas, templates, attachments |
| Bird Fitness | Collection `fit`, docs `logs/<month>` | sessions, sets, prs, stretch\_logs, bodyweight, meal\_logs, water\_logs |
| Bird Fitness | Plans and library inside `fit` | workouts, exercises, foods, recipes, meal\_plans |

The exact old collection names come from reading `legacy/` in step 2. Do not trust this table over the code.

## Build phases

There is one phase per session, or a few sessions. Never start a phase until the previous phase's done-check passes on the iPhone.

**Stack:**

- **App.** Vite, React and TypeScript, with `vite-plugin-pwa`.
- **Data on the phone.** Dexie, read with live queries.
- **Data in the cloud.** Supabase on the free tier: Postgres, Auth, RLS and Edge Functions.
- **Hosting.** Cloudflare Pages on the free plan, with GitHub auto-deploy.
- **Tests.** Vitest and Playwright.

Don't add Redux, a component kit or a CSS framework. Hand-written CSS uses the Bird tokens.

### Phase 0: Spike (prove the risky bits first)

- Repo, CI, deploy to Pages, manifest, icons, a service worker with an update prompt.
- Supabase project, plus sign-in with a **6-digit email code**, not a magic link. One allowed email.
- `claude-gateway` with only the `snapshot` and `propose` actions.
- One test scheduled task that POSTs a "hello" proposal.
- `legacy/` copies saved.

**Done when:**

- [ ] The icon on the iPhone home screen opens full screen.
- [ ] The app opens in airplane mode.
- [ ] Sign-in works inside the installed app.
- [ ] The test task's "hello" shows up in the database. This proves the scheduled task can reach Supabase.
- [ ] The test task can list Calendar events and search Gmail. This proves the connectors work in scheduled runs.

### Phase 1: Shell and the River

- Tabs, tokens, type, quiet mode and ⓘ.
- Today River with manual blocks and steps, the step player, auto-complete, and the Next line.
- Dexie, the outbox, sync, undo, Trash, and backup and restore.

**Done when:**

- [ ] A day can be built by hand.
- [ ] Steps ticked in airplane mode sync with no duplicates after reconnecting.
- [ ] A block made at 11:30 PM stays on the right day.
- [ ] A restored backup matches the original.

### Phase 2: Head (port Clearhead)

Every Clearhead item from the checklist, plus PlanMyDay making River blocks, plus the Clearhead import.

**Done when:**

- [ ] Every Clearhead box is ticked.
- [ ] The import counts all match.
- [ ] Quick Add gives the same result as the old app on 20 sample lines.

### Phase 3: Body (port Bird Fitness)

Every Fitness item, plus workout blocks that use the plan as their steps, plus the Fitness import.

**Done when:**

- [x] A full workout logs offline at the gym and syncs. (Offline: done. Sync: Phase 4.)
- [x] Plate math and PRs match the old app on the same input.
- [ ] The rest timer survives locking the phone. (Built on end time; confirm on the iPhone.)
- [x] Groceries merge into one list.

### Phase 4: The Claude loop

All the gateway actions, the ✓ tab, the four scheduled tasks, and the applier.

**Done when:**

- [ ] Three mornings in a row, the plan is waiting by 5:00.
- [ ] ✓ replaces the River.
- [ ] ✕ leaves it alone.
- [ ] An approved gym booking appears in Google Calendar by the next applier run, and never twice.
- [ ] A declined proposal never reappears the same day.

### Phase 5: Polish

Motion, empty states, the warm voice everywhere, word trimming, home-screen push, and speed.

**Done when:**

- [ ] Anthony uses only Bird Nest for 7 days without opening the old apps.
- [ ] No screen has a paragraph.
- [ ] The app opens in under 1 second when warm.

### Phase 6: Money summary

This phase follows Budget to come, stage B.

**Done when:**

- [ ] The Money tab shows the summary from Bird Budgeting with no data entry.
- [ ] Bill blocks appear on the River with steps.

## Night shift builds

The heavy porting work in Phases 1 to 3 runs overnight as a Claude scheduled task. The run starts a fresh usage window while Anthony sleeps, and the window has reset by morning. It still counts toward the weekly cap.

**When it can start:**

- [ ] The bird-nest repo exists and Phase 0 is done.
- [ ] A test scheduled run can push a branch to the repo. Add this to the Phase 0 done-check.
- [ ] Cloudflare Pages makes a preview link for every branch, so the night's work can be tested on the iPhone before it is merged.

**Schedule:** every night at 12:50 AM Pacific. Pause it from Claude's scheduled tasks during any week when usage is tight. Turn it off for Phases 0, 4 and 5, which need Anthony at each step.

### Night shift prompt

```markdown
You are Bird Nest's night-shift builder. Anthony is asleep. No one can answer a question or approve anything tonight.
1. Pull the bird-nest repo. Read BUILD.md, PROGRESS.md and DECISIONS.md in full.
2. If PROGRESS.md starts with "WAITING ON ANTHONY", stop. End with one line saying so.
3. Work only on the current phase. Branch from main as night/<YYYY-MM-DD>.
4. Take the next unchecked items in order. Port from legacy/, add a test that matches the old app's output, run build and tests, commit small.
5. Stop when any of these is true: the phase's code is done, a step needs Anthony (keys, accounts, a decision, a phone check), something needs approval, or about 3 hours have passed.
6. Never: touch the prod Supabase project, change secrets, merge to main, deploy to production, or rewrite work Anthony already approved.
7. Push the branch. Open a pull request titled "Night shift <date>: Phase <N>, <what changed>".
8. At the top of PROGRESS.md on the branch, write "Morning check": the preview link, at most 3 numbered things to test on the iPhone, and any question. If blocked, write "WAITING ON ANTHONY" and why in one line.
```

### Anthony's morning check, about 10 min

1. Open the pull request from the night.
2. Open the preview link on the iPhone and do the numbered checks.
3. Reply in a Claude session, either "merge it" or one line on what broke.
4. If it says WAITING ON ANTHONY, answer the question. The next night picks up from there.

## Ways this will go wrong, and the fix

These are Claude's own likely mistakes, written down before they happen. Read this section at the start of every session, and name the three rows most likely to bite.

### Building the wrong thing

| # | How I'll mess up | How I'll catch it | The fix |
| --- | --- | --- | --- |
| 1 | Slip back into artifact habits: one big HTML file, `window.claude`, `sample` | `grep -r "window.claude\|sample(" src` in CI fails the build | Stop. Move the logic into `src/` modules. The app talks only to Dexie and the gateway |
| 2 | Rewrite a feature from memory and lose its details, like repeat rules, plate math or Quick Add tokens | A checklist box is ticked only after a side-by-side test with the same input | Port the function from `legacy/`, then add a test with the old app's output |
| 3 | Build everything at once, so nothing works | PROGRESS.md shows more than one phase open | One phase at a time. A failed done-check blocks the next phase |
| 4 | Drift into Budget early | Any money table or screen before Phase 6 | Park it in IDEAS.md |
| 5 | Over-engineer with Redux, a component kit or microservices | `package.json` grows past the stack list | Delete it. Use React state plus Dexie live queries |
| 6 | Lose the thread between sessions | A session starts without reading PROGRESS.md | The starter prompt forces the read. Every choice goes in DECISIONS.md |

### Breaking his data

| # | How I'll mess up | How I'll catch it | The fix |
| --- | --- | --- | --- |
| 7 | Day keys from UTC push a 9 PM workout to tomorrow | Tests run at 11:30 PM local and on DST dates | One `dayKey(date, tz)` helper. Lint bans `toISOString().slice` |
| 8 | Offline edits get lost or doubled on sync | An airplane-mode test in every phase | Outbox with `op_id`, idempotent upserts, last-write-wins on `updated_at`, soft deletes |
| 9 | Migration silently drops rows | The count table shows a mismatch | Upsert by `legacy_id` and re-run. The old apps are never deleted |
| 10 | Test on his real data and wreck it | Any dev run pointed at the prod project | A seed script with fake data. Real data only after a backup |
| 11 | Supabase's free project pauses when idle | The gateway returns errors after a quiet week | The daily tasks keep it active. Local-first means the app still works. A restore button is in Settings |

### Phone and platform traps

| # | How I'll mess up | How I'll catch it | The fix |
| --- | --- | --- | --- |
| 12 | A magic-link sign-in opens Safari, not the installed app, so he can't log in | The Phase 0 done-check on the iPhone | Sign in with a 6-digit email code typed in the app |
| 13 | The service worker serves an old build after a fix | The version in Settings doesn't match the deploy | The PWA prompt shows "New version ↻". Never cache `index.html` forever |
| 14 | Assume iOS can do what desktop Chrome does: background timers, voice, push | Testing only in a desktop browser | The rest timer stores an end time and doesn't count ticks. Voice falls back to iOS dictation in a text box. Push only after home-screen install (iOS 16.4+), and confirm it on his phone |
| 15 | Speech recognition fails inside the installed app | Ramble does nothing | Feature-detect it. If it's missing, show a big text box and tell him to tap the mic on the keyboard |

### Claude overstepping

| # | How I'll mess up | How I'll catch it | The fix |
| --- | --- | --- | --- |
| 16 | A task books, archives or sends without a ✓ | Audit rows with `by = claude` outside proposals | Tasks can only `propose`. Only the applier touches Google, and only for approved rows |
| 17 | Copy whole emails into the database | Any `mail_items` row over 300 characters | A summary line and a link only |
| 18 | Booking the same event twice | Duplicates in the calendar after a retry | The applier searches before creating and marks rows applied |
| 19 | The scheduled task can't reach supabase.co, or the connectors aren't there | The Phase 0 spike fails | Add supabase.co to Claude's network access allowlist in settings. As a fallback, the task commits proposals to a private GitHub repo and the app reads them |
| 20 | Tempted to add Google sign-in to the app | Any Google OAuth code in the repo | No. Testing-mode tokens expire every 7 days and Gmail scopes need Google's review. Google stays behind Claude's connectors |
| 21 | A secret leaks into git or the client | `grep -r service_role` and a secret scan in CI | Client: anon key plus RLS. The gateway token lives only in the tasks. Rotate it from Settings |

### Missing what Anthony asked for

| # | How I'll mess up | How I'll catch it | The fix |
| --- | --- | --- | --- |
| 22 | Too many words on screen | Any step over 6 words, any paragraph, any block over 7 steps | Symbol, number, short label. Extra goes behind ⓘ. Split big blocks |
| 23 | The design drifts generic with extra colors and a stock look | Any color not in the tokens file | Only brass, teal and violet carry meaning. Use Fraunces and Archivo. Compare against the concept page |
| 24 | The voice turns naggy or guilt-y | Copy review in Phase 5 | Lead with one win. No streak-shaming. "Moved to tomorrow", not "You missed" |
| 25 | I say a phase is done without his phone test | The done-check has no iPhone line ticked | Done means checked on his iPhone from the home-screen icon. I tell him exactly what to tap |
| 26 | I reply to him in long paragraphs or symbol soup | He has to reread my messages | Chat replies are plain, short sentences, and steps are numbered |

## What Anthony does, step by step

Follow these blocks top to bottom. Claude does the code. Anthony does the parts that need him.

### Block 1: Accounts (about 20 min, once)

1. Make a GitHub account and an empty repo named `bird-nest`.
2. Make a Supabase account. Create two projects: `nest-dev` and `nest`.
3. Make a Cloudflare account. Leave Pages empty for now.
4. In Claude settings, check network access. Make sure `supabase.co` is allowed.
5. Make sure Gmail and Google Calendar are connected in Claude.

### Block 2: Phase 0 session (about 1 hour)

1. Open a Claude session on the repo.
2. Paste the starter prompt with Phase 0.
3. When Claude asks, paste in the keys. Paste them into `.env` or Supabase secrets only, never into chat history you share.
4. Approve the test scheduled task.

### Block 3: Install on the iPhone (5 min)

1. Open the app's address in Safari.
2. Tap Share, then Add to Home Screen.
3. Open it from the icon and sign in with the 6-digit code.
4. Turn on airplane mode and open it again. It should still work.
5. Tell Claude: "Phase 0 phone check passed" or what broke.

### Block 4: Each build session after that

1. Paste the starter prompt with the next phase number.
2. At the end, do the phone test Claude lists.
3. Report back in one line, with a screenshot if something looks wrong.

### Block 5: Once the loop is live (Phase 4 on)

1. Morning: open Bird Nest, then the ✓ tab, and approve or skip.
2. Follow the River. Tap the now step.
3. Evening: glance at the recap and approve the roll-over.
4. Sunday: do the Weekly Review block.

### Block 6: Switching over

1. Use both old and new for two weeks.
2. When Bird Nest wins, tell Claude "freeze the old apps".
3. Keep the old links bookmarked as an archive.

## Budget to come

Money joins last, in three stages. Bird Budgeting stays live the whole time.

### Stage A: now, hands off

Bird Budgeting keeps running as its own app at its current link. It keeps ICCU imports, Smart Labels, bills with cadences, the Plan page and email imports. Bird Nest does not read or write it.

### Stage B: Phase 6, a money summary

1. The morning task also reads Bird Budgeting's data through Claude's artifact data tool. It is read-only.
2. It sends the gateway a `money_summary`: left to spend per key category (groceries first), bills due before the next payday, overdue bills, and the count of transactions still to label.
3. Bird Nest shows a **Money** tab with that summary. Brass is the only color on that tab.
4. Bills due today become River blocks with steps: "Open ICCU · Pay $ · Mark paid in Budget".
5. The Winco run block shows groceries left to spend at the top.

There is no money entry in Bird Nest at this stage. Edits still happen in Bird Budgeting.

**Check this first in Phase 6.** A scheduled run might not have the artifact data tool. If it doesn't, Anthony runs a "sync money" prompt in a normal Claude session each morning instead. Do not try to call the artifact from the app. Artifacts can't be reached from outside.

### Stage C: later, the fold-in decision

The open question is for Anthony. Bird Budgeting is shared with his wife. Bird Nest is just for him.

- **Option 1.** Keep the budget as its own shared app forever. Bird Nest only shows the summary.
- **Option 2.** Move the budget into Bird Nest as a shared household space. That brings a second login, shared tables and per-table RLS.

If he picks Option 2, port in this order:

1. Transactions and categories.
2. CSV import with dedupe.
3. Smart Labels and the labeler.
4. Bills with cadences.
5. The Plan page.
6. Email and screenshot imports, which move to the scheduled tasks.

Use the same rules as before: port from `legacy/`, verify the counts, and run side by side.

**Money tables for later:** accounts, transactions, transaction\_lines, categories, groups, budgets\_month, recurring\_bills, label\_rules, payee\_memory.
