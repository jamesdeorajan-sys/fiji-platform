/* Issue #54 recovery — integer-only extraction of the widget's structured passenger/luggage tokens.
 *
 * The on-site widget (nadiairporttransfers.com) writes `Passengers: <n>` and `Luggage: <n>` into bookings.notes ahead of any
 * free-text guest notes (app.js submit payload). bookings has no passengers/luggage columns, so those tokens are the only
 * persisted source for the on-site widget (44 of 46 saved requests on 2026-09-21; FijiDash and no-ref rows had none).
 *
 * `notes` can also contain free text a guest typed, so this function is meant to run in the LOCAL sanitising step that builds
 * the movement file: it returns ONLY two bounded integers (or null) and never returns, logs or stores any part of the text.
 */
const PAX = /(?:^|\|\s*|\n)\s*Passengers:\s*(\d{1,2})\b/;
const BAGS = /(?:^|\|\s*|\n)\s*Luggage:\s*(\d{1,2})\b/;

export function deriveStructuredPaxLuggage(notes) {
  if (typeof notes !== 'string') return { passengers: null, luggage: null };
  const p = PAX.exec(notes); const l = BAGS.exec(notes);
  const passengers = p ? Number(p[1]) : null;
  const luggage = l ? Number(l[1]) : null;
  return {
    passengers: Number.isInteger(passengers) && passengers >= 1 && passengers <= 20 ? passengers : null,
    luggage: Number.isInteger(luggage) && luggage >= 0 && luggage <= 20 ? luggage : null,
  };
}
