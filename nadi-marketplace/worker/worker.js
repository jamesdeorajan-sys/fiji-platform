var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// pricing.mjs
var RETURN_MULTIPLIER = 1.85;
var NIGHT_SURCHARGE = 0.2;
var DISCOUNT_THRESHOLD_FJD = 50;
var DISCOUNT_RATE = 0.1;
function computeBaseFare({ flagfallFjd, baseRateFjdPerKm, distanceKm }) {
  if (flagfallFjd === null || flagfallFjd === void 0) return null;
  if (baseRateFjdPerKm === null || baseRateFjdPerKm === void 0) return null;
  if (distanceKm === null || distanceKm === void 0) return null;
  return flagfallFjd + baseRateFjdPerKm * distanceKm;
}
__name(computeBaseFare, "computeBaseFare");
function applyZoneMultiplier(baseFareFjd, remoteMultiplier) {
  const multiplier = remoteMultiplier === null || remoteMultiplier === void 0 ? 1 : remoteMultiplier;
  return baseFareFjd * multiplier;
}
__name(applyZoneMultiplier, "applyZoneMultiplier");
function applyTripTypeMultiplier(fareFjd, tripType) {
  if (tripType === "return") return fareFjd * RETURN_MULTIPLIER;
  return fareFjd;
}
__name(applyTripTypeMultiplier, "applyTripTypeMultiplier");
function isNightPickup(pickupTime) {
  if (!pickupTime) return false;
  const hour = parseInt(String(pickupTime).split(":")[0], 10);
  if (!isFinite(hour)) return false;
  return hour >= 22 || hour < 6;
}
__name(isNightPickup, "isNightPickup");
function applyNightSurcharge(fareFjd, pickupTime) {
  return isNightPickup(pickupTime) ? fareFjd * (1 + NIGHT_SURCHARGE) : fareFjd;
}
__name(applyNightSurcharge, "applyNightSurcharge");
var CHILD_SEAT_FJD = 8;
var SURFBOARD_FJD = 24;
function applyExtras(fareFjd, { hasChildSeat, hasSurfboard }) {
  let total = fareFjd;
  if (hasChildSeat) total += CHILD_SEAT_FJD;
  if (hasSurfboard) total += SURFBOARD_FJD;
  return total;
}
__name(applyExtras, "applyExtras");
function applyLoyaltyDiscount(subtotalFjd, hasTour) {
  if (hasTour || subtotalFjd <= DISCOUNT_THRESHOLD_FJD) {
    return { discountFjd: 0, finalFjd: Math.round(subtotalFjd * 100) / 100 };
  }
  const discountFjd = Math.round(subtotalFjd * DISCOUNT_RATE);
  return { discountFjd, finalFjd: Math.round((subtotalFjd - discountFjd) * 100) / 100 };
}
__name(applyLoyaltyDiscount, "applyLoyaltyDiscount");
function computeFinalTotal(fareFjd) {
  return Math.round(fareFjd * 100) / 100;
}
__name(computeFinalTotal, "computeFinalTotal");
function computeBoatFare({ adults, children, adultFareFjd, childFareFjd }) {
  if (adultFareFjd === null || adultFareFjd === void 0) return null;
  const childTotal = children > 0 ? children * (childFareFjd || 0) : 0;
  return Math.round((adults * adultFareFjd + childTotal) * 100) / 100;
}
__name(computeBoatFare, "computeBoatFare");
function assertSanePricing({ oneWayEquivalentFjd, finalTotalFjd, tripType, minRatio = 1.5, maxRatio = 2.2 }) {
  if (tripType !== "return") return { sane: true };
  if (!oneWayEquivalentFjd || oneWayEquivalentFjd <= 0) {
    return { sane: false, reason: "missing or invalid one-way equivalent fare to compare against" };
  }
  const ratio = finalTotalFjd / oneWayEquivalentFjd;
  if (ratio < minRatio || ratio > maxRatio) {
    return {
      sane: false,
      ratio,
      reason: `return total is ${ratio.toFixed(2)}x the one-way fare, outside the sane [${minRatio}, ${maxRatio}] bound`
    };
  }
  return { sane: true, ratio };
}
__name(assertSanePricing, "assertSanePricing");

// rental.mjs
var RENTAL_CONSENT_VERSION = "rental-consent-2026-10-14";
var RENTAL_PARTNER = "best-adventure-fiji";
var RENTAL_STATUSES = ["new", "contacted", "quoted", "confirmed", "completed", "cancelled"];
var RENTAL_TRANSITIONS = {
  new: ["contacted", "quoted", "cancelled"],
  contacted: ["quoted", "confirmed", "cancelled"],
  quoted: ["contacted", "confirmed", "cancelled"],
  confirmed: ["completed", "cancelled"],
  completed: [],
  cancelled: ["new"]
  // reopen
};
var PICKUP_OPTIONS = ["Nadi International Airport (NAN)", "Nadi / Wailoaloa hotel", "Denarau hotel", "Other \u2014 specify below"];
var DROPOFF_OPTIONS = ["Nadi International Airport (NAN)", "Same as collection", "Nadi / Wailoaloa hotel", "Denarau hotel", "Other \u2014 specify below"];
var VEHICLE_OPTIONS = ["Help me choose", "Toyota Aqua", "Nissan X-Trail", "Toyota Fielder", "Toyota Wish", "Toyota Voxy", "Hyundai Tucson", "Family / larger vehicle"];
var AGE_OPTIONS = ["Under 21", "21\u201324", "25\u201369", "70+"];
var ALLOWED_ORIGINS = ["https://nadiairporttransfers.com", "https://www.nadiairporttransfers.com"];
var MAX_BODY_BYTES = 16e3;
var IP_LIMIT_PER_HOUR = 8;
var GLOBAL_LIMIT_PER_HOUR = 40;
var DUPLICATE_WINDOW_HOURS = 48;
var MAX_RENTAL_DAYS = 120;
var MAX_ADVANCE_DAYS = 550;
var RENTAL_CONSOLE_PATH = "/admin/rentals-console";
var DEFAULT_CONSOLE_URL = "https://api.nadiairporttransfers.com" + RENTAL_CONSOLE_PATH;
var ALERT_LEASE_SECONDS = 120;
var ALERT_BACKOFF_BASE_SECONDS = 300;
var ALERT_BACKOFF_MAX_SECONDS = 3600;
var ALERT_MAX_ATTEMPTS = 6;
var PLAIN_FROM_ATTEMPT = 3;
var ALERT_SWEEP_MIN_AGE_SECONDS = 180;
var ALERT_SWEEP_WINDOW_HOURS = 72;
var ALERT_SWEEP_BATCH = 10;
var REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function fijiNow(now = /* @__PURE__ */ new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Fiji", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const v = /* @__PURE__ */ __name((t) => parts.find((p) => p.type === t)?.value, "v");
  return `${v("year")}-${v("month")}-${v("day")}T${v("hour")}:${v("minute")}`;
}
__name(fijiNow, "fijiNow");
function validDate(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || "")) return false;
  const x = /* @__PURE__ */ new Date(d + "T00:00:00Z");
  return Number.isFinite(x.getTime()) && x.toISOString().slice(0, 10) === d;
}
__name(validDate, "validDate");
function dayDiff(a, b) {
  return Math.round((/* @__PURE__ */ new Date(b + "T00:00:00Z") - /* @__PURE__ */ new Date(a + "T00:00:00Z")) / 864e5);
}
__name(dayDiff, "dayDiff");
var TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
var CONTROL_RE = /[\u0000-\u001f\u007f\u0085\u2028\u2029]/;
function normaliseInternationalPhone(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s || s.length > 40 || CONTROL_RE.test(s) || /[^0-9+\s().\-]/.test(s)) return null;
  let digits = s.replace(/\D/g, "");
  if (s.startsWith("+")) {
  } else if (s.startsWith("00")) digits = digits.slice(2);
  else return null;
  if (digits.length < 8 || digits.length > 15 || digits.startsWith("0")) return null;
  return { phone: "+" + digits, digits };
}
__name(normaliseInternationalPhone, "normaliseInternationalPhone");
function cleanText(v, max) {
  const s = String(v == null ? "" : v).replace(/\r\n?/g, "\n").trim();
  return s.length > max ? null : s;
}
__name(cleanText, "cleanText");
function hasPaymentCardRun(s) {
  return /(?:\d[ \-]?){13,19}/.test(s);
}
__name(hasPaymentCardRun, "hasPaymentCardRun");
function validateRentalSubmission(raw, { now = fijiNow() } = {}) {
  const errors = {};
  const d = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = {};
  const name = cleanText(d.name, 120);
  if (!name || name.length < 2 || CONTROL_RE.test(name.replace(/\n/g, "")) || name.includes("\n") || hasPaymentCardRun(name)) errors.name = "Please enter your name.";
  else out.name = name;
  const ph = normaliseInternationalPhone(d.phone);
  if (!ph) errors.phone = "Please enter your WhatsApp number with its country code, for example +61 400 000 000.";
  else {
    out.phone = ph.phone;
    out.phoneDigits = ph.digits;
  }
  const email = cleanText(d.email, 200);
  if (email === null || email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || CONTROL_RE.test(email))) errors.email = "That email address does not look right. It is optional, so you can leave it blank.";
  else out.email = email || "";
  if (!PICKUP_OPTIONS.includes(d.pickup)) errors.pickup = "Please choose a collection location.";
  else out.pickup = d.pickup;
  if (!DROPOFF_OPTIONS.includes(d.dropoff)) errors.dropoff = "Please choose a return location.";
  else out.dropoff = d.dropoff;
  if (!VEHICLE_OPTIONS.includes(d.vehicle)) errors.vehicle = "Please choose a vehicle preference.";
  else out.vehicle = d.vehicle;
  if (!AGE_OPTIONS.includes(d.age)) errors.age = "Please choose the driver age band.";
  else out.age = d.age;
  const lic = cleanText(d.licenceCountry, 100);
  if (!lic || lic.length < 2 || /\d/.test(lic) || CONTROL_RE.test(lic) || lic.includes("\n")) errors.licenceCountry = "Please enter the country that issued the driving licence (country only, no licence number).";
  else out.licenceCountry = lic;
  const flight = cleanText(d.flight, 30);
  if (flight === null || flight && !/^[A-Za-z0-9][A-Za-z0-9 \-]{1,29}$/.test(flight)) errors.flight = "Flight number format looks wrong. It is optional.";
  else out.flight = flight || "";
  const notes = cleanText(d.notes, 1e3);
  if (notes === null) errors.notes = "Please keep your notes under 1000 characters.";
  else if (hasPaymentCardRun(notes)) errors.notes = "Please do not enter card, passport or licence numbers. We only need your plans here.";
  else out.notes = notes;
  const dates = ["pickupDate", "returnDate"].every((k) => validDate(d[k]));
  const times = ["pickupTime", "returnTime"].every((k) => TIME_RE.test(d[k] || ""));
  if (!dates || !times) errors.dates = "Please enter valid collection and return dates and times.";
  else {
    const start = d.pickupDate + "T" + d.pickupTime;
    const end = d.returnDate + "T" + d.returnTime;
    if (start < now) errors.dates = "Collection must be in the future, using Fiji local time.";
    else if (end <= start) errors.dates = "Return must be after collection.";
    else if (dayDiff(now.slice(0, 10), d.pickupDate) > MAX_ADVANCE_DAYS) errors.dates = "Collection is too far ahead. Please contact the team on WhatsApp.";
    else if (dayDiff(d.pickupDate, d.returnDate) > MAX_RENTAL_DAYS) errors.dates = `Rentals over ${MAX_RENTAL_DAYS} days need a conversation. Please contact the team on WhatsApp.`;
    else {
      out.pickupDate = d.pickupDate;
      out.pickupTime = d.pickupTime;
      out.returnDate = d.returnDate;
      out.returnTime = d.returnTime;
    }
  }
  const blank = /* @__PURE__ */ __name((x) => x === void 0 || x === null || String(x).trim() === "", "blank");
  const pax = Number(d.passengers), bags = Number(d.bags);
  if (blank(d.passengers) || blank(d.bags) || !Number.isInteger(pax) || pax < 1 || pax > 30 || !Number.isInteger(bags) || bags < 0 || bags > 30) errors.party = "Please check the number of people and bags.";
  else {
    out.passengers = pax;
    out.bags = bags;
  }
  if (!errors.pickup && !errors.dropoff && (out.pickup.startsWith("Other") || out.dropoff.startsWith("Other")) && !(out.notes || "").trim()) errors.notes = "Please include your other collection or return address in the notes.";
  if (d.consentShare !== true || d.consentWhatsappGroup !== true) errors.consent = "Please tick both boxes so we can share your details with the rental partner and add you to a WhatsApp group.";
  if (d.consentVersion !== RENTAL_CONSENT_VERSION) errors.consent = "This page is out of date. Please reload it and try again.";
  const keys = Object.keys(errors);
  if (keys.length) return { ok: false, errors, message: errors[keys[0]] };
  return { ok: true, data: out };
}
__name(validateRentalSubmission, "validateRentalSubmission");
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256Hex, "sha256Hex");
function fingerprintSource(d) {
  return JSON.stringify([d.name, d.phoneDigits, d.email, d.pickup, d.dropoff, d.pickupDate, d.pickupTime, d.returnDate, d.returnTime, d.passengers, d.bags, d.vehicle, d.age, d.licenceCountry, d.flight, d.notes]);
}
__name(fingerprintSource, "fingerprintSource");
function newReference() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return "NAT-R-" + Array.from(bytes).map((b) => REF_ALPHABET[b % REF_ALPHABET.length]).join("");
}
__name(newReference, "newReference");
function whatsappLink(digits) {
  return digits ? `https://wa.me/${digits}` : null;
}
__name(whatsappLink, "whatsappLink");
function corsFor(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return { allowed: true, headers: {} };
  const extra = env && env.RENTAL_ALLOWED_ORIGINS ? String(env.RENTAL_ALLOWED_ORIGINS).split(",").map((s) => s.trim()).filter(Boolean) : [];
  if (!ALLOWED_ORIGINS.concat(extra).includes(origin)) return { allowed: false, headers: {} };
  return { allowed: true, headers: { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } };
}
__name(corsFor, "corsFor");
function rentalResponse(obj, status, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extraHeaders } });
}
__name(rentalResponse, "rentalResponse");
function isMissingTable(err) {
  return /no such table/i.test(String(err && err.message));
}
__name(isMissingTable, "isMissingTable");
function createRental(deps) {
  const { requireAdmin: requireAdmin2, getAdminAlertPhones: getAdminAlertPhones2, sendHealthAlertWhatsApp: sendHealthAlertWhatsApp2, createEscalation: createEscalation2, sqliteNow: sqliteNow2, sanitiseWhatsAppParamText: sanitiseWhatsAppParamText2, classifyAlertFailure: classifyAlertFailure2 } = deps;
  async function logEvent(env, rentalId, eventType, { previousStatus = null, newStatus = null, actor = "system", metadata = null } = {}) {
    try {
      await env.DB.prepare(`INSERT INTO rental_enquiry_events (rental_id, event_type, previous_status, new_status, actor, metadata) VALUES (?, ?, ?, ?, ?, ?)`).bind(rentalId, eventType, previousStatus, newStatus, actor, metadata ? JSON.stringify(metadata) : null).run();
    } catch (err) {
      console.warn(`[rental-events] could not log '${eventType}' for rental ${rentalId}: ${err.message}`);
    }
  }
  __name(logEvent, "logEvent");
  function buildAlertText(r, env, { plain = false } = {}) {
    const consoleUrl = env && env.RENTAL_CONSOLE_URL || DEFAULT_CONSOLE_URL;
    const s = /* @__PURE__ */ __name((t, n) => sanitiseWhatsAppParamText2(t, n), "s");
    const head = [
      "NEW CAR RENTAL ENQUIRY (not a confirmed rental)",
      `Ref ${r.reference}`,
      r.related_reference ? `Follows earlier enquiry ${r.related_reference} (details changed, check which is current)` : null,
      `Guest: ${s(r.guest_name, 60)}`,
      `WhatsApp: ${r.guest_phone}`,
      plain ? null : `Chat now: ${whatsappLink(r.guest_phone_digits)}`,
      `Collect: ${r.pickup_date} ${r.pickup_time} ${s(r.pickup_location, 45)}`,
      `Return: ${r.return_date} ${r.return_time} ${s(r.dropoff_location, 45)}`,
      `${r.passengers} people, ${r.bags} bags`,
      `Vehicle: ${s(r.vehicle_preference, 30)}`,
      `Driver age ${r.driver_age_band}, licence from ${s(r.licence_country, 30)}`,
      r.flight_number ? `Flight ${s(r.flight_number, 20)}` : null,
      "Consent: share with partner + WhatsApp group = yes"
    ].filter(Boolean);
    const tail = plain ? `Review: open the rental console and search ${r.reference}` : `Review: ${consoleUrl}?ref=${r.reference}`;
    let text = s([...head, tail].join(" | "), 5e3);
    const room = 960 - text.length;
    if (r.notes && room > 30) {
      const notes = s(r.notes, Math.min(room - 9, 220));
      text = s([...head, `Notes: ${notes}`, tail].join(" | "), 1e3);
    }
    return s(text, 1e3);
  }
  __name(buildAlertText, "buildAlertText");
  async function claimAlert(env, rental2) {
    await env.DB.prepare(`INSERT OR IGNORE INTO rental_notification_state (rental_id, reference, state) VALUES (?, ?, 'NOT_ATTEMPTED')`).bind(rental2.id, rental2.reference).run();
    const claim = await env.DB.prepare(
      `UPDATE rental_notification_state SET state = 'ATTEMPTING', attempt_count = attempt_count + 1, updated_at = datetime('now')
       WHERE rental_id = ? AND attempt_count < ?
         AND (state = 'NOT_ATTEMPTED'
              OR (state = 'FAILED_RETRYABLE'
                  AND CAST(strftime('%s', 'now') AS INTEGER) - CAST(strftime('%s', updated_at) AS INTEGER)
                      >= MIN(? * (1 << (attempt_count - 1)), ?))
              OR (state = 'ATTEMPTING' AND updated_at < datetime('now', ?)))
       RETURNING attempt_count`
    ).bind(rental2.id, ALERT_MAX_ATTEMPTS, ALERT_BACKOFF_BASE_SECONDS, ALERT_BACKOFF_MAX_SECONDS, `-${ALERT_LEASE_SECONDS} seconds`).first();
    if (claim) return { claimed: true, attempt: claim.attempt_count };
    const cur = await env.DB.prepare(
      `SELECT state, attempt_count, CAST(strftime('%s', 'now') AS INTEGER) - CAST(strftime('%s', updated_at) AS INTEGER) AS age_s FROM rental_notification_state WHERE rental_id = ?`
    ).bind(rental2.id).first();
    if (!cur) return { claimed: false, state: null, reason: "no_state" };
    let reason = "in_flight";
    if (cur.state === "SENT") reason = "sent";
    else if (cur.attempt_count >= ALERT_MAX_ATTEMPTS) reason = "attempt_cap";
    else if (cur.state === "FAILED_RETRYABLE") reason = "backoff";
    return { claimed: false, state: cur.state, attempts: cur.attempt_count, reason, wait_seconds: reason === "backoff" ? Math.max(0, backoffSeconds(cur.attempt_count) - cur.age_s) : 0 };
  }
  __name(claimAlert, "claimAlert");
  async function attemptAlert(env, rental2, { trigger = "first" } = {}) {
    try {
      const claim = await claimAlert(env, rental2);
      if (!claim.claimed) {
        if (claim.reason !== "sent") {
          const recent = await env.DB.prepare(`SELECT 1 AS x FROM rental_enquiry_events WHERE rental_id = ? AND event_type = 'rental_alert_skipped' AND created_at > datetime('now', '-60 seconds')`).bind(rental2.id).first();
          if (!recent) await logEvent(env, rental2.id, "rental_alert_skipped", { metadata: { reason: claim.reason, previous_state: claim.state, attempts: claim.attempts ?? null, wait_seconds: claim.wait_seconds ?? null, trigger } });
        }
        return { attempted: false, state: claim.state, reason: claim.reason };
      }
      const ownership = { attempt: claim.attempt, trigger };
      const text = buildAlertText(rental2, env, { plain: claim.attempt >= PLAIN_FROM_ATTEMPT });
      const phones = await getAdminAlertPhones2(env);
      let sentDetail = null;
      let failDetail = null;
      if (phones.length === 0) {
        failDetail = { reason: "platform_settings.admin_alert_phone is not set.", outcome: "NOT_CONFIGURED", possibly_delivered: false };
        await logEvent(env, rental2.id, "rental_alert_failed", { metadata: { ...failDetail, ...ownership } });
      }
      for (const phone of phones) {
        const r = await sendHealthAlertWhatsApp2(env, phone, text, sqliteNow2());
        if (r.attempted && r.ok) {
          let wamid = null;
          try {
            wamid = JSON.parse(r.response || "null")?.messages?.[0]?.id || null;
          } catch {
          }
          sentDetail = { status: r.status, wamid };
          await logEvent(env, rental2.id, "rental_alert_sent", { metadata: { ...sentDetail, ...ownership } });
        } else {
          const c = classifyAlertFailure2(r);
          failDetail = { reason: r.reason || r.error || "Meta rejected the send.", status: r.status, outcome: c.outcome, possibly_delivered: c.possiblyDelivered };
          await logEvent(env, rental2.id, "rental_alert_failed", { metadata: { ...failDetail, ...ownership } });
        }
      }
      if (sentDetail) {
        const done2 = await env.DB.prepare(
          `UPDATE rental_notification_state SET state = 'SENT', last_outcome = 'SENT', last_error = NULL, last_provider_status = ?, wamid = ?, updated_at = datetime('now') WHERE rental_id = ? AND state != 'SENT'`
        ).bind(sentDetail.status ?? null, sentDetail.wamid ?? null, rental2.id).run();
        if (done2.meta.changes === 0) await logEvent(env, rental2.id, "rental_alert_duplicate_delivery", { metadata: { wamid: sentDetail.wamid, ...ownership } });
        return { attempted: true, state: "SENT" };
      }
      const done = await env.DB.prepare(
        `UPDATE rental_notification_state SET state = 'FAILED_RETRYABLE', last_outcome = ?, last_error = ?, last_provider_status = ?, updated_at = datetime('now')
         WHERE rental_id = ? AND state = 'ATTEMPTING' AND attempt_count = ?`
      ).bind(failDetail.outcome, failDetail.reason, failDetail.status ?? null, rental2.id, claim.attempt).run();
      if (done.meta.changes === 0) await logEvent(env, rental2.id, "rental_alert_superseded", { metadata: { ...ownership, outcome: failDetail.outcome } });
      return { attempted: true, state: "FAILED_RETRYABLE", outcome: failDetail.outcome };
    } catch (err) {
      console.error(`[rental-alert] attempt failed for rental ${rental2.id}: ${err.message}`);
      return { attempted: false, error: true };
    }
  }
  __name(attemptAlert, "attemptAlert");
  async function logDuplicate(env, rentalId, kind) {
    const recent = await env.DB.prepare(`SELECT 1 AS x FROM rental_enquiry_events WHERE rental_id = ? AND event_type = 'duplicate_submission' AND created_at > datetime('now', '-60 seconds')`).bind(rentalId).first();
    if (!recent) await logEvent(env, rentalId, "duplicate_submission", { actor: "guest", metadata: { kind } });
  }
  __name(logDuplicate, "logDuplicate");
  function backoffSeconds(attempts) {
    return Math.min(ALERT_BACKOFF_BASE_SECONDS * 2 ** Math.max(0, attempts - 1), ALERT_BACKOFF_MAX_SECONDS);
  }
  __name(backoffSeconds, "backoffSeconds");
  async function sweepAlerts(env) {
    try {
      const found = await env.DB.prepare(
        `SELECT r.id, ns.state, ns.attempt_count, ns.last_outcome,
                CAST(strftime('%s', 'now') - strftime('%s', ns.updated_at) AS INTEGER) AS age_s
         FROM rental_enquiries r LEFT JOIN rental_notification_state ns ON ns.rental_id = r.id
         WHERE r.created_at >= datetime('now', ?) AND r.created_at <= datetime('now', ?)
           AND (ns.rental_id IS NULL OR ns.state IN ('NOT_ATTEMPTED', 'FAILED_RETRYABLE') OR (ns.state = 'ATTEMPTING' AND ns.updated_at < datetime('now', ?)))
           AND NOT EXISTS (SELECT 1 FROM rental_enquiry_events x WHERE x.rental_id = r.id AND x.event_type = 'rental_alert_exhausted'
                           AND x.id > COALESCE((SELECT MAX(q.id) FROM rental_enquiry_events q WHERE q.rental_id = r.id AND q.event_type = 'rental_alert_resend_requested'), 0))
         ORDER BY r.id LIMIT ?`
      ).bind(`-${ALERT_SWEEP_WINDOW_HOURS} hours`, `-${ALERT_SWEEP_MIN_AGE_SECONDS} seconds`, `-${ALERT_LEASE_SECONDS} seconds`, ALERT_SWEEP_BATCH).all();
      for (const row of found && found.results || []) {
        const attempts = row.attempt_count || 0;
        const rental2 = await env.DB.prepare(`SELECT * FROM rental_enquiries WHERE id = ?`).bind(row.id).first();
        if (!rental2) continue;
        if (attempts >= ALERT_MAX_ATTEMPTS) {
          await logEvent(env, row.id, "rental_alert_exhausted", { metadata: { attempts, last_outcome: row.last_outcome || null } });
          await createEscalation2(env, {
            source: "guest",
            triggerType: "app_issue",
            context: `Car rental enquiry ${rental2.reference}: the staff WhatsApp alert could not be delivered after ${attempts} attempts (last outcome: ${row.last_outcome || "unknown"}). The enquiry IS saved: open the staff rental console (admin, Rental enquiries) and search ${rental2.reference} to contact the guest.`
          });
          continue;
        }
        if (row.state === "FAILED_RETRYABLE" && (row.age_s ?? 0) < backoffSeconds(attempts)) continue;
        await attemptAlert(env, rental2, { trigger: "sweep" });
      }
    } catch (err) {
      if (!isMissingTable(err)) console.error(`[rental-alert-sweep] failed: ${err.message}`);
    }
  }
  __name(sweepAlerts, "sweepAlerts");
  async function dispatchAlert(env, ctx, rental2, trigger) {
    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(Promise.allSettled([attemptAlert(env, rental2, { trigger })]));
      return;
    }
    await attemptAlert(env, rental2, { trigger });
  }
  __name(dispatchAlert, "dispatchAlert");
  async function handleCreate(request, env, ctx) {
    const cors = corsFor(request, env);
    const fail = /* @__PURE__ */ __name((error, status, extra = {}) => rentalResponse({ ok: false, saved: false, error, ...extra }, status, cors.headers), "fail");
    if (!cors.allowed) return rentalResponse({ ok: false, saved: false, error: "Please use the Nadi Airport Transfers rental page." }, 403);
    if (!env.DB) return fail("Saving is temporarily unavailable. Please try again or contact the team on WhatsApp.", 503, { code: "SAVE_UNAVAILABLE" });
    if (!(request.headers.get("Content-Type") || "").includes("application/json")) return fail("Unsupported submission format.", 415);
    const declared = Number(request.headers.get("Content-Length") || 0);
    if (declared > MAX_BODY_BYTES) return fail("Please shorten your notes.", 413);
    let body;
    try {
      const text = await request.text();
      if (text.length > MAX_BODY_BYTES) return fail("Please shorten your notes.", 413);
      body = JSON.parse(text);
    } catch {
      return fail("Invalid request.", 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail("Invalid request.", 400);
    if (typeof body.websiteTrap === "string" && body.websiteTrap.trim() !== "") return fail("Please check your details and try again.", 400);
    const id = typeof body.id === "string" ? body.id.trim().toLowerCase() : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return fail("Please reload the page and try again.", 400);
    const v = validateRentalSubmission(body);
    if (!v.ok) return fail(v.message, 400, { fields: v.errors });
    const d = v.data;
    const fp = await sha256Hex(fingerprintSource(d));
    try {
      const existing = await env.DB.prepare(`SELECT * FROM rental_enquiries WHERE client_request_id = ?`).bind(id).first();
      if (existing) {
        if (existing.payload_fingerprint !== fp) return fail("We already saved an earlier request (" + existing.reference + ") with different details. Check the details and send again to save these as a new request linked to it.", 409, { code: "REQUEST_ID_CONFLICT", reference: existing.reference });
        await logDuplicate(env, existing.id, "same_request_id");
        await dispatchAlert(env, ctx, existing, "replay");
        return rentalResponse({ ok: true, saved: true, confirmed: false, duplicate: true, reference: existing.reference, status: existing.status }, 200, cors.headers);
      }
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const day = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      const rateKey = await sha256Hex(`${day}:${ip}`);
      const perIp = await env.DB.prepare(`SELECT COUNT(*) AS n FROM rental_enquiries WHERE rate_key = ? AND created_at > datetime('now', '-60 minutes')`).bind(rateKey).first();
      if ((perIp?.n || 0) >= IP_LIMIT_PER_HOUR) return fail("Too many requests from this connection. Please contact the team on WhatsApp.", 429);
      const global = await env.DB.prepare(`SELECT COUNT(*) AS n FROM rental_enquiries WHERE created_at > datetime('now', '-60 minutes')`).first();
      if ((global?.n || 0) >= GLOBAL_LIMIT_PER_HOUR) return fail("We are receiving a lot of requests right now. Please contact the team on WhatsApp.", 429);
      const dup = await env.DB.prepare(
        `SELECT * FROM rental_enquiries WHERE guest_phone_digits = ? AND payload_fingerprint = ? AND status != 'cancelled' AND created_at > datetime('now', ?) ORDER BY id LIMIT 1`
      ).bind(d.phoneDigits, fp, `-${DUPLICATE_WINDOW_HOURS} hours`).first();
      if (dup) {
        await logDuplicate(env, dup.id, "same_details_new_request_id");
        await dispatchAlert(env, ctx, dup, "replay");
        return rentalResponse({ ok: true, saved: true, confirmed: false, duplicate: true, reference: dup.reference, status: dup.status }, 200, cors.headers);
      }
      const earlier = await env.DB.prepare(
        `SELECT reference FROM rental_enquiries WHERE guest_phone_digits = ? AND pickup_date = ? AND pickup_time = ? AND return_date = ? AND return_time = ?
           AND status != 'cancelled' AND created_at > datetime('now', ?) ORDER BY id DESC LIMIT 1`
      ).bind(d.phoneDigits, d.pickupDate, d.pickupTime, d.returnDate, d.returnTime, `-${DUPLICATE_WINDOW_HOURS} hours`).first();
      const relatedReference = earlier ? earlier.reference : null;
      let reference = null;
      let insertedId = null;
      for (let i = 0; i < 6 && !insertedId; i++) {
        reference = newReference();
        try {
          const ins = await env.DB.prepare(
            `INSERT INTO rental_enquiries (reference, client_request_id, payload_fingerprint, partner, guest_name, guest_phone, guest_phone_digits, guest_email, pickup_location, dropoff_location,
               pickup_date, pickup_time, return_date, return_time, passengers, bags, vehicle_preference, driver_age_band, licence_country, flight_number, notes,
               consent_share_partner, consent_whatsapp_group, consent_version, consent_at, source_url, utm_source, utm_medium, utm_campaign, rate_key, related_reference)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, datetime('now'), ?, ?, ?, ?, ?, ?)`
          ).bind(
            reference,
            id,
            fp,
            RENTAL_PARTNER,
            d.name,
            d.phone,
            d.phoneDigits,
            d.email || null,
            d.pickup,
            d.dropoff,
            d.pickupDate,
            d.pickupTime,
            d.returnDate,
            d.returnTime,
            d.passengers,
            d.bags,
            d.vehicle,
            d.age,
            d.licenceCountry,
            d.flight || null,
            d.notes || null,
            RENTAL_CONSENT_VERSION,
            cleanTag(body.source, 300),
            cleanTag(body.utm && body.utm.utm_source, 100),
            cleanTag(body.utm && body.utm.utm_medium, 100),
            cleanTag(body.utm && body.utm.utm_campaign, 100),
            rateKey,
            relatedReference
          ).run();
          insertedId = ins.meta.last_row_id;
        } catch (err) {
          const msg = String(err && err.message);
          if (/UNIQUE/i.test(msg) && /client_request_id/i.test(msg)) {
            const again = await env.DB.prepare(`SELECT * FROM rental_enquiries WHERE client_request_id = ?`).bind(id).first();
            if (again && again.payload_fingerprint === fp) return rentalResponse({ ok: true, saved: true, confirmed: false, duplicate: true, reference: again.reference, status: again.status }, 200, cors.headers);
            if (!again) throw err;
            return fail("We already saved an earlier request (" + again.reference + ") with different details. Check the details and send again to save these as a new request linked to it.", 409, { code: "REQUEST_ID_CONFLICT", reference: again.reference });
          }
          if (/UNIQUE/i.test(msg) && /reference/i.test(msg)) continue;
          throw err;
        }
      }
      if (!insertedId) throw new Error("could not allocate a reference");
      await logEvent(env, insertedId, "saved", { actor: "guest", metadata: { consent_version: RENTAL_CONSENT_VERSION, ...relatedReference ? { related_reference: relatedReference, note: "same phone and times as an earlier enquiry but different details: saved as a new linked enquiry" } : {} } });
      const rental2 = await env.DB.prepare(`SELECT * FROM rental_enquiries WHERE id = ?`).bind(insertedId).first();
      await dispatchAlert(env, ctx, rental2, "first");
      return rentalResponse({ ok: true, saved: true, confirmed: false, duplicate: false, reference, status: "new", related_reference: relatedReference }, 201, cors.headers);
    } catch (err) {
      console.error(`[rental-create] could not save: ${err && err.message}`);
      return fail("We could not confirm your request was saved. Your details are still on this page: please retry, or contact the team on WhatsApp.", 503, { code: isMissingTable(err) ? "SAVE_UNAVAILABLE" : "SAVE_FAILED" });
    }
  }
  __name(handleCreate, "handleCreate");
  function cleanTag(v, max) {
    const s = String(v == null ? "" : v).replace(/[^\w.:/\-+ %@]/g, "").slice(0, max);
    return s || null;
  }
  __name(cleanTag, "cleanTag");
  const adminJson = /* @__PURE__ */ __name((obj, status = 200) => rentalResponse(obj, status, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization" }), "adminJson");
  function present(row) {
    return {
      id: row.id,
      reference: row.reference,
      related_reference: row.related_reference || null,
      kind: "rental_enquiry",
      status: row.status,
      status_updated_at: row.status_updated_at,
      partner: row.partner,
      guest_name: row.guest_name,
      guest_phone: row.guest_phone,
      whatsapp_link: whatsappLink(row.guest_phone_digits),
      guest_email: row.guest_email || null,
      pickup_location: row.pickup_location,
      dropoff_location: row.dropoff_location,
      pickup_date: row.pickup_date,
      pickup_time: row.pickup_time,
      return_date: row.return_date,
      return_time: row.return_time,
      passengers: row.passengers,
      bags: row.bags,
      vehicle_preference: row.vehicle_preference,
      driver_age_band: row.driver_age_band,
      licence_country: row.licence_country,
      flight_number: row.flight_number || null,
      notes: row.notes || null,
      staff_note: row.staff_note || null,
      consent: { share_with_partner: !!row.consent_share_partner, whatsapp_group: !!row.consent_whatsapp_group, version: row.consent_version, at: row.consent_at },
      created_at: row.created_at,
      alert: row.alert_state === void 0 ? void 0 : { state: row.alert_state || "NOT_ATTEMPTED", attempts: row.alert_attempts || 0, last_outcome: row.alert_last_outcome || null, last_error: row.alert_last_error || null, provider_accepted: row.alert_state === "SENT" }
    };
  }
  __name(present, "present");
  async function handleAdminList(request, env, url) {
    if (!await requireAdmin2(request, env)) return adminJson({ error: "Unauthorized." }, 401);
    if (!env.DB) return adminJson({ ok: false, error: "Database not available." }, 503);
    const status = url.searchParams.get("status") || "";
    if (status && status !== "all" && !RENTAL_STATUSES.includes(status)) return adminJson({ ok: false, error: "Unknown status." }, 400);
    const q = (url.searchParams.get("q") || "").trim().slice(0, 80);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 1), 200);
    const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);
    const where = [];
    const binds = [];
    if (status && status !== "all") {
      where.push("r.status = ?");
      binds.push(status);
    }
    if (url.searchParams.get("attention") === "1") where.push(`(ns.state IS NULL OR ns.state != 'SENT')`);
    if (q) {
      const like = `%${q.replace(/[%_\\]/g, (c) => "\\" + c)}%`;
      const digits = q.replace(/\D/g, "");
      where.push(`(r.reference LIKE ? ESCAPE '\\' OR r.guest_name LIKE ? ESCAPE '\\' OR r.guest_email LIKE ? ESCAPE '\\'${digits.length >= 4 ? " OR r.guest_phone_digits LIKE ?" : ""})`);
      binds.push(like, like, like);
      if (digits.length >= 4) binds.push(`%${digits}%`);
    }
    try {
      const rows = await env.DB.prepare(
        `SELECT r.*, ns.state AS alert_state, ns.attempt_count AS alert_attempts, ns.last_outcome AS alert_last_outcome, ns.last_error AS alert_last_error
         FROM rental_enquiries r LEFT JOIN rental_notification_state ns ON ns.rental_id = r.id
         ${where.length ? "WHERE " + where.join(" AND ") : ""}
         ORDER BY CASE r.status WHEN 'new' THEN 0 ELSE 1 END, r.id DESC LIMIT ? OFFSET ?`
      ).bind(...binds, limit, offset).all();
      const counts = { new: 0, contacted: 0, quoted: 0, confirmed: 0, completed: 0, cancelled: 0 };
      for (const c of (await env.DB.prepare(`SELECT status, COUNT(*) AS n FROM rental_enquiries GROUP BY status`).all()).results || []) counts[c.status] = c.n;
      const att = await env.DB.prepare(`SELECT COUNT(*) AS n FROM rental_enquiries r LEFT JOIN rental_notification_state ns ON ns.rental_id = r.id WHERE ns.state IS NULL OR ns.state != 'SENT'`).first();
      return adminJson({ ok: true, rentals: (rows.results || []).map(present), counts, alerts_needing_attention: att ? att.n : 0, note: "Rental enquiries are separate from transfer bookings. A saved enquiry is not a confirmed rental." });
    } catch (err) {
      if (isMissingTable(err)) return adminJson({ ok: false, error: "Rental tables are not installed yet (migration milestone38 not applied)." }, 503);
      console.error("[rental-admin-list]", err.message);
      return adminJson({ ok: false, error: "Could not load rental enquiries." }, 500);
    }
  }
  __name(handleAdminList, "handleAdminList");
  async function handleAdminDetail(request, env, id) {
    if (!await requireAdmin2(request, env)) return adminJson({ error: "Unauthorized." }, 401);
    const row = await env.DB.prepare(
      `SELECT r.*, ns.state AS alert_state, ns.attempt_count AS alert_attempts, ns.last_outcome AS alert_last_outcome, ns.last_error AS alert_last_error
       FROM rental_enquiries r LEFT JOIN rental_notification_state ns ON ns.rental_id = r.id WHERE r.id = ?`
    ).bind(id).first();
    if (!row) return adminJson({ ok: false, error: "Not found." }, 404);
    const ev = await env.DB.prepare(`SELECT id, event_type, previous_status, new_status, actor, metadata, created_at FROM rental_enquiry_events WHERE rental_id = ? ORDER BY id`).bind(id).all();
    const events = (ev.results || []).map((e) => {
      let m = null;
      try {
        m = e.metadata ? JSON.parse(e.metadata) : null;
      } catch {
      }
      return { ...e, metadata: m };
    });
    return adminJson({ ok: true, rental: present(row), events });
  }
  __name(handleAdminDetail, "handleAdminDetail");
  async function readJson(request) {
    try {
      const t = await request.text();
      if (t.length > 4e3) return null;
      const b = JSON.parse(t);
      return b && typeof b === "object" ? b : null;
    } catch {
      return null;
    }
  }
  __name(readJson, "readJson");
  async function handleAdminStatus(request, env, id) {
    if (!await requireAdmin2(request, env)) return adminJson({ error: "Unauthorized." }, 401);
    const body = await readJson(request);
    if (!body) return adminJson({ ok: false, error: "Invalid JSON." }, 400);
    const next = String(body.status || "");
    if (!RENTAL_STATUSES.includes(next)) return adminJson({ ok: false, error: `status must be one of: ${RENTAL_STATUSES.join(", ")}` }, 400);
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 1e3) : "";
    const row = await env.DB.prepare(`SELECT id, status FROM rental_enquiries WHERE id = ?`).bind(id).first();
    if (!row) return adminJson({ ok: false, error: "Not found." }, 404);
    if (row.status === next) return adminJson({ ok: true, unchanged: true, status: next });
    if (!RENTAL_TRANSITIONS[row.status].includes(next)) return adminJson({ ok: false, error: `A rental enquiry cannot move from ${row.status} to ${next}. Allowed: ${RENTAL_TRANSITIONS[row.status].join(", ") || "none"}.` }, 409);
    const upd = await env.DB.prepare(`UPDATE rental_enquiries SET status = ?, status_updated_at = datetime('now'), staff_note = CASE WHEN ? != '' THEN ? ELSE staff_note END WHERE id = ? AND status = ?`).bind(next, note, note, id, row.status).run();
    if (upd.meta.changes !== 1) return adminJson({ ok: false, error: "This enquiry was changed by someone else. Reload and try again." }, 409);
    await logEvent(env, id, "status_changed", { previousStatus: row.status, newStatus: next, actor: "admin", metadata: note ? { note } : null });
    return adminJson({ ok: true, status: next, previous_status: row.status });
  }
  __name(handleAdminStatus, "handleAdminStatus");
  async function handleAdminNote(request, env, id) {
    if (!await requireAdmin2(request, env)) return adminJson({ error: "Unauthorized." }, 401);
    const body = await readJson(request);
    const note = body && typeof body.note === "string" ? body.note.trim().slice(0, 1e3) : null;
    if (note === null) return adminJson({ ok: false, error: "note is required." }, 400);
    const upd = await env.DB.prepare(`UPDATE rental_enquiries SET staff_note = ? WHERE id = ?`).bind(note || null, id).run();
    if (upd.meta.changes !== 1) return adminJson({ ok: false, error: "Not found." }, 404);
    await logEvent(env, id, "note_saved", { actor: "admin", metadata: { length: note.length } });
    return adminJson({ ok: true });
  }
  __name(handleAdminNote, "handleAdminNote");
  async function handleAdminResend(request, env, id) {
    if (!await requireAdmin2(request, env)) return adminJson({ error: "Unauthorized." }, 401);
    const rental2 = await env.DB.prepare(`SELECT * FROM rental_enquiries WHERE id = ?`).bind(id).first();
    if (!rental2) return adminJson({ ok: false, error: "Not found." }, 404);
    await env.DB.prepare(`INSERT OR IGNORE INTO rental_notification_state (rental_id, reference, state) VALUES (?, ?, 'NOT_ATTEMPTED')`).bind(rental2.id, rental2.reference).run();
    const before = await env.DB.prepare(`SELECT state, attempt_count, last_outcome FROM rental_notification_state WHERE rental_id = ?`).bind(rental2.id).first();
    const reset = await env.DB.prepare(
      `UPDATE rental_notification_state SET state = 'NOT_ATTEMPTED', attempt_count = 0, updated_at = datetime('now')
       WHERE rental_id = ? AND NOT (state = 'ATTEMPTING' AND updated_at >= datetime('now', ?))`
    ).bind(rental2.id, `-${ALERT_LEASE_SECONDS} seconds`).run();
    if (reset.meta.changes !== 1) return adminJson({ ok: false, error: "An alert attempt for this enquiry is already in progress. Try again in a minute." }, 409);
    await logEvent(env, id, "rental_alert_resend_requested", { actor: "admin", metadata: { previous_state: before ? before.state : null, previous_attempts: before ? before.attempt_count : null, previous_outcome: before ? before.last_outcome : null, note: "manual resend: retry timing and attempt count deliberately reset by authenticated staff" } });
    const result = await attemptAlert(env, rental2, { trigger: "admin_resend" });
    return adminJson({ ok: true, result });
  }
  __name(handleAdminResend, "handleAdminResend");
  return { handleCreate, handleAdminList, handleAdminDetail, handleAdminStatus, handleAdminNote, handleAdminResend, sweepAlerts, attemptAlert, buildAlertText, present, logEvent };
}
__name(createRental, "createRental");

