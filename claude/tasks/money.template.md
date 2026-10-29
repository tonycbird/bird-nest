# Money sync · daily, right after the morning plan (or say "sync money" in any Claude chat)

You are Bird Nest's money reader for Anthony. Bird Budgeting is READ-ONLY here: never set, update, str_replace, delete or batch.
Work in /tmp/nest-money. Only the summary leaves this run: never send transactions, payees or amounts per transaction anywhere.

1. Today's month, Pacific time: `TZ=America/Los_Angeles date +%Y-%m` → MONTH (e.g. 2026-10). Start clean: `rm -rf /tmp/nest-money && mkdir -p /tmp/nest-money`.
2. With the ArtifactData tool (if it's listed as deferred, load it with ToolSearch first), url `https://claude.ai/code/artifact/edb46b38-b8d7-4236-838f-5f9ad2f1f7cd`, out_dir `/tmp/nest-money` on every call:
   - `list` collection `recurring`, query `{"limit": 500}`
   - `list` collection `categories`, query `{"limit": 500}`
   - `list` collection `groups`, query `{"limit": 100}`
   - `get` collection `budgets`, doc_id MONTH
   - `query` collection `transactions`, query `{"where": [["month", "==", MONTH]], "limit": 1000}` (if a next_cursor comes back, repeat with it)
   - `query` collection `billMarks`, query `{"where": [["month", "==", MONTH]], "limit": 500}`
   If no ArtifactData tool can be loaded in this run, stop and reply one line: "Money: no ArtifactData tool in this run."
3. Write the script exactly as below, then check it. If the check fails, stop and say so.
```
cat > /tmp/nest-money.mjs <<'NESTMONEY'
@@SCRIPT@@
NESTMONEY
echo "@@SHA@@  /tmp/nest-money.mjs" | sha256sum -c -
```
4. `node /tmp/nest-money.mjs /tmp/nest-money > /tmp/nest-money.json` and make sure it printed one JSON object.
5. Send it (one POST):
```
python3 - <<'PY'
import json, urllib.request
s = json.load(open('/tmp/nest-money.json'))
body = json.dumps({"token": "<TOKEN>", "action": "put", "args": {"summary": s}}).encode()
req = urllib.request.Request("<SUPABASE_URL>/rest/v1/rpc/nest_money", data=body, method="POST",
      headers={"apikey": "<ANON_KEY>", "Content-Type": "application/json"})
print(urllib.request.urlopen(req).read().decode())
PY
```
   The reply must have `"ok": true`. If not, stop and say why in one line.
6. Reply in 2 short lines: groceries left and the next payday; anything odd (e.g. bank copy older than 5 days).
