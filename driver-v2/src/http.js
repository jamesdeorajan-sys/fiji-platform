// Driver PWA v2 — thin HTTP surface over the service (Worker-style: Request -> Response). ISOLATED; no production hostname anywhere.
import { CODE } from './constants.js';

const STATUS = {
  [CODE.OK]: 200, [CODE.ASSIGNED]: 200, [CODE.DRIVER_DECLINED]: 200,
  [CODE.AUTH_EXPIRED]: 401,
  [CODE.OFFER_NOT_FOUND]: 404, [CODE.NOT_ASSIGNED_DRIVER]: 404,
  [CODE.DRIVER_OFFLINE]: 403, [CODE.DRIVER_OUTSIDE_ZONE]: 403, [CODE.TEST_DRIVER_MODE_REFUSED]: 403, [CODE.NON_SYNTHETIC_BOOKING_REFUSED]: 403,
  [CODE.ASSIGNMENT_ALREADY_TAKEN]: 409, [CODE.INVALID_TRANSITION]: 409, [CODE.EVIDENCE_REQUIRED]: 409, [CODE.SUPERSEDED]: 409, [CODE.FINANCIAL_EFFECTS_DISABLED]: 409,
  [CODE.OFFER_EXPIRED]: 410, [CODE.HUMAN_FALLBACK_REQUIRED]: 410,
  [CODE.EVIDENCE_UPLOAD_FAILED]: 502, [CODE.AUDIT_PERSIST_FAILED]: 503, [CODE.NOTIFICATION_PROVIDER_ERROR]: 502,
};
const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const respond = (r) => json(r, STATUS[r.code] ?? (r.ok ? 200 : 400));

export async function handle(request, { service }) {
  const url = new URL(request.url);
  const m = (re) => url.pathname.match(re);
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const auth = await service.authenticate(token);
  if (!auth.ok) return json({ ok: false, code: auth.code }, 401);
  const driverId = auth.driverId;
  const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};

  if (request.method === 'GET' && url.pathname === '/api/state') return json(await service.myState(driverId), 200);
  let x;
  if (request.method === 'POST' && (x = m(/^\/api\/offers\/([A-Za-z0-9_]+)\/(view|accept|decline)$/))) {
    const [, offerId, action] = x;
    return respond(await service[action]({ driverId, offerId }));
  }
  if (request.method === 'GET' && (x = m(/^\/api\/trips\/(\d+)$/))) return respond(await service.tripState(driverId, Number(x[1])));
  if (request.method === 'POST' && (x = m(/^\/api\/trips\/(\d+)\/stage$/))) return respond(await service.advanceTrip({ driverId, bookingId: Number(x[1]), stage: String(body.stage || '') }));
  if (request.method === 'POST' && (x = m(/^\/api\/trips\/(\d+)\/evidence$/)))
    return respond(await service.submitEvidence({ driverId, bookingId: Number(x[1]), kind: String(body.kind || ''), clientEvidenceId: String(body.client_evidence_id || ''), sha256: body.sha256 ?? null, bytes: body.bytes ?? null }));
  return json({ ok: false, code: CODE.INVALID_TRANSITION, error: 'NO_SUCH_ROUTE' }, 404);
}
