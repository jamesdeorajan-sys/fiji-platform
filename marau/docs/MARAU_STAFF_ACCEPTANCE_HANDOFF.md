# Marau - hosted staff-console acceptance: operator handoff

**RC3 is frozen** (code `a7b8d3c`, hosted Worker `615f1da8-2cc1-4f8d-91ab-ca66e5ba2bbf`). This is a *human-operated* check: the author does not type credentials into the hosted page. Synthetic data only; nothing is sent to anyone; rewards stay OFF. Takes about 15 minutes.

**Hosted staff console:** https://marau-stage1-preview-legs.helpronline.workers.dev/staff
(Guest links, the Trip page and everything else live on the same host. This is an isolated preview: its own Worker and its own D1 `marau-stage1-legs-db`. Not production, not RC1.)

## A. Before the operator starts (engineer, ~5 min)
1. Pick the operator. They need **two** secrets, delivered separately (section B): the **shared admin token** and **their own staff token**.
2. Seed individual credentials and synthetic guests (reads the admin token from an environment variable; writes every secret to a private file *outside the repository*; prints none of them):
   `ADMIN_TOKEN=<preview admin token> node scripts/staff_acceptance_credentials.mjs seed https://marau-stage1-preview-legs.helpronline.workers.dev <private file path>`
   This creates **two named staff identities** ("Acceptance Operator A (run id)" = preparer, "Acceptance Operator B (run id)" = reviewer) and **two synthetic guests**: `recipient_with_consent` (marketing consent granted) and `recipient_without_consent`. Each of the two staff identities has its own random token.
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
| Prefix | anything you type is labelled "(acceptance)" so it is easy to find and ignore |

## D. The seven steps and expected results
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

*Not part of these seven (reward-only, optional):* the "Verify with evidence" button for an uncertain return appears **only next to an earned reward credit**, so it cannot be exercised with rewards OFF. See the pilot package (requirement R4).

## E. Cleanup and revocation - affects ONLY the credentials created for this run
Do these in order after the operator is done. Nothing here rotates the shared admin token.
1. **Guest links (this run's two only):** `ADMIN_TOKEN=<admin token> node scripts/staff_acceptance_credentials.mjs teardown <base url> <private file path>` - revokes both guests and verifies each now answers 401.
2. **This run's two staff identities (no API delete exists):** run the two `wrangler d1 execute marau-stage1-legs-db --remote --command "DELETE FROM marau_staff_identities WHERE operator_name = '...'"` lines printed by the seed step (one per operator, exact names). Use `--command`, never `--file`. Then re-run teardown with `--staff-deleted`: it must report each staff token **refused (401)**.
3. Delete the private file.
4. Synthetic supplier/offer/edition/send rows stay in the preview database, labelled "(acceptance)". They are harmless and are not removed (no delete API; removing rows by hand is not worth the risk).

### The shared admin token: do NOT rotate by default
The preview has one shared admin bearer (`MARAU_ADMIN_TEST_TOKEN`, a Worker variable). Who/what depends on it (checked from the repo and the Worker config):
- the author's scripts: `hosted_roundtrip_journey.mjs`, `hosted_roundtrip_phone_seed.mjs`, `staff_acceptance_credentials.mjs`, and the local file holding the value;
- **nothing else**: no cron/trigger, no route or custom domain, no service binding, no other Worker, no Nadi or Vakaviti system references this preview; guest links are separate tokens and are unaffected; RC1 has its own separate preview and token.

So rotation would break only the author's scripts, but it requires a redeploy, which creates a **new Worker version ID with identical code** (the frozen candidate's *version ID* would change; the code commit would not). Therefore:
- If the operator is someone who may hold the admin token (e.g. James), **do not rotate**; just do steps 1-3.
- If the admin token was shared with anyone else, rotate once afterwards: redeploy with a new `--var MARAU_ADMIN_TEST_TOKEN:<new>`, record the new version ID against `a7b8d3c`, update the author's local token file, and verify the old token now returns 401.

## F. Leftovers to know about
Earlier automated runs created staff identities named like `Ana (roundtrip <run>)` / `Bala (roundtrip <run>)` in the same preview DB. They are not part of this handoff and are not touched; they are useless without the admin token.
