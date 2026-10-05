# Email follow-up fallback - operations runbook (initial testing)

Status: **prepared, not deployed.** Nothing here has been run against production.

## 1. Who owns it
- **Designated owner (policy): James.** He monitors **tourfijitours@gmail.com** and owns email follow-ups during initial testing (recorded 2026-10-06). Stored as `platform_settings.email_followup_owner` (seeded by the migration; change it with a normal settings update) and copied onto each request as `designated_owner`.
- **Claimed (fact):** a request is only CLAIMED when someone presses Claim (`assigned_to` set). Until then every card, staff alert and escalation text says **UNCLAIMED - Owner: James - NOT YET CLAIMED**. The designated owner is never presented as proof that anyone has picked it up.
- The inbox is a RECEIVING inbox. This system never sends as that address; every reply is written by a person.

## 2. Staff walkthrough (what James does)
1. Open **driver.fijidash.com -> admin-email-followups.html** (same login as the other admin pages; also linked from the Escalations page). The sub-heading shows "N open · M UNCLAIMED".
2. Each card shows: status, **Saved booking #N** or **ENQUIRY - not a booking**, claim state, how long it has waited, reference, website (nadiairporttransfers.com / book.fijidash.com), **Reply to** (the guest's address), name and phone, the journey, and warnings (reply address differs from the booking email; staff WhatsApp alert did not send).
3. Press **Claim** (your name is recorded). The request becomes ACKNOWLEDGED and the guest can no longer change the address from the website.
4. Write to the guest from tourfijitours@gmail.com at the **Reply to** address, quoting the reference. For a **Saved booking** you are confirming against that booking; for an **ENQUIRY** nothing exists yet - treat it as a new request (check availability/price, then create the booking through the normal process). If the reply address differs from the booking email, confirm with the guest by phone/WhatsApp before sending booking details.
5. Choose **I emailed the guest** (status CONTACTED; stays open until the guest answers), then later **Guest confirmed by email**, **Cannot reach the guest**, or **No action needed** (these close it). Add a short note if useful.
6. The Escalations page still lists the mirrored line ("EMAIL FOLLOW-UP REQUIRED ..."), kept in step with the claim. Its Resolve button is refused for an open follow-up and tells you to use the follow-up page.
7. If the staff WhatsApp alert never arrived, nothing is lost: open the follow-up page (bookmark it). Check it at the times in section 3.

## 3. Proposed INTERNAL follow-up target and escalation (for James to review - NOT approved, NOT guest-facing)
No response-time promise is published on either website and none is approved. Proposal for the testing period only:
- **Check the queue** at least twice a day (start and end of the Fiji working day) and whenever a staff WhatsApp alert arrives.
- **Claim target:** within 4 working hours of the request; requests arriving after hours are claimed by 09:00 the next Fiji morning.
- **First email within 1 hour of claiming.**
- **Escalate** (call or WhatsApp the guest on the phone number on the card) if: still UNCLAIMED after 4 working hours; any request whose pickup is within 24 hours; or no guest reply 24 hours after "I emailed the guest" and pickup is near. Record the result as the contact outcome.
- Review the targets after the first 2 weeks using the card's wait times and outcomes.

## 4. FOLLOWUP_SECRET (do not put the value anywhere in chat, logs, tickets or AGENT_SYNC)
Why: the token that protects a guest's request is HMAC(secret, reference). Today production has `ADMIN_TOKEN` but no `FOLLOWUP_SECRET`, so without it the key is *derived from ADMIN_TOKEN* (works, but rotating the admin token would silently invalidate guests' in-flight follow-ups). A dedicated secret is recommended.
- **Behaviour matrix (tested):** `FOLLOWUP_SECRET` set -> used. Only `ADMIN_TOKEN` -> derived key. Neither -> no token is issued, `POST /email-followup` answers 503 NOT_CONFIGURED, bookings behave exactly as before. Tokens issued under one key are rejected under another (set the secret BEFORE the pages go live; changing/rotating it later makes guests mid-request see "could not record - use WhatsApp").
- **Set it without ever displaying it** (PowerShell, from `nadi-marketplace/worker`; value is generated and piped straight to Cloudflare):
  `$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | ForEach-Object { $_.ToString('x2') }) -join '' | npx wrangler secret put FOLLOWUP_SECRET --name nadi-dispatch-api`
  (use `env -u CLOUDFLARE_API_TOKEN` as with other wrangler commands here). Verify the NAME exists (never the value): `npx wrangler secret list --name nadi-dispatch-api`.
- Setting a secret creates a new Worker version: do it as step 1b of the release (after the migration, before/with the Worker), and record the version id. It is not part of this preparation; nothing was changed.

## 5. Release sequence with verification between stages (not requested yet)
0. Drift check: Worker `7a32a034`, NAT `e43dc900`, FijiDash `6346db54`, served assets vs bases; read-only queue counts.
1. **Migration** `milestone38-email-followups.sql` (`wrangler d1 execute ... --file`, additive). Verify: table + 3 indexes exist, settings rows present, row counts of bookings/escalations unchanged. Rollback: `migrations/rollback/milestone38-rollback.sql`.
1b. `FOLLOWUP_SECRET` (section 4). Verify the secret NAME is listed.
2. **Worker** (this branch). Verify: version id; POST /bookings response gains `followup_token` only (synthetic ref, blocked-outbound environment preferred); `/email-followup` without token -> 403; `/admin/email-followups` without auth -> 401, with auth -> 200 empty; existing endpoints unchanged. Rollback: previous Worker `7a32a034` (the table is simply unused).
3. **NAT** page. Verify served assets/cache key, result screens, the option present, WhatsApp wording and fares unchanged. Rollback: `e43dc900`.
4. **FijiDash** page. Same verification. Rollback: `6346db54`.
5. **Staff page**: `admin-email-followups.html` ships with the staging-site (admin) Pages project; verify login and an empty queue BEFORE the guest pages go live.
Each stage needs James's approval; no live test booking or guest message is part of verification (use blocked/synthetic paths).

## 6. Known gap: FijiDash negotiated-fare result has no email option
See the review package section 5. Recommendation: **does not block** this release.
