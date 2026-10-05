# Email follow-up fallback - operations runbook (initial testing)

Status: **prepared, not deployed.** Nothing here has been run against production. Read-only checks are labelled with the date they were made.

## 1. Who owns it
- **Designated owner (policy): James.** He monitors **tourfijitours@gmail.com** and owns email follow-ups during initial testing (recorded 2026-10-06). Stored as `platform_settings.email_followup_owner` (seeded by the migration) and copied onto each request as `designated_owner`.
- **Claimed (fact):** a request is only CLAIMED when someone presses Claim (`assigned_to`). Until then every card, staff alert and escalation says **UNCLAIMED - Owner: James - NOT YET CLAIMED**.
- The inbox is a RECEIVING inbox. The system never sends as that address; every reply is written by a person.

## 2. Staff walkthrough
1. Open **driver.fijidash.com -> admin-email-followups.html** (same login as the other admin pages; linked from the Escalations page). The heading shows "N open · M UNCLAIMED".
2. Each card shows: status; **Saved booking #N** or **ENQUIRY - not a booking**; claim state; time waiting; reference; website; **Reply to** (the guest's address); name and phone; the journey; warnings (reply address differs from the booking email; the staff WhatsApp alert did not send).
3. **Claim** (your name is recorded; the request becomes ACKNOWLEDGED and the guest can no longer change the address on the website).
4. Email the guest from tourfijitours@gmail.com at the Reply-to address, quoting the reference. Saved booking = confirm against that booking. ENQUIRY = nothing exists yet: check availability/price, then create the booking through the normal process. If the reply address differs from the booking email, confirm by phone/WhatsApp before sending booking details.
5. Record **I emailed the guest** (CONTACTED, stays open) and later **Guest confirmed** / **Cannot reach the guest** / **No action needed** (these close it).
6. The Escalations page shows the mirrored line, kept in step with the claim; its Resolve is refused for an open follow-up and points here.

## 3. Operational response - PROPOSAL for James to decide (nothing is approved; no guest-facing promise is published or implied)
Coverage must be defined, not assumed. **24/7 coverage is NOT assumed.**

| Decision for James | Proposed default | Your decision |
|---|---|---|
| Staffed hours (Fiji time) when the queue is watched | e.g. ____ to ____ | |
| Backup owner (named person who covers when James is unavailable) | ____ | |
| Backup cover hours | ____ | |
| After-hours cover | none assumed - requests wait until the next staffed hour | accept / other |

Proposed targets (clock runs only in staffed hours):
- **Staffed hours:** respond to the staff alert promptly; inspect the queue **at least hourly**. **First human email within 1 hour of receipt.**
- **After hours:** no cover assumed; the first-email timer starts at the next staffed hour; the first thing done then is to claim everything UNCLAIMED, oldest first.
- **Urgent - pickup within 24 hours** (visible in the journey on the card): **priority handling and an immediate staff escalation**: phone/WhatsApp the guest on the number on the card at once, tell the backup owner, then record the outcome. If this arrives after hours and nobody is on cover, it waits - which is exactly why the backup/after-hours rows above must be decided before launch.
- **Escalate** any request still UNCLAIMED after 1 staffed hour to the backup owner.
- Review after 2 weeks from the cards' wait times and outcomes.

## 4. FOLLOWUP_SECRET - exact steps and activation behaviour (never put the value in chat, logs, tickets or AGENT_SYNC)
The token that protects a guest's request is HMAC(secret, reference). With no `FOLLOWUP_SECRET` the key is *derived from ADMIN_TOKEN* (works; rotating the admin token would silently invalidate in-flight tokens). With neither: no token, 503 NOT_CONFIGURED, bookings unchanged (tested). Production secret NAMES today (read-only, 2026-10-05): ADMIN_TOKEN, DOC_SIGNING_SECRET, GOOGLE_MAPS_API_KEY, WHATSAPP_PHONE_ID, WHATSAPP_TOKEN - no FOLLOWUP_SECRET.

