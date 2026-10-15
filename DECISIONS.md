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
