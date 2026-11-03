# Bula release gate — candidate `26fd18a2` and its fixed successor `a38e7d71` (2026-11-03)
No production deployment, activation, migration, message or real-data change was made. Synthetic data only. Previous candidate `1343f866…` is unchanged and still the rollback target.

## Result of the gate on `26fd18a2`
The gate found **two real defects**, both fixed in the successor `a38e7d7155571a70fbcd522f1452a43c24cf9ab7` (code-only descendant, the new candidate):
1. **Cursor/poison gap.** A booking whose single-read failed for 10+ polls (e.g. NAT read route down while discovery was up) was "parked" and then fell behind the 20-id overlap window — never retried automatically. Fixed: a **parked-retry sweep** re-attempts every open retryable record (≤20 per run, ≥15 min apart, no attempt limit) until it mirrors or staff mark it handled; health alert `SOURCE_BOOKING_PARKED_RETRYING`.
2. **Defaulted facts.** (a) Guest email gave a source-mirrored booking the default currency if the source had none → now blocked (`missing_currency`); (b) the legacy receipt template printed `Passengers: undefined`; (c) the trip price showed a bare number when currency was unknown → now labelled "(currency not provided)".

## Gate table (successor `a38e7d71`)
| Gate item | Result | Evidence |
|---|---|---|
| Full automated suite | 641 tests / 632 pass / **0 fail** / 9 skipped (the 9 are existing tests that need a real NAT Worker at a path on James's PC). Excludes only the two copied evidence tests under docs/evidence. | `full-suite-run.txt` |
| Source polling, first-poll floor, overlap windows, outage/recovery, duplicate discovery, watermark, 10-attempt handling, missing email, missing phone | `bula/m6_discovery.test.mjs` 17/17 | test file |
| Cursor safety (restart, cursor persistence, crash before cursor saved, same-time, >50, >200, outage > interval, repeated transient failures, poison record, parked valid booking, permanent refusals) | `bula/m7_cursor_safety.test.mjs` 11/11 | test file |
| Source fidelity (email, flight, passengers, luggage, add-ons, discount, return, price/currency, pickup) | `bula/m8_fidelity_surfaces.test.mjs` 6/6 + `m6` labels | test file |
| Phone-size browser journey 390×844 | **17/17** (guest trip, missing-field rendering, staff refusal queue, claim/confirm, decline, Mark handled w/ and w/o note, guest withdrawal, isolation, invariants, no page errors) | `browser-phone-390x844/` |
| Staff refusal queue + Mark handled authorisation/audit | no staff credential ⇒ 401; note required in UI; second resolve ⇒ 409; audit row written | m6 + browser |
| Guest isolation / staff authorization / wallet + capacity invariants / decline / withdrawal / confirmation / capture safety | existing suites (m2–m4) all pass unchanged + browser run; `collectHealth` shows no WALLET/CAPACITY/DUPLICATE alert | suite + browser |
| Rollback compatibility | `1343f866` code + its full suite (586 tests, 0 fail) run against a database that already contains the new `0048` tables ⇒ rolling the code back leaves the additive tables unused and harmless | this session |

## POISON RECORD / CURSOR SAFETY — exact behaviour
* Permanently malformed booking (example: `quoted_amount` is text, so the reader rejects it) between valid bookings: the poll mirrors every valid booking before **and** after it in the same run. The poison record is written to `bula_source_refusals` (`SOURCE_READ_FAILED`, detail `SOURCE_MALFORMED_FIELD_quoted_amount`), state **open**.
* While its attempt count is < 10 the watermark is held just before it (so nothing behind it can be skipped; up to 200 bookings per run still flow past it in the overlap re-read). At the 10th failed attempt it stops holding the cursor — later valid bookings are never lost and were already mirrored.
* It is **not** dropped: the sweep keeps retrying it (≥ 15 min apart, unlimited). If NAT corrects the record it mirrors automatically (refusal auto-resolved, `resolved_by auto:mirrored`). Otherwise it stays in the staff queue ("could not be read from NAT yet … keeps retrying") and raises `SOURCE_BOOKING_REFUSED_NEEDS_STAFF` and `SOURCE_BOOKING_PARKED_RETRYING`. No guest journey, no message.
* Test: 60 valid bookings + 1 poison, 16 polls: 59 mirrored, watermark 62, poison open with ≥10 attempts, later correction mirrors it.
* Residual limit (honest): permanent refusals (missing email/phone/amount) are retried only while inside the 20-id overlap; they are not swept (they cannot fix themselves) and remain open for staff.

## Source-fidelity review (UI, API, email)
Missing/NOT_APPLICABLE ⇒ guest trip API returns `{available:false}` with no value; UI prints the fixed text "Not available from your booking record"; emails omit the line entirely (no "undefined/null/0/1/none"); staff UI shows reasons and field NAMES only; price shows source currency or says "currency not provided"; pickup/route missing ⇒ email blocked (`missing_*`). Searched all server and UI code for default literals next to passengers/luggage/flight/add-ons/discount/currency: none remain after the two fixes.

## Remaining honest limits
Bula production, real ingestion, email, WhatsApp remain HOLD and untested against real services. The 9 skipped tests need the real NAT Worker on the PC and could now be run against the recovered source on that machine.
