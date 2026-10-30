# The door (shared by every Bird Nest task)

Every call is one POST. Use exactly this shape (curl is fine):

```
curl -s -X POST "<SUPABASE_URL>/rest/v1/rpc/nest_gateway" \
  -H "apikey: <ANON_KEY>" -H "Content-Type: application/json" \
  -d '{"token":"<TOKEN>","action":"ACTION","args":{...}}'
```

The reply is JSON with `"ok": true`. If `ok` is false, or the call fails, stop and say why in one line. Never guess app data.
An item the database can't read (a bad date, a bad id) is skipped on its own and counted in `skipped`; the rest still go in. If `skipped` is more than you expected, say so in one line.

Actions:
- `snapshot` (args `{}`): today, tomorrow, tz, blocks (with steps), open tasks, areas, projects, `body` (the next 7 days of workouts and stretch, already worked out by the app, plus `missed`), `prefs` (gym_days 0=Sun, gym_time, plan_time), calendar, pending proposals, `decided_today`.
- `propose` (args `{"items":[...]}`): each item `{"kind","payload","reason","dedupe_key","day"}`. Same kind + dedupe_key on the same day is skipped, so a ✕ never comes back that day.
- `cache_calendar` (args `{"from","to","events":[{"google_id","day","start","end","title","all_day","calendar"}]}`): replaces the cached events for those days. Times are HH:MM local. `calendar` is the name of the calendar the event is on.
- `add_mail` (args `{"items":[{"received","from","subject","ask","due","link"}]}`): a summary line and a link only. Never a body.

Proposal payloads the app understands (Nest applies these two by itself; anything else is set aside):
- `task`: `{"title","notes","when","due","est","area","link"}`. It lands in his Head Inbox.
- `grocery`: `{"items":[{"name","amt"}]}`. It goes on his grocery list.

Style rules for anything Anthony reads: steps are 6 words or fewer, 2 to 7 steps a block. Symbols first. Warm, no guilt, no streak talk. One win first.

## Testing mode reports (Anthony's ⚑ flag)
Reports live in `nest_rows` (tbl `reports`) and come through their own door, `nest_reports(token, action, args)`
(migration 0003): `list` (args `{"status":"open|fixed|later|all","full":true}`) and `mark` (args `{"items":[{"id","status":"fixed|later|open","note"}]}`).
In a coding session: `node claude/tools/reports.mjs list`, `pull <dir>` (saves the screen HTML + photo to redraw), `mark <id> fixed "what changed"`.
The note shows on Anthony's phone under the report.

## Money (Phase 6)
The money summary has its own narrow door, `nest_money(token, action, args)` (migration 0005): `put` (args `{"summary": {...}}` from claude/tools/money.mjs) and `get`.
The full steps are in `claude/tasks/money.md` (built from money.template.md; the morning prompt's `<MONEY>` is that file with the door filled in).