// rental_console.mjs
function rentalConsoleHtml(nonce) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Rental enquiries - staff</title>
<style nonce="${nonce}">
:root{--ocean:#0066cc;--ocean-dark:#004d99;--teal:#00b386;--dark:#0f1923;--mid:#5a6b7a;--sand:#f5f0e8;--line:#d4dce4;--red:#c83e3e;--amber:#b8860b;--green:#1f8f5f}
*{box-sizing:border-box}body{margin:0;font-family:'DM Sans',-apple-system,Segoe UI,Roboto,sans-serif;background:#f8f7f4;color:var(--dark);padding:16px 14px 80px;line-height:1.45}
.wrap{max-width:980px;margin:0 auto}h1{font-size:22px;margin:0 0 4px;font-family:Sora,sans-serif}.sub{color:var(--mid);font-size:14px;margin:0 0 14px}
.banner{background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:10px 12px;font-size:13px;color:#7c2d12;margin-bottom:14px}
#gate{max-width:360px;margin:60px auto;text-align:center}#gate input{width:100%;padding:12px;border:1px solid var(--line);border-radius:8px;font-size:16px;margin-bottom:10px}
button{font:inherit;cursor:pointer}.primary{background:var(--ocean);color:#fff;border:0;border-radius:8px;padding:12px 16px;font-weight:600;min-height:44px}.primary:disabled{opacity:.5}
.wide{width:100%}.link{background:none;border:0;color:var(--ocean);text-decoration:underline;font-size:13px;padding:8px}.msg{font-size:13px;margin-top:8px;min-height:18px}.err{color:var(--red)}.ok{color:var(--green)}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.chip{border:1px solid var(--line);background:#fff;border-radius:20px;padding:8px 12px;font-size:13px;min-height:40px}.chip[aria-pressed=true]{background:var(--dark);color:#fff;border-color:var(--dark)}
.tools{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}.tools input{flex:1;min-width:180px;padding:10px;border:1px solid var(--line);border-radius:8px;font-size:15px}.tools button{border:1px solid var(--line);background:#fff;border-radius:8px;padding:10px 12px;min-height:42px}
.card{background:#fff;border:1px solid var(--line);border-left:5px solid var(--ocean);border-radius:10px;padding:14px;margin-bottom:12px}.card.new{border-left-color:var(--teal)}.card.cancelled{opacity:.7;border-left-color:#999}
.top{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:6px}.ref{font-family:Sora,sans-serif;font-weight:700;font-size:15px}.badge{display:inline-block;border-radius:12px;padding:2px 10px;font-size:12px;font-weight:700;background:#e6f0ff;color:var(--ocean-dark);text-transform:uppercase}
.badge.alert-ok{background:#e6f9f4;color:#0b6b4b}.badge.alert-warn{background:#fff4d6;color:#8a6100}.badge.alert-bad{background:#fdeaea;color:#8a1f1f}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 14px;font-size:14px;margin:8px 0}.grid b{color:var(--mid);font-weight:600;display:block;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.full{grid-column:1/-1}.actions{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.wa{background:#1f9d55;color:#fff;border-radius:8px;padding:11px 14px;font-weight:700;text-decoration:none;min-height:44px;display:inline-flex;align-items:center}
.sec{border:1px solid var(--line);background:#fff;border-radius:8px;padding:10px 12px;min-height:44px}select,textarea{font:inherit;padding:10px;border:1px solid var(--line);border-radius:8px;width:100%}textarea{min-height:60px}
.statusrow{display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:8px}.events{font-size:12px;color:var(--mid);margin-top:8px}.events div{padding:2px 0}.hint{font-size:12px;color:var(--mid)}
@media(max-width:560px){.grid{grid-template-columns:1fr}}
</style></head><body>
<div id="gate"><h1>Rental enquiries</h1><p class="sub">Staff sign-in (same PIN as the other admin pages).</p>
<input id="pin" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN" maxlength="12"><button class="primary wide" id="pinBtn">Sign in</button>
<button class="link" id="showTok" type="button">Use an admin token instead</button><div id="tokWrap" hidden><input id="tok" type="password" autocomplete="off" placeholder="Admin token"><button class="primary wide" id="tokBtn">Enter</button></div><div id="gmsg" class="msg" role="status"></div></div>
<div class="wrap" id="main" hidden><h1>Car rental enquiries</h1><p class="sub" id="subline">Loading...</p>
<div class="banner"><b>Separate from transfer bookings.</b> A saved enquiry is <b>not</b> a confirmed rental: Best Adventure Fiji confirms availability, price, terms and payment. Set <b>confirmed</b> only after the partner has confirmed.</div>
<div class="chips" id="chips" role="group" aria-label="Filter by status"></div>
<div class="tools"><input id="q" type="search" placeholder="Search reference, name, phone, email"><button id="attn" type="button" aria-pressed="false">Alert not confirmed</button><button id="refresh" type="button">Refresh</button><button id="logout" type="button">Log out</button></div>
<div id="err" class="msg err" role="alert"></div><div id="list"></div></div>
<script nonce="${nonce}">
(function(){
var KEY='nadi_rental_admin_token',token=sessionStorage.getItem(KEY)||'',statusF='new',attn=false,counts={},STATUSES=['new','contacted','quoted','confirmed','completed','cancelled'],NEXT={new:['contacted','quoted','cancelled'],contacted:['quoted','confirmed','cancelled'],quoted:['contacted','confirmed','cancelled'],confirmed:['completed','cancelled'],completed:[],cancelled:['new']};
var $=function(i){return document.getElementById(i)};
function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}
function api(path,opt){opt=opt||{};opt.headers=Object.assign({'Authorization':'Bearer '+token},opt.headers||{});return fetch(path,opt)}
function gmsg(t,c){var m=$('gmsg');m.textContent=t;m.className='msg '+(c||'')}
async function login(body,url){$('pinBtn').disabled=true;try{var r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});var d=await r.json();if(d.ok&&d.token){token=d.token;sessionStorage.setItem(KEY,token);await start()}else gmsg(d.error||'Could not sign in.','err')}catch(e){gmsg('Connection error.','err')}$('pinBtn').disabled=false}
$('pinBtn').onclick=function(){var p=$('pin').value.trim();if(p)login({pin:p},'/admin/login-pin')};
$('pin').onkeydown=function(e){if(e.key==='Enter')$('pinBtn').click()};$('tok').onkeydown=function(e){if(e.key==='Enter')$('tokBtn').click()};
$('showTok').onclick=function(){$('tokWrap').hidden=false;$('showTok').hidden=true};
$('tokBtn').onclick=async function(){var t=$('tok').value.trim();if(!t)return;token=t;if(await load()){sessionStorage.setItem(KEY,token);show()}else{token='';gmsg('Invalid token.','err')}};
$('logout').onclick=function(){sessionStorage.removeItem(KEY);token='';$('main').hidden=true;$('gate').hidden=false};
$('refresh').onclick=load;$('attn').onclick=function(){attn=!attn;$('attn').setAttribute('aria-pressed',String(attn));load()};
var qt=null;$('q').oninput=function(){clearTimeout(qt);qt=setTimeout(load,350)};
function show(){$('gate').hidden=true;$('main').hidden=false}
async function start(){if(await load())show()}
function badge(a){var b=el('span','badge');if(!a){b.textContent='alert unknown';return b}
 if(a.state==='SENT'){b.className='badge alert-ok';b.textContent='alert accepted by WhatsApp'}
 else if(a.attempts>=6){b.className='badge alert-bad';b.textContent='alert FAILED - contact guest'}
 else if(a.state==='FAILED_RETRYABLE'||a.state==='ATTEMPTING'){b.className='badge alert-warn';b.textContent='alert retrying ('+a.attempts+')'}
 else{b.className='badge alert-warn';b.textContent='alert pending'}return b}
function field(g,label,value,full){var d=el('div',full?'full':'');d.appendChild(el('b','',label));d.appendChild(document.createTextNode(value||'-'));g.appendChild(d)}
function card(r){
 var c=el('div','card '+r.status);c.id='rental-'+r.id;var top=el('div','top');top.appendChild(el('span','ref',r.reference));var right=el('span');right.appendChild(el('span','badge',r.status));right.appendChild(document.createTextNode(' '));right.appendChild(badge(r.alert));top.appendChild(right);c.appendChild(top);
 c.appendChild(el('div','hint','Received '+r.created_at+' UTC - rental enquiry for Best Adventure Fiji (not a transfer booking)'));
 if(r.related_reference){c.appendChild(el('div','banner','Follows earlier enquiry '+r.related_reference+': same phone and times, but the details were changed. Check which one is current.'))}
 var g=el('div','grid');field(g,'Guest',r.guest_name);field(g,'WhatsApp',r.guest_phone);field(g,'Email',r.guest_email);field(g,'Driver age / licence from',r.driver_age_band+' / '+r.licence_country);
 field(g,'Collect',r.pickup_date+' '+r.pickup_time+' - '+r.pickup_location,true);field(g,'Return',r.return_date+' '+r.return_time+' - '+r.dropoff_location,true);
 field(g,'People / bags',r.passengers+' people, '+r.bags+' bags');field(g,'Vehicle preference',r.vehicle_preference);field(g,'Flight',r.flight_number);
 field(g,'Consent',(r.consent.share_with_partner?'share with partner: yes':'share with partner: NO')+'; '+(r.consent.whatsapp_group?'WhatsApp group: yes':'WhatsApp group: NO')+' ('+r.consent.version+')',true);
 field(g,'Guest notes',r.notes,true);c.appendChild(g);
 var act=el('div','actions');var wa=el('a','wa','Message guest on WhatsApp');wa.href=r.whatsapp_link||'#';wa.target='_blank';wa.rel='noopener';act.appendChild(wa);
 var rs=el('button','sec','Resend staff alert');rs.type='button';rs.onclick=async function(){rs.disabled=true;var x=await api('/admin/rentals/'+r.id+'/resend-alert',{method:'POST'});var d=await x.json().catch(function(){return{}});rs.textContent=d.ok?'Alert attempt: '+((d.result&&d.result.state)||'done'):'Could not resend';setTimeout(load,800)};act.appendChild(rs);
 var hb=el('button','sec','History');hb.type='button';var ev=el('div','events');ev.hidden=true;hb.onclick=async function(){ev.hidden=!ev.hidden;if(!ev.hidden){ev.replaceChildren(el('div','','Loading...'));var x=await api('/admin/rentals/'+r.id);var d=await x.json();ev.replaceChildren();(d.events||[]).forEach(function(e){ev.appendChild(el('div','',e.created_at+' - '+e.event_type+(e.new_status?' -> '+e.new_status:'')+(e.actor?' ('+e.actor+')':'')))})}};act.appendChild(hb);c.appendChild(act);c.appendChild(ev);
 var opts=NEXT[r.status]||[];
 if(opts.length){var row=el('div','statusrow');var sel=el('select');sel.setAttribute('aria-label','Change status');var o0=el('option','',  'Change status...');o0.value='';sel.appendChild(o0);opts.forEach(function(s){var o=el('option','',s);o.value=s;sel.appendChild(o)});row.appendChild(sel);var sb=el('button','primary','Save status');sb.type='button';row.appendChild(sb);c.appendChild(row);
  var note=el('textarea');note.placeholder='Optional staff note (kept with the status change)';note.maxLength=1000;note.value=r.staff_note||'';c.appendChild(note);
  var m=el('div','msg');c.appendChild(m);sb.onclick=async function(){if(!sel.value)return;if(sel.value==='confirmed'&&!confirm('Set CONFIRMED only after Best Adventure Fiji has confirmed the vehicle and terms. Continue?'))return;sb.disabled=true;var x=await api('/admin/rentals/'+r.id+'/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:sel.value,note:note.value})});var d=await x.json().catch(function(){return{}});if(d.ok){m.className='msg ok';m.textContent='Saved.';load()}else{m.className='msg err';m.textContent=d.error||'Could not save.';sb.disabled=false}}}
 else{c.appendChild(el('div','hint','No further status changes from '+r.status+'.'))}
 return c}
async function load(){
 $('err').textContent='';
 try{var p=new URLSearchParams();p.set('status',statusF);if(attn)p.set('attention','1');var q=$('q').value.trim();if(q)p.set('q',q);
  var res=await api('/admin/rentals?'+p.toString());if(!res.ok){if(!$('main').hidden){$('err').textContent='Could not load (status '+res.status+').'}return false}
  var d=await res.json();counts=d.counts||{};renderChips();$('subline').textContent=(d.rentals||[]).length+' shown - '+(d.alerts_needing_attention||0)+' with an alert not yet accepted by WhatsApp';
  var list=$('list');list.replaceChildren();if(!(d.rentals||[]).length){list.appendChild(el('p','hint','No rental enquiries in this view.'))}(d.rentals||[]).forEach(function(r){list.appendChild(card(r))});
  var ref=new URLSearchParams(location.search).get('ref');if(ref&&!q){$('q').value=ref;history.replaceState({},'',location.pathname);statusF='all';return load()}
  return true}catch(e){if(!$('main').hidden)$('err').textContent='Connection error.';return false}}
function renderChips(){var c=$('chips');c.replaceChildren();['all'].concat(STATUSES).forEach(function(s){var b=el('button','chip',s==='all'?'All':s+' ('+(counts[s]||0)+')');b.type='button';b.setAttribute('aria-pressed',String(statusF===s));b.onclick=function(){statusF=s;load()};c.appendChild(b)})}
if(token)start();
})();
<\/script></body></html>`;
}
__name(rentalConsoleHtml, "rentalConsoleHtml");

// worker.js
var rental = createRental({ requireAdmin, getAdminAlertPhones, sendHealthAlertWhatsApp, createEscalation, sqliteNow, sanitiseWhatsAppParamText, classifyAlertFailure });
var JSON_CORS = {
  "Access-Control-Allow-Origin": "*",
  // PATCH added for Milestone 7's destination edit endpoint - every prior
  // write endpoint in this file was POST-only, so nothing needed it before.
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
var ALLOWED_VEHICLE_TYPES = ["sedan", "minivan", "minibus", "boat"];
var NEGOTIATION_FLOOR_RATIO = 0.8;
var NADI_AIRPORT_ZONE_NAME = "Nadi Airport";
var ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
var MAX_PHOTO_BYTES = 8 * 1024 * 1024;
var DOC_URL_TTL_SECONDS = 3600;
var MAGIC_LINK_TTL_SECONDS = 7 * 24 * 3600;
var DRIVER_WELCOME_TEMPLATE = "vakaviti_driver_welcome";
var DRIVER_WELCOME_LANG_CODE = "en";
var BOOKING_BROADCAST_TEMPLATE = "vakaviti_booking_broadcast";
var BOOKING_BROADCAST_LANG_CODE = "en";
var DRIVER_RETURN_TEMPLATE = "vakaviti_driver_return";
var DRIVER_RETURN_LANG_CODE = "en";
var DRIVER_APP_URL = "https://driver.fijidash.com/driver-app";
var GUEST_DRIVER_ASSIGNED_TEMPLATE = "vakaviti_guest_driver_assigned";
var GUEST_DRIVER_ASSIGNED_LANG_CODE = "en";
var GUEST_EN_ROUTE_TEMPLATE = "vakaviti_guest_en_route";
var GUEST_EN_ROUTE_LANG_CODE = "en";
var ADMIN_LOGIN_PHONE = "+61413335007";
var ADMIN_LOGIN_TEMPLATE = "vakaviti_admin_login";
var ADMIN_LOGIN_LANG_CODE = "en";
var PIN_MIN_DIGITS = 6;
var PIN_MAX_ATTEMPTS = 5;
var PIN_LOCKOUT_MINUTES = 15;
var PIN_PBKDF2_ITERATIONS = 1e5;
var FCCC_PETROLEUM_URL = "https://fccc.gov.fj/master-price-list/petroleum/";
var FCCC_PDF_LINK_RE = /href="(https:\/\/fccc\.gov\.fj\/wp-content\/uploads\/[^"]*Petroleum-Prices[^"]*\.pdf)"/;
var FUEL_MULTIPLIER_BASELINE_FJD = 3.93;
var FUEL_INDEX_ALERT_TEMPLATE = "vakaviti_fuel_index_alert";
var FUEL_INDEX_ALERT_LANG_CODE = "en";
var HEALTH_ALERT_TEMPLATE = "vakaviti_ops_health_alert";
var HEALTH_ALERT_LANG_CODE = "en";
var worker_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: JSON_CORS });
    }
    if (request.method === "GET" && url.pathname === "/health") {
      return handleHealth(env);
    }
    if (request.method === "POST" && url.pathname === "/admin/health-check/run") {
      return handleAdminHealthCheckRun(request, env);
    }
    if (request.method === "POST" && url.pathname === "/admin/backup/run") {
      return handleAdminBackupRun(request, env);
    }
    if (request.method === "GET" && url.pathname === "/admin/whatsapp/templates") {
      return handleAdminWhatsAppTemplatesList(request, env);
    }
    if (request.method === "GET" && url.pathname === "/admin/whatsapp/phone-info") {
      return handleAdminWhatsAppPhoneInfo(request, env);
    }
    if (request.method === "GET" && url.pathname === "/zones") {
      return handleZones(env);
    }
    if (request.method === "POST" && url.pathname === "/drivers") {
      return handleDriverSubmit(request, env);
    }
    if (request.method === "POST" && url.pathname === "/bookings") {
      return handleGuestBookingCreate(request, env, ctx);
    }
    if (request.method === "POST" && url.pathname === "/negotiate") {
      return handleNegotiationCreate(request, env);
    }
    if (request.method === "GET" && url.pathname === "/reference-fare") {
      return handleReferenceFarePreview(request, env);
    }
    const negotiationStatusMatch = url.pathname.match(/^\/negotiate\/(\d+)$/);
    if (request.method === "GET" && negotiationStatusMatch) {
      return handleNegotiationStatus(request, env, Number(negotiationStatusMatch[1]));
    }
    const negotiationAcceptMatch = url.pathname.match(/^\/negotiate\/(\d+)\/accept-offer$/);
    if (request.method === "POST" && negotiationAcceptMatch) {
      return handleNegotiationAcceptOffer(request, env, Number(negotiationAcceptMatch[1]));
    }
    const negotiationDeclineMatch = url.pathname.match(/^\/negotiate\/(\d+)\/decline$/);
    if (request.method === "POST" && negotiationDeclineMatch) {
      return handleNegotiationDecline(request, env, Number(negotiationDeclineMatch[1]));
    }
    if (request.method === "POST" && url.pathname === "/quote") {
      return handleQuoteCreate(request, env);
    }
    if (request.method === "POST" && url.pathname === "/escalate") {
      return handleEscalationCreate(request, env);
    }
    if (request.method === "GET" && url.pathname.startsWith("/admin/docs/")) {
      return handleDocServe(request, env, url);
    }
    if (request.method === "GET" && url.pathname === "/admin/drivers") {
      return handleAdminListDrivers(request, env, url);
    }
    const approveMatch = url.pathname.match(/^\/admin\/drivers\/(\d+)\/approve$/);
    if (request.method === "POST" && approveMatch) {
      return handleAdminApprove(request, env, Number(approveMatch[1]));
    }
    const rejectMatch = url.pathname.match(/^\/admin\/drivers\/(\d+)\/reject$/);
    if (request.method === "POST" && rejectMatch) {
      return handleAdminReject(request, env, Number(rejectMatch[1]));
    }
    const suspendMatch = url.pathname.match(/^\/admin\/drivers\/(\d+)\/suspend$/);
    if (request.method === "POST" && suspendMatch) {
      return handleAdminSuspendDriver(request, env, Number(suspendMatch[1]));
    }
    const reactivateMatch = url.pathname.match(/^\/admin\/drivers\/(\d+)\/reactivate$/);
    if (request.method === "POST" && reactivateMatch) {
      return handleAdminReactivateDriver(request, env, Number(reactivateMatch[1]));
    }
    const driverZonesMatch = url.pathname.match(/^\/admin\/drivers\/(\d+)\/zones$/);
    if (request.method === "POST" && driverZonesMatch) {
      return handleAdminUpdateDriverZones(request, env, Number(driverZonesMatch[1]));
    }
    if (request.method === "POST" && url.pathname === "/driver/login") {
      return handleDriverLogin(request, env);
    }
    if (request.method === "GET" && url.pathname === "/driver/me") {
      return handleDriverMe(request, env);
    }
    if (request.method === "POST" && url.pathname === "/driver/online") {
      return handleDriverOnline(request, env);
    }
    if (request.method === "GET" && url.pathname === "/driver/jobs") {
      return handleDriverJobs(request, env);
    }
    if (request.method === "GET" && url.pathname === "/driver/wallet") {
      return handleDriverWallet(request, env);
    }
    const acceptMatch = url.pathname.match(/^\/driver\/bookings\/(\d+)\/accept$/);
    if (request.method === "POST" && acceptMatch) {
      return handleDriverAcceptBooking(request, env, Number(acceptMatch[1]));
    }
    const statusMatch = url.pathname.match(/^\/driver\/bookings\/(\d+)\/status$/);
    if (request.method === "POST" && statusMatch) {
      return handleDriverBookingStatus(request, env, Number(statusMatch[1]));
    }
    if (request.method === "GET" && url.pathname === "/driver/negotiation-requests") {
      return handleDriverNegotiationRequests(request, env);
    }
    const negotiationOfferMatch = url.pathname.match(/^\/driver\/negotiation-requests\/(\d+)\/offer$/);
    if (request.method === "POST" && negotiationOfferMatch) {
      return handleDriverNegotiationOffer(request, env, Number(negotiationOfferMatch[1]));
    }
    if (request.method === "POST" && url.pathname === "/admin/login") {
      return handleAdminLogin(request, env);
    }
    if (request.method === "POST" && url.pathname === "/admin/login-pin") {
      return handleAdminLoginPin(request, env);
    }
    if (request.method === "POST" && url.pathname === "/admin/set-pin") {
      return handleAdminSetPin(request, env);
    }
    if (request.method === "POST" && url.pathname === "/admin/test-booking") {
      return handleAdminTestBooking(request, env);
    }
    if (request.method === "GET" && url.pathname === "/admin/bookings") {
      return handleAdminListBookings(request, env, url);
    }
    const bookingEventsMatch = url.pathname.match(/^\/admin\/bookings\/(\d+)\/events$/);
    if (request.method === "GET" && bookingEventsMatch) {
      return handleAdminListBookingEvents(request, env, Number(bookingEventsMatch[1]));
    }
    if (request.method === "POST" && url.pathname === "/admin/bookings/manual-assign") {
      return handleAdminManualAssign(request, env);
    }
    const cancelBookingMatch = url.pathname.match(/^\/admin\/bookings\/(\d+)\/cancel$/);
    if (request.method === "POST" && cancelBookingMatch) {
      return handleAdminCancelBooking(request, env, Number(cancelBookingMatch[1]));
    }
    if (request.method === "GET" && url.pathname === "/admin/dashboard-stats") {
      return handleAdminDashboardStats(request, env);
    }
    if (request.method === "GET" && url.pathname === "/admin/financials") {
      return handleAdminFinancials(request, env, url);
    }
    if (request.method === "GET" && url.pathname === "/admin/escalations") {
      return handleAdminListEscalations(request, env, url);
    }
    const resolveEscalationMatch = url.pathname.match(/^\/admin\/escalations\/(\d+)\/resolve$/);
    if (request.method === "POST" && resolveEscalationMatch) {
      return handleAdminResolveEscalation(request, env, Number(resolveEscalationMatch[1]));
    }
    if (request.method === "GET" && url.pathname === "/admin/negotiations") {
      return handleAdminListNegotiations(request, env, url);
    }
    if (request.method === "POST" && url.pathname === "/admin/max-hours-sweep") {
      return handleAdminMaxHoursSweep(request, env);
    }
    if (request.method === "GET" && url.pathname === "/fuel-index") {
      return handleFuelIndexPublic(request, env);
    }
    if (request.method === "POST" && url.pathname === "/admin/fuel-index/check") {
      return handleAdminFuelIndexCheck(request, env);
    }
    if (request.method === "POST" && url.pathname === "/admin/fuel-index/submit") {
      return handleAdminFuelIndexSubmit(request, env);
    }
    const fuelConfirmMatch = url.pathname.match(/^\/admin\/fuel-index\/pending\/(\d+)\/confirm$/);
    if (request.method === "POST" && fuelConfirmMatch) {
      return handleAdminFuelIndexConfirm(request, env, Number(fuelConfirmMatch[1]));
    }
    const fuelRejectMatch = url.pathname.match(/^\/admin\/fuel-index\/pending\/(\d+)\/reject$/);
    if (request.method === "POST" && fuelRejectMatch) {
      return handleAdminFuelIndexReject(request, env, Number(fuelRejectMatch[1]));
    }
    if (request.method === "GET" && url.pathname === "/destinations") {
      return handleDestinationsPublic(env);
    }
    if (request.method === "GET" && url.pathname === "/admin/destinations") {
      return handleAdminDestinationsList(request, env);
    }
    if (request.method === "POST" && url.pathname === "/admin/destinations") {
      return handleAdminDestinationCreate(request, env);
    }
    const destEditMatch = url.pathname.match(/^\/admin\/destinations\/(\d+)$/);
    if (request.method === "PATCH" && destEditMatch) {
      return handleAdminDestinationEdit(request, env, Number(destEditMatch[1]));
    }
    const destDeactivateMatch = url.pathname.match(/^\/admin\/destinations\/(\d+)\/deactivate$/);
    if (request.method === "POST" && destDeactivateMatch) {
      return handleAdminDestinationDeactivate(request, env, Number(destDeactivateMatch[1]));
    }
    if (request.method === "POST" && url.pathname === "/rental-enquiries") {
      return rental.handleCreate(request, env, ctx);
    }
    if (request.method === "GET" && url.pathname === RENTAL_CONSOLE_PATH) {
      const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
      return new Response(rentalConsoleHtml(nonce), {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Robots-Tag": "noindex, nofollow",
          "X-Frame-Options": "DENY",
          "Referrer-Policy": "no-referrer",
          "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
        }
      });
    }
    if (request.method === "GET" && url.pathname === "/admin/rentals") {
      return rental.handleAdminList(request, env, url);
    }
    const rentalMatch = url.pathname.match(/^\/admin\/rentals\/(\d+)(?:\/(status|note|resend-alert))?$/);
    if (rentalMatch) {
      const rid = Number(rentalMatch[1]);
      if (request.method === "GET" && !rentalMatch[2]) return rental.handleAdminDetail(request, env, rid);
      if (request.method === "POST" && rentalMatch[2] === "status") return rental.handleAdminStatus(request, env, rid);
      if (request.method === "POST" && rentalMatch[2] === "note") return rental.handleAdminNote(request, env, rid);
      if (request.method === "POST" && rentalMatch[2] === "resend-alert") return rental.handleAdminResend(request, env, rid);
    }
    return json({ error: "Not found." }, 404);
  },
  // Cron dispatch — controller.cron tells us which of the two schedules
  // fired (wrangler.toml registers both), so one scheduled() export can
  // route to the right job rather than needing two separate Workers.
  async scheduled(controller, env, ctx) {
    if (controller.cron === "*/15 * * * *") {
      ctx.waitUntil(enforceMaxHoursCap(env));
    } else if (controller.cron === "0 12 * * 6") {
      ctx.waitUntil(checkFuelIndexUpdate(env));
    } else if (controller.cron === "*/5 * * * *") {
      ctx.waitUntil(Promise.allSettled([runHealthCheckAlert(env), sweepAdminNotifications(env), sweepDriverBroadcasts(env), rental.sweepAlerts(env)]));
    } else if (controller.cron === "0 14 * * *") {
      ctx.waitUntil(runD1Backup(env));
    }
  }
};
async function checkOverallHealth(env) {
  const status = {
    service: "nadi-dispatch-api",
    phase: 1,
    milestone: "health-monitoring-and-backups",
    db_connected: false,
    r2_connected: !!env.DOCS,
    whatsapp_configured: !!(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID),
    tables: []
  };
  if (!env.DB) {
    status.healthy = false;
    return status;
  }
  try {
    const result = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    ).all();
    status.db_connected = true;
    status.tables = (result.results || []).map((r) => r.name);
  } catch (err) {
    status.db_error = "Database check failed.";
    console.error("[health] db check failed:", err.message);
  }
  status.healthy = status.db_connected && status.whatsapp_configured;
  return status;
}
__name(checkOverallHealth, "checkOverallHealth");
async function handleHealth(env) {
  const status = await checkOverallHealth(env);
  return json(status, status.healthy ? 200 : 503);
}
__name(handleHealth, "handleHealth");
async function runHealthCheckAlert(env) {
  const status = await checkOverallHealth(env);
  const lastStatus = await getSetting(env, "health_check_last_status", "healthy");
  const currentStatus = status.healthy ? "healthy" : "unhealthy";
  const transitioned = currentStatus !== lastStatus;
  let alert = null;
  if (transitioned) {
    const alertPhone = await getSetting(env, "admin_alert_phone", "");
    const state = currentStatus === "unhealthy" ? "DOWN" : "RECOVERED";
    const timestamp = sqliteNow();
    alert = alertPhone ? await sendHealthAlertWhatsApp(env, alertPhone, state, timestamp) : { attempted: false, reason: "platform_settings.admin_alert_phone is not set." };
  }
  await env.DB.prepare(
    `INSERT INTO platform_settings (key, value, updated_at) VALUES ('health_check_last_status', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).bind(currentStatus).run();
  return { checked_at: sqliteNow(), status: currentStatus, transitioned, alert, health: status };
}
__name(runHealthCheckAlert, "runHealthCheckAlert");
async function handleAdminHealthCheckRun(request, env) {
  if (!await requireAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  const result = await runHealthCheckAlert(env);
  return json(result, 200);
}
__name(handleAdminHealthCheckRun, "handleAdminHealthCheckRun");
async function handleAdminWhatsAppTemplatesList(request, env) {
  if (!await requireAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID) {
    return json({ ok: false, error: "WHATSAPP_TOKEN/WHATSAPP_PHONE_ID not configured on this Worker." }, 503);
  }
  try {
    const url = new URL(request.url);
    let wabaId = url.searchParams.get("waba_id");
    if (!wabaId) {
      const phoneRes = await fetch(
        `https://graph.facebook.com/v19.0/${env.WHATSAPP_PHONE_ID}?fields=whatsapp_business_account{id}`,
        { headers: { "Authorization": `Bearer ${env.WHATSAPP_TOKEN}` } }
      );
      const phoneBody = await phoneRes.json().catch(() => null);
      if (!phoneRes.ok || !phoneBody?.whatsapp_business_account?.id) {
        return json({
          ok: false,
          error: "Could not resolve WABA id from WHATSAPP_PHONE_ID. Pass ?waba_id=<id> explicitly (find it in WhatsApp Manager > Account overview) to skip auto-discovery.",
          detail: phoneBody
        }, 502);
      }
      wabaId = phoneBody.whatsapp_business_account.id;
    }
    const templatesRes = await fetch(
      `https://graph.facebook.com/v19.0/${wabaId}/message_templates?fields=name,language,status,category&limit=100`,
      { headers: { "Authorization": `Bearer ${env.WHATSAPP_TOKEN}` } }
    );
    const templatesBody = await templatesRes.json().catch(() => null);
    if (!templatesRes.ok) {
      return json({ ok: false, error: "Graph API templates list failed.", detail: templatesBody }, 502);
    }
    return json({ ok: true, waba_id: wabaId, templates: templatesBody.data || [] }, 200);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
__name(handleAdminWhatsAppTemplatesList, "handleAdminWhatsAppTemplatesList");
async function handleAdminWhatsAppPhoneInfo(request, env) {
  if (!await requireAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID) {
    return json({ ok: false, error: "WHATSAPP_TOKEN/WHATSAPP_PHONE_ID not configured on this Worker." }, 503);
  }
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${env.WHATSAPP_PHONE_ID}?fields=display_phone_number,verified_name,quality_rating`,
      { headers: { "Authorization": `Bearer ${env.WHATSAPP_TOKEN}` } }
    );
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      return json({ ok: false, error: "Graph API phone lookup failed.", detail: body }, 502);
    }
    return json({ ok: true, phone_info: body }, 200);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}
__name(handleAdminWhatsAppPhoneInfo, "handleAdminWhatsAppPhoneInfo");
async function handleZones(env) {
  if (!env.DB) return json({ zones: [] }, 503);
  try {
    const result = await env.DB.prepare(`SELECT id, name FROM zones ORDER BY id`).all();
    return json({ zones: result.results || [] }, 200);
  } catch (err) {
    console.error("[zones] failed:", err.message);
    return json({ zones: [], error: "Failed to load zones." }, 500);
  }
}
__name(handleZones, "handleZones");
async function handleDriverSubmit(request, env) {
  if (!env.DB) return json({ ok: false, error: "Database not available." }, 503);
  if (!env.DOCS) return json({ ok: false, error: "Document storage not available. R2 bucket is not yet bound to this Worker." }, 503);
  const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
  const rateLimit = await checkDriverSubmitRateLimit(env, clientIp);
  if (rateLimit.limited) {
    return json({ ok: false, error: "Too many driver applications from this connection. Please try again later, or contact us directly if you need help applying." }, 429);
  }
  await env.DB.prepare(`INSERT INTO driver_submit_lookups (source_ip) VALUES (?)`).bind(clientIp).run();
  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: "Invalid form submission." }, 400);
  }
  const name = (form.get("name") || "").toString().trim();
  const phone = normaliseDriverPhone((form.get("phone") || "").toString());
  const vehicleType = (form.get("vehicle_type") || "").toString().trim().toLowerCase();
  const plate = (form.get("plate") || "").toString().trim().toUpperCase();
  const zones = form.getAll("zones").map((z) => z.toString().trim()).filter(Boolean);
  const vehiclePhoto = form.get("vehicle_photo");
  const licensePhoto = form.get("license_photo");
  const insurancePhoto = form.get("insurance_photo");
  const errors = [];
  if (!name) errors.push("name is required");
  if (!phone) errors.push("a valid phone number is required");
  if (!ALLOWED_VEHICLE_TYPES.includes(vehicleType)) errors.push(`vehicle_type must be one of: ${ALLOWED_VEHICLE_TYPES.join(", ")}`);
  if (!plate) errors.push("plate is required");
  if (zones.length === 0) errors.push("at least one zone is required");
  if (!(vehiclePhoto instanceof File)) errors.push("vehicle_photo is required");
  if (!(licensePhoto instanceof File)) errors.push("license_photo is required");
  if (!(insurancePhoto instanceof File)) errors.push("insurance_photo is required");
  for (const [label, file] of [["vehicle_photo", vehiclePhoto], ["license_photo", licensePhoto], ["insurance_photo", insurancePhoto]]) {
    if (file instanceof File) {
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) errors.push(`${label} must be JPEG, PNG, or WebP (got ${file.type || "unknown"})`);
      if (file.size > MAX_PHOTO_BYTES) errors.push(`${label} exceeds 8MB limit`);
    }
  }
  if (zones.length > 0) {
    const validZones = await getValidZoneNames(env);
    const invalid = zones.filter((z) => !validZones.has(z));
    if (invalid.length > 0) errors.push(`unknown zone(s): ${invalid.join(", ")}`);
  }
  if (errors.length > 0) {
    return json({ ok: false, errors }, 400);
  }
  const existing = await env.DB.prepare(`SELECT id FROM drivers WHERE phone = ?`).bind(phone).first();
  if (existing) {
    return json({ ok: false, error: "A driver application with this phone number already exists." }, 409);
  }
  const docPrefix = `drivers/${phone.replace(/[^0-9]/g, "")}-${Date.now()}`;
  let vehicleKey, licenseKey, insuranceKey;
  try {
    vehicleKey = await uploadToR2(env, `${docPrefix}/vehicle${extFor(vehiclePhoto.type)}`, vehiclePhoto);
    licenseKey = await uploadToR2(env, `${docPrefix}/license${extFor(licensePhoto.type)}`, licensePhoto);
    insuranceKey = await uploadToR2(env, `${docPrefix}/insurance${extFor(insurancePhoto.type)}`, insurancePhoto);
  } catch (err) {
    console.error("[driver-submit] document upload failed:", err.message);
    return json({ ok: false, error: "Failed to upload documents. Please try again." }, 500);
  }
  try {
    const driverInsert = await env.DB.prepare(
      `INSERT INTO drivers (name, phone, status, zones, license_photo_url, insurance_photo_url) VALUES (?, ?, 'pending', ?, ?, ?)`
    ).bind(name, phone, JSON.stringify(zones), licenseKey, insuranceKey).run();
    const driverId = driverInsert.meta.last_row_id;
    const vehicleInsert = await env.DB.prepare(
      `INSERT INTO vehicles (driver_id, type, plate, photo_url) VALUES (?, ?, ?, ?)`
    ).bind(driverId, vehicleType, plate, vehicleKey).run();
    const applicationSummary = `New driver application: ${name} (${phone}), ${vehicleType}, plate ${plate}, zones: ${zones.join(", ")}.`;
    for (const alertPhone of await getAdminAlertPhones(env)) {
      await sendHealthAlertWhatsApp(env, alertPhone, applicationSummary, sqliteNow());
    }
    return json({
      ok: true,
      driver_id: driverId,
      vehicle_id: vehicleInsert.meta.last_row_id,
      status: "pending"
    }, 201);
  } catch (err) {
    console.error("[driver-submit] save failed:", err.message);
    return json({ ok: false, error: "Failed to save application. Please try again." }, 500);
  }
}
__name(handleDriverSubmit, "handleDriverSubmit");
async function getValidZoneNames(env) {
  const result = await env.DB.prepare(`SELECT name FROM zones`).all();
  return new Set((result.results || []).map((r) => r.name));
}
__name(getValidZoneNames, "getValidZoneNames");
function normalisePhone(raw) {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.replace(/[^\d]/g, "").length < 7) return "";
  return digits;
}
__name(normalisePhone, "normalisePhone");
var FIJI_PHONE_RE = /^\+679\d{7}$/;
var AU_MOBILE_PHONE_RE = /^\+614\d{8}$/;
function normaliseDriverPhone(raw) {
  const digitsWithPlus = (raw || "").toString().trim().replace(/[^\d+]/g, "");
  const digitsOnly = digitsWithPlus.replace(/\+/g, "");
  if (FIJI_PHONE_RE.test(digitsWithPlus)) return digitsWithPlus;
  if (AU_MOBILE_PHONE_RE.test(digitsWithPlus)) return digitsWithPlus;
  if (/^\d{7}$/.test(digitsOnly)) return "+679" + digitsOnly;
  if (/^04\d{8}$/.test(digitsOnly)) return "+61" + digitsOnly.slice(1);
  if (/^4\d{8}$/.test(digitsOnly)) return "+61" + digitsOnly;
  return "";
}
__name(normaliseDriverPhone, "normaliseDriverPhone");
function extFor(mimeType) {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return ".jpg";
}
__name(extFor, "extFor");
async function uploadToR2(env, key, file) {
  const buf = await file.arrayBuffer();
  await env.DOCS.put(key, buf, { httpMetadata: { contentType: file.type } });
  return key;
}
__name(uploadToR2, "uploadToR2");
async function hmacSign(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sigBuf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hmacSign, "hmacSign");
async function signDocUrl(env, key, ttlSeconds = DOC_URL_TTL_SECONDS) {
  const exp = Math.floor(Date.now() / 1e3) + ttlSeconds;
  const sig = await hmacSign(env.DOC_SIGNING_SECRET, `${key}:${exp}`);
  return `/admin/docs/${encodeURIComponent(key)}?exp=${exp}&sig=${sig}`;
}
__name(signDocUrl, "signDocUrl");
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
__name(timingSafeEqual, "timingSafeEqual");
function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(bytesToHex, "bytesToHex");
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}
__name(hexToBytes, "hexToBytes");
async function derivePinHash(pin, saltBytes, iterations) {
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}
__name(derivePinHash, "derivePinHash");
async function hashPinForStorage(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePinHash(pin, salt, PIN_PBKDF2_ITERATIONS);
  return `pbkdf2$${PIN_PBKDF2_ITERATIONS}$${bytesToHex(salt)}$${hash}`;
}
__name(hashPinForStorage, "hashPinForStorage");
async function verifyPinAgainstStoredHash(pin, stored) {
  const parts = (stored || "").split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;
  const candidateHash = await derivePinHash(pin, hexToBytes(parts[2]), iterations);
  return timingSafeEqual(candidateHash, parts[3]);
}
__name(verifyPinAgainstStoredHash, "verifyPinAgainstStoredHash");
async function handleDocServe(request, env, url) {
  if (!env.DOCS) return json({ error: "Document storage not available." }, 503);
  if (!env.DOC_SIGNING_SECRET) return json({ error: "Signing not configured." }, 503);
  const key = decodeURIComponent(url.pathname.slice("/admin/docs/".length));
  const exp = url.searchParams.get("exp");
  const sig = url.searchParams.get("sig");
  const expNum = parseInt(exp, 10);
  if (!expNum || !sig || expNum < Math.floor(Date.now() / 1e3)) {
    return json({ error: "Link expired or invalid." }, 403);
  }
  const expectedSig = await hmacSign(env.DOC_SIGNING_SECRET, `${key}:${expNum}`);
  if (!timingSafeEqual(sig, expectedSig)) {
    return json({ error: "Invalid signature." }, 403);
  }
  const obj = await env.DOCS.get(key);
  if (!obj) return json({ error: "Document not found." }, 404);
  return new Response(obj.body, {
    status: 200,
    headers: {
      "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream",
      "Cache-Control": "private, max-age=300",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
__name(handleDocServe, "handleDocServe");
async function requireAdmin(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  if (env.ADMIN_TOKEN && timingSafeEqual(token, env.ADMIN_TOKEN)) return true;
  if (!env.DB) return false;
  const row = await env.DB.prepare(
    `SELECT id FROM admin_login_tokens
     WHERE token = ?
       AND expires_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9][T ][0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'
       AND date(substr(expires_at, 1, 10)) = substr(expires_at, 1, 10)
       AND julianday(expires_at) > julianday('now')`
  ).bind(token).first();
  return !!row;
}
__name(requireAdmin, "requireAdmin");
async function handleAdminListDrivers(request, env, url) {
  if (!await requireAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (!env.DB) return json({ drivers: [] }, 503);
  const status = url.searchParams.get("status") || "pending";
  const result = await env.DB.prepare(
    `SELECT d.id, d.name, d.phone, d.status, d.zones, d.license_photo_url, d.insurance_photo_url, d.created_at,
            v.id AS vehicle_id, v.type AS vehicle_type, v.plate, v.photo_url AS vehicle_photo_url
     FROM drivers d
     LEFT JOIN vehicles v ON v.driver_id = d.id
     WHERE d.status = ?
     ORDER BY d.created_at ASC`
  ).bind(status).all();
  const drivers = [];
  for (const row of result.results || []) {
    drivers.push({
      id: row.id,
      name: row.name,
      phone: row.phone,
      status: row.status,
      zones: JSON.parse(row.zones || "[]"),
      created_at: row.created_at,
      vehicle: { id: row.vehicle_id, type: row.vehicle_type, plate: row.plate },
      docs: {
        vehicle_photo: row.vehicle_photo_url ? await signDocUrl(env, row.vehicle_photo_url) : null,
        license_photo: row.license_photo_url ? await signDocUrl(env, row.license_photo_url) : null,
        insurance_photo: row.insurance_photo_url ? await signDocUrl(env, row.insurance_photo_url) : null
      }
    });
  }
  return json({ status, drivers }, 200);
}
__name(handleAdminListDrivers, "handleAdminListDrivers");
async function handleAdminListBookings(request, env, url) {
  if (!await requireAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (!env.DB) return json({ bookings: [] }, 503);
  const requestedLimit = Number(url.searchParams.get("limit"));
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 && requestedLimit <= 200 ? requestedLimit : 50;
  const status = url.searchParams.get("status");
  const search = (url.searchParams.get("search") || "").trim();
  const conditions = [];
  const whereParams = [];
  if (status) {
    conditions.push("b.status = ?");
    whereParams.push(status);
  }
  if (search) {
    conditions.push("(b.guest_name LIKE ? OR b.guest_phone LIKE ?)");
    whereParams.push(`%${search}%`, `%${search}%`);
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const staleAfterMinutes = Number(await getSetting(env, "booking_stale_after_minutes", "30"));
  const params = [staleAfterMinutes, ...whereParams, limit];
  const result = await env.DB.prepare(
    `SELECT b.id, b.guest_name, b.guest_phone, b.guest_email, b.pickup_zone, b.destination_zone, b.distance_km,
            b.vehicle_type, b.quoted_currency, b.quoted_amount, b.payment_method, b.status,
            b.pickup_date, b.pickup_time, b.flight_number, b.notes, b.client_booking_ref,
            b.created_at, d.name AS driver_name,
            (b.status = 'pending' AND b.assigned_driver_id IS NULL
             AND (julianday('now') - julianday(b.created_at)) * 24 * 60 >= ?) AS is_stale
     FROM bookings b
     LEFT JOIN drivers d ON d.id = b.assigned_driver_id
     ${whereClause}
     ORDER BY b.created_at DESC
     LIMIT ?`
  ).bind(...params).all();
  const bookings = (result.results || []).map((b) => ({ ...b, is_stale: !!b.is_stale }));
  return json({ bookings }, 200);
}
__name(handleAdminListBookings, "handleAdminListBookings");
async function handleAdminListBookingEvents(request, env, bookingId) {
  if (!await requireAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (!env.DB) return json({ events: [] }, 503);
  const booking = await env.DB.prepare(`SELECT id FROM bookings WHERE id = ?`).bind(bookingId).first();
  if (!booking) return json({ ok: false, error: "Booking not found." }, 404);
  const result = await env.DB.prepare(
    `SELECT id, event_type, previous_status, new_status, actor, metadata, created_at
     FROM booking_events WHERE booking_id = ? ORDER BY created_at ASC, id ASC`
  ).bind(bookingId).all();
  const events = (result.results || []).map((e) => ({
    ...e,
    metadata: e.metadata ? JSON.parse(e.metadata) : null
  }));
  return json({ booking_id: bookingId, events }, 200);
}
__name(handleAdminListBookingEvents, "handleAdminListBookingEvents");
async function handleAdminDashboardStats(request, env) {
  if (!await requireAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (!env.DB) return json({ error: "Database unavailable." }, 503);
  await expireStaleNegotiationRequests(env);
  const staleAfterMinutes = Number(await getSetting(env, "booking_stale_after_minutes", "30"));
  const [todayResult, byStatusResult, unassignedResult, staleUnassignedResult, escalationsResult, negotiationsByStatusResult, offlineMidJobResult, upcomingResult] = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS count FROM bookings WHERE date(created_at) = date('now')`),
    env.DB.prepare(`SELECT status, COUNT(*) AS count FROM bookings GROUP BY status`),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM bookings WHERE status = 'pending' AND assigned_driver_id IS NULL`),
    env.DB.prepare(
      `SELECT COUNT(*) AS count FROM bookings
       WHERE status = 'pending' AND assigned_driver_id IS NULL
         AND (julianday('now') - julianday(created_at)) * 24 * 60 >= ?`
    ).bind(staleAfterMinutes),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM escalations WHERE resolved = 0`),
    env.DB.prepare(`SELECT status, COUNT(*) AS count FROM negotiation_requests GROUP BY status`),
    // Milestone 30 - real gap the combined review found: nothing stopped,
    // or even flagged, a driver going offline (POST /driver/online,
    // handleDriverOnline) while still assigned to a booking that's
    // 'accepted' or 'en_route' - the guest is mid-trip or waiting for
    // pickup with a driver the platform itself no longer considers
    // reachable. Deliberately NOT blocked at the toggle - a driver may
    // have a real reason (phone died, emergency) and trapping them online
    // would be worse - this is the "surface it" half of the ask, so a
    // human can call the driver or the guest.
    env.DB.prepare(
      `SELECT b.id, b.guest_name, b.guest_phone, b.pickup_zone, b.destination_zone, b.status,
              d.id AS driver_id, d.name AS driver_name, d.phone AS driver_phone
       FROM bookings b
       JOIN drivers d ON d.id = b.assigned_driver_id
       WHERE b.status IN ('accepted', 'en_route') AND d.online = 0
       ORDER BY b.created_at ASC
       LIMIT 20`
    ),
    env.DB.prepare(
      `SELECT b.id, b.guest_name, b.pickup_zone, b.destination_zone, b.vehicle_type, b.status,
              b.pickup_date, b.pickup_time, d.name AS driver_name
       FROM bookings b
       LEFT JOIN drivers d ON d.id = b.assigned_driver_id
       WHERE b.pickup_date >= date('now')
       ORDER BY b.pickup_date ASC, b.pickup_time ASC
       LIMIT 20`
    )
  ]);
  const bookingsByStatus = {};
  for (const row of byStatusResult.results || []) bookingsByStatus[row.status] = row.count;
  const negotiationsByStatus = {};
  for (const row of negotiationsByStatusResult.results || []) negotiationsByStatus[row.status] = row.count;
  const offlineMidJob = offlineMidJobResult.results || [];
  return json({
    bookings_today: todayResult.results?.[0]?.count || 0,
    bookings_by_status: bookingsByStatus,
    unassigned_bookings: unassignedResult.results?.[0]?.count || 0,
    stale_unassigned_bookings: staleUnassignedResult.results?.[0]?.count || 0,
    booking_stale_after_minutes: staleAfterMinutes,
    active_escalations: escalationsResult.results?.[0]?.count || 0,
    negotiations_by_status: negotiationsByStatus,
    drivers_offline_mid_job: offlineMidJob.length,
    offline_mid_job: offlineMidJob,
    upcoming_transfers: upcomingResult.results || []
  }, 200);
}
__name(handleAdminDashboardStats, "handleAdminDashboardStats");
async function handleAdminFinancials(request, env, url) {
  if (!await requireAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (!env.DB) return json({ error: "Database unavailable." }, 503);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const bookingDateConditions = ["b.status = 'completed'"];
  const bookingDateParams = [];
  if (from) {
    bookingDateConditions.push("date(b.created_at) >= ?");
    bookingDateParams.push(from);
  }
  if (to) {
    bookingDateConditions.push("date(b.created_at) <= ?");
    bookingDateParams.push(to);
  }
  const bookingWhere = bookingDateConditions.join(" AND ");
  const txnDateConditions = [`wt.type = 'commission_owed'`];
  const txnDateParams = [];
  if (from) {
    txnDateConditions.push("date(wt.created_at) >= ?");
    txnDateParams.push(from);
  }
  if (to) {
    txnDateConditions.push("date(wt.created_at) <= ?");
    txnDateParams.push(to);
  }
  const txnWhere = txnDateConditions.join(" AND ");
  const [totalsResult, byDriverEarningsResult, byDriverCommissionResult, walletsResult] = await env.DB.batch([
    env.DB.prepare(
      `SELECT
         (SELECT COALESCE(SUM(b.settlement_amount_fjd), 0) FROM bookings b WHERE ${bookingWhere}) AS total_driver_earnings_fjd,
         (SELECT COALESCE(SUM(-wt.amount_fjd), 0) FROM wallet_transactions wt WHERE ${txnWhere}) AS total_commission_owed_fjd`
    ).bind(...bookingDateParams, ...txnDateParams),
    env.DB.prepare(
      `SELECT b.assigned_driver_id AS driver_id, COUNT(*) AS completed_bookings,
              COALESCE(SUM(b.settlement_amount_fjd), 0) AS driver_earnings_fjd
       FROM bookings b
       WHERE ${bookingWhere} AND b.assigned_driver_id IS NOT NULL
       GROUP BY b.assigned_driver_id`
    ).bind(...bookingDateParams),
    env.DB.prepare(
      `SELECT wt.driver_id, COALESCE(SUM(-wt.amount_fjd), 0) AS commission_owed_fjd
       FROM wallet_transactions wt
       WHERE ${txnWhere}
       GROUP BY wt.driver_id`
    ).bind(...txnDateParams),
    env.DB.prepare(`SELECT d.id AS driver_id, d.name AS driver_name, w.balance_fjd
                     FROM drivers d LEFT JOIN wallets w ON w.driver_id = d.id`)
  ]);
  const earningsByDriver = {};
  for (const row of byDriverEarningsResult.results || []) earningsByDriver[row.driver_id] = row;
  const commissionByDriver = {};
  for (const row of byDriverCommissionResult.results || []) commissionByDriver[row.driver_id] = row.commission_owed_fjd;
  const byDriver = (walletsResult.results || []).map((d) => ({
    driver_id: d.driver_id,
    driver_name: d.driver_name,
    completed_bookings: earningsByDriver[d.driver_id]?.completed_bookings || 0,
    driver_earnings_fjd: earningsByDriver[d.driver_id]?.driver_earnings_fjd || 0,
    commission_owed_fjd: commissionByDriver[d.driver_id] || 0,
    current_wallet_balance_fjd: d.balance_fjd ?? 0
  })).filter((d) => d.completed_bookings > 0 || d.current_wallet_balance_fjd !== 0).sort((a, b) => b.driver_earnings_fjd - a.driver_earnings_fjd);
  const totals = totalsResult.results?.[0] || { total_driver_earnings_fjd: 0, total_commission_owed_fjd: 0 };
  return json({
    period: { from: from || null, to: to || null },
    total_driver_earnings_fjd: totals.total_driver_earnings_fjd,
    total_commission_owed_fjd: totals.total_commission_owed_fjd,
    by_driver: byDriver
  }, 200);
}
__name(handleAdminFinancials, "handleAdminFinancials");
async function handleAdminListEscalations(request, env, url) {
  if (!await requireAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (!env.DB) return json({ escalations: [] }, 503);
  const requestedLimit = Number(url.searchParams.get("limit"));
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 && requestedLimit <= 200 ? requestedLimit : 50;
  const resolvedParam = url.searchParams.get("resolved");
  const resolved = resolvedParam === "1" ? 1 : 0;
  const search = (url.searchParams.get("search") || "").trim();
  const conditions = ["e.resolved = ?"];
  const params = [resolved];
  if (search) {
    conditions.push("(e.context LIKE ? OR b.guest_name LIKE ? OR b.guest_phone LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  params.push(limit);
  const result = await env.DB.prepare(
    `SELECT e.id, e.source, e.trigger_type, e.context, e.booking_id, e.driver_id,
            e.created_at, e.resolved,
            b.pickup_zone, b.destination_zone, b.guest_name AS booking_guest_name, b.guest_phone AS booking_guest_phone,
            d.name AS driver_name
     FROM escalations e
     LEFT JOIN bookings b ON b.id = e.booking_id
     LEFT JOIN drivers d ON d.id = e.driver_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY e.created_at DESC
     LIMIT ?`
  ).bind(...params).all();
  return json({ escalations: result.results || [] }, 200);
}
__name(handleAdminListEscalations, "handleAdminListEscalations");
async function handleAdminResolveEscalation(request, env, escalationId) {
  if (!await requireAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (!env.DB) return json({ ok: false, error: "Database not available." }, 503);
  const escalation = await env.DB.prepare(`SELECT id, resolved FROM escalations WHERE id = ?`).bind(escalationId).first();
  if (!escalation) return json({ ok: false, error: "Escalation not found." }, 404);
  if (escalation.resolved) return json({ ok: true, id: escalationId, resolved: true, already: true }, 200);
  await env.DB.prepare(`UPDATE escalations SET resolved = 1 WHERE id = ?`).bind(escalationId).run();
  return json({ ok: true, id: escalationId, resolved: true }, 200);
}
__name(handleAdminResolveEscalation, "handleAdminResolveEscalation");
async function handleAdminListNegotiations(request, env, url) {
  if (!await requireAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (!env.DB) return json({ negotiations: [] }, 503);
  await expireStaleNegotiationRequests(env);
  const requestedLimit = Number(url.searchParams.get("limit"));
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 && requestedLimit <= 200 ? requestedLimit : 50;
  const status = url.searchParams.get("status");
  const conditions = [];
  const params = [];
  if (status) {
    conditions.push("n.status = ?");
    params.push(status);
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit);
  const result = await env.DB.prepare(
    `SELECT n.id, n.guest_name, n.guest_phone, n.pickup_zone, n.destination_zone,
            n.vehicle_type, n.status, n.reference_fare_fjd, n.guest_proposed_amount_fjd,
            n.booking_id, n.created_at
     FROM negotiation_requests n
     ${whereClause}
     ORDER BY n.created_at DESC
     LIMIT ?`
  ).bind(...params).all();
  return json({ negotiations: result.results || [] }, 200);
}
__name(handleAdminListNegotiations, "handleAdminListNegotiations");
async function handleAdminApprove(request, env, driverId) {
  if (!await requireAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (!env.DB) return json({ ok: false, error: "Database not available." }, 503);
  const driver = await env.DB.prepare(`SELECT id, name, phone, status FROM drivers WHERE id = ?`).bind(driverId).first();
  if (!driver) return json({ ok: false, error: "Driver not found." }, 404);
  await env.DB.prepare(`UPDATE drivers SET status = 'verified' WHERE id = ?`).bind(driverId).run();
  await env.DB.prepare(`INSERT OR IGNORE INTO wallets (driver_id, balance_fjd) VALUES (?, 0)`).bind(driverId).run();
  const token = crypto.randomUUID().replace(/-/g, "");
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_SECONDS * 1e3).toISOString();
  await env.DB.prepare(
    `INSERT INTO driver_login_tokens (driver_id, token, expires_at) VALUES (?, ?, ?)`
  ).bind(driverId, token, expiresAt).run();
  const whatsappResult = await sendDriverWelcomeWhatsApp(env, driver.phone, driver.name, token);
  return json({
    ok: true,
    driver_id: driverId,
    status: "verified",
    whatsapp: whatsappResult
  }, 200);
}
__name(handleAdminApprove, "handleAdminApprove");
async function handleAdminSuspendDriver(request, env, driverId) {
  if (!await requireAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (!env.DB) return json({ ok: false, error: "Database not available." }, 503);
  const driver = await env.DB.prepare(`SELECT id, status FROM drivers WHERE id = ?`).bind(driverId).first();
  if (!driver) return json({ ok: false, error: "Driver not found." }, 404);
  if (driver.status !== "verified") {
    return json({ ok: false, error: `Only a verified driver can be suspended (current status: ${driver.status}).` }, 409);
  }
  await env.DB.prepare(`UPDATE drivers SET status = 'suspended', online = 0, online_since = NULL WHERE id = ?`).bind(driverId).run();
  return json({ ok: true, driver_id: driverId, status: "suspended" }, 200);
}
__name(handleAdminSuspendDriver, "handleAdminSuspendDriver");
async function handleAdminReactivateDriver(request, env, driverId) {
  if (!await requireAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (!env.DB) return json({ ok: false, error: "Database not available." }, 503);
  const driver = await env.DB.prepare(`SELECT id, status FROM drivers WHERE id = ?`).bind(driverId).first();
  if (!driver) return json({ ok: false, error: "Driver not found." }, 404);
  if (driver.status !== "suspended") {
    return json({ ok: false, error: `Only a suspended driver can be reactivated (current status: ${driver.status}).` }, 409);
  }
  await env.DB.prepare(`UPDATE drivers SET status = 'verified' WHERE id = ?`).bind(driverId).run();
  return json({ ok: true, driver_id: driverId, status: "verified" }, 200);
}
__name(handleAdminReactivateDriver, "handleAdminReactivateDriver");
async function handleAdminUpdateDriverZones(request, env, driverId) {
  if (!await requireAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (!env.DB) return json({ ok: false, error: "Database not available." }, 503);
  const driver = await env.DB.prepare(`SELECT id FROM drivers WHERE id = ?`).bind(driverId).first();
  if (!driver) return json({ ok: false, error: "Driver not found." }, 404);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON." }, 400);
  }
  const zones = Array.isArray(body.zones) ? body.zones.map((z) => String(z).trim()).filter(Boolean) : [];
  if (zones.length === 0) return json({ ok: false, error: "At least one zone is required." }, 400);
  const validZones = await getValidZoneNames(env);
  const invalid = zones.filter((z) => !validZones.has(z));
  if (invalid.length > 0) return json({ ok: false, error: `unknown zone(s): ${invalid.join(", ")}` }, 400);
  await env.DB.prepare(`UPDATE drivers SET zones = ? WHERE id = ?`).bind(JSON.stringify(zones), driverId).run();
  return json({ ok: true, driver_id: driverId, zones }, 200);
}
__name(handleAdminUpdateDriverZones, "handleAdminUpdateDriverZones");
async function handleAdminReject(request, env, driverId) {
  if (!await requireAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (!env.DB) return json({ ok: false, error: "Database not available." }, 503);
  const driver = await env.DB.prepare(`SELECT id FROM drivers WHERE id = ?`).bind(driverId).first();
  if (!driver) return json({ ok: false, error: "Driver not found." }, 404);
  await env.DB.prepare(`UPDATE drivers SET status = 'rejected' WHERE id = ?`).bind(driverId).run();
  return json({ ok: true, driver_id: driverId, status: "rejected" }, 200);
}
__name(handleAdminReject, "handleAdminReject");
async function sendWhatsAppTemplate(env, phone, templateName, langCode, bodyParams) {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID) {
    return { attempted: false, reason: "WHATSAPP_TOKEN/WHATSAPP_PHONE_ID not configured on this Worker." };
  }
  const cleanNumber = (phone || "").replace(/[^0-9]/g, "");
  if (!cleanNumber || cleanNumber.length < 8) {
    return { attempted: false, reason: "Phone number invalid for WhatsApp send." };
  }
  const limitMs = Number(env.HEALTH_ALERT_SEND_TIMEOUT_MS) > 0 ? Number(env.HEALTH_ALERT_SEND_TIMEOUT_MS) : HEALTH_ALERT_SEND_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limitMs);
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${env.WHATSAPP_PHONE_ID}/messages`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Authorization": `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: cleanNumber,
        type: "template",
        template: {
          name: templateName,
          language: { code: langCode },
          components: [{
            type: "body",
            parameters: bodyParams.map((text) => ({ type: "text", text: String(text) }))
          }]
        }
      })
    });
    const bodyText = await res.text().catch(() => "");
    return { attempted: true, ok: res.ok, status: res.status, response: bodyText.slice(0, 500) };
  } catch (err) {
    if (controller.signal.aborted) {
      console.error("[whatsapp-template] send timed out after", limitMs, "ms");
      return { attempted: true, ok: false, error: "Send timed out.", timedOut: true };
    }
    console.error("[whatsapp-template] send failed:", err.message);
    return { attempted: true, ok: false, error: "Send failed." };
  } finally {
    clearTimeout(timer);
  }
}
__name(sendWhatsAppTemplate, "sendWhatsAppTemplate");
async function sendDriverWelcomeWhatsApp(env, phone, driverName, token) {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID) {
    return { attempted: false, reason: "WHATSAPP_TOKEN/WHATSAPP_PHONE_ID not configured on this Worker." };
  }
  const cleanNumber = (phone || "").replace(/[^0-9]/g, "");
  if (!cleanNumber || cleanNumber.length < 8) {
    return { attempted: false, reason: "Phone number invalid for WhatsApp send." };
  }
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${env.WHATSAPP_PHONE_ID}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: cleanNumber,
        type: "template",
        template: {
          name: DRIVER_WELCOME_TEMPLATE,
          language: { code: DRIVER_WELCOME_LANG_CODE },
          components: [
            { type: "body", parameters: [{ type: "text", text: driverName || "Driver" }] },
            { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: token }] }
          ]
        }
      })
    });
    const bodyText = await res.text().catch(() => "");
    return { attempted: true, ok: res.ok, status: res.status, response: bodyText.slice(0, 500) };
  } catch (err) {
    console.error("[driver-welcome] send failed:", err.message);
    return { attempted: true, ok: false, error: "Send failed." };
  }
}
__name(sendDriverWelcomeWhatsApp, "sendDriverWelcomeWhatsApp");
async function sendDriverReturnWhatsApp(env, phone, driverName, token) {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID) {
    return { attempted: false, reason: "WHATSAPP_TOKEN/WHATSAPP_PHONE_ID not configured on this Worker." };
  }
  const cleanNumber = (phone || "").replace(/[^0-9]/g, "");
  if (!cleanNumber || cleanNumber.length < 8) {
    return { attempted: false, reason: "Phone number invalid for WhatsApp send." };
  }
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${env.WHATSAPP_PHONE_ID}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: cleanNumber,
        type: "template",
        template: {
          name: DRIVER_RETURN_TEMPLATE,
          language: { code: DRIVER_RETURN_LANG_CODE },
          components: [
            { type: "body", parameters: [{ type: "text", text: driverName || "Driver" }] },
            { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: token }] }
          ]
        }
      })
    });
    const bodyText = await res.text().catch(() => "");
    return { attempted: true, ok: res.ok, status: res.status, response: bodyText.slice(0, 500) };
  } catch (err) {
    console.error("[driver-return] send failed:", err.message);
    return { attempted: true, ok: false, error: "Send failed." };
  }
}
__name(sendDriverReturnWhatsApp, "sendDriverReturnWhatsApp");
async function sendAdminLoginWhatsApp(env, phone, token) {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID) {
    return { attempted: false, reason: "WHATSAPP_TOKEN/WHATSAPP_PHONE_ID not configured on this Worker." };
  }
  const cleanNumber = (phone || "").replace(/[^0-9]/g, "");
  if (!cleanNumber || cleanNumber.length < 8) {
    return { attempted: false, reason: "Phone number invalid for WhatsApp send." };
  }
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${env.WHATSAPP_PHONE_ID}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: cleanNumber,
        type: "template",
        template: {
          name: ADMIN_LOGIN_TEMPLATE,
          language: { code: ADMIN_LOGIN_LANG_CODE },
          components: [
            { type: "body", parameters: [{ type: "text", text: "Fiji Dash Admin" }] },
            { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: token }] }
          ]
        }
      })
    });
    const bodyText = await res.text().catch(() => "");
    return { attempted: true, ok: res.ok, status: res.status, response: bodyText.slice(0, 500) };
  } catch (err) {
    console.error("[admin-login] send failed:", err.message);
    return { attempted: true, ok: false, error: "Send failed." };
  }
}
__name(sendAdminLoginWhatsApp, "sendAdminLoginWhatsApp");
async function sendBookingBroadcastWhatsApp(env, phone, booking) {
  const jobUrl = `${DRIVER_APP_URL}?token=`;
  const fare = `${booking.quoted_currency} ${formatMoneyAmount(booking.quoted_amount)}`;
  return sendWhatsAppTemplate(env, phone, BOOKING_BROADCAST_TEMPLATE, BOOKING_BROADCAST_LANG_CODE, [
    booking.pickup_zone,
    booking.destination_zone,
    booking.vehicle_type,
    fare,
    DRIVER_APP_URL
  ]);
}
__name(sendBookingBroadcastWhatsApp, "sendBookingBroadcastWhatsApp");
async function sendGuestDriverAssignedWhatsApp(env, booking, driverName) {
  const pickupSummary = booking.pickup_date ? `${booking.pickup_date}${booking.pickup_time ? " " + booking.pickup_time : ""}` : "time to be confirmed";
  return sendWhatsAppTemplate(env, booking.guest_phone, GUEST_DRIVER_ASSIGNED_TEMPLATE, GUEST_DRIVER_ASSIGNED_LANG_CODE, [
    booking.guest_name || "Guest",
    driverName || "your driver",
    booking.vehicle_type,
    `${booking.pickup_zone} -> ${booking.destination_zone}`,
    pickupSummary
  ]);
}
__name(sendGuestDriverAssignedWhatsApp, "sendGuestDriverAssignedWhatsApp");
async function sendGuestEnRouteWhatsApp(env, booking, driverName) {
  return sendWhatsAppTemplate(env, booking.guest_phone, GUEST_EN_ROUTE_TEMPLATE, GUEST_EN_ROUTE_LANG_CODE, [
    booking.guest_name || "Guest",
    driverName || "Your driver",
    `${booking.pickup_zone} -> ${booking.destination_zone}`
  ]);
}
__name(sendGuestEnRouteWhatsApp, "sendGuestEnRouteWhatsApp");
async function sendFuelIndexAlertWhatsApp(env, phone, bodyText) {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID) {
    return { attempted: false, reason: "WHATSAPP_TOKEN/WHATSAPP_PHONE_ID not configured on this Worker." };
  }
  const cleanNumber = (phone || "").replace(/[^0-9]/g, "");
  if (!cleanNumber || cleanNumber.length < 8) {
    return { attempted: false, reason: "admin_alert_phone not set or invalid." };
  }
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${env.WHATSAPP_PHONE_ID}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: cleanNumber,
        type: "template",
        template: {
          name: FUEL_INDEX_ALERT_TEMPLATE,
          language: { code: FUEL_INDEX_ALERT_LANG_CODE },
          components: [{ type: "body", parameters: [{ type: "text", parameter_name: "alert_message", text: bodyText }] }]
        }
      })
    });
    const responseText = await res.text().catch(() => "");
    return { attempted: true, ok: res.ok, status: res.status, response: responseText.slice(0, 500) };
  } catch (err) {
    console.error("[fuel-index-alert] send failed:", err.message);
    return { attempted: true, ok: false, error: "Send failed." };
  }
}
__name(sendFuelIndexAlertWhatsApp, "sendFuelIndexAlertWhatsApp");
var HEALTH_ALERT_SEND_TIMEOUT_MS = 8e3;
async function sendHealthAlertWhatsApp(env, phone, state, timestamp, langCodeOverride, timeoutMs = HEALTH_ALERT_SEND_TIMEOUT_MS) {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID) {
    return { attempted: false, reason: "WHATSAPP_TOKEN/WHATSAPP_PHONE_ID not configured on this Worker." };
  }
  const cleanNumber = (phone || "").replace(/[^0-9]/g, "");
  if (!cleanNumber || cleanNumber.length < 8) {
    return { attempted: false, reason: "admin_alert_phone not set or invalid." };
  }
  const limitMs = Number(env.HEALTH_ALERT_SEND_TIMEOUT_MS) > 0 ? Number(env.HEALTH_ALERT_SEND_TIMEOUT_MS) : timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limitMs);
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${env.WHATSAPP_PHONE_ID}/messages`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Authorization": `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: cleanNumber,
        type: "template",
        template: {
          name: HEALTH_ALERT_TEMPLATE,
          language: { code: langCodeOverride || HEALTH_ALERT_LANG_CODE },
          components: [{
            type: "body",
            parameters: [
              { type: "text", parameter_name: "alert_summary", text: state },
              { type: "text", parameter_name: "timestamp", text: timestamp }
            ]
          }]
        }
      })
    });
    const responseText = await res.text().catch(() => "");
    return { attempted: true, ok: res.ok, status: res.status, response: responseText.slice(0, 500) };
  } catch (err) {
    if (controller.signal.aborted) {
      console.error("[health-alert] send timed out after", limitMs, "ms");
      return { attempted: true, ok: false, error: "Send timed out.", timedOut: true };
    }
    console.error("[health-alert] send failed:", err.message);
    return { attempted: true, ok: false, error: "Send failed." };
  } finally {
    clearTimeout(timer);
  }
}
__name(sendHealthAlertWhatsApp, "sendHealthAlertWhatsApp");
async function requireDriver(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT d.id, d.name, d.phone, d.status, d.zones, d.online, d.online_since, d.forced_offline_until
     FROM driver_login_tokens t
     JOIN drivers d ON d.id = t.driver_id
     WHERE t.token = ? AND t.expires_at > datetime('now') AND d.status = 'verified'`
  ).bind(token).first();
  return row || null;
}
__name(requireDriver, "requireDriver");
async function handleDriverLogin(request, env) {
  if (!env.DB) return json({ ok: false, error: "Database not available." }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON." }, 400);
  }
  const phone = normaliseDriverPhone((body.phone || "").toString());
  if (!phone) return json({ ok: false, error: "Valid phone number required." }, 400);
  const driver = await env.DB.prepare(`SELECT id, name, phone FROM drivers WHERE phone = ? AND status = 'verified'`).bind(phone).first();
  if (!driver) {
    return json({ ok: true, message: "If this number is a verified driver, a login link has been sent." }, 200);
  }
  const token = crypto.randomUUID().replace(/-/g, "");
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_SECONDS * 1e3).toISOString();
  await env.DB.prepare(`INSERT INTO driver_login_tokens (driver_id, token, expires_at) VALUES (?, ?, ?)`).bind(driver.id, token, expiresAt).run();
  const whatsappResult = await sendDriverReturnWhatsApp(env, driver.phone, driver.name, token);
  return json({ ok: true, message: "If this number is a verified driver, a login link has been sent.", whatsapp: whatsappResult }, 200);
}
__name(handleDriverLogin, "handleDriverLogin");
async function handleAdminLogin(request, env) {
  if (!env.DB) return json({ ok: false, error: "Database not available." }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON." }, 400);
  }
  const phone = normaliseDriverPhone((body.phone || "").toString());
  if (!phone || phone !== ADMIN_LOGIN_PHONE) {
    return json({ ok: true, message: "If this number is authorized, a login link has been sent." }, 200);
  }
  const token = crypto.randomUUID().replace(/-/g, "");
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_SECONDS * 1e3).toISOString();
  await env.DB.prepare(`INSERT INTO admin_login_tokens (token, expires_at) VALUES (?, ?)`).bind(token, expiresAt).run();
  const whatsappResult = await sendAdminLoginWhatsApp(env, phone, token);
  return json({ ok: true, message: "If this number is authorized, a login link has been sent.", whatsapp: whatsappResult }, 200);
}
__name(handleAdminLogin, "handleAdminLogin");
async function handleAdminSetPin(request, env) {
  if (!await requireAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (!env.DB) return json({ ok: false, error: "Database not available." }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON." }, 400);
  }
  const pin = (body.pin || "").toString().trim();
  if (!/^\d+$/.test(pin) || pin.length < PIN_MIN_DIGITS || pin.length > 12) {
    return json({ ok: false, error: `PIN must be ${PIN_MIN_DIGITS}-12 digits, numbers only.` }, 400);
  }
  const hash = await hashPinForStorage(pin);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO platform_settings (key, value, updated_at) VALUES ('admin_pin_hash', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).bind(hash),
    // A newly-set PIN gets a clean slate - any lockout from guesses
    // against the OLD PIN shouldn't carry over and lock James out of
    // his own brand-new one.
    env.DB.prepare(`UPDATE platform_settings SET value = '0' WHERE key = 'admin_pin_failed_attempts'`),
    env.DB.prepare(`UPDATE platform_settings SET value = '' WHERE key = 'admin_pin_locked_until'`)
  ]);
  return json({ ok: true }, 200);
}
__name(handleAdminSetPin, "handleAdminSetPin");
async function handleAdminLoginPin(request, env) {
  if (!env.DB) return json({ ok: false, error: "Database not available." }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON." }, 400);
  }
  const pin = (body.pin || "").toString().trim();
  const storedHash = await getSetting(env, "admin_pin_hash", "");
  if (!storedHash) return json({ ok: false, error: "PIN not configured yet." }, 400);
  const lockedUntil = await getSetting(env, "admin_pin_locked_until", "");
  if (lockedUntil) {
    const row = await env.DB.prepare(
      `SELECT (julianday(?) > julianday(datetime('now'))) AS still_locked,
              CAST((julianday(?) - julianday(datetime('now'))) * 1440 AS INTEGER) AS minutes_left`
    ).bind(lockedUntil, lockedUntil).first();
    if (row && row.still_locked) {
      return json({ ok: false, error: `Too many attempts. Try again in ${Math.max(1, row.minutes_left)} minute(s).` }, 429);
    }
  }
  const valid = pin ? await verifyPinAgainstStoredHash(pin, storedHash) : false;
  if (valid) {
    await env.DB.batch([
      env.DB.prepare(`UPDATE platform_settings SET value = '0' WHERE key = 'admin_pin_failed_attempts'`),
      env.DB.prepare(`UPDATE platform_settings SET value = '' WHERE key = 'admin_pin_locked_until'`)
    ]);
    const token = crypto.randomUUID().replace(/-/g, "");
    const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_SECONDS * 1e3).toISOString();
    await env.DB.prepare(`INSERT INTO admin_login_tokens (token, expires_at) VALUES (?, ?)`).bind(token, expiresAt).run();
    return json({ ok: true, token }, 200);
  }
  await env.DB.prepare(
    `UPDATE platform_settings SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = datetime('now') WHERE key = 'admin_pin_failed_attempts'`
  ).run();
  const attempts = Number(await getSetting(env, "admin_pin_failed_attempts", String(PIN_MAX_ATTEMPTS)));
  if (attempts >= PIN_MAX_ATTEMPTS) {
    const newLockUntil = new Date(Date.now() + PIN_LOCKOUT_MINUTES * 60 * 1e3).toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO platform_settings (key, value, updated_at) VALUES ('admin_pin_locked_until', ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
      ).bind(newLockUntil),
      env.DB.prepare(`UPDATE platform_settings SET value = '0' WHERE key = 'admin_pin_failed_attempts'`)
    ]);
    return json({ ok: false, error: `Too many attempts. Try again in ${PIN_LOCKOUT_MINUTES} minute(s).` }, 429);
  }
  return json({ ok: false, error: "Incorrect PIN.", attempts_remaining: PIN_MAX_ATTEMPTS - attempts }, 401);
}
__name(handleAdminLoginPin, "handleAdminLoginPin");
async function handleDriverMe(request, env) {
  const driver = await requireDriver(request, env);
  if (!driver) return json({ error: "Unauthorized or expired session." }, 401);
  return json({
    id: driver.id,
    name: driver.name,
    phone: driver.phone,
    status: driver.status,
    zones: JSON.parse(driver.zones || "[]"),
    online: !!driver.online,
    online_since: driver.online_since
  }, 200);
}
__name(handleDriverMe, "handleDriverMe");
async function handleDriverOnline(request, env) {
  const driver = await requireDriver(request, env);
  if (!driver) return json({ error: "Unauthorized or expired session." }, 401);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  const online = !!body.online;
  const zones = Array.isArray(body.zones) ? body.zones.map((z) => String(z).trim()).filter(Boolean) : null;
  if (online) {
    if (driver.forced_offline_until && driver.forced_offline_until > sqliteNow()) {
      return json({ error: "Resting after reaching your max-hours cap.", resting_until: driver.forced_offline_until }, 403);
    }
    const locked = await enforceWalletLockout(env, driver.id);
    if (locked.locked) {
      return json({ error: "Wallet balance below the allowed threshold. Settle your balance to go online.", balance_fjd: locked.balance_fjd, threshold_fjd: locked.threshold_fjd }, 403);
    }
    if (!zones || zones.length === 0) return json({ error: "At least one zone is required to go online." }, 400);
    const validZones = await getValidZoneNames(env);
    const invalid = zones.filter((z) => !validZones.has(z));
    if (invalid.length > 0) return json({ error: `unknown zone(s): ${invalid.join(", ")}` }, 400);
    await env.DB.prepare(`UPDATE drivers SET online = 1, online_since = datetime('now'), zones = ? WHERE id = ?`).bind(JSON.stringify(zones), driver.id).run();
  } else {
    await env.DB.prepare(`UPDATE drivers SET online = 0, online_since = NULL WHERE id = ?`).bind(driver.id).run();
  }
  const updated = await env.DB.prepare(`SELECT online, online_since, zones FROM drivers WHERE id = ?`).bind(driver.id).first();
  return json({ ok: true, online: !!updated.online, online_since: updated.online_since, zones: JSON.parse(updated.zones || "[]") }, 200);
}
__name(handleDriverOnline, "handleDriverOnline");
async function handleDriverWallet(request, env) {
  const driver = await requireDriver(request, env);
  if (!driver) return json({ error: "Unauthorized or expired session." }, 401);
  const wallet = await env.DB.prepare(`SELECT balance_fjd, updated_at FROM wallets WHERE driver_id = ?`).bind(driver.id).first();
  const txns = await env.DB.prepare(
    `SELECT id, booking_id, amount_fjd, type, created_at FROM wallet_transactions WHERE driver_id = ? ORDER BY created_at DESC LIMIT 50`
  ).bind(driver.id).all();
  const locked = await enforceWalletLockout(env, driver.id);
  return json({
    balance_fjd: wallet ? wallet.balance_fjd : 0,
    updated_at: wallet ? wallet.updated_at : null,
    locked: locked.locked,
    threshold_fjd: locked.threshold_fjd,
    transactions: txns.results || []
  }, 200);
}
__name(handleDriverWallet, "handleDriverWallet");
async function handleDriverJobs(request, env) {
  const driver = await requireDriver(request, env);
  if (!driver) return json({ error: "Unauthorized or expired session." }, 401);
  if (!driver.online) return json({ jobs: [], note: "Go online to see available jobs." }, 200);
  const driverZones = new Set(JSON.parse(driver.zones || "[]"));
  const result = await env.DB.prepare(
    `SELECT id, guest_name, guest_phone, pickup_zone, destination_zone, distance_km, vehicle_type,
            quoted_currency, quoted_amount, payment_method, status, created_at
     FROM bookings WHERE status = 'pending' AND assigned_driver_id IS NULL ORDER BY created_at ASC LIMIT 20`
  ).all();
  const jobs = (result.results || []).filter((b) => driverZones.has(b.pickup_zone));
  return json({ jobs }, 200);
}
__name(handleDriverJobs, "handleDriverJobs");
async function handleDriverAcceptBooking(request, env, bookingId) {
  const driver = await requireDriver(request, env);
  if (!driver) return json({ error: "Unauthorized or expired session." }, 401);
  if (!driver.online) {
    return json({ error: "Go online to accept jobs." }, 403);
  }
  const target = await env.DB.prepare(`SELECT pickup_zone FROM bookings WHERE id = ?`).bind(bookingId).first();
  if (!target) return json({ error: "Booking not found." }, 404);
  const driverZones = new Set(JSON.parse(driver.zones || "[]"));
  if (!driverZones.has(target.pickup_zone)) {
    return json({ error: "This booking is outside your online zones." }, 403);
  }
  const locked = await enforceWalletLockout(env, driver.id);
  if (locked.locked) {
    return json({ error: "Wallet balance below the allowed threshold. Settle your balance before accepting jobs.", balance_fjd: locked.balance_fjd, threshold_fjd: locked.threshold_fjd }, 403);
  }
  const result = await env.DB.prepare(
    `UPDATE bookings SET assigned_driver_id = ?, status = 'accepted' WHERE id = ? AND assigned_driver_id IS NULL AND status = 'pending'`
  ).bind(driver.id, bookingId).run();
  const won = result.meta.changes === 1;
  if (!won) {
    const current = await env.DB.prepare(`SELECT assigned_driver_id, status FROM bookings WHERE id = ?`).bind(bookingId).first();
    return json({ ok: false, won: false, reason: "Booking already taken or no longer available.", current }, 409);
  }
  const booking = await env.DB.prepare(`SELECT * FROM bookings WHERE id = ?`).bind(bookingId).first();
  await logBookingEvent(env, { bookingId, eventType: "accepted", previousStatus: "pending", newStatus: "accepted", actor: `driver:${driver.id}` });
  await sendGuestDriverAssignedWhatsApp(env, booking, driver.name);
  return json({ ok: true, won: true, booking }, 200);
}
__name(handleDriverAcceptBooking, "handleDriverAcceptBooking");
async function handleAdminCancelBooking(request, env, bookingId) {
  if (!await requireAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (!env.DB) return json({ ok: false, error: "Database not available." }, 503);
  const booking = await env.DB.prepare(`SELECT id, status FROM bookings WHERE id = ?`).bind(bookingId).first();
  if (!booking) return json({ ok: false, error: "Booking not found." }, 404);
  if (booking.status === "completed" || booking.status === "cancelled") {
    return json({ ok: false, error: `Cannot cancel a booking that is already ${booking.status}.` }, 409);
  }
  let body = {};
  try {
    body = await request.json();
  } catch {
  }
  const reason = body && body.reason ? String(body.reason).slice(0, 500) : null;
  await env.DB.prepare(`UPDATE bookings SET status = 'cancelled' WHERE id = ?`).bind(bookingId).run();
  await logBookingEvent(env, {
    bookingId,
    eventType: "cancelled",
    previousStatus: booking.status,
    newStatus: "cancelled",
    actor: "admin",
    metadata: reason ? { reason } : null
  });
  return json({ ok: true, booking_id: bookingId, status: "cancelled" }, 200);
}
__name(handleAdminCancelBooking, "handleAdminCancelBooking");
async function handleAdminManualAssign(request, env) {
  if (!await requireAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (!env.DB) return json({ ok: false, error: "Database not available." }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON." }, 400);
  }
  const driverId = Number(body.driver_id);
  if (!Number.isInteger(driverId) || driverId <= 0) return json({ ok: false, error: "driver_id must be a positive integer" }, 400);
  const driver = await env.DB.prepare(`SELECT id, name, status FROM drivers WHERE id = ?`).bind(driverId).first();
  if (!driver) return json({ ok: false, error: "No driver found with that driver_id." }, 404);
  if (driver.status !== "verified") return json({ ok: false, error: `Driver ${driver.name} is not verified (status: ${driver.status}).` }, 403);
  if (body.booking_id !== void 0 && body.booking_id !== null) {
    const bookingId = Number(body.booking_id);
    if (!Number.isInteger(bookingId) || bookingId <= 0) return json({ ok: false, error: "booking_id must be a positive integer" }, 400);
    const result2 = await env.DB.prepare(
      `UPDATE bookings SET assigned_driver_id = ?, status = 'accepted' WHERE id = ? AND assigned_driver_id IS NULL AND status = 'pending'`
    ).bind(driverId, bookingId).run();
    const won = result2.meta.changes === 1;
    if (!won) {
      const current = await env.DB.prepare(`SELECT assigned_driver_id, status FROM bookings WHERE id = ?`).bind(bookingId).first();
      if (!current) return json({ ok: false, error: "Booking not found." }, 404);
      return json({ ok: false, won: false, reason: "Booking already taken or no longer available.", current }, 409);
    }
    const booking = await env.DB.prepare(`SELECT * FROM bookings WHERE id = ?`).bind(bookingId).first();
    await logBookingEvent(env, {
      bookingId,
      eventType: "accepted",
      previousStatus: "pending",
      newStatus: "accepted",
      actor: "admin",
      metadata: { assigned_driver_id: driverId, via: "manual_assign" }
    });
    await sendGuestDriverAssignedWhatsApp(env, booking, driver.name);
    return json({ ok: true, won: true, booking }, 200);
  }
  let negotiationRequest = null;
  if (body.negotiation_request_id !== void 0 && body.negotiation_request_id !== null) {
    const negotiationRequestId = Number(body.negotiation_request_id);
    if (!Number.isInteger(negotiationRequestId) || negotiationRequestId <= 0) {
      return json({ ok: false, error: "negotiation_request_id must be a positive integer" }, 400);
    }
    negotiationRequest = await env.DB.prepare(`SELECT id, status FROM negotiation_requests WHERE id = ?`).bind(negotiationRequestId).first();
    if (!negotiationRequest) return json({ ok: false, error: "No negotiation request found with that negotiation_request_id." }, 404);
    if (!["open", "expired"].includes(negotiationRequest.status)) {
      return json({ ok: false, error: `This negotiation request is already ${negotiationRequest.status}, cannot link it to a new booking.` }, 409);
    }
  }
  const quotedAmount = Number(body.quoted_amount);
  const result = await createBookingRecord(env, {
    guestName: (body.guest_name || "").toString().trim().slice(0, 200) || "Guest",
    guestPhone: normalisePhone((body.guest_phone || "").toString()),
    pickupZone: (body.pickup_zone || "").toString().trim(),
    destinationZone: (body.destination_zone || "").toString().trim(),
    vehicleType: (body.vehicle_type || "").toString().trim().toLowerCase(),
    quotedCurrency: (body.quoted_currency || "").toString().trim().toUpperCase(),
    quotedAmount,
    fxRate: body.fx_rate_at_booking !== void 0 ? Number(body.fx_rate_at_booking) : 1,
    distanceKm: body.distance_km !== void 0 && body.distance_km !== null ? Number(body.distance_km) : null,
    paymentMethod: (body.payment_method || "").toString().trim().toLowerCase(),
    sourceIp: request.headers.get("CF-Connecting-IP") || "unknown",
    assignedDriverId: driverId,
    status: "accepted",
    actor: "admin"
    // manually arranged over WhatsApp, no existing booking row - an admin action created this
  });
  if (!result.ok) return json({ ok: false, errors: result.errors }, 400);
  await sendGuestDriverAssignedWhatsApp(env, result.booking, driver.name);
  if (negotiationRequest) {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO negotiation_offers (request_id, driver_id, offer_type, offer_amount_fjd, guest_decision)
         VALUES (?, ?, 'accept', ?, 'accepted')
         ON CONFLICT(request_id, driver_id) DO UPDATE SET offer_type = 'accept', offer_amount_fjd = excluded.offer_amount_fjd, guest_decision = 'accepted'`
      ).bind(negotiationRequest.id, driverId, quotedAmount),
      env.DB.prepare(
        `UPDATE negotiation_requests SET status = 'accepted', booking_id = ? WHERE id = ? AND status IN ('open', 'expired')`
      ).bind(result.bookingId, negotiationRequest.id)
    ]);
  }
  return json({ ok: true, booking_id: result.bookingId, booking: result.booking, negotiation_request_id: negotiationRequest ? negotiationRequest.id : null }, 201);
}
__name(handleAdminManualAssign, "handleAdminManualAssign");
var VALID_STATUS_TRANSITIONS = {
  accepted: ["en_route", "completed"],
  en_route: ["completed"]
};
async function handleDriverBookingStatus(request, env, bookingId) {
  const driver = await requireDriver(request, env);
  if (!driver) return json({ error: "Unauthorized or expired session." }, 401);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  const newStatus = (body.status || "").toString();
  if (!["en_route", "completed"].includes(newStatus)) return json({ error: "status must be 'en_route' or 'completed'" }, 400);
  const booking = await env.DB.prepare(
    `SELECT id, assigned_driver_id, status, payment_method, settlement_amount_fjd, commission_rate,
            pickup_zone, destination_zone, guest_name, guest_phone, vehicle_type
     FROM bookings WHERE id = ?`
  ).bind(bookingId).first();
  if (!booking) return json({ error: "Booking not found." }, 404);
  if (booking.assigned_driver_id !== driver.id) return json({ error: "This booking is not assigned to you." }, 403);
  const allowed = VALID_STATUS_TRANSITIONS[booking.status] || [];
  if (!allowed.includes(newStatus)) {
    return json({ error: `Cannot transition from '${booking.status}' to '${newStatus}'.` }, 409);
  }
  await env.DB.prepare(`UPDATE bookings SET status = ? WHERE id = ?`).bind(newStatus, bookingId).run();
  await logBookingEvent(env, { bookingId, eventType: newStatus, previousStatus: booking.status, newStatus, actor: `driver:${driver.id}` });
  let commission = null;
  if (newStatus === "completed" && booking.payment_method === "cash") {
    commission = await accrueCommission(env, booking);
  }
  if (newStatus === "completed") {
    const completedSummary = `Booking #${bookingId} completed: ${driver.name || "driver " + driver.id}, ${booking.pickup_zone} -> ${booking.destination_zone}, FJD ${booking.settlement_amount_fjd}` + (commission ? `, commission FJD ${commission.commission_fjd}` : "") + ".";
    for (const alertPhone of await getAdminAlertPhones(env)) {
      await sendHealthAlertWhatsApp(env, alertPhone, completedSummary, sqliteNow());
    }
  }
  let guestNotified = null;
  if (newStatus === "en_route") {
    const enRouteSummary = `Booking #${bookingId} en route: ${driver.name || "driver " + driver.id}, ${booking.pickup_zone} -> ${booking.destination_zone}.`;
    for (const alertPhone of await getAdminAlertPhones(env)) {
      await sendHealthAlertWhatsApp(env, alertPhone, enRouteSummary, sqliteNow());
    }
    if (booking.guest_phone) {
      guestNotified = await sendGuestEnRouteWhatsApp(env, booking, driver.name);
    }
  }
  return json({ ok: true, booking_id: bookingId, status: newStatus, commission, guest_notified: guestNotified }, 200);
}
__name(handleDriverBookingStatus, "handleDriverBookingStatus");
async function handleAdminTestBooking(request, env) {
  if (!await requireAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (!env.DB) return json({ ok: false, error: "Database not available." }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON." }, 400);
  }
  const required = ["pickup_zone", "destination_zone", "vehicle_type", "quoted_currency", "quoted_amount", "payment_method"];
  const missing = required.filter((f) => !body[f]);
  if (missing.length > 0) return json({ ok: false, error: `Missing required fields: ${missing.join(", ")}` }, 400);
  const validZones = await getValidZoneNames(env);
  if (!validZones.has(body.pickup_zone)) return json({ ok: false, error: `unknown pickup_zone: ${body.pickup_zone}` }, 400);
  if (!validZones.has(body.destination_zone)) return json({ ok: false, error: `unknown destination_zone: ${body.destination_zone}` }, 400);
  let fuelMultiplierApplied = body.fuel_multiplier_applied;
  if (fuelMultiplierApplied === void 0 || fuelMultiplierApplied === null) {
    const fuelRow = await env.DB.prepare(`SELECT multiplier FROM fuel_index ORDER BY id DESC LIMIT 1`).first();
    fuelMultiplierApplied = fuelRow ? fuelRow.multiplier : 1;
  }
  const insert = await env.DB.prepare(
    `INSERT INTO bookings (guest_name, guest_phone, pickup_zone, destination_zone, distance_km, vehicle_type,
       quoted_currency, quoted_amount, fx_rate_at_booking, settlement_amount_fjd, fuel_multiplier_applied, payment_method, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
  ).bind(
    body.guest_name || "Test Guest",
    body.guest_phone || null,
    body.pickup_zone,
    body.destination_zone,
    body.distance_km || null,
    body.vehicle_type,
    body.quoted_currency,
    body.quoted_amount,
    body.fx_rate_at_booking || 1,
    body.settlement_amount_fjd || body.quoted_amount,
    fuelMultiplierApplied,
    body.payment_method
  ).run();
  const bookingId = insert.meta.last_row_id;
  const booking = await env.DB.prepare(`SELECT * FROM bookings WHERE id = ?`).bind(bookingId).first();
  const broadcast = await broadcastBookingToDrivers(env, booking);
  await logBookingEvent(env, { bookingId, eventType: "created", previousStatus: null, newStatus: "pending", actor: "admin", metadata: { via: "admin_test_booking" } });
  return json({ ok: true, booking_id: bookingId, booking, broadcast }, 201);
}
__name(handleAdminTestBooking, "handleAdminTestBooking");
async function findMatchingOnlineDrivers(env, pickupZone) {
  const candidates = await env.DB.prepare(`SELECT id, name, phone, zones FROM drivers WHERE status = 'verified' AND online = 1`).all();
  return (candidates.results || []).filter((d) => JSON.parse(d.zones || "[]").includes(pickupZone));
}
__name(findMatchingOnlineDrivers, "findMatchingOnlineDrivers");
var DRIVER_BROADCAST_LEASE_SECONDS = 120;
async function claimDriverBroadcastAttempt(env, bookingId, driverId) {
  const existing = await env.DB.prepare(`SELECT 1 x FROM driver_broadcast_attempts WHERE booking_id = ? AND driver_id = ?`).bind(bookingId, driverId).first();
  if (!existing) {
    const rows = (await env.DB.prepare(
      `SELECT metadata FROM booking_events WHERE booking_id = ? AND event_type = 'driver_broadcast_sent'`
    ).bind(bookingId).all()).results || [];
    let historicallySent = false;
    for (const row of rows) {
      try {
        if (JSON.parse(row.metadata || "{}").driver_id === driverId) {
          historicallySent = true;
          break;
        }
      } catch {
      }
    }
    await env.DB.prepare(
      `INSERT OR IGNORE INTO driver_broadcast_attempts (booking_id, driver_id, state) VALUES (?, ?, ?)`
    ).bind(bookingId, driverId, historicallySent ? "SENT" : "NOT_ATTEMPTED").run();
  }
  const claim = await env.DB.prepare(
    `UPDATE driver_broadcast_attempts SET state = 'ATTEMPTING', attempt_count = attempt_count + 1, updated_at = datetime('now')
     WHERE booking_id = ? AND driver_id = ? AND attempt_count < ?
       AND (state IN ('NOT_ATTEMPTED', 'FAILED_RETRYABLE') OR (state = 'ATTEMPTING' AND updated_at < datetime('now', ?)))
     RETURNING attempt_count`
  ).bind(bookingId, driverId, DRIVER_BROADCAST_MAX_TRIES, `-${DRIVER_BROADCAST_LEASE_SECONDS} seconds`).first();
  return claim ? { claimed: true, attempt: claim.attempt_count } : { claimed: false };
}
__name(claimDriverBroadcastAttempt, "claimDriverBroadcastAttempt");
async function broadcastBookingToDrivers(env, booking, { onlyDriverIds = null } = {}) {
  let matching = await findMatchingOnlineDrivers(env, booking.pickup_zone);
  if (onlyDriverIds) matching = matching.filter((d) => onlyDriverIds.has(d.id));
  const results = await Promise.all(matching.map(async (d) => {
    let claim;
    try {
      claim = await claimDriverBroadcastAttempt(env, booking.id, d.id);
    } catch (err) {
      if (!/no such table/i.test(String(err && err.message))) throw err;
      console.error("[driver-broadcast] driver_broadcast_attempts missing; using legacy unfenced path:", err.message);
      claim = { claimed: true, attempt: 1, legacy: true };
    }
    if (!claim.claimed) {
      return { driver_id: d.id, driver_name: d.name, whatsapp: { attempted: false, reason: "already sent or a claim is already in flight" }, skipped: true };
    }
    const whatsappResult = await sendBookingBroadcastWhatsApp(env, d.phone, booking);
    const ok = !!(whatsappResult.attempted && whatsappResult.ok);
    const c = ok ? null : classifyAlertFailure(whatsappResult);
    if (ok) {
      if (!claim.legacy) {
        await env.DB.prepare(
          `UPDATE driver_broadcast_attempts SET state = 'SENT', last_outcome = 'SENT', last_error = NULL, updated_at = datetime('now')
           WHERE booking_id = ? AND driver_id = ? AND state != 'SENT'`
        ).bind(booking.id, d.id).run();
      }
    } else if (!claim.legacy) {
      await env.DB.prepare(
        `UPDATE driver_broadcast_attempts SET state = 'FAILED_RETRYABLE', last_outcome = ?, last_error = ?, last_provider_status = ?, updated_at = datetime('now')
         WHERE booking_id = ? AND driver_id = ? AND state = 'ATTEMPTING' AND attempt_count = ?`
      ).bind(c.outcome, whatsappResult.reason || whatsappResult.error || "Meta rejected the send.", whatsappResult.status ?? null, booking.id, d.id, claim.attempt).run();
    }
    await logBookingEvent(env, {
      bookingId: booking.id,
      eventType: ok ? "driver_broadcast_sent" : "driver_broadcast_failed",
      actor: "system",
      metadata: ok ? { driver_id: d.id, status: whatsappResult.status } : { driver_id: d.id, outcome: c.outcome, possibly_delivered: c.possiblyDelivered, status: whatsappResult.status ?? null, reason: whatsappResult.reason || whatsappResult.error || "Meta rejected the send." }
    });
    return { driver_id: d.id, driver_name: d.name, whatsapp: whatsappResult };
  }));
  return { matched_drivers: matching.length, results };
}
__name(broadcastBookingToDrivers, "broadcastBookingToDrivers");
var DRIVER_BROADCAST_MAX_TRIES = 3;
var DRIVER_BROADCAST_SWEEP_CANDIDATES = 200;
var DRIVER_BROADCAST_SWEEP_WORK_BUDGET = 10;
var DRIVER_BROADCAST_SWEEP_CURSOR_KEY = "driver_broadcast_sweep_cursor_id";
async function fetchSweepCandidates(env, minAgeExpr, maxIds) {
  const cursor = Number(await getSetting(env, DRIVER_BROADCAST_SWEEP_CURSOR_KEY, "0")) || 0;
  const baseWhere = `status = 'pending' AND assigned_driver_id IS NULL AND created_at >= datetime('now', '-60 minutes') AND created_at <= datetime('now', ?)`;
  const forward = (await env.DB.prepare(`SELECT id FROM bookings WHERE ${baseWhere} AND id > ? ORDER BY id LIMIT ?`).bind(minAgeExpr, cursor, maxIds).all()).results || [];
  let rows = forward;
  if (rows.length < maxIds) {
    const wrapped = (await env.DB.prepare(`SELECT id FROM bookings WHERE ${baseWhere} AND id <= ? ORDER BY id LIMIT ?`).bind(minAgeExpr, cursor, maxIds - rows.length).all()).results || [];
    rows = rows.concat(wrapped);
  }
  return rows;
}
__name(fetchSweepCandidates, "fetchSweepCandidates");
async function advanceSweepCursor(env, rows) {
  if (rows.length === 0) return;
  const next = Math.max(...rows.map((r) => r.id));
  await env.DB.prepare(
    `INSERT INTO platform_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).bind(DRIVER_BROADCAST_SWEEP_CURSOR_KEY, String(next)).run();
}
__name(advanceSweepCursor, "advanceSweepCursor");
async function sweepDriverBroadcasts(env) {
  try {
    const minAgeExpr = `-${ADMIN_NOTIFICATION_SWEEP_MIN_AGE_SECONDS} seconds`;
    const found = { results: await fetchSweepCandidates(env, minAgeExpr, DRIVER_BROADCAST_SWEEP_CANDIDATES) };
    await advanceSweepCursor(env, found.results);
    let worked = 0;
    for (const row of found && found.results || []) {
      if (worked >= DRIVER_BROADCAST_SWEEP_WORK_BUDGET) break;
      const booking = await env.DB.prepare(`SELECT * FROM bookings WHERE id = ?`).bind(row.id).first();
      if (!booking || booking.status !== "pending" || booking.assigned_driver_id) continue;
      const eligible = await findMatchingOnlineDrivers(env, booking.pickup_zone);
      if (eligible.length === 0) continue;
      let missingIds;
      try {
        const states = (await env.DB.prepare(
          `SELECT driver_id, state, attempt_count FROM driver_broadcast_attempts WHERE booking_id = ?`
        ).bind(row.id).all()).results || [];
        const byId = new Map(states.map((x) => [x.driver_id, x]));
        missingIds = eligible.filter((d) => {
          const st = byId.get(d.id);
          if (!st) return true;
          if (st.state === "SENT") return false;
          return st.attempt_count < DRIVER_BROADCAST_MAX_TRIES;
        }).map((d) => d.id);
      } catch (err) {
        if (!/no such table/i.test(String(err && err.message))) throw err;
        const events = (await env.DB.prepare(
          `SELECT event_type, metadata FROM booking_events WHERE booking_id = ? AND event_type IN ('driver_broadcast_sent', 'driver_broadcast_failed')`
        ).bind(row.id).all()).results || [];
        const sentIds = /* @__PURE__ */ new Set();
        const failCounts = /* @__PURE__ */ new Map();
        for (const e of events) {
          let did = null;
          try {
            did = JSON.parse(e.metadata || "{}").driver_id;
          } catch {
          }
          if (did == null) continue;
          if (e.event_type === "driver_broadcast_sent") sentIds.add(did);
          else failCounts.set(did, (failCounts.get(did) || 0) + 1);
        }
        missingIds = events.length === 0 ? eligible.map((d) => d.id) : eligible.filter((d) => !sentIds.has(d.id) && (failCounts.get(d.id) || 0) < DRIVER_BROADCAST_MAX_TRIES).map((d) => d.id);
      }
      if (missingIds.length === 0) continue;
      await broadcastBookingToDrivers(env, booking, { onlyDriverIds: new Set(missingIds) });
      worked++;
    }
  } catch (err) {
    console.error(`[driver-broadcast-sweep] failed: ${err.message}`);
  }
}
__name(sweepDriverBroadcasts, "sweepDriverBroadcasts");
function normalisedItineraryString(v, maxLen) {
  if (v === void 0 || v === null) return null;
  const s = v.toString().trim().slice(0, maxLen);
  return s === "" ? null : s;
}
__name(normalisedItineraryString, "normalisedItineraryString");
var ATTRIBUTION_PII_PATTERNS = [
  /@/,
  // email address
  /\d{6,}/
  // phone-number-like digit run
];
function sanitisedAttributionField(v, maxLen) {
  const s = normalisedItineraryString(v, maxLen);
  if (s === null) return null;
  if (ATTRIBUTION_PII_PATTERNS.some((re) => re.test(s))) return null;
  return s;
}
__name(sanitisedAttributionField, "sanitisedAttributionField");
function normaliseAttributionSource({ source, medium, referrer }) {
  const s = (source || "").toLowerCase();
  const m = (medium || "").toLowerCase();
  const r = (referrer || "").toLowerCase();
  if (!s && !r) return "direct";
  if (s === "google" || m === "cpc" && r.includes("google") || r.includes("google.")) return "google";
  if (["meta", "facebook", "instagram"].includes(s) || r.includes("facebook.com") || r.includes("instagram.com")) return "meta";
  if (s === "chatgpt" || r === "chatgpt.com" || r.endsWith(".chatgpt.com") || r.endsWith("openai.com")) return "chatgpt_ai";
  if (s === "cometofiji" || r.includes("cometofiji.com")) return "cometofiji";
  if (s === "vakaviti" || r.includes("vakaviti.ai")) return "vakaviti_lagi";
  if (s === "whatsapp") return "whatsapp_referral";
  if (s === "bookfijitransfers") return "bookfijitransfers_promo";
  return "other";
}
__name(normaliseAttributionSource, "normaliseAttributionSource");
async function checkGuestBookingRateLimit(env, ip) {
  const max = Number(await getSetting(env, "guest_booking_rate_limit_max", "5"));
  const windowMinutes = Number(await getSetting(env, "guest_booking_rate_limit_window_minutes", "10"));
  const row = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM bookings WHERE source_ip = ? AND created_at > datetime('now', '-' || ? || ' minutes')`
  ).bind(ip, windowMinutes).first();
  const count = row ? row.cnt : 0;
  return { limited: count >= max, count, max, window_minutes: windowMinutes };
}
__name(checkGuestBookingRateLimit, "checkGuestBookingRateLimit");
async function logBookingEvent(env, { bookingId, eventType, previousStatus = null, newStatus = null, actor = null, metadata = null }) {
  try {
    await env.DB.prepare(
      `INSERT INTO booking_events (booking_id, event_type, previous_status, new_status, actor, metadata) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(bookingId, eventType, previousStatus, newStatus, actor, metadata ? JSON.stringify(metadata) : null).run();
  } catch (err) {
    console.warn(`[booking-events] failed to log '${eventType}' for booking ${bookingId}: ${err.message}`);
  }
}
__name(logBookingEvent, "logBookingEvent");
async function createBookingRecord(env, {
  guestName,
  guestPhone,
  pickupZone,
  destinationZone,
  distanceKm,
  vehicleType,
  quotedCurrency,
  quotedAmount,
  fxRate,
  paymentMethod,
  sourceIp,
  commissionBaseFjd = null,
  assignedDriverId = null,
  status = "pending",
  // Itinerary fields - informational only, never used for pricing/commission
  // math. Added after a real return-trip booking reached dispatch with no
  // return date, time, or pickup location captured anywhere - the bookings
  // table previously stored zero itinerary detail for either leg. All
  // optional/null by default so the two other callers (admin test booking,
  // negotiation accept-offer) are unaffected.
  pickupDate = null,
  pickupTime = null,
  notes = null,
  returnDate = null,
  returnTime = null,
  returnPickupLocation = null,
  // P0 #237 (2026-10-05): when true the caller (a guest page that shows the guest a fare and asks them to accept it) must NEVER have its
  // amount silently replaced - an out-of-band amount is refused with PRICE_MISMATCH carrying the Worker's own number instead. Default false
  // keeps every other caller (cached old pages, FijiDash, admin test, negotiation) exactly as before.
  requireQuoteMatch = false,
  // P0 #237: the total the guest was originally shown, sent only when they ACCEPTED a revised price; recorded, never used for pricing.
  revisedFromAmount = null,
  // Milestone 34 (Issue #34 P0 fix) - client_booking_ref is a stable,
  // guest-widget-generated idempotency key sent on every submit attempt for
  // the same booking (including a retry after a network timeout or a
  // double-tap). null for the two other callers (admin test booking,
  // negotiation accept-offer), which have nothing to deduplicate against
  // and aren't in scope for this fix. guestEmail/flightNumber are the two
  // ops-required contact fields Issue #34 requirement 9 found missing.
  clientBookingRef = null,
  guestEmail = null,
  flightNumber = null,
  // Milestone 35 (revenue attribution, PREVIEW ONLY) - raw first/last-touch
  // fields as captured by the guest widget (see app.js's captureAttribution/
  // getAttributionForPayload). null for the two other callers (admin test
  // booking, negotiation accept-offer), same precedent as clientBookingRef
  // above. Deliberately no attributionSource parameter here - the bucket is
  // always computed below from the raw last-touch fields, never accepted
  // from a caller (see normaliseAttributionSource's own comment).
  firstSource = null,
  firstMedium = null,
  firstCampaign = null,
  firstContent = null,
  firstTerm = null,
  firstReferrer = null,
  firstLandingPath = null,
  firstSeenAt = null,
  lastSource = null,
  lastMedium = null,
  lastCampaign = null,
  lastContent = null,
  lastTerm = null,
  lastReferrer = null,
  lastLandingPath = null,
  // Milestone 18 (Recommendation 1) - see computeAuthoritativePrice's own
  // header comment for the full scope/tier reasoning. verificationMode
  // defaults to 'trusted' (today's existing behavior, unchanged) so the
  // two other callers (admin test booking, negotiation accept-offer - both
  // already have their own, different, already-correct trust model) are
  // completely unaffected without having to pass anything new at all.
  // Only handleGuestBookingCreate passes 'authoritative'.
  verificationMode = "trusted",
  tripType = "one-way",
  isCustomAddress = false,
  hasTour = false,
  hasChildSeat = false,
  hasSurfboard = false,
  // Milestone 19 - who/what is actually creating this row. Each of the
  // three callers (guest create, negotiation accept-offer, admin manual-
  // assign) knows this for itself, so it's passed explicitly rather than
  // guessed from other fields. 'system' is a deliberately honest fallback
  // for any future caller that forgets to set it, not a real actor.
  actor = "system"
}) {
  const errors = [];
  if (!guestPhone) errors.push("a valid guest_phone is required");
  if (!ALLOWED_VEHICLE_TYPES.includes(vehicleType)) errors.push(`vehicle_type must be one of: ${ALLOWED_VEHICLE_TYPES.join(", ")}`);
  if (!/^[A-Z]{3}$/.test(quotedCurrency)) errors.push("quoted_currency must be a 3-letter currency code");
  if (!quotedAmount || !isFinite(quotedAmount) || quotedAmount <= 0 || quotedAmount > 5e3) errors.push("quoted_amount must be a positive number no greater than 5000");
  if (!fxRate || !isFinite(fxRate) || fxRate <= 0 || fxRate > 100) errors.push("fx_rate_at_booking must be a positive, sane number");
  if (distanceKm !== null && (!isFinite(distanceKm) || distanceKm < 0 || distanceKm > 500)) errors.push("distance_km out of range");
  if (!["cash", "prepay"].includes(paymentMethod)) errors.push("payment_method must be 'cash' or 'prepay'");
  if (commissionBaseFjd !== null && (!isFinite(commissionBaseFjd) || commissionBaseFjd < 0 || commissionBaseFjd > quotedAmount)) errors.push("commission_base_fjd out of range");
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const TIME_RE2 = /^\d{2}:\d{2}$/;
  if (pickupDate !== null && !DATE_RE.test(pickupDate)) errors.push("pickup_date must be in YYYY-MM-DD format");
  if (pickupTime !== null && !TIME_RE2.test(pickupTime)) errors.push("pickup_time must be in HH:MM format");
  if (returnDate !== null && !DATE_RE.test(returnDate)) errors.push("return_date must be in YYYY-MM-DD format");
  if (returnTime !== null && !TIME_RE2.test(returnTime)) errors.push("return_time must be in HH:MM format");
  const validZones = await getValidZoneNames(env);
  if (!validZones.has(pickupZone)) errors.push(`unknown pickup_zone: ${pickupZone}`);
  if (!validZones.has(destinationZone)) errors.push(`unknown destination_zone: ${destinationZone}`);
  if (clientBookingRef !== null && (typeof clientBookingRef !== "string" || !clientBookingRef.trim() || clientBookingRef.length > 64)) {
    errors.push("client_booking_ref must be a non-empty string of at most 64 characters");
  }
  if (errors.length > 0) return { ok: false, errors };
  if (clientBookingRef !== null) {
    const existing = await env.DB.prepare(`SELECT * FROM bookings WHERE client_booking_ref = ?`).bind(clientBookingRef).first();
    if (existing) {
      return { ok: true, bookingId: existing.id, booking: existing, pricingNote: null, idempotent: true };
    }
  }
  let attribution = {
    firstSource: null,
    firstMedium: null,
    firstCampaign: null,
    firstContent: null,
    firstTerm: null,
    firstReferrer: null,
    firstLandingPath: null,
    firstSeenAt: null,
    lastSource: null,
    lastMedium: null,
    lastCampaign: null,
    lastContent: null,
    lastTerm: null,
    lastReferrer: null,
    lastLandingPath: null,
    attributionSource: null
  };
  try {
    attribution = {
      firstSource: sanitisedAttributionField(firstSource, 40),
      firstMedium: sanitisedAttributionField(firstMedium, 40),
      firstCampaign: sanitisedAttributionField(firstCampaign, 100),
      firstContent: sanitisedAttributionField(firstContent, 100),
      firstTerm: sanitisedAttributionField(firstTerm, 100),
      firstReferrer: sanitisedAttributionField(firstReferrer, 200),
      firstLandingPath: sanitisedAttributionField(firstLandingPath, 200),
      // Milestone 35 - a timestamp is exempt from the PII digit-run check
      // (an ISO-8601 stamp is nothing but digits) but still length-capped.
      firstSeenAt: normalisedItineraryString(firstSeenAt, 40),
      lastSource: sanitisedAttributionField(lastSource, 40),
      lastMedium: sanitisedAttributionField(lastMedium, 40),
      lastCampaign: sanitisedAttributionField(lastCampaign, 100),
      lastContent: sanitisedAttributionField(lastContent, 100),
      lastTerm: sanitisedAttributionField(lastTerm, 100),
      lastReferrer: sanitisedAttributionField(lastReferrer, 200),
      lastLandingPath: sanitisedAttributionField(lastLandingPath, 200),
      attributionSource: null
      // set below, from the sanitised fields above
    };
    attribution.attributionSource = normaliseAttributionSource({
      source: attribution.lastSource,
      medium: attribution.lastMedium,
      referrer: attribution.lastReferrer
    });
  } catch (err) {
    console.warn(`[attribution] failed to process attribution metadata, storing as null: ${err.message}`);
    attribution = {
      firstSource: null,
      firstMedium: null,
      firstCampaign: null,
      firstContent: null,
      firstTerm: null,
      firstReferrer: null,
      firstLandingPath: null,
      firstSeenAt: null,
      lastSource: null,
      lastMedium: null,
      lastCampaign: null,
      lastContent: null,
      lastTerm: null,
      lastReferrer: null,
      lastLandingPath: null,
      attributionSource: null
    };
  }
  let pricingNote = null;
  const submittedAmount = quotedAmount;
  let calculatedAmount = null;
  let pricingVersion = null;
  let pricingDecision = null;
  let pricingAdjustment = null;
  const isBoatBooking = vehicleType === "boat";
  if (verificationMode === "authoritative") {
    if (isBoatBooking) {
      if (commissionBaseFjd !== null && quotedAmount < commissionBaseFjd) {
        pricingNote = `boat booking quoted_amount (${quotedAmount}) is less than its own verified land-leg portion (${commissionBaseFjd})`;
        console.warn(`[pricing-sanity] ${pricingNote} - ${pickupZone} -> ${destinationZone}`);
      }
    } else {
      const authoritative = await computeAuthoritativePrice(env, {
        pickupZone,
        destinationZone,
        vehicleType,
        tripType,
        pickupTime,
        hasChildSeat,
        hasSurfboard
      });
      if (!authoritative.ok) {
        console.warn(`[pricing-authoritative-unavailable] ${authoritative.error} - ${pickupZone} -> ${destinationZone} ${vehicleType} ${tripType}, falling back to client-trusted quoted_amount`);
        pricingDecision = { outcome: "client_trusted_authoritative_unavailable", reason: "server_could_not_compute_a_reference" };
      } else {
        pricingVersion = authoritative.pricingVersion;
        const serverFjd = authoritative.transferPlusExtrasFjd;
        const serverFjdDiscounted = applyLoyaltyDiscount(serverFjd, false).finalFjd;
        calculatedAmount = serverFjdDiscounted;
        if (tripType === "return") {
          const oneWayEquivalent = await computeAuthoritativePrice(env, {
            pickupZone,
            destinationZone,
            vehicleType,
            tripType: "one-way",
            pickupTime,
            hasChildSeat,
            hasSurfboard
          });
          if (oneWayEquivalent.ok) {
            const addOnsFjd = applyExtras(0, { hasChildSeat, hasSurfboard });
            const returnTransferFjd = computeFinalTotal(serverFjd - addOnsFjd);
            const oneWayTransferFjd = computeFinalTotal(oneWayEquivalent.transferPlusExtrasFjd - addOnsFjd);
            const saneCheck = assertSanePricing({
              oneWayEquivalentFjd: oneWayTransferFjd,
              finalTotalFjd: returnTransferFjd,
              tripType
            });
            if (!saneCheck.sane) {
              await createEscalation(env, {
                source: "guest",
                triggerType: "needs_manual_confirmation",
                context: `Pricing sanity check failed for a return-trip booking: ${saneCheck.reason}. ${pickupZone} -> ${destinationZone}, ${vehicleType} - computed return transfer FJD ${returnTransferFjd} vs one-way transfer FJD ${oneWayTransferFjd} (add-ons FJD ${addOnsFjd} excluded from both). Booking blocked, needs manual confirmation.`,
                sourceIp
              });
              return { ok: false, errors: ["Could not confirm a reliable price for this booking automatically. We've alerted our team and will follow up via WhatsApp to confirm your fare."] };
            }
          }
        }
        if (!hasTour && !isCustomAddress) {
          if (quotedAmount < serverFjdDiscounted * 0.8 || quotedAmount > serverFjdDiscounted * 1.3) {
            if (requireQuoteMatch) {
              console.warn(`[pricing-mismatch-refused] client sent ${quotedAmount}, Worker reference ${serverFjdDiscounted} for ${pickupZone} -> ${destinationZone} ${vehicleType} ${tripType}; nothing saved, guest must accept the Worker number`);
              return {
                ok: false,
                status: 409,
                code: "PRICE_MISMATCH",
                errors: [`The fare for this trip is FJ$${serverFjdDiscounted.toFixed(2)}, not the FJ$${quotedAmount.toFixed(2)} shown. Please review the updated fare and confirm it to continue. Nothing has been booked yet.`],
                quoteMismatch: { submittedAmountFjd: quotedAmount, referenceFareFjd: serverFjdDiscounted }
              };
            }
            pricingAdjustment = {
              submitted_amount_fjd: quotedAmount,
              saved_amount_fjd: serverFjdDiscounted,
              reason: "outside_0.8x_1.3x_band",
              band_low_fjd: Math.round(serverFjdDiscounted * 0.8 * 1e3) / 1e3,
              band_high_fjd: Math.round(serverFjdDiscounted * 1.3 * 1e3) / 1e3
            };
            console.warn(`[pricing-drift] client sent ${quotedAmount}, outside the plausible published-price range (formula reference ${serverFjdDiscounted}) for ${pickupZone} -> ${destinationZone} ${vehicleType} ${tripType} - replacing with the server number`);
            quotedAmount = serverFjdDiscounted;
          }
          distanceKm = authoritative.distanceKm;
          if (pricingAdjustment) pricingDecision = { outcome: "replaced_legacy", reason: "outside_0.8x_1.3x_band_replaced_legacy" };
          else if (Math.abs(submittedAmount - serverFjdDiscounted) < 5e-3) pricingDecision = Number.isFinite(revisedFromAmount) ? { outcome: "accepted_revised", reason: "guest_accepted_revised_price" } : { outcome: "matched", reason: "none" };
          else pricingDecision = { outcome: "kept_in_band", reason: "within_0.8x_1.3x_of_calculated" };
        } else if (isCustomAddress && !hasTour) {
          if (quotedAmount < serverFjdDiscounted * 0.7 || quotedAmount > serverFjdDiscounted * 3) {
            pricingNote = `custom-address quoted_amount (${quotedAmount}) is outside the plausible range for this route (zone-floor reference ${serverFjdDiscounted})`;
            console.warn(`[pricing-sanity] ${pricingNote} - ${pickupZone} -> ${destinationZone}`);
          }
        }
        if (hasTour) {
          const remainder = quotedAmount - serverFjd;
          if (remainder < 0) {
            const reason = `tour booking quoted_amount (${quotedAmount}) is less than its own verified transfer+extras portion (${serverFjd})`;
            console.warn(`[pricing-sanity] ${reason} - ${pickupZone} -> ${destinationZone}`);
            await createEscalation(env, {
              source: "guest",
              triggerType: "needs_manual_confirmation",
              context: `Pricing sanity check failed for a tour booking: ${reason}. ${pickupZone} -> ${destinationZone}, ${vehicleType}. Booking blocked, needs manual confirmation.`,
              sourceIp
            });
            return { ok: false, errors: ["Could not confirm a reliable price for this tour booking automatically. We've alerted our team and will follow up via WhatsApp to confirm your fare."] };
          }
        }
      }
    }
  }
  if (verificationMode === "authoritative" && !isBoatBooking && !pricingDecision) pricingDecision = { outcome: "not_fully_server_verified", reason: hasTour ? "tour_in_booking" : isCustomAddress ? "custom_address" : "unknown" };
  const fuelRow = await env.DB.prepare(`SELECT multiplier FROM fuel_index ORDER BY id DESC LIMIT 1`).first();
  const fuelMultiplierApplied = fuelRow ? fuelRow.multiplier : 1;
  const settlementAmountFjd = Math.round(quotedAmount * fxRate * 100) / 100;
  let insert;
  try {
    insert = await env.DB.prepare(
      `INSERT INTO bookings (guest_name, guest_phone, pickup_zone, destination_zone, distance_km, vehicle_type,
         quoted_currency, quoted_amount, fx_rate_at_booking, settlement_amount_fjd, fuel_multiplier_applied,
         payment_method, status, source_ip, commission_base_fjd, assigned_driver_id,
         pickup_date, pickup_time, notes, return_date, return_time, return_pickup_location,
         client_booking_ref, guest_email, flight_number,
         first_source, first_medium, first_campaign, first_content, first_term, first_referrer, first_landing_path, first_seen_at,
         last_source, last_medium, last_campaign, last_content, last_term, last_referrer, last_landing_path, attribution_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      guestName,
      guestPhone,
      pickupZone,
      destinationZone,
      distanceKm,
      vehicleType,
      quotedCurrency,
      quotedAmount,
      fxRate,
      settlementAmountFjd,
      fuelMultiplierApplied,
      paymentMethod,
      status,
      sourceIp,
      commissionBaseFjd,
      assignedDriverId,
      pickupDate,
      pickupTime,
      notes,
      returnDate,
      returnTime,
      returnPickupLocation,
      clientBookingRef,
      guestEmail,
      flightNumber,
      attribution.firstSource,
      attribution.firstMedium,
      attribution.firstCampaign,
      attribution.firstContent,
      attribution.firstTerm,
      attribution.firstReferrer,
      attribution.firstLandingPath,
      attribution.firstSeenAt,
      attribution.lastSource,
      attribution.lastMedium,
      attribution.lastCampaign,
      attribution.lastContent,
      attribution.lastTerm,
      attribution.lastReferrer,
      attribution.lastLandingPath,
      attribution.attributionSource
    ).run();
  } catch (err) {
    if (clientBookingRef !== null && /UNIQUE constraint failed.*client_booking_ref/i.test(err.message || "")) {
      const existing = await env.DB.prepare(`SELECT * FROM bookings WHERE client_booking_ref = ?`).bind(clientBookingRef).first();
      if (existing) return { ok: true, bookingId: existing.id, booking: existing, pricingNote: null, idempotent: true };
    }
    throw err;
  }
  const bookingId = insert.meta.last_row_id;
  const booking = await env.DB.prepare(`SELECT * FROM bookings WHERE id = ?`).bind(bookingId).first();
  await logBookingEvent(env, {
    bookingId,
    eventType: "created",
    previousStatus: null,
    newStatus: status,
    actor,
    metadata: assignedDriverId || pricingAdjustment || pricingDecision ? {
      ...assignedDriverId ? { assigned_driver_id: assignedDriverId } : {},
      ...pricingAdjustment ? { pricing_adjustment: pricingAdjustment } : {},
      // PII-free record of how the saved amount was decided: what was submitted, what the Worker calculated, what was accepted/saved, why, and which pricing produced it
      ...pricingDecision ? { pricing_decision: { ...pricingDecision, submitted_amount_fjd: submittedAmount, calculated_amount_fjd: calculatedAmount, accepted_amount_fjd: quotedAmount, original_shown_amount_fjd: Number.isFinite(revisedFromAmount) ? revisedFromAmount : null, currency: quotedCurrency, pricing_version: pricingVersion } } : {}
    } : null
  });
  if (booking && pricingAdjustment) booking.fare_check = { submitted: pricingAdjustment.submitted_amount_fjd, saved: pricingAdjustment.saved_amount_fjd };
  return { ok: true, bookingId, booking, pricingNote, idempotent: false };
}
__name(createBookingRecord, "createBookingRecord");
function formatMoneyAmount(n) {
  const r = Math.round(Number(n) * 100) / 100;
  if (!Number.isFinite(r)) return String(n);
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
}
__name(formatMoneyAmount, "formatMoneyAmount");
function sanitiseWhatsAppParamText(text, maxLen) {
  if (!text) return "";
  let s = String(text).replace(/[\r\n\t\v\f\u0085\u2028\u2029]+/g, " ").replace(/ {2,}/g, " ").trim();
  if (maxLen && s.length > maxLen) s = s.slice(0, Math.max(0, maxLen - 1)).trimEnd() + "\u2026";
  return s;
}
__name(sanitiseWhatsAppParamText, "sanitiseWhatsAppParamText");
function buildFullBookingAdminSummary(booking) {
  const b = booking;
  const parts = [
    "NEW BOOKING",
    `#${b.id}`,
    b.client_booking_ref ? `Ref ${b.client_booking_ref}` : null,
    `Guest: ${sanitiseWhatsAppParamText(b.guest_name || "Guest", 60)}`,
    `Phone: ${b.guest_phone || "n/a"}`,
    `${b.pickup_zone} -> ${b.destination_zone}`,
    `Pickup: ${b.pickup_date || "date not set"} ${b.pickup_time || ""}`.trim(),
    b.flight_number ? `Flight: ${b.flight_number}` : null,
    `Vehicle: ${b.vehicle_type}`,
    b.return_date || b.return_time ? `Return: ${b.return_date || "date not set"} ${b.return_time || ""}`.trim() : null,
    b.return_pickup_location ? `Return pickup: ${sanitiseWhatsAppParamText(b.return_pickup_location, 60)}` : null,
    b.notes ? `Notes: ${sanitiseWhatsAppParamText(b.notes, 120)}` : null,
    `Total: ${b.quoted_currency} ${formatMoneyAmount(b.quoted_amount)}`,
    b.fare_check ? `FARE CHECK: guest was shown FJD ${Number(b.fare_check.submitted).toFixed(2)}, saved ${Number(b.fare_check.saved).toFixed(2)} - confirm the fare with the guest` : null,
    "Open admin dashboard for full details"
  ].filter(Boolean);
  return sanitiseWhatsAppParamText(parts.join(" | "), 1e3);
}
__name(buildFullBookingAdminSummary, "buildFullBookingAdminSummary");
async function recordAdminNotificationOutcome(env, bookingId, outcome, detail) {
  await logBookingEvent(env, {
    bookingId,
    eventType: `admin_notification_${outcome}`,
    // 'sent' | 'failed' | 'skipped_idempotent'
    actor: "system",
    metadata: { channel: "whatsapp", ...detail }
  });
}
__name(recordAdminNotificationOutcome, "recordAdminNotificationOutcome");
var ADMIN_NOTIFICATION_LEASE_SECONDS = 120;
async function claimAdminNotificationAttempt(env, bookingId, clientBookingRef) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO admin_notification_state (booking_id, client_booking_ref, state)
     SELECT ?, ?, CASE WHEN EXISTS (SELECT 1 FROM booking_events WHERE booking_id = ? AND event_type = 'admin_notification_sent')
                       THEN 'SENT' ELSE 'NOT_ATTEMPTED' END`
  ).bind(bookingId, clientBookingRef, bookingId).run();
  const claim = await env.DB.prepare(
    `UPDATE admin_notification_state
     SET state = 'ATTEMPTING', attempt_count = attempt_count + 1, updated_at = datetime('now')
     WHERE booking_id = ?
       AND (state IN ('NOT_ATTEMPTED', 'FAILED_RETRYABLE')
            OR (state = 'ATTEMPTING' AND updated_at < datetime('now', ?)))
     RETURNING attempt_count`
  ).bind(bookingId, `-${ADMIN_NOTIFICATION_LEASE_SECONDS} seconds`).first();
  if (claim) return { claimed: true, attempt: claim.attempt_count };
  const current = await env.DB.prepare(`SELECT state FROM admin_notification_state WHERE booking_id = ?`).bind(bookingId).first();
  return { claimed: false, state: current ? current.state : null };
}
__name(claimAdminNotificationAttempt, "claimAdminNotificationAttempt");
function classifyAlertFailure(sendResult) {
  if (sendResult.timedOut) return { outcome: "TIMEOUT_UNKNOWN", possiblyDelivered: true };
  if (sendResult.attempted === false) return { outcome: "NOT_CONFIGURED", possiblyDelivered: false };
  if (typeof sendResult.status === "number") return { outcome: "PROVIDER_REJECTED", possiblyDelivered: false };
  return { outcome: "NETWORK_ERROR", possiblyDelivered: true };
}
__name(classifyAlertFailure, "classifyAlertFailure");
async function attemptAdminNotification(env, booking, { replay = false, trigger } = {}) {
  const attemptTrigger = trigger || (replay ? "replay" : "first");
  try {
    let claim;
    try {
      claim = await claimAdminNotificationAttempt(env, booking.id, booking.client_booking_ref);
    } catch (claimErr) {
      if (!/no such table/i.test(String(claimErr && claimErr.message))) throw claimErr;
      console.error("[admin-notification] admin_notification_state missing; using legacy direct path:", claimErr.message);
      if (replay) {
        await recordAdminNotificationOutcome(env, booking.id, "skipped_idempotent", { reason: "replay of existing client_booking_ref (durable state table not applied)" });
        return;
      }
      const legacySummary = buildFullBookingAdminSummary(booking);
      const phones = await getAdminAlertPhones(env);
      if (phones.length === 0) await recordAdminNotificationOutcome(env, booking.id, "failed", { reason: "platform_settings.admin_alert_phone is not set." });
      for (const phone of phones) {
        const r = await sendHealthAlertWhatsApp(env, phone, legacySummary, sqliteNow());
        if (r.attempted && r.ok) {
          let wamid = null;
          try {
            wamid = JSON.parse(r.response || "null")?.messages?.[0]?.id || null;
          } catch {
          }
          await recordAdminNotificationOutcome(env, booking.id, "sent", { status: r.status, wamid, response: r.response });
        } else {
          await recordAdminNotificationOutcome(env, booking.id, "failed", { reason: r.reason || r.error || "Meta rejected the send.", status: r.status, response: r.response });
        }
      }
      return;
    }
    if (!claim.claimed) {
      const reason = claim.state === "SENT" ? "already sent - provider-confirmed success on a prior attempt" : claim.state === "ATTEMPTING" ? "an attempt for this booking is already in flight" : "replay of existing client_booking_ref";
      await recordAdminNotificationOutcome(env, booking.id, "skipped_idempotent", { reason, previous_state: claim.state });
      return;
    }
    const attempt = claim.attempt;
    const ownership = { attempt, trigger: attemptTrigger };
    const fullSummary = buildFullBookingAdminSummary(booking);
    const notifiedPhones = await getAdminAlertPhones(env);
    let sentDetail = null;
    let failDetail = null;
    if (notifiedPhones.length === 0) {
      failDetail = { reason: "platform_settings.admin_alert_phone is not set.", outcome: "NOT_CONFIGURED", possibly_delivered: false };
      await recordAdminNotificationOutcome(env, booking.id, "failed", { ...failDetail, ...ownership });
    }
    for (const alertPhone of notifiedPhones) {
      const sendResult = await sendHealthAlertWhatsApp(env, alertPhone, fullSummary, sqliteNow());
      if (sendResult.attempted && sendResult.ok) {
        let wamid = null;
        try {
          wamid = JSON.parse(sendResult.response || "null")?.messages?.[0]?.id || null;
        } catch {
        }
        sentDetail = { status: sendResult.status, wamid, response: sendResult.response };
        await recordAdminNotificationOutcome(env, booking.id, "sent", { ...sentDetail, ...ownership });
      } else {
        const c = classifyAlertFailure(sendResult);
        failDetail = {
          reason: sendResult.reason || sendResult.error || "Meta rejected the send.",
          status: sendResult.status,
          response: sendResult.response,
          outcome: c.outcome,
          possibly_delivered: c.possiblyDelivered
        };
        await recordAdminNotificationOutcome(env, booking.id, "failed", { ...failDetail, ...ownership });
      }
    }
    if (sentDetail) {
      const done = await env.DB.prepare(
        `UPDATE admin_notification_state SET state = 'SENT', last_outcome = 'SENT', last_error = NULL, last_provider_status = ?, wamid = ?, updated_at = datetime('now')
         WHERE booking_id = ? AND state != 'SENT'`
      ).bind(sentDetail.status ?? null, sentDetail.wamid ?? null, booking.id).run();
      if (done.meta.changes === 0) {
        await recordAdminNotificationOutcome(env, booking.id, "duplicate_delivery", { wamid: sentDetail.wamid, ...ownership, reason: "booking was already SENT: this attempt also delivered an alert" });
      }
    } else {
      const done = await env.DB.prepare(
        `UPDATE admin_notification_state SET state = 'FAILED_RETRYABLE', last_outcome = ?, last_error = ?, last_provider_status = ?, updated_at = datetime('now')
         WHERE booking_id = ? AND state = 'ATTEMPTING' AND attempt_count = ?`
      ).bind(failDetail.outcome, failDetail.reason, failDetail.status ?? null, booking.id, attempt).run();
      if (done.meta.changes === 0) {
        await recordAdminNotificationOutcome(env, booking.id, "superseded", { ...ownership, outcome: failDetail.outcome, reason: "a newer attempt or a confirmed delivery owns this booking; this stale failure was not applied" });
      }
    }
  } catch (err) {
    console.error(`[admin-notification] attempt failed for booking ${booking.id}: ${err.message}`);
  }
}
__name(attemptAdminNotification, "attemptAdminNotification");
var ADMIN_NOTIFICATION_MAX_ATTEMPTS = 6;
var ADMIN_NOTIFICATION_SWEEP_MIN_AGE_SECONDS = 180;
var ADMIN_NOTIFICATION_SWEEP_WINDOW_HOURS = 24;
var ADMIN_NOTIFICATION_SWEEP_BATCH = 10;
function adminNotificationBackoffSeconds(attemptCount) {
  return Math.min(300 * 2 ** Math.max(0, attemptCount - 1), 3600);
}
__name(adminNotificationBackoffSeconds, "adminNotificationBackoffSeconds");
async function sweepAdminNotifications(env) {
  try {
    const found = await env.DB.prepare(
      `SELECT b.id, ns.state, ns.attempt_count, ns.last_outcome,
              CAST(strftime('%s', 'now') - strftime('%s', ns.updated_at) AS INTEGER) AS age_s
       FROM bookings b LEFT JOIN admin_notification_state ns ON ns.booking_id = b.id
       WHERE b.created_at >= datetime('now', ?) AND b.created_at <= datetime('now', ?)
         AND NOT EXISTS (SELECT 1 FROM booking_events e WHERE e.booking_id = b.id AND e.event_type = 'admin_notification_sent')
         AND NOT EXISTS (SELECT 1 FROM booking_events x WHERE x.booking_id = b.id AND x.event_type = 'admin_notification_exhausted')
         AND (ns.booking_id IS NULL
              OR ns.state IN ('NOT_ATTEMPTED', 'FAILED_RETRYABLE')
              OR (ns.state = 'ATTEMPTING' AND ns.updated_at < datetime('now', ?)))
       ORDER BY b.id LIMIT ?`
    ).bind(
      `-${ADMIN_NOTIFICATION_SWEEP_WINDOW_HOURS} hours`,
      `-${ADMIN_NOTIFICATION_SWEEP_MIN_AGE_SECONDS} seconds`,
      `-${ADMIN_NOTIFICATION_LEASE_SECONDS} seconds`,
      ADMIN_NOTIFICATION_SWEEP_BATCH
    ).all();
    for (const row of found && found.results || []) {
      const attempts = row.attempt_count || 0;
      if (attempts >= ADMIN_NOTIFICATION_MAX_ATTEMPTS) {
        const already = await env.DB.prepare(`SELECT 1 x FROM booking_events WHERE booking_id = ? AND event_type = 'admin_notification_exhausted'`).bind(row.id).first();
        if (!already) {
          await recordAdminNotificationOutcome(env, row.id, "exhausted", { attempts, last_outcome: row.last_outcome || null, reason: "attempt cap reached without a confirmed delivery; escalated to a human" });
          await createEscalation(env, {
            source: "guest",
            triggerType: "app_issue",
            bookingId: row.id,
            context: `Booking #${row.id}: the admin WhatsApp alert could not be delivered after ${attempts} attempts (last outcome: ${row.last_outcome || "unknown"}). Check this booking manually; the guest may be waiting.`
          });
        }
        continue;
      }
      if (row.state === "FAILED_RETRYABLE" && (row.age_s ?? 0) < adminNotificationBackoffSeconds(attempts)) continue;
      const booking = await env.DB.prepare(`SELECT * FROM bookings WHERE id = ?`).bind(row.id).first();
      if (booking) await attemptAdminNotification(env, booking, { trigger: "sweep" });
    }
  } catch (err) {
    console.error(`[admin-notification-sweep] failed: ${err.message}`);
  }
}
__name(sweepAdminNotifications, "sweepAdminNotifications");
async function sendShortAdminAlert(env, booking) {
  try {
    const summary = sanitiseWhatsAppParamText(
      `New booking #${booking.id}: ${booking.guest_name}, ${booking.pickup_zone} -> ${booking.destination_zone}, ${booking.vehicle_type}, ${booking.quoted_currency} ${formatMoneyAmount(booking.quoted_amount)}.${booking.fare_check ? ` FARE CHECK: guest was shown FJD ${Number(booking.fare_check.submitted).toFixed(2)}.` : ""}`,
      1e3
    );
    for (const alertPhone of await getAdminAlertPhones(env)) {
      const r = await sendHealthAlertWhatsApp(env, alertPhone, summary, sqliteNow());
      const ok = !!(r.attempted && r.ok);
      await logBookingEvent(env, {
        bookingId: booking.id,
        eventType: ok ? "admin_short_alert_sent" : "admin_short_alert_failed",
        actor: "system",
        metadata: ok ? { channel: "whatsapp", status: r.status } : { channel: "whatsapp", reason: r.reason || r.error || "Meta rejected the send.", status: r.status, timedOut: !!r.timedOut }
      });
    }
  } catch (err) {
    console.error(`[admin-short-alert] failed for booking ${booking.id}: ${err.message}`);
  }
}
__name(sendShortAdminAlert, "sendShortAdminAlert");
async function dispatchAdminNotifications(env, ctx, booking, { replay }) {
  const jobs = /* @__PURE__ */ __name(() => replay ? [attemptAdminNotification(env, booking, { replay: true })] : [sendShortAdminAlert(env, booking), attemptAdminNotification(env, booking)], "jobs");
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(Promise.allSettled(jobs()));
    return;
  }
  if (replay) {
    await attemptAdminNotification(env, booking, { replay: true });
    return;
  }
  await sendShortAdminAlert(env, booking);
  await attemptAdminNotification(env, booking);
}
__name(dispatchAdminNotifications, "dispatchAdminNotifications");
async function dispatchNewBookingSideEffects(env, ctx, booking) {
  if (ctx && typeof ctx.waitUntil === "function") {
    let matched = null;
    try {
      matched = (await findMatchingOnlineDrivers(env, booking.pickup_zone)).length;
    } catch (err) {
      console.error("[broadcast] matched-driver count failed:", err.message);
    }
    ctx.waitUntil(Promise.allSettled([
      broadcastBookingToDrivers(env, booking),
      sendShortAdminAlert(env, booking),
      attemptAdminNotification(env, booking)
    ]));
    return { matched_drivers: matched, deferred: true };
  }
  const broadcast = await broadcastBookingToDrivers(env, booking);
  await sendShortAdminAlert(env, booking);
  await attemptAdminNotification(env, booking);
  return broadcast;
}
__name(dispatchNewBookingSideEffects, "dispatchNewBookingSideEffects");
async function handleGuestBookingCreate(request, env, ctx) {
  if (!env.DB) return json({ ok: false, error: "Database not available." }, 503);
  const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
  const rateLimit = await checkGuestBookingRateLimit(env, clientIp);
  if (rateLimit.limited) {
    return json({ ok: false, error: "Too many booking submissions from this connection. Please try again shortly." }, 429);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON." }, 400);
  }
  const result = await createBookingRecord(env, {
    guestName: (body.guest_name || "").toString().trim().slice(0, 200) || "Guest",
    guestPhone: normalisePhone((body.guest_phone || "").toString()),
    pickupZone: (body.pickup_zone || "").toString().trim(),
    destinationZone: (body.destination_zone || "").toString().trim(),
    vehicleType: (body.vehicle_type || "").toString().trim().toLowerCase(),
    quotedCurrency: (body.quoted_currency || "").toString().trim().toUpperCase(),
    quotedAmount: Number(body.quoted_amount),
    fxRate: body.fx_rate_at_booking !== void 0 ? Number(body.fx_rate_at_booking) : 1,
    distanceKm: body.distance_km !== void 0 && body.distance_km !== null ? Number(body.distance_km) : null,
    paymentMethod: (body.payment_method || "").toString().trim().toLowerCase(),
    // Milestone 13: for a boat booking, the land-leg-only portion of the
    // bundled quoted_amount - kept separate so a future commission pass
    // never charges/credits a driver commission on the boat operator's
    // pass-through fare. null for every ordinary road booking, unchanged.
    commissionBaseFjd: body.commission_base_fjd !== void 0 && body.commission_base_fjd !== null ? Number(body.commission_base_fjd) : null,
    sourceIp: clientIp,
    pickupDate: normalisedItineraryString(body.pickup_date, 10),
    pickupTime: normalisedItineraryString(body.pickup_time, 5),
    notes: normalisedItineraryString(body.notes, 1e3),
    returnDate: normalisedItineraryString(body.return_date, 10),
    returnTime: normalisedItineraryString(body.return_time, 5),
    returnPickupLocation: normalisedItineraryString(body.return_pickup_location, 300),
    // Milestone 34 (Issue #34 P0 fix)
    clientBookingRef: normalisedItineraryString(body.client_booking_ref, 64),
    guestEmail: normalisedItineraryString(body.guest_email, 200),
    flightNumber: normalisedItineraryString(body.flight_number, 20),
    // Milestone 35 (revenue attribution, PREVIEW ONLY) - this is the ONLY
    // place any of these 15 keys are ever read off the request body. Any
    // other key the client sends (or an attacker adds) is never looked at
    // for attribution, by construction - that's the actual PII defence,
    // not a filter applied after the fact. sanitisedAttributionField inside
    // createBookingRecord() does the length-cap/PII-pattern rejection;
    // this call site only decides WHICH keys are even eligible to reach it.
    firstSource: body.first_source,
    firstMedium: body.first_medium,
    firstCampaign: body.first_campaign,
    firstContent: body.first_content,
    firstTerm: body.first_term,
    firstReferrer: body.first_referrer,
    firstLandingPath: body.first_landing_path,
    firstSeenAt: body.first_seen_at,
    lastSource: body.last_source,
    lastMedium: body.last_medium,
    lastCampaign: body.last_campaign,
    lastContent: body.last_content,
    lastTerm: body.last_term,
    lastReferrer: body.last_referrer,
    lastLandingPath: body.last_landing_path,
    // Milestone 18 (Recommendation 1) - the only caller that opts into
    // server-authoritative pricing. tripType/hasChildSeat/hasSurfboard/
    // hasTour/isCustomAddress are new fields the guest widget now sends
    // (see app.js's submitMarketplaceBooking) specifically so this trust-
    // boundary flip has what it needs - see computeAuthoritativePrice's
    // own comment for exactly how each is used.
    verificationMode: "authoritative",
    tripType: (body.trip_type || "one-way").toString().trim() === "return" ? "return" : "one-way",
    isCustomAddress: body.is_custom_address === true,
    hasTour: body.has_tour === true,
    hasChildSeat: body.has_child_seat === true,
    hasSurfboard: body.has_surfboard === true,
    requireQuoteMatch: body.require_quote_match === true,
    revisedFromAmount: body.revised_from_amount !== void 0 && body.revised_from_amount !== null && isFinite(Number(body.revised_from_amount)) ? Number(body.revised_from_amount) : null,
    actor: "guest"
    // the public guest widget - a real guest's own booking submission
  });
  if (!result.ok && result.code === "PRICE_MISMATCH") {
    return json({ ok: false, code: "PRICE_MISMATCH", errors: result.errors, reference_fare_fjd: result.quoteMismatch.referenceFareFjd, submitted_amount_fjd: result.quoteMismatch.submittedAmountFjd }, 409);
  }
  if (!result.ok) return json({ ok: false, errors: result.errors }, 400);
  if (result.idempotent) {
    await dispatchAdminNotifications(env, ctx, result.booking, { replay: true });
    return json({ ok: true, booking_id: result.bookingId, booking: result.booking, idempotent: true }, 200);
  }
  const b = result.booking;
  const broadcast = await dispatchNewBookingSideEffects(env, ctx, b);
  return json({ ok: true, booking_id: result.bookingId, booking: result.booking, broadcast, idempotent: false }, 201);
}
__name(handleGuestBookingCreate, "handleGuestBookingCreate");
async function checkNegotiationRateLimit(env, ip) {
  const max = Number(await getSetting(env, "negotiation_rate_limit_max_per_day", "5"));
  const windowMinutes = Number(await getSetting(env, "negotiation_rate_limit_window_minutes", "10"));
  const row = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM negotiation_requests WHERE source_ip = ? AND created_at > datetime('now', '-' || ? || ' minutes')`
  ).bind(ip, windowMinutes).first();
  const count = row ? row.cnt : 0;
  return { limited: count >= max, count, max, window_minutes: windowMinutes };
}
__name(checkNegotiationRateLimit, "checkNegotiationRateLimit");
async function checkReferenceFareRateLimit(env, ip) {
  const max = Number(await getSetting(env, "reference_fare_rate_limit_max_per_day", "60"));
  const windowMinutes = Number(await getSetting(env, "reference_fare_rate_limit_window_minutes", "10"));
  const row = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM reference_fare_lookups WHERE source_ip = ? AND created_at > datetime('now', '-' || ? || ' minutes')`
  ).bind(ip, windowMinutes).first();
  const count = row ? row.cnt : 0;
  return { limited: count >= max, count, max, window_minutes: windowMinutes };
}
__name(checkReferenceFareRateLimit, "checkReferenceFareRateLimit");
async function checkNegotiationStatusRateLimit(env, ip) {
  const max = Number(await getSetting(env, "negotiation_status_rate_limit_max", "300"));
  const windowMinutes = Number(await getSetting(env, "negotiation_status_rate_limit_window_minutes", "10"));
  const row = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM negotiation_status_lookups WHERE source_ip = ? AND created_at > datetime('now', '-' || ? || ' minutes')`
  ).bind(ip, windowMinutes).first();
  const count = row ? row.cnt : 0;
  return { limited: count >= max, count, max, window_minutes: windowMinutes };
}
__name(checkNegotiationStatusRateLimit, "checkNegotiationStatusRateLimit");
async function checkDriverSubmitRateLimit(env, ip) {
  const max = Number(await getSetting(env, "driver_submit_rate_limit_max", "5"));
  const windowMinutes = Number(await getSetting(env, "driver_submit_rate_limit_window_minutes", "60"));
  const row = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM driver_submit_lookups WHERE source_ip = ? AND created_at > datetime('now', '-' || ? || ' minutes')`
  ).bind(ip, windowMinutes).first();
  const count = row ? row.cnt : 0;
  return { limited: count >= max, count, max, window_minutes: windowMinutes };
}
__name(checkDriverSubmitRateLimit, "checkDriverSubmitRateLimit");
async function handleReferenceFarePreview(request, env) {
  if (!env.DB) return json({ ok: false, error: "Database not available." }, 503);
  const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
  const rateLimit = await checkReferenceFareRateLimit(env, clientIp);
  if (rateLimit.limited) {
    return json({ ok: false, error: "Too many fare lookups from this connection. Please try again shortly." }, 429);
  }
  const url = new URL(request.url);
  const pickupZone = (url.searchParams.get("pickup_zone") || "").trim();
  const destinationZone = (url.searchParams.get("destination_zone") || "").trim();
  const vehicleType = (url.searchParams.get("vehicle_type") || "").trim().toLowerCase();
  const tripType = (url.searchParams.get("trip_type") || "one-way").trim();
  const errors = [];
  if (!["sedan", "minivan", "minibus"].includes(vehicleType)) errors.push("vehicle_type must be one of: sedan, minivan, minibus");
  if (!["one-way", "return"].includes(tripType)) errors.push("trip_type must be one of: one-way, return");
  const validZones = await getValidZoneNames(env);
  if (!validZones.has(pickupZone)) errors.push(`unknown pickup_zone: ${pickupZone}`);
  if (!validZones.has(destinationZone)) errors.push(`unknown destination_zone: ${destinationZone}`);
  if (errors.length === 0 && pickupZone !== NADI_AIRPORT_ZONE_NAME && destinationZone !== NADI_AIRPORT_ZONE_NAME) {
    errors.push("one of pickup_zone or destination_zone must be Nadi Airport - reference fares are scoped to airport-anchored routes only");
  }
  if (errors.length > 0) return json({ ok: false, errors }, 400);
  const result = await computeRealReferenceFare(env, pickupZone, destinationZone, vehicleType, tripType);
  if (!result.ok) return json({ ok: false, error: result.error }, result.status);
  if (!result.cacheHit) {
    await env.DB.prepare(`INSERT INTO reference_fare_lookups (source_ip) VALUES (?)`).bind(clientIp).run();
  }
  return json({ ok: true, reference_fare_fjd: result.referenceFareFjd, distance_km: result.distanceKm, cached: result.cacheHit }, 200);
}
__name(handleReferenceFarePreview, "handleReferenceFarePreview");
async function handleNegotiationCreate(request, env) {
  if (!env.DB) return json({ ok: false, error: "Database not available." }, 503);
  const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
  const rateLimit = await checkNegotiationRateLimit(env, clientIp);
  if (rateLimit.limited) {
    return json({ ok: false, error: "Too many price proposals from this connection. Please try again shortly." }, 429);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON." }, 400);
  }
  const guestName = (body.guest_name || "").toString().trim().slice(0, 200) || "Guest";
  const guestPhone = normalisePhone((body.guest_phone || "").toString());
  const pickupZone = (body.pickup_zone || "").toString().trim();
  const destinationZone = (body.destination_zone || "").toString().trim();
  const vehicleType = (body.vehicle_type || "").toString().trim().toLowerCase();
  const passengers = body.passengers !== void 0 && body.passengers !== null ? Number(body.passengers) : null;
  const pickupDatetime = body.pickup_datetime ? body.pickup_datetime.toString().trim() : null;
  const guestProposedAmountFjd = Number(body.guest_proposed_amount_fjd);
  const tripType = (body.trip_type || "one-way").toString().trim();
  const errors = [];
  if (!guestPhone) errors.push("a valid guest_phone is required");
  if (!["sedan", "minivan", "minibus"].includes(vehicleType)) errors.push("vehicle_type must be one of: sedan, minivan, minibus");
  if (!["one-way", "return"].includes(tripType)) errors.push("trip_type must be one of: one-way, return");
  if (passengers !== null && (!Number.isInteger(passengers) || passengers < 1 || passengers > 20)) errors.push("passengers must be an integer between 1 and 20");
  if (!guestProposedAmountFjd || !isFinite(guestProposedAmountFjd) || guestProposedAmountFjd <= 0 || guestProposedAmountFjd > 5e3) errors.push("guest_proposed_amount_fjd must be a positive number no greater than 5000");
  const validZones = await getValidZoneNames(env);
  if (!validZones.has(pickupZone)) errors.push(`unknown pickup_zone: ${pickupZone}`);
  if (!validZones.has(destinationZone)) errors.push(`unknown destination_zone: ${destinationZone}`);
  if (errors.length === 0 && pickupZone !== NADI_AIRPORT_ZONE_NAME && destinationZone !== NADI_AIRPORT_ZONE_NAME) {
    errors.push("one of pickup_zone or destination_zone must be Nadi Airport - negotiated fares are scoped to airport-anchored routes only");
  }
  if (errors.length > 0) return json({ ok: false, errors }, 400);
  const refFareResult = await computeRealReferenceFare(env, pickupZone, destinationZone, vehicleType, tripType);
  if (!refFareResult.ok) {
    return json({ ok: false, error: refFareResult.error }, refFareResult.status);
  }
  const { referenceFareFjd: realReferenceFareFjd, distanceKm: realDistanceKm } = refFareResult;
  const floorFjd = realReferenceFareFjd * NEGOTIATION_FLOOR_RATIO;
  if (guestProposedAmountFjd < floorFjd) {
    return json({
      ok: false,
      errors: [`guest_proposed_amount_fjd must be at least ${Math.round(floorFjd * 100) / 100} (${Math.round(NEGOTIATION_FLOOR_RATIO * 100)}% of the real standard fare for this route, ${realReferenceFareFjd})`]
    }, 400);
  }
  const insert = await env.DB.prepare(
    `INSERT INTO negotiation_requests (guest_name, guest_phone, pickup_zone, destination_zone, distance_km, vehicle_type,
       passengers, pickup_datetime, reference_fare_fjd, guest_proposed_amount_fjd, source_ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    guestName,
    guestPhone,
    pickupZone,
    destinationZone,
    realDistanceKm,
    vehicleType,
    passengers,
    pickupDatetime,
    realReferenceFareFjd,
    guestProposedAmountFjd,
    clientIp
  ).run();
  const requestId = insert.meta.last_row_id;
  const negotiationRequest = await env.DB.prepare(`SELECT * FROM negotiation_requests WHERE id = ?`).bind(requestId).first();
  const adminSummary = `New negotiation request #${requestId}: ${guestName} (${guestPhone}), ${pickupZone} -> ${destinationZone}, ${vehicleType}, proposed FJD ${guestProposedAmountFjd} (reference fare FJD ${realReferenceFareFjd}).`;
  const adminAlerts = [];
  for (const alertPhone of await getAdminAlertPhones(env)) {
    adminAlerts.push(await sendHealthAlertWhatsApp(env, alertPhone, adminSummary, sqliteNow()));
  }
  return json({
    ok: true,
    request_id: requestId,
    request: negotiationRequest,
    admin_alerts: adminAlerts
  }, 201);
}
__name(handleNegotiationCreate, "handleNegotiationCreate");
async function handleNegotiationStatus(request, env, requestId) {
  if (!env.DB) return json({ ok: false, error: "Database not available." }, 503);
  const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
  const rateLimit = await checkNegotiationStatusRateLimit(env, clientIp);
  if (rateLimit.limited) {
    return json({ ok: false, error: "Too many status checks from this connection. Please try again shortly." }, 429);
  }
  await env.DB.prepare(`INSERT INTO negotiation_status_lookups (source_ip) VALUES (?)`).bind(clientIp).run();
  const negotiationRequest = await env.DB.prepare(`SELECT id, status, created_at, reference_fare_fjd FROM negotiation_requests WHERE id = ?`).bind(requestId).first();
  if (!negotiationRequest) return json({ ok: false, error: "Negotiation request not found." }, 404);
  if (negotiationRequest.status === "open") {
    const expiryMinutes = Number(await getSetting(env, "negotiation_expiry_minutes", "20"));
    const ageRow = await env.DB.prepare(
      `SELECT (julianday('now') - julianday(created_at)) * 24 * 60 AS age_minutes FROM negotiation_requests WHERE id = ?`
    ).bind(requestId).first();
    if (ageRow && ageRow.age_minutes >= expiryMinutes) {
      await env.DB.prepare(`UPDATE negotiation_requests SET status = 'expired' WHERE id = ? AND status = 'open'`).bind(requestId).run();
      negotiationRequest.status = "expired";
    }
  }
  const offers = await env.DB.prepare(
    `SELECT id, driver_id, offer_type, offer_amount_fjd, guest_decision, created_at FROM negotiation_offers WHERE request_id = ? ORDER BY created_at ASC`
  ).bind(requestId).all();
  return json({ ok: true, request: negotiationRequest, offers: offers.results || [] }, 200);
}
__name(handleNegotiationStatus, "handleNegotiationStatus");
async function handleNegotiationAcceptOffer(request, env, requestId) {
  if (!env.DB) return json({ ok: false, error: "Database not available." }, 503);
  const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
  const rateLimit = await checkGuestBookingRateLimit(env, clientIp);
  if (rateLimit.limited) {
    return json({ ok: false, error: "Too many booking submissions from this connection. Please try again shortly." }, 429);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON." }, 400);
  }
  const offerId = Number(body.offer_id);
  if (!Number.isInteger(offerId) || offerId <= 0) return json({ ok: false, error: "offer_id must be a positive integer" }, 400);
  const negotiationRequest = await env.DB.prepare(`SELECT * FROM negotiation_requests WHERE id = ?`).bind(requestId).first();
  if (!negotiationRequest) return json({ ok: false, error: "Negotiation request not found." }, 404);
  if (negotiationRequest.status !== "open") {
    return json({ ok: false, error: `This request is ${negotiationRequest.status}, cannot accept an offer.` }, 409);
  }
  const offer = await env.DB.prepare(`SELECT * FROM negotiation_offers WHERE id = ? AND request_id = ?`).bind(offerId, requestId).first();
  if (!offer) return json({ ok: false, error: "Offer not found for this request." }, 404);
  if (offer.guest_decision !== "pending") {
    return json({ ok: false, error: `This offer is already ${offer.guest_decision}.` }, 409);
  }
  const result = await createBookingRecord(env, {
    guestName: negotiationRequest.guest_name,
    guestPhone: negotiationRequest.guest_phone,
    pickupZone: negotiationRequest.pickup_zone,
    destinationZone: negotiationRequest.destination_zone,
    distanceKm: negotiationRequest.distance_km,
    vehicleType: negotiationRequest.vehicle_type,
    quotedCurrency: "FJD",
    quotedAmount: offer.offer_amount_fjd,
    fxRate: 1,
    paymentMethod: "cash",
    sourceIp: clientIp,
    assignedDriverId: offer.driver_id,
    status: "accepted",
    // Milestone 18 - explicit, not just the default. This price is
    // intentionally different from the standard fare (that's the whole
    // point of negotiation) and is already independently verified via
    // the trip-type-aware floor check at negotiation-create time -
    // re-running the standard-fare check here would incorrectly flag a
    // legitimate negotiated price.
    verificationMode: "trusted",
    actor: "guest"
    // the guest's own tap accepting a driver's counter-offer created this row
  });
  if (!result.ok) return json({ ok: false, errors: result.errors }, 400);
  await env.DB.batch([
    env.DB.prepare(`UPDATE negotiation_offers SET guest_decision = 'accepted' WHERE id = ?`).bind(offerId),
    env.DB.prepare(`UPDATE negotiation_offers SET guest_decision = 'declined' WHERE request_id = ? AND id != ?`).bind(requestId, offerId),
    env.DB.prepare(`UPDATE negotiation_requests SET status = 'accepted', booking_id = ? WHERE id = ?`).bind(result.bookingId, requestId)
  ]);
  const assignedDriver = await env.DB.prepare(`SELECT name FROM drivers WHERE id = ?`).bind(offer.driver_id).first();
  await sendGuestDriverAssignedWhatsApp(env, result.booking, assignedDriver?.name);
  const alertPhone = await getSetting(env, "admin_alert_phone", "");
  const alert = alertPhone ? await sendHealthAlertWhatsApp(env, alertPhone, `Negotiated booking #${result.bookingId} agreed: FJD ${offer.offer_amount_fjd} (${negotiationRequest.pickup_zone} -> ${negotiationRequest.destination_zone})`, sqliteNow()) : { attempted: false, reason: "platform_settings.admin_alert_phone is not set." };
  return json({ ok: true, booking_id: result.bookingId, booking: result.booking, alert }, 200);
}
__name(handleNegotiationAcceptOffer, "handleNegotiationAcceptOffer");
async function handleNegotiationDecline(request, env, requestId) {
  if (!await requireAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (!env.DB) return json({ ok: false, error: "Database not available." }, 503);
  const negotiationRequest = await env.DB.prepare(
    `SELECT id, status FROM negotiation_requests WHERE id = ?`
  ).bind(requestId).first();
  if (!negotiationRequest) return json({ ok: false, error: "Negotiation request not found." }, 404);
  if (negotiationRequest.status !== "open") {
    return json({ ok: false, error: `This request is already ${negotiationRequest.status}, cannot decline.` }, 409);
  }
  await env.DB.prepare(
    `UPDATE negotiation_requests SET status = 'declined' WHERE id = ? AND status = 'open'`
  ).bind(requestId).run();
  return json({ ok: true }, 200);
}
__name(handleNegotiationDecline, "handleNegotiationDecline");
async function expireStaleNegotiationRequests(env) {
  const expiryMinutes = Number(await getSetting(env, "negotiation_expiry_minutes", "20"));
  await env.DB.prepare(
    `UPDATE negotiation_requests SET status = 'expired'
     WHERE status = 'open' AND (julianday('now') - julianday(created_at)) * 24 * 60 >= ?`
  ).bind(expiryMinutes).run();
}
__name(expireStaleNegotiationRequests, "expireStaleNegotiationRequests");
async function handleDriverNegotiationRequests(request, env) {
  const driver = await requireDriver(request, env);
  if (!driver) return json({ error: "Unauthorized or expired session." }, 401);
  if (!driver.online) return json({ requests: [], note: "Go online to see available requests." }, 200);
  await expireStaleNegotiationRequests(env);
  const driverZones = new Set(JSON.parse(driver.zones || "[]"));
  const result = await env.DB.prepare(
    `SELECT id, guest_name, pickup_zone, destination_zone, distance_km, vehicle_type, passengers,
            pickup_datetime, reference_fare_fjd, guest_proposed_amount_fjd, status, created_at
     FROM negotiation_requests WHERE status = 'open' ORDER BY created_at ASC LIMIT 20`
  ).all();
  const alreadyResponded = await env.DB.prepare(
    `SELECT request_id FROM negotiation_offers WHERE driver_id = ?`
  ).bind(driver.id).all();
  const respondedIds = new Set((alreadyResponded.results || []).map((r) => r.request_id));
  const requests = (result.results || []).filter((r) => driverZones.has(r.pickup_zone) && !respondedIds.has(r.id));
  return json({ requests }, 200);
}
__name(handleDriverNegotiationRequests, "handleDriverNegotiationRequests");
async function handleDriverNegotiationOffer(request, env, requestId) {
  const driver = await requireDriver(request, env);
  if (!driver) return json({ error: "Unauthorized or expired session." }, 401);
  if (!driver.online) return json({ error: "Go online to respond to requests." }, 403);
  const target = await env.DB.prepare(`SELECT pickup_zone, status, reference_fare_fjd FROM negotiation_requests WHERE id = ?`).bind(requestId).first();
  if (!target) return json({ error: "Negotiation request not found." }, 404);
  const driverZones = new Set(JSON.parse(driver.zones || "[]"));
  if (!driverZones.has(target.pickup_zone)) {
    return json({ error: "This request is outside your online zones." }, 403);
  }
  if (target.status !== "open") {
    return json({ error: `This request is ${target.status}, no longer open.` }, 409);
  }
  const locked = await enforceWalletLockout(env, driver.id);
  if (locked.locked) {
    return json({ error: "Wallet balance below the allowed threshold. Settle your balance before responding to requests.", balance_fjd: locked.balance_fjd, threshold_fjd: locked.threshold_fjd }, 403);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  const offerType = (body.type || "").toString().trim().toLowerCase();
  if (!["accept", "counter"].includes(offerType)) return json({ error: "type must be 'accept' or 'counter'" }, 400);
  let offerAmount;
  if (offerType === "accept") {
    const req = await env.DB.prepare(`SELECT guest_proposed_amount_fjd FROM negotiation_requests WHERE id = ?`).bind(requestId).first();
    offerAmount = req.guest_proposed_amount_fjd;
  } else {
    offerAmount = Number(body.amount_fjd);
    if (!offerAmount || !isFinite(offerAmount) || offerAmount <= 0 || offerAmount > 5e3) {
      return json({ error: "amount_fjd must be a positive number no greater than 5000 for a counter" }, 400);
    }
    const floorFjd = target.reference_fare_fjd * NEGOTIATION_FLOOR_RATIO;
    if (offerAmount < floorFjd) {
      return json({
        error: `amount_fjd must be at least ${Math.round(floorFjd * 100) / 100} (${Math.round(NEGOTIATION_FLOOR_RATIO * 100)}% of the real standard fare for this route, ${target.reference_fare_fjd})`
      }, 400);
    }
  }
  try {
    const insert = await env.DB.prepare(
      `INSERT INTO negotiation_offers (request_id, driver_id, offer_type, offer_amount_fjd) VALUES (?, ?, ?, ?)`
    ).bind(requestId, driver.id, offerType, offerAmount).run();
    const offer = await env.DB.prepare(`SELECT * FROM negotiation_offers WHERE id = ?`).bind(insert.meta.last_row_id).first();
    return json({ ok: true, offer }, 201);
  } catch (err) {
    if (String(err.message || "").includes("UNIQUE")) {
      return json({ error: "You have already responded to this request." }, 409);
    }
    throw err;
  }
}
__name(handleDriverNegotiationOffer, "handleDriverNegotiationOffer");
async function getSetting(env, key, fallback) {
  const row = await env.DB.prepare(`SELECT value FROM platform_settings WHERE key = ?`).bind(key).first();
  return row ? row.value : fallback;
}
__name(getSetting, "getSetting");
async function getAdminAlertPhones(env) {
  const phone = await getSetting(env, "admin_alert_phone", "");
  return phone ? [phone] : [];
}
__name(getAdminAlertPhones, "getAdminAlertPhones");
async function enforceWalletLockout(env, driverId) {
  const thresholdRaw = await getSetting(env, "wallet_lockout_threshold_fjd", "-150");
  const threshold = Number(thresholdRaw);
  const wallet = await env.DB.prepare(`SELECT balance_fjd FROM wallets WHERE driver_id = ?`).bind(driverId).first();
  const balance = wallet ? wallet.balance_fjd : 0;
  return { locked: balance <= threshold, balance_fjd: balance, threshold_fjd: threshold };
}
__name(enforceWalletLockout, "enforceWalletLockout");
async function accrueCommission(env, booking) {
  const rateRaw = booking.commission_rate ?? await getSetting(env, "default_commission_rate", "0.15");
  const rate = Number(rateRaw);
  const commission = Math.round(booking.settlement_amount_fjd * rate * 100) / 100;
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO wallets (driver_id, balance_fjd) VALUES (?, 0)`).bind(booking.assigned_driver_id),
    env.DB.prepare(
      `INSERT INTO wallet_transactions (driver_id, booking_id, amount_fjd, type) VALUES (?, ?, ?, 'commission_owed')`
    ).bind(booking.assigned_driver_id, booking.id, -commission),
    env.DB.prepare(
      `UPDATE wallets SET balance_fjd = balance_fjd - ?, updated_at = datetime('now') WHERE driver_id = ?`
    ).bind(commission, booking.assigned_driver_id)
  ]);
  const wallet = await env.DB.prepare(`SELECT balance_fjd FROM wallets WHERE driver_id = ?`).bind(booking.assigned_driver_id).first();
  const threshold = Number(await getSetting(env, "wallet_lockout_threshold_fjd", "-150"));
  if (wallet.balance_fjd <= threshold) {
    await env.DB.prepare(`UPDATE drivers SET online = 0, online_since = NULL WHERE id = ?`).bind(booking.assigned_driver_id).run();
  }
  return { rate, commission_fjd: commission, new_balance_fjd: wallet.balance_fjd };
}
__name(accrueCommission, "accrueCommission");
async function enforceMaxHoursCap(env) {
  const restGapHours = Number(await getSetting(env, "max_hours_rest_gap_hours", "8"));
  const overCap = await env.DB.prepare(
    `SELECT id FROM drivers
     WHERE online = 1 AND online_since IS NOT NULL
       AND (julianday('now') - julianday(online_since)) * 24 >= max_hours_cap`
  ).all();
  const forced = [];
  for (const row of overCap.results || []) {
    await env.DB.prepare(
      `UPDATE drivers SET online = 0, online_since = NULL, forced_offline_until = datetime('now', '+' || ? || ' hours') WHERE id = ?`
    ).bind(restGapHours, row.id).run();
    forced.push(row.id);
  }
  return { checked_at: sqliteNow(), rest_gap_hours: restGapHours, forced_offline_driver_ids: forced };
}
__name(enforceMaxHoursCap, "enforceMaxHoursCap");
async function handleAdminMaxHoursSweep(request, env) {
  if (!await requireAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (!env.DB) return json({ ok: false, error: "Database not available." }, 503);
  const result = await enforceMaxHoursCap(env);
  return json({ ok: true, ...result }, 200);
}
__name(handleAdminMaxHoursSweep, "handleAdminMaxHoursSweep");
async function checkFuelIndexUpdate(env) {
  let html;
  try {
    const res = await fetch(FCCC_PETROLEUM_URL, { headers: { "User-Agent": "Mozilla/5.0 (compatible; nadi-dispatch-api fuel-index-check)" } });
    if (!res.ok) return { ok: false, error: `FCCC page returned ${res.status}` };
    html = await res.text();
  } catch (err) {
    return { ok: false, error: `Fetch failed: ${err.message}` };
  }
  const match = html.match(FCCC_PDF_LINK_RE);
  if (!match) return { ok: false, error: "No Petroleum Prices PDF link found on the FCCC page - page structure may have changed." };
  const latestPdfUrl = match[1];
  const latestFilename = latestPdfUrl.split("/").pop();
  const lastSeen = await getSetting(env, "fuel_index_last_seen_order", "");
  if (latestFilename === lastSeen) {
    return { ok: true, new_order: false, filename: latestFilename };
  }
  await env.DB.prepare(
    `INSERT INTO platform_settings (key, value, updated_at) VALUES ('fuel_index_last_seen_order', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).bind(latestFilename).run();
  const current = await env.DB.prepare(`SELECT fuel_price_fjd_per_litre FROM fuel_index ORDER BY id DESC LIMIT 1`).first();
  const currentPrice = current ? current.fuel_price_fjd_per_litre : null;
  const alertPhone = await getSetting(env, "admin_alert_phone", "");
  const bodyText = `New FCCC petroleum price order detected: ${latestFilename}. Current fuel_index baseline: FJ$${currentPrice ?? "unset"}/L. Please review Schedule 1 (Viti Levu, within 3km), Gasoil (diesoline), Retail, Bulk Sale price at ${latestPdfUrl} and submit it via POST /admin/fuel-index/submit.`;
  const whatsapp = alertPhone ? await sendFuelIndexAlertWhatsApp(env, alertPhone, bodyText) : { attempted: false, reason: "platform_settings.admin_alert_phone is not set." };
  return { ok: true, new_order: true, filename: latestFilename, pdf_url: latestPdfUrl, current_price_fjd: currentPrice, whatsapp };
}
__name(checkFuelIndexUpdate, "checkFuelIndexUpdate");
async function handleAdminFuelIndexCheck(request, env) {
  if (!await requireAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  const result = await checkFuelIndexUpdate(env);
  return json(result, result.ok ? 200 : 500);
}
__name(handleAdminFuelIndexCheck, "handleAdminFuelIndexCheck");
async function handleAdminFuelIndexSubmit(request, env) {
  if (!await requireAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (!env.DB) return json({ ok: false, error: "Database not available." }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON." }, 400);
  }
  const price = Number(body.fuel_price_fjd_per_litre);
  const effectiveFrom = (body.effective_from || "").toString();
  const orderReference = (body.order_reference || "").toString();
  if (!price || price <= 0) return json({ ok: false, error: "fuel_price_fjd_per_litre must be a positive number." }, 400);
  if (!effectiveFrom) return json({ ok: false, error: "effective_from is required." }, 400);
  if (!orderReference) return json({ ok: false, error: "order_reference is required." }, 400);
  const current = await env.DB.prepare(`SELECT fuel_price_fjd_per_litre FROM fuel_index ORDER BY id DESC LIMIT 1`).first();
  const currentPrice = current ? current.fuel_price_fjd_per_litre : null;
  const percentChange = currentPrice ? (price - currentPrice) / currentPrice * 100 : null;
  const insert = await env.DB.prepare(
    `INSERT INTO fuel_index_pending (fuel_price_fjd_per_litre, effective_from, order_reference, status) VALUES (?, ?, ?, 'pending')`
  ).bind(price, effectiveFrom, orderReference).run();
  const pendingId = insert.meta.last_row_id;
  const alertPhone = await getSetting(env, "admin_alert_phone", "");
  const changeText = percentChange !== null ? `${percentChange >= 0 ? "+" : ""}${percentChange.toFixed(1)}%` : "no prior baseline";
  const bodyText = `Fuel price change pending confirm: FJ$${currentPrice ?? "unset"}/L -> FJ$${price}/L (${changeText}). Order: ${orderReference}. Effective ${effectiveFrom}. Reply/call POST /admin/fuel-index/pending/${pendingId}/confirm to apply, or /reject to discard. fuel_auto_apply is false - this will NOT go live without an explicit confirm.`;
  const whatsapp = alertPhone ? await sendFuelIndexAlertWhatsApp(env, alertPhone, bodyText) : { attempted: false, reason: "platform_settings.admin_alert_phone is not set." };
  return json({
    ok: true,
    pending_id: pendingId,
    current_price_fjd: currentPrice,
    submitted_price_fjd: price,
    percent_change: percentChange,
    whatsapp
  }, 201);
}
__name(handleAdminFuelIndexSubmit, "handleAdminFuelIndexSubmit");
async function handleAdminFuelIndexConfirm(request, env, pendingId) {
  if (!await requireAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (!env.DB) return json({ ok: false, error: "Database not available." }, 503);
  const pending = await env.DB.prepare(`SELECT * FROM fuel_index_pending WHERE id = ?`).bind(pendingId).first();
  if (!pending) return json({ ok: false, error: "Pending fuel index change not found." }, 404);
  if (pending.status !== "pending") return json({ ok: false, error: `Already ${pending.status}, cannot confirm again.` }, 409);
  const multiplier = Math.round(pending.fuel_price_fjd_per_litre / FUEL_MULTIPLIER_BASELINE_FJD * 1e4) / 1e4;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO fuel_index (fuel_price_fjd_per_litre, effective_from, multiplier, order_reference, updated_by) VALUES (?, ?, ?, ?, 'admin confirm via /admin/fuel-index/pending/:id/confirm')`
    ).bind(pending.fuel_price_fjd_per_litre, pending.effective_from, multiplier, pending.order_reference),
    env.DB.prepare(`UPDATE fuel_index_pending SET status = 'confirmed' WHERE id = ?`).bind(pendingId),
    env.DB.prepare(
      `UPDATE platform_settings SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = datetime('now') WHERE key = 'fuel_confirmed_accurate_count'`
    )
  ]);
  return json({ ok: true, pending_id: pendingId, applied_price_fjd: pending.fuel_price_fjd_per_litre, multiplier }, 200);
}
__name(handleAdminFuelIndexConfirm, "handleAdminFuelIndexConfirm");
async function handleAdminFuelIndexReject(request, env, pendingId) {
  if (!await requireAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (!env.DB) return json({ ok: false, error: "Database not available." }, 503);
  const pending = await env.DB.prepare(`SELECT id, status FROM fuel_index_pending WHERE id = ?`).bind(pendingId).first();
  if (!pending) return json({ ok: false, error: "Pending fuel index change not found." }, 404);
  if (pending.status !== "pending") return json({ ok: false, error: `Already ${pending.status}, cannot reject.` }, 409);
  await env.DB.prepare(`UPDATE fuel_index_pending SET status = 'rejected' WHERE id = ?`).bind(pendingId).run();
  return json({ ok: true, pending_id: pendingId, status: "rejected" }, 200);
}
__name(handleAdminFuelIndexReject, "handleAdminFuelIndexReject");
async function handleFuelIndexPublic(request, env) {
  if (!env.DB) return json({ error: "Database not available." }, 503);
  const row = await env.DB.prepare(
    `SELECT fuel_price_fjd_per_litre, effective_from, multiplier FROM fuel_index ORDER BY id DESC LIMIT 1`
  ).first();
  if (!row) return json({ error: "No fuel index set yet." }, 404);
  return json({
    fuel_price_fjd_per_litre: row.fuel_price_fjd_per_litre,
    effective_from: row.effective_from,
    multiplier: row.multiplier
  }, 200);
}
__name(handleFuelIndexPublic, "handleFuelIndexPublic");
var BACKUP_TABLES = [
  "zones",
  "drivers",
  "vehicles",
  "destinations",
  "fuel_index",
  "fuel_index_pending",
  "platform_settings",
  "pricing_rules",
  "bookings",
  "wallets",
  "wallet_transactions",
  "driver_login_tokens",
  "admin_login_tokens"
];
var OPTIONAL_BACKUP_TABLES = ["rental_enquiries", "rental_enquiry_events", "rental_notification_state"];
async function runD1Backup(env) {
  if (!env.DB) return { ok: false, error: "Database not available." };
  if (!env.BACKUPS) return { ok: false, error: "BACKUPS R2 bucket not bound to this Worker." };
  const snapshot = { exported_at: sqliteNow(), table_order: BACKUP_TABLES, tables: {} };
  const rowCounts = {};
  for (const table of BACKUP_TABLES) {
    const result = await env.DB.prepare(`SELECT * FROM ${table}`).all();
    snapshot.tables[table] = result.results || [];
    rowCounts[table] = snapshot.tables[table].length;
  }
  for (const table of OPTIONAL_BACKUP_TABLES) {
    try {
      const result = await env.DB.prepare(`SELECT * FROM ${table}`).all();
      snapshot.tables[table] = result.results || [];
      rowCounts[table] = snapshot.tables[table].length;
      snapshot.table_order = [...snapshot.table_order, table];
    } catch (err) {
      if (!/no such table/i.test(String(err && err.message))) throw err;
    }
  }
  const filename = `nadi-marketplace-db-${snapshot.exported_at.replace(/[: ]/g, "-")}.json`;
  const key = `backups/${filename}`;
  const body = JSON.stringify(snapshot);
  await env.BACKUPS.put(key, body, { httpMetadata: { contentType: "application/json" } });
  return { ok: true, key, filename, size_bytes: body.length, row_counts: rowCounts, exported_at: snapshot.exported_at };
}
__name(runD1Backup, "runD1Backup");
async function handleAdminBackupRun(request, env) {
  if (!await requireAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  const result = await runD1Backup(env);
  return json(result, result.ok ? 201 : 500);
}
__name(handleAdminBackupRun, "handleAdminBackupRun");
var ALLOWED_DESTINATION_TYPES = ["hotel", "airport", "port", "town", "custom"];
async function handleDestinationsPublic(env) {
  if (!env.DB) return json({ zones: [] }, 503);
  const result = await env.DB.prepare(
    `SELECT d.id, d.name, d.type, d.display_order, z.id AS zone_id, z.name AS zone_name
     FROM destinations d JOIN zones z ON z.id = d.zone_id
     WHERE d.active = 1
     ORDER BY z.id, d.display_order, d.name`
  ).all();
  const zonesMap = /* @__PURE__ */ new Map();
  for (const row of result.results || []) {
    if (!zonesMap.has(row.zone_id)) zonesMap.set(row.zone_id, { zone_id: row.zone_id, zone_name: row.zone_name, destinations: [] });
    zonesMap.get(row.zone_id).destinations.push({ id: row.id, name: row.name, type: row.type, display_order: row.display_order });
  }
  return json({ zones: [...zonesMap.values()] }, 200);
}
__name(handleDestinationsPublic, "handleDestinationsPublic");
async function handleAdminDestinationsList(request, env) {
  if (!await requireAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (!env.DB) return json({ destinations: [] }, 503);
  const result = await env.DB.prepare(
    `SELECT d.id, d.name, d.type, d.active, d.display_order, z.name AS zone
     FROM destinations d JOIN zones z ON z.id = d.zone_id
     ORDER BY z.id, d.display_order, d.name`
  ).all();
  return json({ destinations: (result.results || []).map((r) => ({ ...r, active: !!r.active })) }, 200);
}
__name(handleAdminDestinationsList, "handleAdminDestinationsList");
async function handleAdminDestinationCreate(request, env) {
  if (!await requireAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (!env.DB) return json({ ok: false, error: "Database not available." }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON." }, 400);
  }
  const name = (body.name || "").toString().trim();
  const type = (body.type || "").toString().trim().toLowerCase();
  const zoneName = (body.zone || "").toString().trim();
  const displayOrder = body.display_order !== void 0 && body.display_order !== null ? Number(body.display_order) : null;
  const active = body.active !== void 0 ? body.active ? 1 : 0 : 1;
  const transferType = (body.transfer_type || "road").toString().trim().toLowerCase();
  const boatAdultFareFjd = body.boat_adult_fare_fjd !== void 0 && body.boat_adult_fare_fjd !== null ? Number(body.boat_adult_fare_fjd) : null;
  const boatChildFareFjd = body.boat_child_fare_fjd !== void 0 && body.boat_child_fare_fjd !== null ? Number(body.boat_child_fare_fjd) : null;
  const boatLandLegFareFjd = body.boat_land_leg_fare_fjd !== void 0 && body.boat_land_leg_fare_fjd !== null ? Number(body.boat_land_leg_fare_fjd) : null;
  const boatOperatorName = body.boat_operator_name ? body.boat_operator_name.toString().trim() : null;
  const boatFareSourcedAt = body.boat_fare_sourced_at ? body.boat_fare_sourced_at.toString().trim() : null;
  const boatFareSourceNote = body.boat_fare_source_note ? body.boat_fare_source_note.toString().trim() : null;
  const pricingStatus = body.pricing_status ? body.pricing_status.toString().trim().toLowerCase() : transferType === "boat" ? boatAdultFareFjd ? "sourced" : "pending" : null;
  const errors = [];
  if (!name) errors.push("name is required");
  if (!ALLOWED_DESTINATION_TYPES.includes(type)) errors.push(`type must be one of: ${ALLOWED_DESTINATION_TYPES.join(", ")}`);
  if (!zoneName) errors.push("zone is required");
  if (!["road", "boat"].includes(transferType)) errors.push(`transfer_type must be one of: road, boat`);
  if (transferType === "boat" && !["sourced", "pending"].includes(pricingStatus)) errors.push(`pricing_status must be one of: sourced, pending (required for transfer_type=boat)`);
  if (transferType === "boat" && pricingStatus === "sourced" && !boatAdultFareFjd) errors.push("boat_adult_fare_fjd is required when pricing_status is sourced");
  if (errors.length > 0) return json({ ok: false, errors }, 400);
  const zone = await env.DB.prepare(`SELECT id FROM zones WHERE name = ?`).bind(zoneName).first();
  if (!zone) return json({ ok: false, error: `unknown zone: ${zoneName}` }, 400);
  const insert = await env.DB.prepare(
    `INSERT INTO destinations (name, type, zone_id, display_order, active, transfer_type, boat_adult_fare_fjd, boat_child_fare_fjd, boat_land_leg_fare_fjd, boat_operator_name, boat_fare_sourced_at, boat_fare_source_note, pricing_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(name, type, zone.id, displayOrder, active, transferType, boatAdultFareFjd, boatChildFareFjd, boatLandLegFareFjd, boatOperatorName, boatFareSourcedAt, boatFareSourceNote, pricingStatus).run();
  const destinationId = insert.meta.last_row_id;
  const row = await env.DB.prepare(
    `SELECT d.id, d.name, d.type, d.active, d.display_order, z.name AS zone,
            d.transfer_type, d.pricing_status, d.boat_adult_fare_fjd, d.boat_child_fare_fjd, d.boat_land_leg_fare_fjd, d.boat_operator_name
     FROM destinations d JOIN zones z ON z.id = d.zone_id WHERE d.id = ?`
  ).bind(destinationId).first();
  return json({ ok: true, destination: row }, 201);
}
__name(handleAdminDestinationCreate, "handleAdminDestinationCreate");
async function handleAdminDestinationEdit(request, env, destinationId) {
  if (!await requireAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (!env.DB) return json({ ok: false, error: "Database not available." }, 503);
  const existing = await env.DB.prepare(`SELECT id FROM destinations WHERE id = ?`).bind(destinationId).first();
  if (!existing) return json({ ok: false, error: "Destination not found." }, 404);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON." }, 400);
  }
  const updates = [];
  const values = [];
  if (body.name !== void 0) {
    const name = body.name.toString().trim();
    if (!name) return json({ ok: false, error: "name cannot be empty." }, 400);
    updates.push("name = ?");
    values.push(name);
  }
  if (body.type !== void 0) {
    const type = body.type.toString().trim().toLowerCase();
    if (!ALLOWED_DESTINATION_TYPES.includes(type)) return json({ ok: false, error: `type must be one of: ${ALLOWED_DESTINATION_TYPES.join(", ")}` }, 400);
    updates.push("type = ?");
    values.push(type);
  }
  if (body.zone !== void 0) {
    const zone = await env.DB.prepare(`SELECT id FROM zones WHERE name = ?`).bind(body.zone.toString().trim()).first();
    if (!zone) return json({ ok: false, error: `unknown zone: ${body.zone}` }, 400);
    updates.push("zone_id = ?");
    values.push(zone.id);
  }
  if (body.display_order !== void 0) {
    updates.push("display_order = ?");
    values.push(body.display_order === null ? null : Number(body.display_order));
  }
  if (body.active !== void 0) {
    updates.push("active = ?");
    values.push(body.active ? 1 : 0);
  }
  if (body.pricing_status !== void 0) {
    const pricingStatus = body.pricing_status === null ? null : body.pricing_status.toString().trim().toLowerCase();
    if (pricingStatus !== null && !["sourced", "pending"].includes(pricingStatus)) {
      return json({ ok: false, error: "pricing_status must be 'sourced', 'pending', or null" }, 400);
    }
    updates.push("pricing_status = ?");
    values.push(pricingStatus);
  }
  if (body.transfer_type !== void 0) {
    const transferType = body.transfer_type.toString().trim().toLowerCase();
    if (!["road", "boat"].includes(transferType)) return json({ ok: false, error: "transfer_type must be one of: road, boat" }, 400);
    updates.push("transfer_type = ?");
    values.push(transferType);
  }
  if (body.boat_adult_fare_fjd !== void 0) {
    updates.push("boat_adult_fare_fjd = ?");
    values.push(body.boat_adult_fare_fjd === null ? null : Number(body.boat_adult_fare_fjd));
  }
  if (body.boat_child_fare_fjd !== void 0) {
    updates.push("boat_child_fare_fjd = ?");
    values.push(body.boat_child_fare_fjd === null ? null : Number(body.boat_child_fare_fjd));
  }
  if (body.boat_land_leg_fare_fjd !== void 0) {
    updates.push("boat_land_leg_fare_fjd = ?");
    values.push(body.boat_land_leg_fare_fjd === null ? null : Number(body.boat_land_leg_fare_fjd));
  }
  if (body.boat_operator_name !== void 0) {
    updates.push("boat_operator_name = ?");
    values.push(body.boat_operator_name ? body.boat_operator_name.toString().trim() : null);
  }
  if (body.boat_fare_sourced_at !== void 0) {
    updates.push("boat_fare_sourced_at = ?");
    values.push(body.boat_fare_sourced_at ? body.boat_fare_sourced_at.toString().trim() : null);
  }
  if (body.boat_fare_source_note !== void 0) {
    updates.push("boat_fare_source_note = ?");
    values.push(body.boat_fare_source_note ? body.boat_fare_source_note.toString().trim() : null);
  }
  if (updates.length === 0) return json({ ok: false, error: "No fields to update." }, 400);
  values.push(destinationId);
  await env.DB.prepare(`UPDATE destinations SET ${updates.join(", ")} WHERE id = ?`).bind(...values).run();
  const row = await env.DB.prepare(
    `SELECT d.id, d.name, d.type, d.active, d.display_order, z.name AS zone,
            d.transfer_type, d.pricing_status, d.boat_adult_fare_fjd, d.boat_child_fare_fjd,
            d.boat_land_leg_fare_fjd, d.boat_operator_name, d.boat_fare_sourced_at, d.boat_fare_source_note
     FROM destinations d JOIN zones z ON z.id = d.zone_id WHERE d.id = ?`
  ).bind(destinationId).first();
  return json({ ok: true, destination: row }, 200);
}
__name(handleAdminDestinationEdit, "handleAdminDestinationEdit");
async function handleAdminDestinationDeactivate(request, env, destinationId) {
  if (!await requireAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (!env.DB) return json({ ok: false, error: "Database not available." }, 503);
  const existing = await env.DB.prepare(`SELECT id FROM destinations WHERE id = ?`).bind(destinationId).first();
  if (!existing) return json({ ok: false, error: "Destination not found." }, 404);
  await env.DB.prepare(`UPDATE destinations SET active = 0 WHERE id = ?`).bind(destinationId).run();
  return json({ ok: true, destination_id: destinationId, active: false }, 200);
}
__name(handleAdminDestinationDeactivate, "handleAdminDestinationDeactivate");
var GOOGLE_ROUTES_API_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
var MAX_QUOTE_DISTANCE_KM = 300;
var LOW_CONFIDENCE_GEOCODE_TYPES = /* @__PURE__ */ new Set([
  "country",
  "administrative_area_level_1",
  "administrative_area_level_2"
]);
function normalizeAddressQuery(raw) {
  return (raw || "").toString().trim().toLowerCase().replace(/\s+/g, " ");
}
__name(normalizeAddressQuery, "normalizeAddressQuery");
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
__name(haversineKm, "haversineKm");
async function findNearestZone(env, lat, lng) {
  const result = await env.DB.prepare(`SELECT id, name, lat, lng, remote_multiplier FROM zones WHERE lat IS NOT NULL AND lng IS NOT NULL`).all();
  let nearest = null;
  let nearestDist = Infinity;
  for (const zone of result.results || []) {
    const d = haversineKm(lat, lng, zone.lat, zone.lng);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = zone;
    }
  }
  return nearest;
}
__name(findNearestZone, "findNearestZone");
async function computeFareFjd(env, vehicleType, distanceKm, remoteMultiplier) {
  const detailed = await computeFareFjdDetailed(env, vehicleType, distanceKm, remoteMultiplier);
  return detailed ? detailed.fare : null;
}
__name(computeFareFjd, "computeFareFjd");
async function computeFareFjdDetailed(env, vehicleType, distanceKm, remoteMultiplier) {
  const rule = await env.DB.prepare(
    `SELECT base_rate_fjd_per_km, flagfall_fjd FROM pricing_rules
     WHERE vehicle_type = ? AND active = 1 AND distance_min_km <= ? AND (distance_max_km IS NULL OR ? < distance_max_km)
     ORDER BY distance_min_km DESC LIMIT 1`
  ).bind(vehicleType, distanceKm, distanceKm).first();
  if (!rule) return null;
  const baseFare = computeBaseFare({ flagfallFjd: rule.flagfall_fjd, baseRateFjdPerKm: rule.base_rate_fjd_per_km, distanceKm });
  const withZoneMultiplier = applyZoneMultiplier(baseFare, remoteMultiplier);
  return { fare: computeFinalTotal(withZoneMultiplier), rule: { flagfall: rule.flagfall_fjd, rate: rule.base_rate_fjd_per_km }, zoneMultiplier: remoteMultiplier === null || remoteMultiplier === void 0 ? 1 : remoteMultiplier };
}
__name(computeFareFjdDetailed, "computeFareFjdDetailed");
function pricingVersionString(vehicleType, detail) {
  return `nat-formula-v1|${vehicleType}|flag${detail.rule.flagfall}|rate${detail.rule.rate}|zm${detail.zoneMultiplier}|ret${RETURN_MULTIPLIER}|night${NIGHT_SURCHARGE}|disc${DISCOUNT_RATE}|band0.8-1.3`;
}
__name(pricingVersionString, "pricingVersionString");
async function computeZoneToZoneDistanceKm(env, lat1, lng1, lat2, lng2) {
  if (!env.GOOGLE_MAPS_API_KEY) return null;
  try {
    const res = await fetch(GOOGLE_ROUTES_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": env.GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask": "routes.distanceMeters"
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: lat1, longitude: lng1 } } },
        destination: { location: { latLng: { latitude: lat2, longitude: lng2 } } },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_UNAWARE",
        units: "METRIC"
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const route = data.routes && data.routes[0];
    if (!route || !route.distanceMeters) return null;
    return route.distanceMeters / 1e3;
  } catch (err) {
    return null;
  }
}
__name(computeZoneToZoneDistanceKm, "computeZoneToZoneDistanceKm");
async function getZoneDistanceKm(env, zoneAName, zoneBName, latA, lngA, latB, lngB) {
  const [sortedA, sortedB, sortedLatA, sortedLngA, sortedLatB, sortedLngB] = zoneAName <= zoneBName ? [zoneAName, zoneBName, latA, lngA, latB, lngB] : [zoneBName, zoneAName, latB, lngB, latA, lngA];
  const cached = await env.DB.prepare(
    `SELECT distance_km FROM zone_distance_cache WHERE zone_a = ? AND zone_b = ?`
  ).bind(sortedA, sortedB).first();
  if (cached) return { distanceKm: cached.distance_km, cacheHit: true };
  const distanceKm = await computeZoneToZoneDistanceKm(env, sortedLatA, sortedLngA, sortedLatB, sortedLngB);
  if (distanceKm === null) return { distanceKm: null, cacheHit: false };
  await env.DB.prepare(
    `INSERT OR IGNORE INTO zone_distance_cache (zone_a, zone_b, distance_km) VALUES (?, ?, ?)`
  ).bind(sortedA, sortedB, distanceKm).run();
  return { distanceKm, cacheHit: false };
}
__name(getZoneDistanceKm, "getZoneDistanceKm");
async function computeRealReferenceFare(env, pickupZone, destinationZone, vehicleType, tripType = "one-way") {
  const remoteZoneName = pickupZone === NADI_AIRPORT_ZONE_NAME ? destinationZone : pickupZone;
  const [airportZoneRow, remoteZoneRow] = await Promise.all([
    env.DB.prepare(`SELECT lat, lng FROM zones WHERE name = ?`).bind(NADI_AIRPORT_ZONE_NAME).first(),
    env.DB.prepare(`SELECT lat, lng, remote_multiplier FROM zones WHERE name = ?`).bind(remoteZoneName).first()
  ]);
  if (!airportZoneRow || !remoteZoneRow || airportZoneRow.lat === null || remoteZoneRow.lat === null) {
    return { ok: false, error: "Could not compute a real fare for this route right now. Please try again shortly.", status: 503 };
  }
  const { distanceKm, cacheHit } = await getZoneDistanceKm(
    env,
    NADI_AIRPORT_ZONE_NAME,
    remoteZoneName,
    airportZoneRow.lat,
    airportZoneRow.lng,
    remoteZoneRow.lat,
    remoteZoneRow.lng
  );
  if (distanceKm === null) {
    return { ok: false, error: "Could not compute a real fare for this route right now. Please try again shortly.", status: 503 };
  }
  const oneWayFareFjd = await computeFareFjd(env, vehicleType, distanceKm, remoteZoneRow.remote_multiplier);
  if (!oneWayFareFjd) {
    return { ok: false, error: "No pricing rule found for this route and vehicle type.", status: 400 };
  }
  const referenceFareFjd = computeFinalTotal(applyTripTypeMultiplier(oneWayFareFjd, tripType));
  return { ok: true, referenceFareFjd, distanceKm, cacheHit };
}
__name(computeRealReferenceFare, "computeRealReferenceFare");
async function computeAuthoritativePrice(env, { pickupZone, destinationZone, vehicleType, tripType, pickupTime, hasChildSeat, hasSurfboard }) {
  const remoteZoneName = pickupZone === NADI_AIRPORT_ZONE_NAME ? destinationZone : pickupZone;
  const [airportZoneRow, remoteZoneRow] = await Promise.all([
    env.DB.prepare(`SELECT lat, lng FROM zones WHERE name = ?`).bind(NADI_AIRPORT_ZONE_NAME).first(),
    env.DB.prepare(`SELECT lat, lng, remote_multiplier FROM zones WHERE name = ?`).bind(remoteZoneName).first()
  ]);
  if (!airportZoneRow || !remoteZoneRow || airportZoneRow.lat === null || remoteZoneRow.lat === null) {
    return { ok: false, error: "Could not resolve zone coordinates for authoritative pricing." };
  }
  const { distanceKm } = await getZoneDistanceKm(
    env,
    NADI_AIRPORT_ZONE_NAME,
    remoteZoneName,
    airportZoneRow.lat,
    airportZoneRow.lng,
    remoteZoneRow.lat,
    remoteZoneRow.lng
  );
  if (distanceKm === null) {
    return { ok: false, error: "Could not resolve a real distance for authoritative pricing." };
  }
  const oneWayDetail = await computeFareFjdDetailed(env, vehicleType, distanceKm, remoteZoneRow.remote_multiplier);
  const oneWayFareFjd = oneWayDetail ? oneWayDetail.fare : null;
  if (!oneWayFareFjd) {
    return { ok: false, error: "No pricing rule found for this route and vehicle type." };
  }
  const withTripType = applyTripTypeMultiplier(oneWayFareFjd, tripType);
  const withNightSurcharge = applyNightSurcharge(withTripType, pickupTime);
  const withExtras = applyExtras(withNightSurcharge, { hasChildSeat, hasSurfboard });
  return { ok: true, transferPlusExtrasFjd: computeFinalTotal(withExtras), distanceKm, pricingVersion: pricingVersionString(vehicleType, oneWayDetail) };
}
__name(computeAuthoritativePrice, "computeAuthoritativePrice");
async function callGoogleRoutesApi(env, airportLat, airportLng, addressText, direction = "from_airport") {
  if (!env.GOOGLE_MAPS_API_KEY) {
    return { ok: false, reason: "not_configured" };
  }
  const airportPoint = { location: { latLng: { latitude: airportLat, longitude: airportLng } } };
  const addressPoint = { address: addressText };
  const origin = direction === "to_airport" ? addressPoint : airportPoint;
  const destination = direction === "to_airport" ? airportPoint : addressPoint;
  try {
    const res = await fetch(GOOGLE_ROUTES_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": env.GOOGLE_MAPS_API_KEY,
        // routes.legs.endLocation added after a real test caught a real bug:
        // without it, the destination's resolved lat/lng was never in the
        // response at all, and findNearestZone() was silently computing
        // distance from (0,0) instead - see the Milestone 9 report for
        // exactly how this was caught (a real Denarau address matched
        // "Natadola" as nearest zone, which is nowhere near it).
        // routes.legs.startLocation added for Milestone 12: when the
        // free-text address is the ORIGIN (direction='to_airport'), its
        // resolved point is the first leg's start, not the last leg's end.
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.warnings,routes.legs.startLocation,routes.legs.endLocation,routes.legs.steps.travelMode,routes.legs.steps.navigationInstruction,geocodingResults"
      },
      body: JSON.stringify({
        origin,
        destination,
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_UNAWARE",
        units: "METRIC",
        // Disambiguates short/ambiguous text addresses (e.g. "Waila",
        // "Namaka") to Fiji without altering the address string itself -
        // confirmed via the real Routes API docs that regionCode is a
        // top-level ccTLD hint the API applies during geocoding, not a
        // display/formatting-only field.
        regionCode: "FJ"
      })
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return { ok: false, reason: "geocode_failed", status: res.status, raw: errText.slice(0, 500) };
    }
    const data = await res.json();
    const addressSideWaypoint = direction === "to_airport" ? data.geocodingResults?.origin : data.geocodingResults?.destination;
    const geocoderStatusCode = addressSideWaypoint?.geocoderStatus?.code;
    const isLowConfidence = !addressSideWaypoint || geocoderStatusCode !== void 0 && geocoderStatusCode !== 0 || addressSideWaypoint.partialMatch === true || (addressSideWaypoint.type || []).some((t) => LOW_CONFIDENCE_GEOCODE_TYPES.has(t));
    if (isLowConfidence) {
      return { ok: true, hasRoute: false };
    }
    const route = data.routes && data.routes[0];
    if (!route) {
      return { ok: true, hasRoute: false };
    }
    const distanceKm = route.distanceMeters / 1e3;
    const warningsText = JSON.stringify(route.warnings || []).toLowerCase();
    const stepsText = JSON.stringify(route.legs || []).toLowerCase();
    const hasFerryLeg = warningsText.includes("ferry") || stepsText.includes("ferry") || stepsText.includes('"travelmode":"ferry"');
    const firstLeg = route.legs && route.legs[0];
    const lastLeg = route.legs && route.legs[route.legs.length - 1];
    const addressLatLng = direction === "to_airport" ? firstLeg && firstLeg.startLocation && firstLeg.startLocation.latLng : lastLeg && lastLeg.endLocation && lastLeg.endLocation.latLng;
    const geocodedLat = addressLatLng ? addressLatLng.latitude : null;
    const geocodedLng = addressLatLng ? addressLatLng.longitude : null;
    return { ok: true, hasRoute: true, distanceKm, durationRaw: route.duration, hasFerryLeg, geocodedLat, geocodedLng };
  } catch (err) {
    console.error("[routes-api] fetch failed:", err.message);
    return { ok: false, reason: "fetch_error", error: "Route lookup failed." };
  }
}
__name(callGoogleRoutesApi, "callGoogleRoutesApi");
async function checkQuoteRateLimit(env, ip) {
  const max = Number(await getSetting(env, "quote_rate_limit_max_per_day", "20"));
  const row = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM quote_requests_log WHERE source_ip = ? AND created_at > datetime('now', '-1440 minutes')`
  ).bind(ip).first();
  const count = row ? row.cnt : 0;
  return { limited: count >= max, count, max };
}
__name(checkQuoteRateLimit, "checkQuoteRateLimit");
async function handleBoatQuote(env, body, clientIp) {
  const destinationId = Number(body.destination_id);
  const adults = body.adults !== void 0 ? Number(body.adults) : 1;
  const children = body.children !== void 0 ? Number(body.children) : 0;
  const errors = [];
  if (!Number.isInteger(destinationId) || destinationId <= 0) errors.push("destination_id must be a positive integer");
  if (!Number.isInteger(adults) || adults < 1 || adults > 20) errors.push("adults must be an integer between 1 and 20");
  if (!Number.isInteger(children) || children < 0 || children > 20) errors.push("children must be an integer between 0 and 20");
  if (errors.length > 0) return json({ ok: false, errors }, 400);
  const dest = await env.DB.prepare(
    `SELECT d.id, d.name, d.active, d.transfer_type, d.pricing_status, z.name AS zone_name,
            d.boat_adult_fare_fjd, d.boat_child_fare_fjd, d.boat_land_leg_fare_fjd, d.boat_operator_name
     FROM destinations d JOIN zones z ON z.id = d.zone_id WHERE d.id = ?`
  ).bind(destinationId).first();
  if (!dest || !dest.active || dest.transfer_type !== "boat") {
    return json({ ok: false, error: "Unknown or unsupported boat destination_id." }, 400);
  }
  if (dest.pricing_status !== "sourced") {
    const { escalation } = await createEscalation(env, {
      source: "guest",
      triggerType: "boat_pricing_pending",
      context: `Boat transfer price requested for "${dest.name}" (${dest.zone_name}) - fare not yet sourced.`,
      sourceIp: clientIp
    });
    return json({
      ok: true,
      outcome: "needs_manual_confirmation",
      transfer_type: "boat",
      destination_id: dest.id,
      destination_name: dest.name,
      message: `We're confirming your real-time price for ${dest.name} via WhatsApp.`,
      escalation_id: escalation.id,
      whatsapp_link: buildConciergeWhatsAppLink("boat_pricing_pending", dest.name)
    }, 200);
  }
  if (children > 0 && dest.boat_child_fare_fjd === null) {
    return json({ ok: false, error: `${dest.name} does not accept children on this transfer.` }, 400);
  }
  const totalFjd = computeBoatFare({
    adults,
    children,
    adultFareFjd: dest.boat_adult_fare_fjd,
    childFareFjd: dest.boat_child_fare_fjd
  });
  return json({
    ok: true,
    outcome: "resolved",
    transfer_type: "boat",
    destination_id: dest.id,
    destination_name: dest.name,
    zone: dest.zone_name,
    operator_name: dest.boat_operator_name,
    adults,
    children,
    adult_fare_fjd: dest.boat_adult_fare_fjd,
    child_fare_fjd: dest.boat_child_fare_fjd,
    land_leg_fare_fjd: dest.boat_land_leg_fare_fjd,
    quoted_fare_fjd: totalFjd
  }, 200);
}
__name(handleBoatQuote, "handleBoatQuote");
async function handleQuoteCreate(request, env) {
  if (!env.DB) return json({ ok: false, error: "Database not available." }, 503);
  const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
  const rateLimit = await checkQuoteRateLimit(env, clientIp);
  if (rateLimit.limited) {
    return json({ ok: false, error: "Too many quote requests from this connection today. Please try again tomorrow, or contact us directly." }, 429);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON." }, 400);
  }
  if (body.destination_id !== void 0 && body.destination_id !== null) {
    return handleBoatQuote(env, body, clientIp);
  }
  const addressRaw = (body.address || "").toString().trim();
  const vehicleType = (body.vehicle_type || "").toString().trim().toLowerCase();
  const direction = (body.direction || "from_airport").toString().trim();
  const guestWhatsapp = normalisePhone((body.guest_whatsapp || "").toString());
  const errors = [];
  if (!addressRaw) errors.push("address is required");
  if (addressRaw.length > 300) errors.push("address is too long");
  if (!ALLOWED_VEHICLE_TYPES.includes(vehicleType)) errors.push(`vehicle_type must be one of: ${ALLOWED_VEHICLE_TYPES.join(", ")}`);
  if (!["from_airport", "to_airport"].includes(direction)) errors.push(`direction must be one of: from_airport, to_airport`);
  if (errors.length > 0) return json({ ok: false, errors }, 400);
  const queryNormalized = `${direction}:${normalizeAddressQuery(addressRaw)}`;
  let cacheRow = await env.DB.prepare(`SELECT * FROM geocoded_addresses WHERE query_normalized = ?`).bind(queryNormalized).first();
  let cacheHit = !!cacheRow;
  if (!cacheRow) {
    const nadiAirport = await env.DB.prepare(`SELECT lat, lng FROM zones WHERE name = 'Nadi Airport'`).first();
    if (!nadiAirport || nadiAirport.lat === null) {
      return json({ ok: false, error: "Origin zone coordinates not configured." }, 500);
    }
    const routeResult = await callGoogleRoutesApi(env, nadiAirport.lat, nadiAirport.lng, addressRaw, direction);
    let outcome, resolvedAddress = null, lat = null, lng = null, distanceKm = null, durationText = null, hasFerryLeg = 0, nearestZoneId = null;
    if (!routeResult.ok) {
      const { escalation: geoFailEscalation } = await createEscalation(env, {
        source: "guest",
        triggerType: "geocode_failed",
        // guestWhatsapp goes FIRST, not appended at the end - the WhatsApp
        // alert James actually receives (sendEscalationAlert) truncates
        // this whole string to 200 chars, and addressRaw alone can be up
        // to 300 chars. Putting the number first guarantees it survives
        // truncation regardless of how long the address text is - the
        // entire point of this fix is that James can always reach the
        // guest, not just for short addresses.
        context: `${guestWhatsapp ? `Guest WhatsApp: ${guestWhatsapp}. ` : ""}Quote request for "${addressRaw}" (${direction}) could not be geocoded (${routeResult.reason || "unknown reason"}).`,
        sourceIp: clientIp
      });
      return json({
        ok: true,
        outcome: "needs_manual_confirmation",
        message: "Could not confirm this address automatically. We will follow up with you directly to confirm pricing.",
        detail: routeResult.reason,
        escalation_id: geoFailEscalation.id,
        whatsapp_link: buildConciergeWhatsAppLink("needs_manual_confirmation", addressRaw, direction)
      }, 200);
    } else if (!routeResult.hasRoute) {
      outcome = "needs_manual_confirmation";
    } else if (routeResult.distanceKm > MAX_QUOTE_DISTANCE_KM || routeResult.hasFerryLeg) {
      outcome = "needs_water_transfer";
      distanceKm = routeResult.distanceKm;
      durationText = routeResult.durationRaw;
      hasFerryLeg = routeResult.hasFerryLeg ? 1 : 0;
      lat = routeResult.geocodedLat;
      lng = routeResult.geocodedLng;
    } else {
      distanceKm = routeResult.distanceKm;
      durationText = routeResult.durationRaw;
      outcome = "resolved";
      lat = routeResult.geocodedLat;
      lng = routeResult.geocodedLng;
    }
    await env.DB.prepare(
      `INSERT OR IGNORE INTO geocoded_addresses (query_normalized, query_raw, resolved_address, lat, lng, distance_km, duration_text, has_ferry_leg, nearest_zone_id, outcome, direction)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(queryNormalized, addressRaw, resolvedAddress, lat, lng, distanceKm, durationText, hasFerryLeg, nearestZoneId, outcome, direction).run();
    cacheRow = await env.DB.prepare(`SELECT * FROM geocoded_addresses WHERE query_normalized = ?`).bind(queryNormalized).first();
    cacheHit = false;
  }
  await env.DB.prepare(
    `INSERT INTO quote_requests_log (source_ip, query_normalized, cache_hit) VALUES (?, ?, ?)`
  ).bind(clientIp, queryNormalized, cacheHit ? 1 : 0).run();
  if (cacheRow.outcome === "needs_manual_confirmation") {
    const { escalation: manualConfEscalation } = await createEscalation(env, {
      source: "guest",
      triggerType: "needs_manual_confirmation",
      // guestWhatsapp first - see the identical note in the geocode_failed
      // branch above (sendEscalationAlert truncates to 200 chars).
      context: `${guestWhatsapp ? `Guest WhatsApp: ${guestWhatsapp}. ` : ""}Quote request for "${addressRaw}" (${direction}) needs manual confirmation.`,
      sourceIp: clientIp
    });
    return json({
      ok: true,
      outcome: "needs_manual_confirmation",
      message: "Could not confirm this address automatically. We will follow up with you directly to confirm pricing.",
      cached: cacheHit,
      escalation_id: manualConfEscalation.id,
      whatsapp_link: buildConciergeWhatsAppLink("needs_manual_confirmation", addressRaw, direction)
    }, 200);
  }
  if (cacheRow.outcome === "needs_water_transfer") {
    return json({
      ok: true,
      outcome: "needs_water_transfer",
      message: "This destination requires a water transfer. Please contact us directly to arrange this trip.",
      distance_km: cacheRow.distance_km,
      has_ferry_leg: !!cacheRow.has_ferry_leg,
      direction,
      cached: cacheHit
    }, 200);
  }
  const nearestZone = await findNearestZone(env, cacheRow.lat, cacheRow.lng);
  const fare = nearestZone ? await computeFareFjd(env, vehicleType, cacheRow.distance_km, nearestZone.remote_multiplier) : null;
  return json({
    ok: true,
    outcome: "resolved",
    query: addressRaw,
    direction,
    distance_km: cacheRow.distance_km,
    duration: cacheRow.duration_text,
    nearest_zone: nearestZone ? { id: nearestZone.id, name: nearestZone.name, remote_multiplier: nearestZone.remote_multiplier } : null,
    vehicle_type: vehicleType,
    quoted_fare_fjd: fare,
    cached: cacheHit
  }, 200);
}
__name(handleQuoteCreate, "handleQuoteCreate");
var ESCALATION_SOURCES = ["guest", "driver"];
var ESCALATION_TRIGGER_TYPES = ["geocode_failed", "needs_manual_confirmation", "wallet_dispute", "app_issue", "other", "boat_pricing_pending"];
var CONCIERGE_WHATSAPP_NUMBER = "61478886145";
function buildConciergeWhatsAppLink(triggerType, contextText, direction = "from_airport") {
  const which = direction === "to_airport" ? "pickup" : "destination";
  const preface = {
    geocode_failed: `Hi, I'm trying to book a Nadi Airport transfer but the online quote tool couldn't process my ${which}.`,
    needs_manual_confirmation: `Hi, I'm trying to book a Nadi Airport transfer but couldn't get an automatic quote for my ${which}.`,
    wallet_dispute: "Hi, I have a question about my driver wallet balance.",
    app_issue: "Hi, I'm having a problem with the driver app.",
    other: "Hi, I need some help with my Nadi Airport transfer.",
    boat_pricing_pending: "Hi, I'd like to book a boat transfer to my resort and need the current price confirmed."
  }[triggerType] || "Hi, I need some help with my Nadi Airport transfer.";
  const message = contextText ? `${preface} Details: ${contextText}` : preface;
  return `https://wa.me/${CONCIERGE_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}
__name(buildConciergeWhatsAppLink, "buildConciergeWhatsAppLink");
async function sendEscalationAlert(env, escalation) {
  const alertPhone = await getSetting(env, "admin_alert_phone", "");
  const summary = `ESCALATION #${escalation.id} (${escalation.source}/${escalation.trigger_type}): ${(escalation.context || "no context provided").slice(0, 200)}`;
  return alertPhone ? await sendHealthAlertWhatsApp(env, alertPhone, summary, sqliteNow()) : { attempted: false, reason: "platform_settings.admin_alert_phone is not set." };
}
__name(sendEscalationAlert, "sendEscalationAlert");
async function checkEscalationRateLimit(env, ip) {
  const max = Number(await getSetting(env, "escalation_rate_limit_max_per_day", "10"));
  const row = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM escalations WHERE source_ip = ? AND created_at > datetime('now', '-1440 minutes')`
  ).bind(ip).first();
  const count = row ? row.cnt : 0;
  return { limited: count >= max, count, max };
}
__name(checkEscalationRateLimit, "checkEscalationRateLimit");
async function createEscalation(env, { source, triggerType, context, bookingId = null, driverId = null, sourceIp = null }) {
  const insert = await env.DB.prepare(
    `INSERT INTO escalations (source, trigger_type, context, booking_id, driver_id, source_ip) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(source, triggerType, context, bookingId, driverId, sourceIp).run();
  const escalation = { id: insert.meta.last_row_id, source, trigger_type: triggerType, context };
  const alert = await sendEscalationAlert(env, escalation);
  if (bookingId) {
    await logBookingEvent(env, {
      bookingId,
      eventType: "escalated",
      actor: source,
      metadata: { escalation_id: escalation.id, trigger_type: triggerType }
    });
  }
  return { escalation, alert };
}
__name(createEscalation, "createEscalation");
async function handleEscalationCreate(request, env) {
  if (!env.DB) return json({ ok: false, error: "Database not available." }, 503);
  const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
  const rateLimit = await checkEscalationRateLimit(env, clientIp);
  if (rateLimit.limited) {
    return json({ ok: false, error: "Too many escalation requests from this connection today. Please try again tomorrow, or contact us directly." }, 429);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON." }, 400);
  }
  const source = (body.source || "").toString().trim().toLowerCase();
  const triggerType = (body.trigger_type || "").toString().trim().toLowerCase();
  const context = body.context !== void 0 && body.context !== null ? body.context.toString().slice(0, 2e3) : null;
  const bookingId = Number.isInteger(body.booking_id) ? body.booking_id : null;
  const driverId = Number.isInteger(body.driver_id) ? body.driver_id : null;
  const errors = [];
  if (!ESCALATION_SOURCES.includes(source)) errors.push(`source must be one of: ${ESCALATION_SOURCES.join(", ")}`);
  if (!ESCALATION_TRIGGER_TYPES.includes(triggerType)) errors.push(`trigger_type must be one of: ${ESCALATION_TRIGGER_TYPES.join(", ")}`);
  if (errors.length > 0) return json({ ok: false, errors }, 400);
  const { escalation, alert } = await createEscalation(env, { source, triggerType, context, bookingId, driverId, sourceIp: clientIp });
  return json({
    ok: true,
    escalation_id: escalation.id,
    whatsapp_link: buildConciergeWhatsAppLink(triggerType, context),
    alert
  }, 201);
}
__name(handleEscalationCreate, "handleEscalationCreate");
function sqliteNow() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ");
}
__name(sqliteNow, "sqliteNow");
function json(obj, status) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { ...JSON_CORS, "Content-Type": "application/json" }
  });
}
__name(json, "json");
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map

