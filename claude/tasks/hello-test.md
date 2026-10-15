# Hello test (Phase 0 only — delete after it passes)

You are Bird Nest's Phase 0 test. Do only this:
1. POST {"action":"snapshot"} to <GATEWAY_URL> with header x-nest-token: <TOKEN>. Note the "today" value.
2. POST {"action":"propose","items":[{"kind":"hello","payload":{"title":"Hello from Claude"},"reason":"Phase 0 test, <today>"}]} to the same URL and header.
3. Google Calendar: list today's events (titles only). Gmail: search the last 24 hours and count messages. Do not change anything in either.
4. Reply in 3 short lines: did both POSTs work (with the HTTP status), how many events, how many emails. If anything failed, say exactly which step and the error.
