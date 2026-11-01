/* Bula Happiness — HTTP routes (guest + staff) over the persisted modules. Flag-gated; nothing here is reachable unless the Worker routes to it.
 * IDENTITY RULES
 *  - Guest: Authorization: Bearer <session token> ONLY (the existing cookie fallback is deliberately NOT accepted here, so a cross-site
 *    request cannot ride a cookie). Party/wallet/ownership are derived from the session, never from the request body.
 *  - Staff: the shared admin credential AND the individual staff token (x-marau-staff-token) -> bula_staff_roles row (active, role).
 *    staffId/role come from that row only; any staff_id/role/verified_by/kind/contract_id in a body is ignored.
 *  - State-changing requests must be application/json (forces a CORS preflight for browsers). */
import { loadConfig } from './config.js';
import { issueStaffActor, issueConfirmationAuthority, issueCancellationAuthority, requireRole } from './authority.js';
import { grantWelcome, reserve, confirmHold, cancelHold, releaseFailedCheckout, balance, sweepExpired, expireGrants } from './inventory_credit.js';
import { importCsv, approveOffer, editOffer, withdrawOffer, runPublisher, listEdition, resolveContract, ROLE_POLICY } from './offers_d1.js';
import { staffQueue, dispatch, liveSenderDisabled, reconcileAmbiguous } from './outbox_d1.js';
import { reconcileAll } from './recovery.js';
import { GUEST_UI, STAFF_UI } from './ui.js';
import { withSqlFault } from './fault.js';

