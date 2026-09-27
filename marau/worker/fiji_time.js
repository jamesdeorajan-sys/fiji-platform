/* Marau Stage 1 (PREVIEW ONLY) — Fiji-time parsing and display, in one
 * place, used by both the server (parsing a guest's raw wall-clock input)
 * and the client (displaying a stored UTC instant back in Fiji time).
 *
 * FIX (fourth independent review, finding 2 — pickup accuracy): under
 * TZ=UTC (the Workers runtime's own timezone, and the environment this
 * bug was found in), submitting the guest form's raw datetime-local
 * value "2026-10-01T12:00" used to be parsed with plain
 * `new Date(...).toISOString()`, which treats a zone-less date-time
 * string as being in the SERVER's own local time — i.e. UTC on a Worker.
 * Stored as "2026-10-01T12:00:00.000Z", that instant is actually
 * MIDNIGHT ON 2 OCTOBER in Fiji (UTC+12) — 12 hours later than the guest
 * actually entered. The guest form's input is always meant as Fiji local
 * wall-clock time (this is a Fiji transfer service), so it must be
 * interpreted as such before being converted to a real UTC instant.
 *
 * getFijiOffsetMinutesAt/fijiWallClockToUtcIso use Intl's real tzdata for
 * Pacific/Fiji (via `timeZoneName: 'shortOffset'`) rather than a
 * hardcoded +12:00 — Fiji has observed DST in some years, and this
 * degrades correctly if it ever does again, without a code change.
 *
 * normalizePickupDatetime is idempotent on an already-zoned value (one
 * ending in Z or a numeric UTC offset) — it passes those through
 * unchanged rather than re-interpreting them as Fiji wall-clock time.
 * This is what makes "including unchanged-time submission" (resubmitting
 * a change request with the same time) safe: once a value has been
 * normalized to a real UTC instant and stored, re-reading it back out
 * (already zoned) and feeding it through this function again is a no-op,
 * never a second, compounding shift.
 */

export const FIJI_TZ = 'Pacific/Fiji';

const ZONED_SUFFIX_RE = /Z$|[+-]\d{2}:?\d{2}$/;

export function getFijiOffsetMinutesAt(utcMs) {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: FIJI_TZ, timeZoneName: 'shortOffset' });
  const parts = dtf.formatToParts(new Date(utcMs));
  const tzPart = parts.find((p) => p.type === 'timeZoneName');
  const match = tzPart && tzPart.value.match(/GMT([+-]\d+)(?::(\d+))?/);
  if (!match) return 12 * 60; // conservative fallback — Fiji's standard offset
  const hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  return hours * 60 + (hours < 0 ? -minutes : minutes);
}

/**
 * Interprets a naive "YYYY-MM-DDTHH:MM[:SS]" string (no zone) as Fiji
 * local wall-clock time and returns the real UTC instant as an ISO
 * string. Converges in two passes: the first pass's rough UTC guess is
 * used only to look up Fiji's offset AT that approximate instant (which
 * only matters right at a DST boundary, if Fiji ever reinstates one);
 * the second pass applies that offset for the real answer.
 */
export function fijiWallClockToUtcIso(wallClockString) {
  const m = String(wallClockString).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) throw new Error(`not a recognizable date-time: ${wallClockString}`);
  const [, y, mo, d, h, mi, s] = m;
  const naiveUtcMs = Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0));
  let resultMs = naiveUtcMs;
  for (let i = 0; i < 2; i++) {
    const offsetMinutes = getFijiOffsetMinutesAt(resultMs);
    resultMs = naiveUtcMs - offsetMinutes * 60000;
  }
  return new Date(resultMs).toISOString();
}

/**
 * The single entry point every raw pickup_datetime value (booking
 * creation, and a change request's requested pickup_datetime) must pass
 * through before being stored. Already-zoned input is trusted as-is
 * (just normalized to a canonical ISO string); naive input is treated as
 * Fiji wall-clock time.
 */
export function normalizePickupDatetime(raw) {
  if (raw == null) return raw;
  const str = String(raw);
  if (ZONED_SUFFIX_RE.test(str)) {
    return new Date(str).toISOString();
  }
  return fijiWallClockToUtcIso(str);
}

/**
 * Client-facing display: a real UTC instant, formatted in Fiji time.
 * Used by the guest app (embedded via .toString() into pages.js, exactly
 * like client_idempotency.js's functions — self-contained on purpose, no
 * outer-scope constant referenced from inside the function body, per the
 * embedding bug found and fixed in round 3).
 */
export function formatFijiDateTime(iso) {
  var d = new Date(iso);
  var day = new Intl.DateTimeFormat('en-US', { timeZone: 'Pacific/Fiji', weekday: 'long', month: 'short', day: 'numeric' }).format(d);
  var time = new Intl.DateTimeFormat('en-US', { timeZone: 'Pacific/Fiji', hour: 'numeric', minute: '2-digit' }).format(d);
  return { day: day, time: time };
}
