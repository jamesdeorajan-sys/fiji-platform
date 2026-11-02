/* Bula production email path (PREPARED, NOT WIRED, NOT ACTIVE). Nothing imports this module: the release bundle is unchanged until a CEO-approved wiring patch (docs) is applied.
 * Contract with the existing outbox dispatcher (outbox_d1.js): send({idempotencyKey, to, subject, text}) -> {id} | throws; err.ambiguous = true when the provider MAY have accepted the message.
 * Safety properties (all tested in m5_email_provider.test.mjs):
 *  - fail closed: refuses to construct without https endpoint, key, valid From; TEST mode refuses construction without a recipient allow-list and refuses to send to anyone not on it
 *  - idempotent: the outbox job key is sent as the provider Idempotency-Key and is the correlation id; a repeated send of the same key is the provider's duplicate to drop, and an uncertain outcome is NEVER auto-resent
 *  - errors/logs carry CODES only: never the address, subject, body, link/token or API key
 *  - no redirects followed with the credential attached
 */
const CODE = (c) => { const e = new Error(c); return e; };
const AMBIG = (c) => { const e = CODE(c); e.ambiguous = true; return e; };
const ADDR = /^[^\s@<>,;"'()\\]+@[^\s@<>,;"'()\\]+\.[^\s@<>,;"'()\\]+$/;
export const normAddr = (a) => String(a || '').trim().toLowerCase();
export function validAddress(a) { const s = String(a || ''); return s.length <= 254 && !/[\r\n]/.test(s) && ADDR.test(s); }
/** A short, non-reversible tag for logs/alerts (job keys can embed booking refs; addresses never appear). */
export async function tag(s) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s))); return [...new Uint8Array(d)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join(''); }

export function createHttpEmailSender({ endpoint, apiKey, from, fetchImpl, mode = 'test', allowRecipients = [], timeoutMs = 8000, log = () => {}, lookupImpl } = {}) {
  let url; try { url = new URL(endpoint); } catch { throw CODE('EMAIL_CONFIG_ENDPOINT'); }
  if (url.protocol !== 'https:') throw CODE('EMAIL_CONFIG_ENDPOINT');
  if (typeof apiKey !== 'string' || apiKey.length < 8) throw CODE('EMAIL_CONFIG_KEY');
  { const m = /^(?:[^<>\r\n"]{1,80}<([^<>\r\n]+)>|([^<>\r\n\s]+))$/.exec(String(from || '').trim()); if (!m || !validAddress(m[1] || m[2])) throw CODE('EMAIL_CONFIG_FROM'); }
  if (mode !== 'test' && mode !== 'live') throw CODE('EMAIL_CONFIG_MODE');
  const allow = new Set((allowRecipients || []).map(normAddr).filter(validAddress));
  if (mode === 'test' && allow.size === 0) throw CODE('EMAIL_CONFIG_TEST_NEEDS_ALLOWLIST');
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  return {
    mode,
    async send(m) {
      const k = await tag(m && m.idempotencyKey);
      const fail = (code, ambiguous) => { log({ evt: 'bula.email.failed', code, job: k, mode }); return ambiguous ? AMBIG(code) : CODE(code); };
      if (!m || typeof m.idempotencyKey !== 'string' || !m.idempotencyKey) throw fail('EMAIL_NO_IDEMPOTENCY_KEY');
      if (!validAddress(m.to)) throw fail('EMAIL_BAD_RECIPIENT');
      if (typeof m.subject !== 'string' || /[\r\n]/.test(m.subject) || !m.subject || typeof m.text !== 'string' || !m.text) throw fail('EMAIL_BAD_MESSAGE');
      if (mode === 'test' && !allow.has(normAddr(m.to))) throw fail('RECIPIENT_NOT_ALLOWED');   // TEST mode can only ever reach the CEO-controlled allow-list
      let res;
      try {
        res = await doFetch(url.toString(), { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'idempotency-key': m.idempotencyKey },
          body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text, headers: { 'X-Bula-Ref': m.idempotencyKey } }) });
      } catch { throw fail('PROVIDER_NO_RESPONSE_AMBIGUOUS', true); }   // may have been accepted: never blind-resend
      if (res.status >= 300 && res.status < 400) throw fail('PROVIDER_REDIRECT_REFUSED');
      if (res.status >= 200 && res.status < 300) {
        let id = null; try { const j = await res.json(); id = j && (j.id || j.messageId || j.message_id) ? String(j.id || j.messageId || j.message_id).slice(0, 200) : null; } catch { /* body is optional */ }
        log({ evt: 'bula.email.accepted', job: k, mode }); return { id: id || `accepted-${k}` };
      }
      if (res.status === 429) throw fail('PROVIDER_RATE_LIMITED');                 // rejected before processing: safe to retry later
      if (res.status >= 500) throw fail(`PROVIDER_5XX_AMBIGUOUS`, true);            // provider may have queued it: human/lookup decides
      throw fail(`PROVIDER_REJECTED_${res.status}`);                                 // 4xx: permanent, visible, capped by outboxMaxAttempts
    },
    // Only a provider that can answer "did you accept key K?" may return a verdict. Without it we return undefined = UNKNOWN, so the dispatcher leaves the job 'ambiguous' for a human and NEVER requeues it.
    async lookup(key) { if (!lookupImpl) return undefined; try { const r = await lookupImpl(key); return r === undefined ? undefined : r; } catch { return undefined; } },
  };
}

/** Provider webhook -> delivery evidence. The signature is HMAC-SHA256(secret, rawBody) in hex, compared in constant time. */
export async function verifyWebhook({ rawBody, signature, secret }) {
  if (!secret || typeof signature !== 'string' || typeof rawBody !== 'string') return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)));
  const want = [...mac].map((b) => b.toString(16).padStart(2, '0')).join(''); const got = signature.trim().toLowerCase();
  if (want.length !== got.length) return false; let d = 0; for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ got.charCodeAt(i); return d === 0;
}
/** Maps a verified provider event to the existing evidence columns. Unknown ids are ignored; repeats are no-ops (columns are only set on 'accepted' jobs). */
export async function applyDeliveryEvent(db, ev, nowMs) {
  const col = { delivered: 'delivered_at', bounced: 'bounced_at' }[ev && ev.type]; if (!col || !ev.id) return { applied: false };
  const job = await db.prepare('SELECT job_key FROM bula_outbox WHERE provider_id = ?').bind(String(ev.id)).first(); if (!job) return { applied: false, reason: 'unknown_provider_id' };
  const r = await db.prepare(`UPDATE bula_outbox SET ${col} = COALESCE(${col}, ?), updated_at = ? WHERE job_key = ? AND state = 'accepted'`).bind(nowMs, nowMs, job.job_key).run();
  return { applied: r.meta.changes === 1, job: await tag(job.job_key) };
}