const H = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const out = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: H });
const page = (t) => new Response(t, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } });
const bearer = (r) => { const m = /^Bearer\s+(.+)$/i.exec(r.headers.get('authorization') || ''); return m ? m[1].trim() : null; };
const ctEq = (a, b) => { if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const isJson = (r) => /^application\/json\b/i.test(r.headers.get('content-type') || '');
async function body(r) { if (!isJson(r)) throw Object.assign(new Error('content-type must be application/json'), { status: 415 }); try { const b = await r.json(); if (!b || typeof b !== 'object' || Array.isArray(b)) throw 0; return b; } catch { throw Object.assign(new Error('invalid JSON body'), { status: 400 }); } }

/** Guest session from a bearer token only. */
export async function guestFromRequest(request, env) {
  const t = bearer(request); if (!t) return null;
  return await env.DB.prepare('SELECT * FROM guest_sessions WHERE access_token = ? AND access_token_revoked = 0').bind(t).first();
}
export async function partyKeyForSession(db, sessionId) {
  const b = await db.prepare('SELECT client_booking_ref FROM marau_test_bookings WHERE guest_session_id = ? AND parent_booking_id IS NULL ORDER BY id LIMIT 1').bind(sessionId).first();
  return b ? `trip:${b.client_booking_ref}` : `session:${sessionId}`;
}
/** Verified staff actor or null. Never reads identity from a body. */
export async function staffFromRequest(request, env) {
  if (!env.MARAU_ADMIN_TEST_TOKEN || !ctEq(bearer(request) || '', env.MARAU_ADMIN_TEST_TOKEN)) return null;
  const tok = (request.headers.get('x-marau-staff-token') || '').trim(); if (!tok) return null;
  const r = await env.DB.prepare('SELECT r.staff_id, r.role FROM bula_staff_roles r JOIN marau_staff_identities i ON i.token = r.token WHERE r.token = ? AND r.active = 1').bind(tok).first();
  return r ? issueStaffActor({ staffId: r.staff_id, role: r.role }) : null;
}
const adminOnly = (request, env) => !!env.MARAU_ADMIN_TEST_TOKEN && ctEq(bearer(request) || '', env.MARAU_ADMIN_TEST_TOKEN);
const isStr = (v, max = 400) => typeof v === 'string' && v.length > 0 && v.length <= max;

function holdView(h) {
  const s = JSON.parse(h.snapshot_json);
  return { holdId: h.hold_id, state: h.state, title: s.title, serviceDate: s.serviceDate, serviceStartUtc: s.serviceStartUtc, qty: h.qty, capacityUnit: s.capacityUnit, pricingBasis: s.pricingBasis,
    offerPriceCents: h.price_cents, creditCents: h.credit_cents, netPayableCents: h.net_cents, expiresAt: h.expires_at, cancellationTerms: s.cancellationTerms, instantConfirm: s.instantConfirm,
    confirmedAt: h.confirmed_at, creditRestored: h.credit_restored == null ? null : !!h.credit_restored, inventoryRestored: h.inventory_restored == null ? null : !!h.inventory_restored,
    message: { held: s.instantConfirm ? 'Reserving…' : 'Requested — not confirmed until our team confirms it.', confirmed: 'Confirmed.', released: 'Request withdrawn.', expired: 'Request expired — nothing was charged.', cancelled: 'Cancelled.' }[h.state] };
}
const codeStatus = (c) => ({ unknown_offer: 404, unknown_hold: 404, no_server_authority: 403, ROLE_NOT_PERMITTED: 403, STAFF_IDENTITY_REQUIRED: 401, DISABLED: 403, CREDITS_DISABLED: 403 }[c] || 409);

export async function bulaRoute(request, env0, pathname, method) {
  let env = env0; let faulted = null; const harness = env0.BULA_FAULT_HARNESS === 'on' && !!env0.MARAU_ADMIN_TEST_TOKEN && ctEq(request.headers.get('x-bula-harness-key') || '', env0.MARAU_ADMIN_TEST_TOKEN);   // second header: guest routes already use Authorization for the guest
  const dropResponse = harness && request.headers.get('x-bula-drop-response') === 'on';
  const fk = harness ? request.headers.get('x-bula-fault-statement') : null;
  if (fk !== null && /^\d{1,2}$/.test(fk)) { env = { ...env0, DB: withSqlFault(env0.DB, Number(fk)) }; faulted = env.DB; }
  const res = await bulaRouteInner(request, env, pathname, method);
  if (!res) return res;
  if (faulted) { const h = new Headers(res.headers); h.set('x-bula-fault-injected', faulted.__fault.injected ? 'yes' : 'no'); h.set('x-bula-batch-len', String(faulted.__fault.batchLen ?? '')); return new Response(res.body, { status: res.status, headers: h }); }
  if (dropResponse) return new Response('response lost (simulated at app layer after commit)', { status: 504 });
  return res;
}
async function bulaRouteInner(request, env, pathname, method) {
  const cfg = loadConfig(env); const nowMs = Date.now();
  try {
    if (method === 'GET' && pathname === '/bula/manifest.webmanifest') return new Response(JSON.stringify({ id: '/bula', name: 'Bula Happiness', short_name: 'Bula', start_url: '/bula', scope: '/bula', display: 'standalone', background_color: '#f6f4ef', theme_color: '#0a4f46',
      icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }] }), { headers: { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'no-cache' } });   // static: never carries a token
    if (method === 'GET' && pathname === '/bula') return page(GUEST_UI);
    if (method === 'GET' && pathname === '/bula/staff') return page(STAFF_UI);
    if (!pathname.startsWith('/preview/bula/') && !pathname.startsWith('/preview/admin/bula/')) return null;

    /* ------------------------------- outbox runner (admin credential) ------------------------------- */
    if (method === 'POST' && pathname === '/preview/bula/outbox/run') { if (!adminOnly(request, env)) return out({ error: 'unauthorized' }, 401); const { bulaRunOutbox } = await import('./hook.js'); return out(await bulaRunOutbox(env)); }

    /* ------------------------------------------ guest ------------------------------------------------ */
    if (pathname.startsWith('/preview/bula/')) {
      const s = await guestFromRequest(request, env); if (!s) return out({ error: 'unauthorized' }, 401);
      const party = await partyKeyForSession(env.DB, s.session_id);
      if (method === 'GET' && pathname === '/preview/bula/offers') {
        if (cfg.editionPublishEnabled) await runPublisher(env.DB, cfg, nowMs, 'lazy-guest');
        const ed = await listEdition(env.DB, cfg, nowMs, party); const bal = cfg.creditsEnabled ? await balance(env.DB, party) : null;
        return out({ ...ed, checkoutEnabled: cfg.checkoutEnabled, wallet: bal && { availableCents: bal.available, reservedCents: bal.reserved, expiresAt: bal.expiresAt }, serverNowUtc: nowMs });
      }
      if (method === 'GET' && pathname === '/preview/bula/holds') {
        const { results } = await env.DB.prepare('SELECT * FROM bula_holds WHERE party_key = ? ORDER BY created_at DESC LIMIT 50').bind(party).all(); return out({ holds: results.map(holdView) });
      }
      if (method === 'POST' && pathname === '/preview/bula/reserve') {
        if (!cfg.checkoutEnabled) return out({ error: 'checkout is not enabled' }, 403);
        const b = await body(request);
        if (!isStr(b.offer_id, 100) || !isStr(b.idem_key, 100) || !Number.isInteger(b.version) || !Number.isInteger(b.qty) || (b.expected_net_cents !== undefined && !Number.isSafeInteger(b.expected_net_cents))) return out({ error: 'offer_id, version, qty, idem_key (and optional expected_net_cents) are required' }, 400);
        const o = await env.DB.prepare('SELECT * FROM bula_offers WHERE offer_id = ?').bind(b.offer_id).first();
        const contract = o && o.instant_confirm ? await resolveContract(env.DB, o, nowMs) : null;
        const ttlMs = contract ? cfg.holdTtlMs : Math.max(60000, Math.min(cfg.requestHoldTtlMs, o ? o.service_start_utc - nowMs : cfg.holdTtlMs));
        const r = await reserve(env.DB, cfg, { partyKey: party, idemKey: b.idem_key, offerId: b.offer_id, qty: b.qty, expectedVersion: b.version, expectedNetCents: b.expected_net_cents, nowMs, ttlMs });
        if (!r.ok) return out(r, codeStatus(r.code));
        let state = r.state;
        if (contract && state === 'held') { // instant confirmation: authority minted HERE from the resolved contract, never from the request
          const c = await confirmHold(env.DB, { holdId: r.holdId, partyKey: party, authority: issueConfirmationAuthority({ kind: 'operator_acceptance_contract', ref: contract.contract_id, verifiedBy: `contract:${contract.contract_id}` }), nowMs });
          state = c.ok ? 'confirmed' : state;
        }
        const h = await env.DB.prepare('SELECT * FROM bula_holds WHERE hold_id = ?').bind(r.holdId).first(); return out({ ok: true, replay: !!r.replay, hold: holdView(h) }, r.replay ? 200 : 201);
      }
      const m = /^\/preview\/bula\/holds\/([\w-]+)\/(release|cancel)$/.exec(pathname);
      if (method === 'POST' && m) {
        await body(request); const [, holdId, act] = m;
        if (act === 'release') { const r = await releaseFailedCheckout(env.DB, { holdId, partyKey: party, nowMs }); return out(r, r.ok ? 200 : codeStatus(r.code)); }
        const r = await cancelHold(env.DB, { holdId, partyKey: party, authority: issueCancellationAuthority({ kind: 'guest_cancel', verifiedBy: `guest:${s.session_id}` }), nowMs });
        return out(r, r.ok ? 200 : codeStatus(r.code));
      }
      return out({ error: 'not found' }, 404);
    }

    /* ------------------------------------------ staff ------------------------------------------------ */
    if (method === 'POST' && pathname === '/preview/admin/bula/staff') { // bootstrap/admin only: the shared admin credential seeds individual staff identities + roles
      if (!adminOnly(request, env)) return out({ error: 'unauthorized' }, 401);
      const b = await body(request);
      if (!isStr(b.token, 200) || !/^[\w.-]{2,40}$/.test(b.staff_id || '') || !isStr(b.display_name, 80) || !['ceo', 'approver', 'ops', 'editor'].includes(b.role)) return out({ error: 'token, staff_id, display_name and a valid role are required' }, 400);
      // A token is bound to exactly ONE staff identity. Re-seeding is idempotent; binding a token that already belongs to another staff_id is refused (409), never a 500 and never a silent re-assignment.
      const byTok = await env.DB.prepare('SELECT staff_id, role, active FROM bula_staff_roles WHERE token = ?').bind(b.token).first();
      if (byTok && byTok.staff_id !== b.staff_id) return out({ error: 'token already bound to another staff identity', staff_id: byTok.staff_id, role: byTok.role, active: byTok.active }, 409);
      const same = await env.DB.prepare('SELECT token, display_name, role, active FROM bula_staff_roles WHERE staff_id = ?').bind(b.staff_id).first();
      if (same && same.token === b.token && same.role === b.role && same.display_name === b.display_name && same.active === 1) return out({ ok: true, unchanged: true });   // repeat of an identical request: no writes, no new audit row
      try {
      await env.DB.batch([env.DB.prepare('INSERT INTO marau_staff_identities (token, operator_name, created_at) VALUES (?,?,?) ON CONFLICT(token) DO UPDATE SET operator_name = excluded.operator_name').bind(b.token, b.display_name, new Date(nowMs).toISOString()),
        env.DB.prepare('INSERT INTO bula_staff_roles (staff_id, token, display_name, role, active, created_by, created_at) VALUES (?,?,?,?,1,?,?) ON CONFLICT(staff_id) DO UPDATE SET role = excluded.role, token = excluded.token, display_name = excluded.display_name, active = 1').bind(b.staff_id, b.token, b.display_name, b.role, 'admin-credential', nowMs),
        env.DB.prepare('INSERT INTO bula_audit (at, actor, action, subject, detail) VALUES (?,?,?,?,?)').bind(nowMs, 'admin-credential', 'staff_role_set', b.staff_id, b.role)]);
      } catch (e) { if (/UNIQUE|constraint/i.test(String(e && e.message))) return out({ error: 'staff identity conflict' }, 409); throw e; }
      return out({ ok: true });
    }
    const actor = await staffFromRequest(request, env); if (!actor) return out({ error: 'unauthorized' }, 401);
    if (method === 'GET' && pathname === '/preview/admin/bula/me') return out({ staffId: actor.staffId, role: actor.role });
    if (method === 'GET' && pathname === '/preview/admin/bula/offers') { const { results } = await env.DB.prepare('SELECT offer_id, version, status, title, service_date, price_cents, max_credit_cents, capacity_unit, capacity_total, remaining, booking_cutoff_utc, created_by, approved_by, instant_confirm FROM bula_offers ORDER BY service_date, offer_id').all(); return out({ offers: results }); }
    if (method === 'GET' && pathname === '/preview/admin/bula/queue') {
      requireRole(actor, ROLE_POLICY.confirm);
      const { results } = await env.DB.prepare("SELECT * FROM bula_holds WHERE state = 'held' ORDER BY created_at").all(); const { results: conf } = await env.DB.prepare("SELECT * FROM bula_holds WHERE state = 'confirmed' ORDER BY confirmed_at DESC LIMIT 30").all();
      return out({ requests: results.map((h) => ({ ...holdView(h), partyKey: h.party_key })), confirmed: conf.map((h) => ({ ...holdView(h), partyKey: h.party_key })), email: await staffQueue(env.DB) });
    }
    if (method === 'POST' && pathname === '/preview/admin/bula/contracts') {
      requireRole(actor, ROLE_POLICY.contracts); const b = await body(request);
      if (!isStr(b.contract_id, 80) || !isStr(b.operator_id, 80) || !Number.isSafeInteger(b.valid_from) || !Number.isSafeInteger(b.valid_to) || b.valid_to <= b.valid_from) return out({ error: 'contract_id, operator_id, valid_from, valid_to required' }, 400);
      await env.DB.batch([env.DB.prepare("INSERT INTO bula_operator_contracts (contract_id, operator_id, status, scope_offer_ids, valid_from, valid_to, approved_by_staff_id, approved_at, notes) VALUES (?,?, 'active', ?,?,?,?,?,?)").bind(b.contract_id, b.operator_id, isStr(b.scope_offer_ids) ? b.scope_offer_ids : null, b.valid_from, b.valid_to, actor.staffId, nowMs, isStr(b.notes) ? b.notes : null),
        env.DB.prepare('INSERT INTO bula_audit (at, actor, action, subject) VALUES (?,?,?,?)').bind(nowMs, `${actor.staffId}(${actor.role})`, 'contract_recorded', b.contract_id)]);
      return out({ ok: true }, 201);
    }
    if (method === 'POST' && pathname === '/preview/admin/bula/offers/import') { const b = await body(request); if (typeof b.csv !== 'string' || b.csv.length > 400000) return out({ error: 'csv text required' }, 400); const r = await importCsv(env.DB, b.csv, actor, nowMs); return out(r, r.errors.length ? 422 : 201); }
    const om = /^\/preview\/admin\/bula\/offers\/([\w.-]+)\/(approve|withdraw|edit)$/.exec(pathname);
    if (method === 'POST' && om) {
      const [, id, act] = om; const b = await body(request);
      const r = act === 'approve' ? await approveOffer(env.DB, id, actor, nowMs) : act === 'withdraw' ? await withdrawOffer(env.DB, id, actor, nowMs) : await editOffer(env.DB, id, b.patch, actor, nowMs);
      return out(r, r.ok ? 200 : r.code === 'invalid' ? 422 : 409);
    }
    const hm = /^\/preview\/admin\/bula\/holds\/([\w-]+)\/(confirm|cancel|decline)$/.exec(pathname);
    if (method === 'POST' && hm) {
      requireRole(actor, ROLE_POLICY.confirm); const [, holdId, act] = hm; const b = await body(request);
      const h = await env.DB.prepare('SELECT * FROM bula_holds WHERE hold_id = ?').bind(holdId).first(); if (!h) return out({ code: 'unknown_hold' }, 404);
      const note = isStr(b.evidence_note, 300) ? b.evidence_note : null;
      if (act === 'confirm') { // authority = the verified staff session itself; the note is context, not authority
        const r = await confirmHold(env.DB, { holdId, partyKey: h.party_key, authority: issueConfirmationAuthority({ kind: 'staff_confirmation', ref: `${actor.staffId}:${note || 'no-note'}`, verifiedBy: actor.staffId }), bookingRef: null, nowMs }); return out(r, r.ok ? 200 : codeStatus(r.code));
      }
      if (act === 'decline') { const r = await releaseFailedCheckout(env.DB, { holdId, partyKey: h.party_key, nowMs }); await env.DB.prepare('INSERT INTO bula_audit (at, actor, action, subject, detail) VALUES (?,?,?,?,?)').bind(nowMs, `${actor.staffId}(${actor.role})`, 'hold_declined', holdId, note).run(); return out(r, r.ok ? 200 : codeStatus(r.code)); }
      if (!note) return out({ error: 'evidence_note is required to cancel on behalf of a guest' }, 400);
      const refund = b.refund_credit === true; if (refund) requireRole(actor, ROLE_POLICY.refundCredit);
      const r = await cancelHold(env.DB, { holdId, partyKey: h.party_key, authority: issueCancellationAuthority({ kind: b.operator_cancelled === true ? 'operator_cancel' : 'staff_cancel', ref: `${actor.staffId}:${note}`, verifiedBy: actor.staffId, refundCredit: refund }), nowMs });
      return out(r, r.ok ? 200 : codeStatus(r.code));
    }
    if (method === 'POST' && pathname === '/preview/admin/bula/credits/grant') {   // CEO only. Amount is the CONFIGURED welcome amount (never from the request); once per guest party; audited atomically with the grant.
      requireRole(actor, ROLE_POLICY.grantCredit); if (!cfg.creditsEnabled) return out({ error: 'credits are not enabled' }, 403);
      const b = await body(request); if (!isStr(b.booking_ref, 120)) return out({ error: 'booking_ref is required' }, 400);
      const bk = await env.DB.prepare('SELECT 1 x FROM marau_test_bookings WHERE client_booking_ref = ? AND parent_booking_id IS NULL').bind(b.booking_ref).first(); if (!bk) return out({ error: 'unknown booking' }, 404);
      const partyKey = `trip:${b.booking_ref}`;
      const g = await grantWelcome(env.DB, cfg, { partyKey, actor: `staff:${actor.staffId}`, source: 'staff-promotional-grant', nowMs, extra: [env.DB.prepare('INSERT INTO bula_audit (at, actor, action, subject, detail) VALUES (?,?,?,?,?)').bind(nowMs, `${actor.staffId}(${actor.role})`, 'credit_granted', partyKey, String(cfg.welcomeCents))] });
      const bal = await balance(env.DB, partyKey); return out({ ok: true, granted: g.granted, alreadyGranted: !g.granted, grantedCents: g.grantedCents, availableCents: bal.available }, g.granted ? 201 : 200);
    }
    if (method === 'POST' && pathname === '/preview/admin/bula/publish') { requireRole(actor, ROLE_POLICY.publish); await body(request); return out(await runPublisher(env.DB, cfg, nowMs, `manual:${actor.staffId}`)); }
    if (method === 'GET' && pathname === '/preview/admin/bula/audit') { requireRole(actor, ['ceo']); const { results } = await env.DB.prepare('SELECT * FROM bula_audit ORDER BY seq DESC LIMIT 100').all(); return out({ audit: results }); }
    return out({ error: 'not found' }, 404);
  } catch (e) {
    if (e && (e.code === 'ROLE_NOT_PERMITTED' || e.code === 'STAFF_IDENTITY_REQUIRED')) return out({ error: e.code }, e.code === 'ROLE_NOT_PERMITTED' ? 403 : 401);
    if (e && e.status) return out({ error: e.message }, e.status);
    console.error('[bula] route error', e && e.message); return out({ error: 'internal error' }, 500);
  }
}
