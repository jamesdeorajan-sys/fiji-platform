# Marau - hosted staff-console acceptance: operator handoff

**Baseline RC3 is preserved** (code `a7b8d3c`, hosted Worker `615f1da8-2cc1-4f8d-91ab-ca66e5ba2bbf`, untouched). **This acceptance is for the successor RC4** (code `7df9958`, hosted Worker `1ae9a441-3a2d-4000-bc03-1e5627c1ba9b`), which adds the uncertain-return workflow as a pilot requirement. This is a *human-operated* check: the author does not type credentials into the hosted page. Synthetic data only; nothing is sent to anyone; rewards stay OFF. Takes about 15 minutes.

**Hosted staff console (RC4):** https://marau-stage1-preview-rc4.helpronline.workers.dev/staff
(Guest links and the Trip page live on the same host. Isolated preview: its own Worker, sharing the preview D1 `marau-stage1-legs-db` with RC3 (no migration was needed). Not production, not RC1.)

> **FIXTURE STATUS - read first.** The staff identities, guests and records below are **planned fixtures**. They do not exist for you until the seed script has **created AND verified them on the host you will use** (it prints `VERIFIED ...` lines and writes `fixtures_verified: true` to the private file). **Records seeded on a local demo server or in the test suite are NOT hosted fixtures** and must not be described as hosted-ready. Evidence so far: the script's own verification passed once on a throwaway proof run on the RC4 preview (all 9 checks), after which that run's guests were revoked and its two staff identities deleted (0 rows remain). **No operator fixtures currently exist on the hosted preview.** Seed them at handoff time.

## A. Before the operator starts (engineer, ~5 min)
1. Pick the operator. They need **two** secrets, delivered separately (section B): the **shared admin token** and **their own staff token**.
2. Seed individual credentials and synthetic guests (reads the admin token from an environment variable; writes every secret to a private file *outside the repository*; prints none of them):
   `ADMIN_TOKEN=<preview admin token> node scripts/staff_acceptance_credentials.mjs seed https://marau-stage1-preview-rc4.helpronline.workers.dev <private file path>`
   This creates **two named staff identities** ("Acceptance Operator A (run id)" = preparer, "Acceptance Operator B (run id)" = reviewer) and three synthetic guests**: `recipient_with_consent` (consent granted, WhatsApp available), `recipient_without_consent` (no consent, no WhatsApp, so it appears in Needs attention) and `uncertain_return` (a synthetic round trip whose source says *completed* while the return is still ahead). The script then **verifies on that host** that both staff tokens work, rewards policy is OFF, every guest link works and both Needs-attention items are present. If any line says `FAILED`, do not hand the fixtures over. Each of the two staff identities has its own random token.
3. Give Operator A the file's `staff[0].token`, and the second person (or the same person, signing in a second time) `staff[1].token`. Give the guest link `recipient_with_consent` to whoever will do step 5 (a phone or a private window).

## B. Safe private credential delivery
- Deliver the **admin token** and each **staff token** through a password manager share or in person, **in two different channels** (e.g. vault for the admin token, a voice/in-person read-out or a second vault item for the staff token). Never email, chat, ticket, commit, screenshot or screen-share them.
- The sign-in fields are password fields. Do not screenshot the sign-in view; screenshots of later panels are fine (they contain no secrets).
- The private file is `0600`, outside the repo, and is deleted at cleanup.
- Guest links contain a guest access token: treat them the same way (private chat to James/operator only).

## C. Synthetic records to use
| Use | Value |
|---|---|
| Supplier | `Synthetic Reef Tours (acceptance)` - fulfilment owner = your staff name |
| Offer | `Synthetic snorkel (acceptance)`: capacity 20, price 120, supplier cost 80, starts in ~6 days, book-by ~5 days, expires after book-by |
| Edition | Fiji date at least 2 days ahead, slot `morning`, containing that offer |
| Recipient | guest link `recipient_with_consent` (consent granted); `recipient_without_consent` should NOT appear as eligible |
| Uncertain return | guest link `uncertain_return` (return Mon-ish, 10:30 AM Fiji time, Sofitel Denarau lobby -> Nadi Airport); source status `completed` |
| Prefix | anything you type is labelled "(acceptance)" so it is easy to find and ignore |

