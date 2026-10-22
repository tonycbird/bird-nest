# Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-10-15 | Hosting: wait for Cloudflare Pages (not Vercel) | Anthony's call. Nothing before the iPhone check needs hosting. |
| 2026-10-15 | Repo lives on Anthony's Mac; he pushes with GitHub Desktop | No GitHub tokens pasted in chat. Night shift will need its own access later. |
| 2026-10-15 | TypeScript 5.9 (not 7) | Stable with the Vite/React tooling; revisit later. |
| 2026-10-15 | Sign-in by 6-digit email code | Magic links open Safari, not the installed app, on iPhone. |
| 2026-10-15 | Fonts bundled with @fontsource (not Google Fonts link) | Must work offline at the gym. |
| 2026-10-15 | Proposals: only the gateway inserts; the app can only change status | "Claude proposes, Anthony approves" enforced in the database, not just the UI. |
| 2026-10-15 | Gateway deployed with verify_jwt = false and its own token check | Scheduled tasks have no user login; the token is the lock. |
| 2026-10-15 | Default time zone America/Los_Angeles | Coeur d'Alene is on Pacific time. Settings can change it. |
| 2026-10-15 | Phone-only until Phase 4 (cloud behind VITE_CLOUD=on) | Anthony asked to skip cloud setup for now. Data lives in IndexedDB; weekly backup nudge. |
| 2026-10-15 | Clearhead logic ported verbatim as JS (`src/head/core/clearhead.js`, allowJs) with a .d.ts | "Port, don't reinvent." Identical behavior, guarded by parity tests from captured outputs. |
| 2026-10-15 | Head rows keep Clearhead's field names (when, tod, due, someday, areaId…) | Clearhead backups import as-is; the ported selectors run unchanged. Sync stamp is `_u` (ms). |
| 2026-10-15 | Area colors stored but not shown; areas show their emoji | Design rule: only brass, teal, violet carry meaning. |
| 2026-10-15 | Head → River: a task becomes one block; checklist = steps (max 7) | Every block has numbered steps. Finishing the block finishes the task; undo undoes both. |
| 2026-10-15 | Plan My Day ends by putting today on the River (default on) | The River is the home screen; Plan My Day is how Head feeds it. |
| 2026-10-15 | Ramble sorts on the phone (Clearhead's splitRamble) | No in-app AI. Claude's sort returns as a Phase 4 proposal. |
| 2026-10-15 | Focus timer counts from an end time | A locked iPhone pauses JS timers; end-time math stays right. |
| 2026-10-15 | No seed areas unless Anthony taps "Start fresh" | Seeding before an import would duplicate his six areas. |
| 2026-10-15 | Drag reorder replaced by ☑ select → ⤒ to the top | Touch drag is fiddly and risky to port in one night; revisit if missed. |
| 2026-10-15 | Body runs the old Bird Fitness code as-is in a same-origin frame (`body.html`) | "Port, don't reinvent." 4,800 lines with exact plate math, PRs, rotation and meal logic; a rewrite risks drift. Parity is checked against the old app. |
| 2026-10-15 | Only edit to the Fitness code: `window.claude` → `window.nest`; links to Nest live in `adapter.legacy.js` | Keeps the no-artifact guard strict and the old code diffable. |
| 2026-10-15 | Fitness data in Nest's `fit` table (old doc shape: `fit/settings`, `logs/2026-10`) | Old backups import as-is; Nest backups include Body; Phase 4 sync gets one more table. localStorage stays as a fast cache. |
| 2026-10-15 | The Body frame stays loaded when you leave the tab | The rest timer keeps running while you tick steps on Today. |
| 2026-10-15 | A gym day is three River blocks: Warm-up, the workout, Cool-down | Matches the old Today flow; each is one thing to do with numbered steps. Lifts past 6 fold into step 7. |
| 2026-10-15 | Logging in Body ticks the River, not the other way (except Warm-up) | A set needs reps and weight; a River tick can't make one up. |
| 2026-10-15 | One grocery list, in Head; Fitness sends to it | Head's list has aisles, stores and the 🌊 shopping block. Spices skipped (pantry). |
| 2026-10-15 | Restoring an older backup leaves tables it doesn't have alone | A Phase 2 backup must not wipe Body data. |
| 2026-10-17 | Updates install on their own (autoUpdate), registered at startup; a blank start repairs stale files once, then shows a rescue screen | iPhone got stuck on a bad cached copy and couldn't tap "Update". Reset app files fixed it; now the app does that itself. |
| 2026-10-17 | Claude's door is a SQL function (`nest_gateway`) called through the REST API, not an Edge Function | One SQL paste instead of deploying a function; the token is checked by hash inside the database. `supabase/functions/claude-gateway` is the old Phase 0 draft, not used. |
| 2026-10-17 | The phone stays the main copy; the cloud gets a copy of every row (`nest_rows`, jsonb) | Simple and safe: Claude reads it, a new phone can restore from it, and nothing on the phone is ever overwritten by the cloud. |
| 2026-10-17 | ✓ is applied on the phone; only Google changes wait for the applier | The phone owns the data. The app marks its own proposals applied; the database guard allows that only for non-Google ones. |
| 2026-10-17 | Sign-in is optional | Nest must work at the gym and can't be locked behind an email code. ☁ Connect is in ⚙. |
| 2026-10-17 | The door key lives in the scheduled tasks; its hash in Supabase (`supabase/local/`, gitignored) | No secrets in git or the client. Rotate: new key, new hash row, update the four tasks. |
| 2026-10-17 | Public Supabase URL + publishable key in `.env.production` (in git) | They're public by design (they ship in the app). Cloudflare builds need them; RLS does the protecting. |
| 2026-10-21 | Sign-in is email + password, not a 6-digit code | Free Supabase won't let the email templates change without custom SMTP, and its default email only has a link (which opens Safari, not the app). "Confirm email" off; sign-ups off after Anthony's account. |
| 2026-10-21 | Design: Structured-style pill timeline + Moleskine-style cards (design G) | Anthony uses Structured and Moleskine Tasks; picked G on the design canvas. |
| 2026-10-21 | Colors follow the sun: Mist (light) by day, Dusk (dark) at night | Anthony likes airy apps; dark keeps 4:45 AM easy on the eyes. Computed on the phone, no network. |
| 2026-10-21 | One color per life area (replaces "only brass, teal, violet") | Colors now mean the area at a glance: pills, circles, week bars all match. |
| 2026-10-21 | Nest draws its own icons; emoji are swapped at render time | Anthony asked for no emoji icons. A JSX runtime swap catches old saved data and Claude's plans too. |
| 2026-10-21 | Less is more: show the minimum, expand on tap | Anthony's standing design rule. Steps hide behind "2/5 ⌄"; details behind Settings → Show details. |
| 2026-10-21 | Font: Plus Jakarta Sans (one family) | Clean, round, reads well at small sizes. Bundled for offline. |
| 2026-10-22 | Bugs are reported from inside the app (Testing mode), not with an admin account | A report captures the screen, taps and errors at the moment it happens; an admin account would only split the data. |
| 2026-10-22 | Reports sync as nest_rows (tbl reports); Claude reads/marks them through `nest_reports()` | Same token, same pattern as the gateway; status comes back down to the phone. |
| 2026-10-22 | Every sheet closes by swipe-down / grab bar (one global handler) | In the installed iPhone app there's no back button; no screen may trap Anthony. |
| 2026-10-22 | Brain dump sorts on the phone into six places, then Anthony confirms | Dump is for emptying your head fast; sorting must be instant and offline, and nothing is saved until he says "Put away". |
| 2026-10-22 | Updates wait for a calm moment (app in background, or a Reload tap) instead of auto-reloading | Auto-update could reload mid-workout or mid-dump. Backgrounding the app, Reload, Check for update and the rescue screen all still pick up a fix, so a stuck screen can still be fixed. |
| 2026-10-22 | A phone's first sync for an account brings the cloud copy down first; Body (`fit`) rows come from the cloud | A new phone starts with Body defaults; pushing them would overwrite the real settings and program. Other tables keep "phone wins". |
| 2026-10-22 | Rows the cloud refuses are set aside (Settings can show them), not retried forever | One bad character used to stop every sync after it. Text is also cleaned (half emoji, NUL) on the way up. |
| 2026-10-22 | Claude's door tries each item on its own (0004) | One bad date from a scheduled task shouldn't throw away the rest of that night's work. |
| 2026-10-22 | Restoring a backup leaves Claude's suggestions alone | They belong to the cloud; old ones could be ✓'d twice. |
| 2026-10-22 | Every sheet also gets a ✕; touch areas grow with invisible rings, not bigger buttons | Swipe-to-close isn't discoverable; bigger hit areas keep the airy look. |
| 2026-10-22 | Muted text darkened in light mode (ink-3 #767D8F, accent text #0F8577, warn text #C05128) | The audit found small labels under 3:1 on Mist. Fills keep the original colors. |
| 2026-10-22 | The brain dump sorts on the phone (no AI call) | Anthony picked phone-only: free, instant, works at the gym with no signal. Rules are tuned on real-style dictation; the review screen is where he fixes the rest. |
| 2026-10-22 | A dump offers new projects (on by default, one switch to skip) | Ranting about a new job is the main use. Steps keep the order they were said in; the first one is the next action. |
| 2026-10-22 | Task titles stay short; the rest of what was said goes in the notes | Less is more on the lists; nothing he said is lost. |
| 2026-10-22 | A Head task with a day and a time shows on that day's River by itself, once | Anthony chose "River + Head" for timed things; Google Calendar is untouched. Removing the block keeps it off. |
| 2026-10-22 | Calendar items on Today are suggestions; hold one to accept it | Most shared-calendar items (sabbaticals, other people's days off) aren't his. Faded and small until held; a timed one becomes a River block, an all-day one a task that day. Deleting it un-accepts. |
| 2026-10-22 | New app icon: a white monoline B on the teal gradient | Anthony passed on four concepts and asked for a B. Same teal as before, so it still reads as Nest. |
