# Progress

## Now: Phase 0 — Spike (part 1 done, waiting on Anthony)

### Done
- [x] Repo skeleton: Vite + React + TypeScript, PWA (manifest, icons, service worker with "New version ↻" prompt)
- [x] Design tokens copied from the concept page (brass / teal / violet, Fraunces + Archivo, light + dark)
- [x] Sign-in with a 6-digit email code (not a magic link)
- [x] Four tabs: Today · Head · Body · ✓ Approve, plus ⚙ Settings (version, update, sign out)
- [x] ✓ Approve reads proposals, works offline from a local copy, Undo for 10 s
- [x] Supabase migration `0001_phase0.sql`: settings + proposals with RLS; the app can only change status
- [x] `claude-gateway` Edge Function: snapshot + propose, token-checked
- [x] `legacy/clearhead.html` and `legacy/fitness.html` saved
- [x] Tests: dayKey (11:30 PM, midnight, both DST nights); CI checks for artifact APIs and secrets

### Waiting on Anthony
1. Supabase setup steps (Claude will walk through them)
2. Cloudflare account → deploy → iPhone install check
3. Approve the "hello" test scheduled task

### Phase 0 done-check
- [ ] Icon on the iPhone home screen opens full screen
- [ ] Opens in airplane mode
- [ ] Sign-in works inside the installed app
- [ ] Test task's "hello" shows up (scheduled task can reach Supabase)
- [ ] Test task can list Calendar events and search Gmail
- [ ] Test scheduled run can push a branch to bird-nest (needed for night shift)
