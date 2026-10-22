# The door (shared by every Bird Nest task)

Every call is one POST. Use exactly this shape (curl is fine):

```
curl -s -X POST "<SUPABASE_URL>/rest/v1/rpc/nest_gateway" \
  -H "apikey: <ANON_KEY>" -H "Content-Type: application/json" \
  -d '{"token":"<TOKEN>","action":"ACTION","args":{...}}'
```

The reply is JSON with `"ok": true`. If `ok` is false, or the call fails, stop and say why in one line. Never guess app data.

Actions:
- `snapshot` (args `{}`): today, tomorrow, tz, blocks (with steps), open tasks, areas, projects, `body` (the next 7 days of workouts and stretch, already worked out by the app, plus `missed`), `prefs` (gym_days 0=Sun, gym_time, plan_time), calendar, pending proposals, `decided_today`.
- `propose` (args `{"items":[...]}`): each item `{"kind","payload","reason","dedupe_key","day"}`. Same kind + dedupe_key on the same day is skipped, so a ✕ never comes back that day.
- `cache_calendar` (args `{"from","to","events":[{"google_id","day","start","end","title","all_day"}]}`): replaces the cached events for those days. Times are HH:MM local.
- `add_mail` (args `{"items":[{"received","from","subject","ask","due","link"}]}`): a summary line and a link only. Never a body.
- `approved` (args `{}`): approved proposals that need Google.
- `mark` (args `{"items":[{"id","status":"applied|failed","note"}]}`).

Proposal payloads the app understands:
- `day_plan`: `{"sentence","blocks":[{"start":"HH:MM","end":"HH:MM","kind":"body|head|life","icon","title","steps":[{"label","value"}],"source_type":"task|workout","source_id"}]}`. For a workout part use `source_type:"workout"` and `source_id:"YYYY-MM-DD|warm|main|cool"`. For a task use its id.
  `icon` is a Nest icon name: lift, warmup, stretch, timer, meal, sleep, morning, study, church, head, doc, job, briefcase, laptop, mail, call, person, home, groceries, drive, place, bill, coin, heart. (An old emoji still works; the app swaps it.)
- `task`: `{"title","notes","when","due","est","area","link"}`.
- `calendar_book`: `{"title","day","start","end","notes"}` (needs Google; the applier does it).
- `rollover`: `{"to":"YYYY-MM-DD","move":[task ids],"someday":[task ids]}`.
- `recap`: `{"lines":["…","…","…"]}`.
- `makeup`: `{"missed":"YYYY-MM-DD"}` (the app uses the old Fitness makeup rules).
- `grocery`: `{"items":[{"name","amt"}]}`.
- `weekly_review`: `{"prompts":["…"],"start":"HH:MM"}`.

Style rules for anything Anthony reads: steps are 6 words or fewer, 2 to 7 steps a block. Symbols first. Warm, no guilt, no streak talk. One win first.

## Testing mode reports (Anthony's ⚑ flag)
Reports live in `nest_rows` (tbl `reports`) and come through their own door, `nest_reports(token, action, args)`
(migration 0003): `list` (args `{"status":"open|fixed|later|all","full":true}`) and `mark` (args `{"items":[{"id","status":"fixed|later|open","note"}]}`).
In a coding session: `node claude/tools/reports.mjs list`, `pull <dir>` (saves the screen HTML + photo to redraw), `mark <id> fixed "what changed"`.
The note shows on Anthony's phone under the report.
