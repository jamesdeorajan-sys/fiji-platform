# Browser acceptance of the release candidates (isolated; nothing real was written)
Candidate page `ceo/p0-quote-consent-site` @ 653a839 + Worker `ceo/p0-quote-consent-worker` @ eadac79 (real `wrangler deploy --dry-run` bundle, in-memory DB, every outbound call recorded and blocked). Chromium (in-app browser); the page's fetch/XHR/beacon/open are guarded so only the local server is reachable; programmatic clicks (pointer coordinates were unreliable in the pane).
| Case | Result |
|---|---|
| #237 exact itinerary | page 142 (158 - 16) -> 409 PRICE_MISMATCH, 0 bookings, 0 outbound, 0 escalations -> review shows "Original total shown: FJ$142 / Revised total: FJ$300.45", button "Accept revised price and submit" |
| Edit after mismatch (child seat off) | notice and acceptance dropped, button back to normal, total 135; seat back on -> 142 (old 300.45 not reused) |
| RACE (Codex): edit while the request is pending, then release the old 409 | override null, no notice, button normal, 0 bookings, 0 outbound (red without bd295c1) |
| Accept | 201, 1 booking FJD 300.45, "Fare saved: FJD 300.45", both alerts FJD 300.45, decision accepted_revised 300.45/300.45 original 142 |
| Affected routes | Nadi sedan one-way 19 -> 30.15; Wailoaloa sedan return 67 -> 50.17; Momi minibus one-way 71 -> 157.92: each 409, 0 bookings, 0 outbound |
| Unchanged route (Denarau sedan 49) | 201 first try, no notice, alerts FJD 49 |
| Lost reply after acceptance | Worker created the booking (201), reply lost, page's own bounded retry got 200 idempotent: 1 booking, same ref, success shown |
Not browser-tested: a manual retry after BOTH attempts are lost (unit-tested), FijiDash, old cached tabs.
