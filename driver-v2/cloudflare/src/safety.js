// Gate 1.5 isolation guards. These run (a) at build time via scripts/assert_package_safe.mjs and (b) at runtime before ANY request is served.
// The production identifiers below are a DENY list: they exist in this repository only so the guards can refuse them.
export const ISOLATED = Object.freeze({
  WORKER_NAME: 'driver-v2-gate15-isolated',
  D1_NAME: 'driver-v2-gate15-isolated-20261103',
  MARKER: 'driver-v2-gate15-isolated-20261103',
  BINDING: 'DB',
  ALLOWED_ENV_KEYS: Object.freeze(['DB', 'GATE15_CONTROL_TOKEN']),
});

export const PRODUCTION_DENYLIST = Object.freeze({
  names: Object.freeze(['nadi-marketplace-db', 'nadi-dispatch-api', 'vakaviti-kb', 'marau-stage1-test-db', 'fiji-chat-widget', 'vakaviti-monitor']),
  d1_ids: Object.freeze(['0ec1cd84-fcda-4f7f-8337-0fb70fe1a512']),
  hostnames: Object.freeze(['nadiairporttransfers.com', 'fijidash.com', 'vakaviti.ai', 'kiaoratransferstoursfiji.tours', 'cometofiji.com', 'fijitourtransfers.com']),
});

// Exactly the objects the isolated schema creates. Any other TABLE in the bound database means it is not the isolated D1 -> refuse.
export const EXPECTED_TABLES = Object.freeze([
  'drivers', 'driver_sessions', 'bookings', 'booking_events', 'driver_broadcast_attempts', 'driver_offers', 'dispatch_runs',
  'dispatch_escalations', 'driver_evidence', 'wallets', 'wallet_transactions',
  'gate15_identity', 'gate15_meta', 'gate15_capture', 'gate15_probe',
]);

export class IsolationError extends Error { constructor(reason) { super(reason); this.code = 'ISOLATION_ASSERTION_FAILED'; this.reason = reason; } }

export function assertEnvShape(env) {
  if (!env || !env.DB) throw new IsolationError('NO_DB_BINDING');
  for (const k of Object.keys(env)) if (!ISOLATED.ALLOWED_ENV_KEYS.includes(k)) throw new IsolationError(`UNEXPECTED_BINDING:${k}`);
}

export function assertHostAllowed(hostname) {
  const h = String(hostname || '').toLowerCase();
  for (const bad of PRODUCTION_DENYLIST.hostnames) if (h === bad || h.endsWith(`.${bad}`)) throw new IsolationError('PRODUCTION_HOSTNAME_REFUSED');
  const ok = h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1'
    || (h.startsWith(`${ISOLATED.WORKER_NAME}.`) && h.endsWith('.workers.dev'));
  if (!ok) throw new IsolationError('HOSTNAME_NOT_ALLOWLISTED');
}

let verified = false;       // per-isolate cache; a different database cannot be bound to a live isolate
export async function assertIsolatedDatabase(db) {
  if (verified) return;
  let marker;
  try { marker = await db.prepare(`SELECT marker, worker_name FROM gate15_identity WHERE id = 1`).first(); }
  catch { throw new IsolationError('IDENTITY_TABLE_MISSING'); }
  if (!marker || marker.marker !== ISOLATED.MARKER || marker.worker_name !== ISOLATED.WORKER_NAME) throw new IsolationError('IDENTITY_MARKER_MISMATCH');
  const rows = (await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all()).results.map((r) => r.name);
  const extra = rows.filter((n) => !EXPECTED_TABLES.includes(n) && !n.startsWith('sqlite_') && !n.startsWith('_cf_') && !n.startsWith('d1_'));
  if (extra.length) throw new IsolationError(`FOREIGN_TABLES_PRESENT:${extra.slice(0, 5).join(',')}`);
  const missing = EXPECTED_TABLES.filter((n) => !rows.includes(n));
  if (missing.length) throw new IsolationError(`SCHEMA_INCOMPLETE:${missing.slice(0, 5).join(',')}`);
  verified = true;
}
export const _resetVerifiedForTests = () => { verified = false; };
