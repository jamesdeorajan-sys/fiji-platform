/* Bula Happiness — connecting an installed (Home Screen) app to an EXISTING guest, without ever putting a credential in the manifest or a URL.
 *  Safari (authenticated) or staff issue a one-time code -> the installed app redeems it once -> it receives its OWN device key (random 256-bit, stored hashed).
 *  The device key resolves to the same guest_sessions row: same party, same wallet, no second guest, no second grant. It expires, can be revoked individually,
 *  and stops working the moment the guest session itself is revoked. Codes: 8 chars from a 31-letter alphabet (~39.7 bits), 10 minutes, single use, hashed at rest. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';           // no 0/O/1/I/L
export async function sha256hex(s) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join(''); }
const rndHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
export function newCode() { let out = ''; while (out.length < 8) { const b = crypto.getRandomValues(new Uint8Array(16)); for (const x of b) { if (x < 248 && out.length < 8) out += ALPHABET[x % 31]; } } return out; }   // 248 = 31*8: no modulo bias
export const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const prettyCode = (c) => `${c.slice(0, 4)}-${c.slice(4)}`;

export async function issuePairingCode(db, cfg, { sessionId, issuedBy, nowMs }) {
  const code = newCode(); const hash = await sha256hex(code);
  const active = await db.prepare('SELECT COUNT(*) n FROM bula_devices WHERE session_id = ? AND revoked_at IS NULL AND expires_at > ?').bind(sessionId, nowMs).first();
  if (active.n >= cfg.maxDevices) return { ok: false, code: 'too_many_devices' };
  await db.batch([db.prepare('DELETE FROM bula_pairing WHERE session_id = ? AND used_at IS NULL').bind(sessionId),                                  // only the newest unused code is valid
    db.prepare('INSERT INTO bula_pairing (code_hash, session_id, issued_by, created_at, expires_at) VALUES (?,?,?,?,?)').bind(hash, sessionId, issuedBy, nowMs, nowMs + cfg.pairingTtlMs),
    db.prepare('INSERT INTO bula_audit (at, actor, action, subject, detail) VALUES (?,?,?,?,?)').bind(nowMs, issuedBy, 'pairing_code_issued', sessionId, null)]);
  return { ok: true, code: prettyCode(code), expiresAt: nowMs + cfg.pairingTtlMs };
}

/** Unauthenticated by design (the installed app has nothing yet). One generic failure for unknown / expired / used, and a per-source failure limit. */
export async function redeemPairingCode(db, cfg, { code, label, ipHash, nowMs }) {
  const c = normCode(code); const lbl = String(label || 'Home Screen app').replace(/[^\w .-]/g, '').slice(0, 40) || 'Home Screen app';
  const recent = await db.prepare('SELECT COUNT(*) n FROM bula_pair_failures WHERE ip_hash = ? AND at > ?').bind(ipHash, nowMs - cfg.pairFailWindowMs).first();
  if (recent.n >= cfg.pairFailLimit) return { ok: false, status: 429, code: 'too_many_attempts' };
  const fail = async () => { await db.batch([db.prepare('INSERT INTO bula_pair_failures (ip_hash, at) VALUES (?,?)').bind(ipHash, nowMs), db.prepare('DELETE FROM bula_pair_failures WHERE at < ?').bind(nowMs - 3600e3)]); return { ok: false, status: 400, code: 'invalid_or_expired_code' }; };
  if (c.length !== 8) return await fail();
  const hash = await sha256hex(c); const token = 'dev_' + rndHex(32); const tokenHash = await sha256hex(token); const deviceId = 'D_' + rndHex(8);
  const row = await db.prepare('SELECT session_id FROM bula_pairing WHERE code_hash = ?').bind(hash).first(); if (!row) return await fail();
  const live = await db.prepare('SELECT COUNT(*) n FROM bula_devices WHERE session_id = ? AND revoked_at IS NULL AND expires_at > ?').bind(row.session_id, nowMs).first(); if (live.n >= cfg.maxDevices) return await fail();
  try {
    await db.batch([
      db.prepare('UPDATE bula_pairing SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?').bind(nowMs, hash, nowMs),
      db.prepare('INSERT INTO bula_assert(ok) SELECT CASE WHEN changes() = 1 THEN 1 ELSE 0 END'), db.prepare('DELETE FROM bula_assert'),                    // single use, even under concurrent redemptions
      db.prepare('INSERT INTO bula_devices (device_id, token_hash, session_id, label, created_at, expires_at, last_used_at) SELECT ?,?,session_id,?,?,?,? FROM bula_pairing WHERE code_hash = ?').bind(deviceId, tokenHash, lbl, nowMs, nowMs + cfg.deviceTtlMs, nowMs, hash),
      db.prepare('INSERT INTO bula_audit (at, actor, action, subject, detail) VALUES (?,?,?,?,?)').bind(nowMs, 'device', 'device_connected', row.session_id, deviceId)]);
  } catch (e) { if (/bula_assert|CHECK|UNIQUE/i.test(String(e && e.message))) return await fail(); throw e; }
  return { ok: true, deviceToken: token, deviceId, expiresAt: nowMs + cfg.deviceTtlMs };
}

/** Guest session for a device key, or null. Honours device expiry/revocation AND the guest session's own revocation. */
export async function sessionForDevice(db, token, nowMs) {
  if (typeof token !== 'string' || !token.startsWith('dev_') || token.length !== 68) return null;
  const h = await sha256hex(token);
  const r = await db.prepare('SELECT g.*, d.device_id AS __device_id, d.last_used_at AS __last FROM bula_devices d JOIN guest_sessions g ON g.session_id = d.session_id WHERE d.token_hash = ? AND d.revoked_at IS NULL AND d.expires_at > ? AND g.access_token_revoked = 0').bind(h, nowMs).first();
  if (!r) return null;
  if (nowMs - r.__last > 3600e3) { try { await db.prepare('UPDATE bula_devices SET last_used_at = ? WHERE device_id = ?').bind(nowMs, r.__device_id).run(); } catch { /* best effort */ } }
  return r;
}
export async function listDevices(db, sessionId, nowMs, currentDeviceId = null) {
  const { results } = await db.prepare('SELECT device_id, label, created_at, last_used_at, expires_at FROM bula_devices WHERE session_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at').bind(sessionId, nowMs).all();
  return results.map((d) => ({ deviceId: d.device_id, label: d.label, createdAt: d.created_at, lastUsedAt: d.last_used_at, expiresAt: d.expires_at, current: d.device_id === currentDeviceId }));
}
export async function revokeDevice(db, sessionId, deviceId, nowMs, actor) {
  const r = await db.prepare('SELECT 1 x FROM bula_devices WHERE device_id = ? AND session_id = ?').bind(deviceId, sessionId).first(); if (!r) return { ok: false, code: 'unknown_device' };
  await db.batch([db.prepare('UPDATE bula_devices SET revoked_at = COALESCE(revoked_at, ?) WHERE device_id = ? AND session_id = ?').bind(nowMs, deviceId, sessionId), db.prepare('INSERT INTO bula_audit (at, actor, action, subject, detail) VALUES (?,?,?,?,?)').bind(nowMs, actor, 'device_revoked', sessionId, deviceId)]);
  return { ok: true };
}
