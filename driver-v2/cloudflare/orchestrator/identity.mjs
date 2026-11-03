// Exact-identity preconditions for the isolated D1. Pure functions - no I/O - so they can be unit-tested and reused by every driver.
// The expected name + UUID are PINNED in src/safety.js (and in wrangler.toml, enforced by assert_package_safe). They are never read from the environment or argv.
import { ISOLATED, PRODUCTION_DENYLIST } from '../src/safety.js';

export class PreconditionError extends Error { constructor(code, detail) { super(`${code}${detail ? ': ' + detail : ''}`); this.code = code; this.detail = detail; } }

// Environment variables that could be used to smuggle in a different database id/name are refused outright.
const SMUGGLE_KEYS = ['GATE15_D1_ID', 'GATE15_D1_UUID', 'GATE15_D1_NAME', 'D1_DATABASE_ID', 'DATABASE_ID', 'CLOUDFLARE_D1_ID', 'CLOUDFLARE_D1_DATABASE_ID', 'WRANGLER_D1_DATABASE_ID'];
export function assertNoIdentityOverrides(env) {
  const present = SMUGGLE_KEYS.filter((k) => env[k] !== undefined && env[k] !== '');
  if (present.length) throw new PreconditionError('IDENTITY_OVERRIDE_REFUSED', `remove ${present.join(', ')} - the isolated D1 identity is pinned in the package and cannot be supplied`);
}

// `results` = the `result` array of GET /accounts/{id}/d1/database?name=<pinned name>.  Must contain exactly one entry that matches name AND uuid exactly.
export function verifyIsolatedD1(results) {
  if (!Array.isArray(results)) throw new PreconditionError('D1_LOOKUP_MALFORMED');
  for (const r of results) {
    if (PRODUCTION_DENYLIST.names.includes(r.name)) throw new PreconditionError('PRODUCTION_D1_NAME_REFUSED', r.name);
    if (PRODUCTION_DENYLIST.d1_ids.includes(String(r.uuid).toLowerCase())) throw new PreconditionError('PRODUCTION_D1_UUID_REFUSED', r.uuid);
  }
  const exact = results.filter((r) => r.name === ISOLATED.D1_NAME);
  if (exact.length !== 1) throw new PreconditionError('ISOLATED_D1_NOT_FOUND_EXACTLY_ONCE', `matches=${exact.length}`);
  if (String(exact[0].uuid).toLowerCase() !== ISOLATED.D1_UUID) throw new PreconditionError('ISOLATED_D1_UUID_MISMATCH', `${exact[0].name} resolved to ${exact[0].uuid}`);
  return { name: exact[0].name, uuid: exact[0].uuid };
}
// Second, independent lookup by the pinned UUID (never by a supplied one).
export function verifyIsolatedD1ByUuid(detail) {
  if (!detail || detail.uuid === undefined) throw new PreconditionError('D1_DETAIL_MALFORMED');
  verifyIsolatedD1([detail]);
  return { name: detail.name, uuid: detail.uuid };
}
