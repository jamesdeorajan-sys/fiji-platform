# Final integration candidates (release review)
- Worker `ceo/p0-release-worker` @ 0b961a4 = eadac79 + ONLY the #238 formatting (13 changed lines in worker.js + money-format test). Suite 118/118.
- Page `ceo/p0-release-site` @ 173be93 = 653a839 + ONLY the #238 formatting + final cache key `app.js?v=20261005-quote-consent-fmt`. Suite 126/126.
- Baselines for rollback: Worker 8c1fa242-bf63-432b-bded-cf6f13b07cbf (2125a34); Pages 8d4a440c (c6d62a6).
- Do NOT deploy e97267b, 0841ac3 or 3499821.
## Browser acceptance on these exact commits (Worker = real dry-run bundle, in-memory DB, outbound blocked)
Mismatch (#237) -> original 142 / revised 300.45 / "Accept revised price and submit", 0 bookings, 0 outbound, 0 escalations; edit after mismatch drops the acceptance (total 135, normal label); stale 409 released after an edit is discarded (0 bookings, normal controls); accept -> 1 booking FJD 300.45, alerts FJD 300.45, decision accepted_revised (original 142); Nadi/Wailoaloa/Momi routes -> 409, 0 bookings; lost reply -> bounded retry 200 idempotent, 1 booking; fareText(127.96000000000001)=127.96 and no artefact on the review. The unchanged-route case was verified on the preceding candidate (653a839) and not re-run on 173be93.
## New tests against the ORIGINAL baselines (expected failures)
Worker 2125a34: quote-consent 3 pass / 4 fail; quote-release 2 pass / 5 fail (pass: same-reference retry and amount agreement already hold); money-format 1 pass / 3 fail. Page c6d62a6: quote-consent 2/5, quote-release 0/11, money-format 1/2.