## D. The eight steps and expected results (rewards stay OFF throughout)
| # | Who | Do | Expected |
|---|---|---|---|
| 1 | Operator A | Open `/staff`. Enter the admin token and **your own** staff token. Press **Sign in**. | Panels load: Needs attention, Offer requests, Reward credits, Report, Suppliers, Offers, Editions, Deals pilot. **Reward credits shows none; Reward policy mode is Off.** A wrong staff token is refused, not silently accepted. |
| 2 | A | Suppliers: create the supplier, then **Verify**. Offers: **Create draft**, then **Publish**. | An unverified supplier's offer cannot be published; after Verify it can. Everything is attributed to your staff name. |
| 3 | A, then B | Editions: **Save draft edition** with the offer, then **Publish**. Deals pilot: look at the edition **before** any review and press **Prepare recipient list**. | Prepare is **refused** (the edition has not been reviewed). The review lists the eligible recipient(s) and the live offer availability and states **nothing was sent**; `recipient_without_consent` is not eligible. Now **B** signs in with B's staff token and presses **Approve for manual send**; then **A** presses **Prepare recipient list**: recipient rows appear as *prepared*. |
| 4 | A | On the prepared recipient press **Check and copy message**. | A box offers the message text to copy. The text has **no link, phone number or email**. The page says nothing has been sent and that the app cannot stop a message sent outside it. |
| 5 | Guest (phone) + A | On the `recipient_with_consent` Trip, open contact preferences and **untick** the deals checkbox. Back in the console refresh and press **Check and copy message** again. | The check is **refused**: no marketing consent. The row shows a **stale** note ("prepare again"). No message text is handed out. |
| 6 | A | On that row press **I sent it** (pretend you had already sent before seeing the change). | It is **recorded, not refused or hidden**, and labelled **sent contrary to eligibility** with the reason. It is different from *Not sent*. |
| 7 | A | **Needs attention**: the `recipient_without_consent` guest (no WhatsApp, no owner) is listed; type your staff name in its owner box and **Assign owner**; then press **Sign out**. As the guest, try to open the staff console data (not possible: the guest page has no staff panels). Reload `/staff`. | The guest is listed with the flag *no whatsapp and no named owner*; after assigning, the owner shows as your staff name. After sign-out the console shows the sign-in again and no staff data. The guest Trip page contains no staff names, evidence or operator figures. |

Record: date, who, browser, and any step that differed. Take screenshots of panels only.

| 8 | A (+ engineer for 8c) | **Needs attention** also lists the `uncertain_return` guest with a *return status needs verification* pill. Read the facts shown (the source says completed; the return date and time in Fiji time; pickup location; destination). (a) Press **Verify: still going ahead**, type evidence (what you checked, with whom, when; at least 10 characters). (b) Open the `uncertain_return` guest link. (c) Engineer runs `ADMIN_TOKEN=... node scripts/staff_acceptance_credentials.mjs change-return <base url> <private file>` (moves the synthetic source's return to 16:00), then refresh Needs attention. | (a) Recorded under your staff name and time; the item leaves the list; the source is stated as unchanged. **No reward credit, driver or payment is involved or implied.** (b) The return shows **Confirmed** and the note "Our team checked that this return transfer is still going ahead. This check does not assign a driver or take payment." The guest page never shows who verified or the evidence. (c) The item **re-opens**, the guest note disappears and the return goes back to *Awaiting human confirmation*: the verification applied only to the old itinerary. If you had left the page open and press Verify on the old row, it is refused with "The itinerary changed since you looked at it". |

(The same button also still appears beside an earned reward credit; that path is reward-only and is not part of this acceptance.)

## E. Cleanup and revocation - affects ONLY the credentials created for this run
Do these in order after the operator is done. Nothing here rotates the shared admin token.
1. **Guest links (this run's three only):** `ADMIN_TOKEN=<admin token> node scripts/staff_acceptance_credentials.mjs teardown <base url> <private file path>` - revokes all three guests and verifies each now answers 401.
2. **This run's two staff identities (no API delete exists):** run the ONE `wrangler d1 execute marau-stage1-legs-db --remote --command "DELETE FROM marau_staff_identities WHERE operator_name IN (...)"` line printed by the seed step (exact names; use `--command`, never `--file`; paste it as a whole line, it contains quotes). **Keep the private file until the next check has run**, then re-run teardown with `--staff-deleted`: it must report each staff token **refused (401)**.
3. Delete the private file.
4. If you ran step 8c the synthetic source booking stays at its changed time; it is labelled synthetic and harmless.
5. Synthetic supplier/offer/edition/send rows stay in the preview database, labelled "(acceptance)". They are harmless and are not removed (no delete API; removing rows by hand is not worth the risk).

### The shared admin token: do NOT rotate by default
The preview has one shared admin bearer (`MARAU_ADMIN_TEST_TOKEN`, a Worker variable). Who/what depends on it (checked from the repo and the Worker config):
- the author's scripts: `hosted_roundtrip_journey.mjs`, `hosted_roundtrip_phone_seed.mjs`, `staff_acceptance_credentials.mjs`, and the local file holding the value;
- **nothing else**: no cron/trigger, no route or custom domain, no service binding, no other Worker, no Nadi or Vakaviti system references this preview; guest links are separate tokens and are unaffected; RC1 has its own separate preview and token.

So rotation would break only the author's scripts, but it requires a redeploy, which creates a **new Worker version ID with identical code** (the frozen candidate's *version ID* would change; the code commit would not). Therefore:
- If the operator is someone who may hold the admin token (e.g. James), **do not rotate**; just do steps 1-3.
- If the admin token was shared with anyone else, rotate once afterwards: redeploy with a new `--var MARAU_ADMIN_TEST_TOKEN:<new>`, record the new version ID against `a7b8d3c`, update the author's local token file, and verify the old token now returns 401.

## F. Leftovers to know about
Earlier automated runs created staff identities named like `Ana (roundtrip <run>)` / `Bala (roundtrip <run>)` in the same preview DB. They are not part of this handoff and are not touched; they are useless without the admin token.
