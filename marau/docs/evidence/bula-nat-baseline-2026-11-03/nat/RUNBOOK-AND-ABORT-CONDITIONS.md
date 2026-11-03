# NAT controlled deployment — RUNBOOK (do NOT execute without the explicit CEO deployment approval)
Run from a checkout of the PRIVATE NAT repository on the CEO's computer (a Claude Code session there can run these). Secrets are typed/pasted by the CEO, never printed, never committed. Nothing here connects Bula.

## Sequence (stop at the first failed check)
**A. Preserve** — baseline and candidate are pushed to the private repository and the tags exist (`git ls-remote --tags <repo>` shows `nat-prod-baseline-04203dd3` and `nat-source-discovery-candidate-ae00bd7c`). Not started until this is true.
**B. Verify production unchanged** — (1) fetch the live worker.js (Cloudflare read-only API) and confirm sha256 `04203dd3…`; (2) `git checkout nat-prod-baseline-04203dd3`, `npx wrangler@4.156.2 deploy --dry-run --outdir /tmp/b` ⇒ `04203dd3…`; (3) `git checkout nat-source-discovery-candidate-ae00bd7c`, same dry-run ⇒ `ae00bd7c…`; (4) `npx wrangler@4.156.2 deployments list` — record the current version id; (5) `node nat_smoke.mjs capture pre` (GET/OPTIONS only); (6) record read-only D1 counts (`SELECT COUNT(*), MAX(id) FROM bookings` and COUNT of booking_events, rental_enquiries, rental_enquiry_events, admin_notification_state) and the secret NAMES list (`wrangler secret list`, must NOT contain SOURCE_READ_TOKEN). If any value differs from the baseline record: STOP.
**C. Deploy** — `npx wrangler@4.156.2 deploy` from the candidate tag with **SOURCE_READ_TOKEN absent**. Confirm the reported bundle is the candidate (version id changes; recorded).
**D. Existing routes + rentals** — `node nat_smoke.mjs capture post` then `node nat_smoke.mjs compare smoke-pre.json smoke-post.json` ⇒ must print "all existing-route probes identical". Also open https://nadiairporttransfers.com/ booking page and the rentals enquiry page (view only) and check the admin dashboard loads.
**E. New routes fail closed** — `ADMIN_TOKEN=<master, typed once, not printed> node nat_smoke.mjs closed` ⇒ six `OK 401` lines (no token / junk / master on both routes).
**F. Set the dedicated token** — generate 48+ random bytes (e.g. `openssl rand -base64 48`), then `npx wrangler@4.156.2 secret put SOURCE_READ_TOKEN` (paste; this creates a new Worker version automatically). Store it only in the password manager and, later, as Bula's `NADI_SOURCE_ADMIN_TOKEN` (NOT now).
**G. Controlled read-only verification** — `SOURCE_READ_TOKEN=<token> node nat_smoke.mjs source` ⇒ all OK. (This reads ONE real booking server-side to check field names; the tool prints names/counts only, never values.) Re-run `closed` ⇒ still 401 for no/junk/master token.
**H. Re-run smoke** — `capture post2` + `compare smoke-pre.json smoke-post2.json`; repeat the D1 counts: **no change attributable to the deployment** (only organic customer rows, cross-checked against the request log); confirm no outbound notification/WhatsApp was triggered during the window (Workers logs + the existing monitor).
**I. Stop.** Do not configure Bula. Record version ids, hashes, and outputs in the evidence file.

## Automatic ABORT / ROLLBACK conditions (any one ⇒ FAST KILL immediately, then FULL ROLLBACK if it is not the new routes alone)
| Condition | How detected | Action |
|---|---|---|
| Existing NAT route regression | `compare` shows any DIFF; any existing GET/OPTIONS probe status or body hash changes | FULL ROLLBACK |
| Rentals regression | rentals probes (`/admin/rentals`, `/admin/rentals-console`, `OPTIONS /rental-enquiries`) differ; rentals page fails to load | FULL ROLLBACK |
| Unexpected write | any bookings / booking_events / rental_* / admin_notification_state row change not explained by a real customer request in the same window | KILL + FULL ROLLBACK + investigate |
| Unexpected notification | any WhatsApp/email/admin alert sent during the verification window that no customer action explains | KILL + FULL ROLLBACK |
| Authentication leakage | `closed` or any request returns anything but 401 for no/junk/master/login token; any 200 on a source route without the dedicated token | KILL immediately (delete secret), FULL ROLLBACK |
| Database error increase | D1 error rate above the trailing-24h baseline for 5 minutes, or any D1 error on a source route | KILL; rollback if it persists |
| Worker exception increase | exceptions > 2× trailing-24h 15-minute mean, or ≥ 5 in 15 min | FULL ROLLBACK |
| Latency affecting booking flow | `POST /bookings` or `/quote` p95 > 2× trailing-24h p95 for 10 minutes | KILL, then FULL ROLLBACK if not restored |
| Any smoke step cannot be completed or is ambiguous | operator judgement | STOP; FAST KILL; ask the CEO |

## Rate / load note
Bula would poll every cron tick (≤ 4 discovery calls of ≤ 50 rows + one read per NEW booking). Discovery is a primary-key range read; negligible against current volume (see the production bookings table: a few hundred KB).
