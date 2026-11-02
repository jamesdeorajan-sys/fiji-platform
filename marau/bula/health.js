/* Bula minimal production health check (PREPARED, NOT WIRED). Pure read-only queries over the Bula tables; returns alerts with CODES and counts only (no guest data).
 * Intended use after approval: a scheduled call writes one `console.error('[bula][ALERT]', JSON)` line per alert to Workers Logs, where a Cloudflare Notification / log alert pages the CEO. */
export async function collectHealth(db, nowMs, { stuckMs = 30 * 60e3 } = {}) {
  const alerts = []; const add = (code, n, extra) => { if (n > 0) alerts.push({ code, count: n, ...extra }); };
  const n = async (sql, ...b) => (await db.prepare(sql).bind(...b).first()).n;
  add('EMAIL_FAILED_OR_DEAD', await n("SELECT COUNT(*) n FROM bula_outbox WHERE state IN ('failed','dead')"));
  add('EMAIL_AMBIGUOUS_NEEDS_HUMAN', await n("SELECT COUNT(*) n FROM bula_outbox WHERE state = 'ambiguous'"));
  add('EMAIL_BLOCKED', await n("SELECT COUNT(*) n FROM bula_outbox WHERE state = 'blocked'"));
  add('EMAIL_BOUNCED', await n('SELECT COUNT(*) n FROM bula_outbox WHERE bounced_at IS NOT NULL'));
  add('EMAIL_STUCK_QUEUED', await n("SELECT COUNT(*) n FROM bula_outbox WHERE state IN ('queued','sending') AND updated_at < ?", nowMs - stuckMs));
  const cut = new Date(nowMs - stuckMs).toISOString();
  add('MIRROR_WITHOUT_GUEST_SESSION', await n('SELECT COUNT(*) n FROM marau_real_booking_links l LEFT JOIN guest_sessions g ON g.session_id = l.guest_session_id WHERE g.session_id IS NULL'));
  add('MIRROR_WITHOUT_JOBS_OR_GRANT', await n(`SELECT COUNT(*) n FROM marau_real_booking_links l JOIN marau_test_bookings b ON b.id = l.marau_booking_id WHERE l.created_at < ? AND (NOT EXISTS (SELECT 1 FROM bula_outbox o WHERE o.booking_ref = b.client_booking_ref) OR NOT EXISTS (SELECT 1 FROM bula_credit_ledger c WHERE c.party_key = 'trip:' || b.client_booking_ref AND c.type = 'granted'))`, cut));
  add('SOURCE_ROWS_WITHOUT_SNAPSHOT', await n(`SELECT COUNT(*) n FROM marau_real_booking_links l JOIN marau_test_bookings b ON b.id = l.marau_booking_id WHERE l.created_at < ? AND NOT EXISTS (SELECT 1 FROM bula_booking_snapshots s WHERE s.booking_ref = b.client_booking_ref)`, cut));
  // wallet invariants
  add('WALLET_BUCKETS_DONT_ADD_UP', await n('SELECT COUNT(*) n FROM bula_credit_accounts WHERE available_cents + reserved_cents + redeemed_cents + expired_cents != granted_cents'));
  add('WALLET_GRANT_LEDGER_MISMATCH', await n("SELECT COUNT(*) n FROM bula_credit_accounts a WHERE a.granted_cents != COALESCE((SELECT SUM(amount_cents) FROM bula_credit_ledger l WHERE l.party_key = a.party_key AND l.type = 'granted'), 0)"));
  add('WALLET_DUPLICATE_GRANT', await n("SELECT COUNT(*) n FROM (SELECT party_key FROM bula_credit_ledger WHERE type = 'granted' GROUP BY party_key HAVING COUNT(*) > 1)"));
  add('WALLET_RESERVED_NOT_LIVE_REQUESTS', await n("SELECT COUNT(*) n FROM bula_credit_accounts a WHERE a.reserved_cents + a.redeemed_cents != COALESCE((SELECT SUM(credit_cents) FROM bula_holds h WHERE h.party_key = a.party_key AND h.state IN ('held','confirmed')), 0)"));
  // capacity invariants
  add('CAPACITY_MISMATCH', await n("SELECT COUNT(*) n FROM bula_offers o WHERE o.remaining != o.capacity_total - COALESCE((SELECT SUM(qty) FROM bula_holds h WHERE h.offer_id = o.offer_id AND h.state IN ('held','confirmed')), 0)"));
  add('CAPACITY_OUT_OF_BOUNDS', await n('SELECT COUNT(*) n FROM bula_offers WHERE remaining < 0 OR remaining > capacity_total'));
  // duplicate / repeated processing (each must be 0 by construction; non-zero means a constraint was bypassed)
  add('DUPLICATE_LINKS_FOR_SOURCE_REF', await n('SELECT COUNT(*) n FROM (SELECT source_booking_ref FROM marau_real_booking_links GROUP BY source_booking_ref HAVING COUNT(*) > 1)'));
  add('DUPLICATE_LEDGER_ROW_PER_HOLD', await n("SELECT COUNT(*) n FROM (SELECT hold_id, type FROM bula_credit_ledger WHERE hold_id IS NOT NULL GROUP BY hold_id, type HAVING COUNT(*) > 1)"));
  // Staff-action conflicts (409 claimed_by_other) are normal races and carry no database trace; they are watched as a 409 rate in Workers Logs/analytics (see monitoring design).
  return { ok: alerts.length === 0, at: nowMs, alerts };
}
