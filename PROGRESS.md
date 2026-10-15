# Progress

## Now: Phase 2 — Head (Clearhead port) · code done, waiting on Anthony's phone check

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
- [ ] Import counts match — needs Anthony's real export on the phone
- [x] Quick Add gives the same result as the old app on 20+ sample lines (26, automated)

---

## Phase 1 — Shell + River · done (pending phone check)
- [x] Today River: blocks + steps, auto-complete, Next line, step player, block menu, edit sheet, sample day, copy day
- [x] Quiet mode + ⓘ, backup/restore, River trash, undo on everything
- [x] Afternoon times marked "p"; tab bar above River icons

## Phase 0 — Spike · part 1 done
- [x] Skeleton, PWA, tokens, icons, 6-digit-code sign-in (off until Phase 4), gateway, migration 0001 (run in Supabase), legacy copies
- [ ] Cloudflare deploy → iPhone install check
- [ ] Hello test scheduled task (Phase 4)
