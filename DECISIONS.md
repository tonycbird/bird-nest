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