**Step 0 - preconditions (read-only).** `npx wrangler versions list --name nadi-dispatch-api` and `npx wrangler deployments status --name nadi-dispatch-api`: the newest uploaded version must be the one deployed at 100% (2026-10-06: `7a32a034-e48f-4c67-af70-63b184006350`, created 2026-10-05T03:06:40Z, 100%).
**Step 1 - set the secret** (from `nadi-marketplace/worker`, value generated and piped, never shown):
`$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | ForEach-Object { $_.ToString('x2') }) -join '' | npx wrangler secret put FOLLOWUP_SECRET --name nadi-dispatch-api`
Why this cannot activate the wrong code: `wrangler secret put` (4.147.0) makes one API call (`PUT /workers/scripts/nadi-dispatch-api/secrets`); it bundles and uploads **no code** and does not read the working tree. Cloudflare creates the new version from the **currently deployed** version plus the secret, and the CLI source shows the API **refuses** the call when the latest uploaded version is not the deployed one ("Secret edit failed ... the latest version of your Worker isn't currently deployed"). So an uploaded-but-undeployed candidate can never be activated by this step. (The "new version + deployed at 100%" behaviour is Cloudflare's documented behaviour; it was NOT exercised here.) **Record the new version id (V_s)**: it is the old code + the secret and becomes the rollback target (section 6).
**Step 2 - upload the candidate without activating it**, from a clean checkout at the exact reviewed commit: `git worktree add --detach <fresh-dir> <worker-commit>`; `git -C <fresh-dir> status --porcelain` must print nothing and `git -C <fresh-dir> rev-parse HEAD` must equal the reviewed hash; then `cd <fresh-dir>/nadi-marketplace/worker && npx wrangler versions upload --name nadi-dispatch-api --tag <hash7> --message "email follow-up candidate <hash7>"`. `versions upload` creates a version and does **not** deploy it. It does not touch crons/routes (unchanged by this candidate).
**Step 3 - how the secret is retained:** in wrangler 4.147.0 both `versions upload` and `deploy` send `keep_bindings: ["secret_text","secret_key"]` (source: `uploadWorkerVersion` / `deployWorker`, `keepSecrets: true`), and `wrangler.toml` has no `[vars]`, so FOLLOWUP_SECRET and every existing secret are carried onto the candidate version. Verify before activating: `npx wrangler versions view <candidate-id> --name nadi-dispatch-api` must list FOLLOWUP_SECRET (name only) next to ADMIN_TOKEN, WHATSAPP_TOKEN, etc.
**Step 4 - activate explicitly by id:** `npx wrangler versions deploy <candidate-id>@100 --name nadi-dispatch-api` (never an unqualified deploy, never from a dirty tree). Then verify with `deployments status`.

## 5. Release sequence (not requested) with verification between stages
0. Drift check: Worker `7a32a034`, NAT `e43dc900`, FijiDash `6346db54`; served assets vs bases; read-only queue counts.
1. Migration `milestone38-email-followups.sql` (additive). Verify table + 3 indexes + 2 settings; bookings/escalations counts unchanged.
1b. FOLLOWUP_SECRET (section 4 steps 0-1); record V_s.
2. Worker (section 4 steps 2-4). Verify: token only on booking responses; `/email-followup` no token -> 403; `/admin/email-followups` 401 without auth, 200 with; existing endpoints unchanged.
3. Staff page (section 7). Verify login + empty queue at driver.fijidash.com BEFORE the guest pages.
4. NAT, then 5. FijiDash. Verify served assets, result screens, WhatsApp wording and fares unchanged.
No live test booking or guest message is part of verification.

## 6. Rollback - application rollback is the DEFAULT and preserves all follow-up data
Order (reverse of release): FijiDash page -> NAT page -> staff page -> Worker. Targets: FijiDash `6346db54`, NAT `e43dc900`, staff page = production branch tip `20c0f648e...` (see section 7), Worker = **V_s** (previous code + FOLLOWUP_SECRET; if V_s was not created, `7a32a034`).
- **The migration is NOT rolled back.** The table, its rows and the two settings stay. Verified (test, previous production Worker `0b961a4` materialised from git, run against the migrated schema with real follow-up rows): old code creates/replays bookings, lists and resolves escalations, has no email routes (404), and never touches the rows or settings.
- **If the Worker is rolled back to old code,** a deployed secret is harmless (ignored). Prefer V_s so a later re-deploy of the candidate keeps the same key (a new version created from a version lacking the secret would fall back to the derived key and silently invalidate tokens).
- **How James reaches outstanding requests after any revert:**
  1. The mirrored lines are on the existing **Escalations page** (full text: reference, reply address, journey, guest). Caveat: old code's Resolve will close that line without touching the follow-up, and claim/outcome state is no longer shown.
  2. Read-only SQL (no `--file`; SELECT only): `npx wrangler d1 execute nadi-marketplace-db --remote --command "SELECT id, client_ref, requested_email, guest_name, guest_phone, origin_site, journey_summary, status, designated_owner, assigned_to, created_at FROM email_followups WHERE status != 'CLOSED' ORDER BY created_at"` (the same query is asserted in the tests). The Cloudflare dashboard D1 console runs the same SELECT.
- **Destructive removal is separate and manual:** `nadi-marketplace/manual-only/DESTRUCTIVE-milestone38-drop-email-followups.sql.txt` - outside `migrations/`, `.txt` suffix, begins with a deliberate syntax-error guard line, never referenced by any rollback step; to be used only if James explicitly decides to delete the data, after exporting it with the SELECT above. (Tested: refuses to run as shipped; after the guard is removed it drops only the table and two settings.)

## 7. Staff page deployment (actual Pages configuration, read via the Cloudflare API on 2026-10-06; no values changed)
Project `nadi-marketplace-staging` (driver.fijidash.com, driver.vakaviti.ai): GitHub-connected to `jamesdeorajan-sys/fiji-platform`; **production branch `nadi-marketplace-phase1-staging`**; build command empty; output directory `nadi-marketplace/staging-site`; preview deployments enabled for ALL branches (`*`, no excludes). Current production deployment `f696d602-2697-4412-9a33-c8dca2038688`, commit `20c0f648e7b3f4b1f681b9e51e91879c8a5ba586` (2026-08-09), equal to the production branch tip.
- **The already-pushed branches DID trigger deployments - preview only.** Every push (feature branches and `main`, including the AGENT_SYNC commits) created a *preview* deployment of this project (3 of the candidate pushes built successfully because those branches contain `nadi-marketplace/staging-site`; the NAT branch and `main` failed to build because the directory is missing). No production deployment was created by any push; `driver.fijidash.com` is unchanged. Preview URLs are reachable but contain only the static pages (the admin API still needs the admin token).
- **Releasing the page WITHOUT unrelated changes:** the production branch has diverged from `main`/the Worker branch (its `staging-site/admin-bookings.html` differs), so pushing/merging the Worker branch would also change admin-bookings.html. Therefore a dedicated branch was prepared from the production tip: `ceo/email-followup-staff-page` @ `719b5da8637bd22be73340f753e69c467ef2b205` = `20c0f64` + exactly two files (`admin-email-followups.html` new, `admin-escalations.html` +1 line); `git diff --stat 20c0f64 719b5da` shows only those two files and the branch is a fast-forward of the production branch. **Release = fast-forward `nadi-marketplace-phase1-staging` to `719b5da`** (a push to the production branch; needs James's explicit approval; the Pages build copies `nadi-marketplace/staging-site` as-is). Verify the deployment id, commit, and that only those two files differ from the previous deployment. Rollback: push/redeploy the previous production commit `20c0f64` (or redeploy `f696d602` from the dashboard).

## 8. Known gap: FijiDash negotiated-fare result has no email option - see the review package section 5 (acceptance of this exception is PENDING James's decision).
