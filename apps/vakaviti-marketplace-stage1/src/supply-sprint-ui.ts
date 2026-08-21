import { Hono } from 'hono';
import { discoverProviderFromSource } from './discovery-bridge';

// Vakaviti P1.4/P1.4A - the Initial Supply Sprint Controller. Lets James trigger real
// Worker-origin provider discovery against the 7 CEO-authorized sources in bounded batches,
// without waiting on the normal 24-hour Cron rotation (unchanged and still active for ongoing
// maintenance - see wrangler.toml/src/deal-agent.ts, neither touched by this file).
//
// Same cookie-session/CSRF/Origin/fixed-actor discipline as every other admin console in this
// app (src/batch-review-ui.ts, src/provider-onboarding-ui.ts, src/deals-admin-ui.ts) - one login,
// reused here rather than reinvented. AI has no import path to this file (see
// regression-guards.mjs check 22). Only the authenticated human session can start or continue a
// sprint; every per-source outcome still goes through discoverProviderFromSource()'s own
// independent idempotency/weak-page gating (src/discovery-bridge.ts) regardless of who triggers it.
//
// This file creates PRIVATE candidates only (candidate_operators/candidate_sources/
// candidate_claims/product_candidates) - it has no path to operators/products publication or to
// deal approval. Directory promotion happens later, separately, at /admin/review (P1.3D). Deal
// approval happens later, separately, at /admin/deals (P1, unchanged).
//
// P1.4A root-cause fix: the login flow (src/deals-admin-ui.ts) previously always redirected to
// the fixed /admin/deals queue on success, with no memory of what the user actually came here
// for. A first-time visit to this console bounced through login and landed on an unrelated page,
// with the only way back being the header nav link - real friction, and the most likely reason
// the very first sprint attempt never reached POST /start at all. requireAdminSession below now
// passes return_to so a successful login lands back here directly.

type Bindings = { DB: D1Database; AI: Ai; ENVIRONMENT: string; ADMIN_TOKEN?: string };
export const supplySprintUi = new Hono<{ Bindings: Bindings }>();

const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const COOKIE_NAME = 'vakaviti_admin_session';

const getCookie = (c: any, name: string): string | undefined => {
  const header = c.req.header('cookie') || '';
  const match = header.split(';').map((s: string) => s.trim()).find((s: string) => s.startsWith(name + '='));
  return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : undefined;
};

// Logs a sanitized activation event - never a secret, cookie, CSRF value, or extracted provider
// content, only booleans and short fixed error-code strings. Wrapped so a logging failure can
// never break the real request it's trying to explain.
async function logActivation(env: Bindings, fields: {
  route: string; authenticated: boolean; csrfValid?: boolean; originValid?: boolean;
  runCreated?: boolean; runId?: string; failureStage?: string; errorCode?: string;
}): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO supply_sprint_activation_log (id, route, authenticated, csrf_valid, origin_valid, run_created, run_id, failure_stage, error_code) VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind(
      crypto.randomUUID(), fields.route, fields.authenticated ? 1 : 0,
      fields.csrfValid === undefined ? null : (fields.csrfValid ? 1 : 0),
      fields.originValid === undefined ? null : (fields.originValid ? 1 : 0),
      fields.runCreated ? 1 : 0, fields.runId ?? null, fields.failureStage ?? null, fields.errorCode ?? null
    ).run();
  } catch { /* observability must never break the actual request */ }
}

const requireAdminSession = async (c: any, next: any) => {
  const expected = c.env.ADMIN_TOKEN;
  if (!expected) return c.html(shell('<p>Admin not configured.</p>', { title: 'Admin unavailable' }), 503);
  const session = getCookie(c, COOKIE_NAME);
  if (session !== expected) {
    await logActivation(c.env, { route: c.req.path, authenticated: false, failureStage: 'SESSION_CHECK' });
    return c.redirect(`/admin/deals/login?return_to=${encodeURIComponent(c.req.path)}`);
  }
  await next();
};

async function hmacHex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function csrfField(env: Bindings): Promise<{ html: string; nonce: string }> {
  const nonce = crypto.randomUUID();
  const sig = await hmacHex(env.ADMIN_TOKEN || '', nonce);
  return { html: `<input type="hidden" name="csrf_nonce" value="${esc(nonce)}"><input type="hidden" name="csrf_sig" value="${esc(sig)}">`, nonce };
}
async function csrfValid(env: Bindings, nonce: string, sig: string): Promise<boolean> {
  if (!nonce || !sig) return false;
  const expected = await hmacHex(env.ADMIN_TOKEN || '', nonce);
  return safeEqual(expected, sig);
}
function originAllowed(c: any): boolean {
  const host = c.req.header('host') || '';
  const origin = c.req.header('origin');
  if (origin) { try { return new URL(origin).host === host; } catch { return false; } }
  const referer = c.req.header('referer');
  if (referer) { try { return new URL(referer).host === host; } catch { return false; } }
  return false;
}

const shell = (body: string, opts: { title?: string } = {}) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.title || 'Supply Sprint')} — Vakaviti Admin</title>
<meta name="robots" content="noindex,nofollow">
<style>
:root{--ink:#12231b;--muted:#607068;--line:#dde5e0;--bg:#f6f8f7;--accent:#0f6e6a;--warn:#a15c00;--danger:#a1272b;--good:#1f7a4d}
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:var(--bg);color:var(--ink);-webkit-text-size-adjust:100%}
header{position:sticky;top:0;background:rgba(246,248,247,.96);backdrop-filter:blur(6px);z-index:10;padding:12px 16px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:8px}
header a{color:var(--ink);text-decoration:none;font-weight:700;font-size:15px}
header nav{display:flex;gap:12px;overflow-x:auto;font-size:13px}
header nav a{font-weight:500;color:var(--muted);white-space:nowrap;padding:6px 2px}
main{max-width:900px;margin:auto;padding:16px}
.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px;margin-bottom:12px}
.muted{color:var(--muted);font-size:13px}
.badge{display:inline-block;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;background:#eef2ef;color:var(--muted)}
.badge.good{background:#e9f5f0;color:var(--good)}
.badge.warn{background:#fff3d6;color:var(--warn)}
.badge.danger{background:#fde8e8;color:var(--danger)}
.btn{display:inline-block;background:var(--ink);color:#fff;border:none;text-decoration:none;padding:12px 16px;border-radius:10px;font-weight:700;font-size:14px;min-height:44px;min-width:44px;cursor:pointer}
.btn.secondary{background:#fff;color:var(--ink);border:1px solid var(--ink)}
.btn.big{font-size:17px;padding:18px 20px;min-height:56px;border-radius:14px}
.btn:disabled{opacity:.55;cursor:not-allowed}
.row{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.strip{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;font-size:13px}
.strip .pill{background:#fff;border:1px solid var(--line);border-radius:999px;padding:6px 12px}
.progress{background:var(--bg);border:1px solid var(--line);border-radius:999px;height:14px;overflow:hidden;margin:10px 0}
.progress-bar{background:var(--accent);height:100%;transition:width .2s}
.src{border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:8px;font-size:13px}
.notice{background:#e9f5f0;border:1px solid #a9d9c6;border-radius:10px;padding:12px 14px;font-size:13px;margin-bottom:16px}
.notice.warn{background:#fff3d6;border-color:#e8c877}
.chk-row{display:flex;align-items:flex-start;gap:10px;margin:12px 0;padding:12px 10px;background:var(--bg);border-radius:8px;min-height:44px}
.chk-row input{width:26px;height:26px;flex-shrink:0;margin-top:1px}
.chk-row .lbl{font-size:14px;font-weight:600;cursor:pointer;display:block}
a:focus-visible,button:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
</style></head>
<body>
<header><a href="/admin/supply/sprint">Supply Sprint</a><nav><a href="/admin/supply/sprint">Sprint</a><a href="/admin/review">Batch Review</a><a href="/admin/deals">Deal Intelligence</a><a href="/admin/providers">Providers</a></nav></header>
<main>${body}</main>
<script>
// Prevents a double-tap from firing two submissions client-side. This is a UX layer only - the
// real guarantee against a duplicate run is server-side (see src/supply-sprint-ui.ts: the CSRF
// nonce doubles as the idempotency key for POST /start, so even a request that slips past this
// disables-the-button check still collides on a UNIQUE constraint and creates nothing).
document.addEventListener('submit', function (e) {
  var btn = e.target.querySelector('button[type=submit]');
  if (btn && !btn.disabled) { btn.disabled = true; btn.textContent = btn.textContent + '…'; }
});
</script>
</body></html>`;

// The 7 CEO-authorized sources for this initial sprint (VAKAVITI P1.4, 2026-08-21), reassessed
// live in Phase 2 - all 7 responded 200/text-html at reassessment time. Kept as a fixed constant
// (not read from deal_sources, which holds OFFER source URLs like /specials pages, not provider
// root domains) so the sprint's own scope is explicit and auditable in code, not implicit in a
// mutable table a future change could silently alter.
const SPRINT_SOURCE_DOMAINS = [
  'bluelagooncruises.com',
  'matangiisland.com',
  'savasiisland.com',
  'serenitysands.com.fj',
  'captaincookcruisesfiji.com',
  'fiji.intercontinental.com',
  'plantationisland.com',
];
const MAX_SOURCES_PER_BATCH = 3;
const MAX_RUNNING_MINUTES = 10;

async function recoverStuckSprints(env: Bindings): Promise<void> {
  const stuck = await env.DB.prepare(
    `SELECT id FROM supply_sprint_runs WHERE status='RUNNING' AND started_at < datetime('now', '-' || ? || ' minutes')`
  ).bind(MAX_RUNNING_MINUTES).all<any>();
  for (const row of stuck.results || []) {
    await env.DB.prepare(
      `UPDATE supply_sprint_runs SET status='FAILED', completed_at=CURRENT_TIMESTAMP, summary_json=? WHERE id=? AND status='RUNNING'`
    ).bind(JSON.stringify({ failure_reason: 'TIMED_OUT', reason: `Exceeded ${MAX_RUNNING_MINUTES}-minute running threshold` }), row.id).run();
  }
}

async function processBatch(env: Bindings, run: any): Promise<void> {
  const domains: string[] = JSON.parse(run.source_domains_json);
  const batch = domains.slice(run.next_batch_offset, run.next_batch_offset + MAX_SOURCES_PER_BATCH);

  let processed = run.sources_processed, failed = run.sources_failed;
  let created = run.candidates_created, rejected = run.candidates_rejected_weak, products = run.product_candidates_created;

  for (const domain of batch) {
    const idemKey = `${run.idempotency_key}-${domain}`;
    const already = await env.DB.prepare(`SELECT id FROM supply_sprint_scans WHERE idempotency_key=?`).bind(idemKey).first<any>();
    if (already) continue; // this exact source, in this exact run, was already processed - never double-count on a retried request

    let result: Awaited<ReturnType<typeof discoverProviderFromSource>>;
    try {
      result = await discoverProviderFromSource(env, domain);
    } catch (e: any) {
      result = { outcome: 'FETCH_FAILED', error: String(e?.message || e) };
    }
    processed++;

    const outcome = result.outcome;
    if (outcome === 'FETCH_FAILED') failed++;
    if (outcome === 'REJECTED_WEAK') rejected++;
    if (outcome === 'CANDIDATE_CREATED') { created++; products += (result as any).productsFound || 0; }

    await env.DB.prepare(
      `INSERT INTO supply_sprint_scans (id, sprint_run_id, source_domain, idempotency_key, http_status, classification, outcome, resulted_candidate_id, missing_fields_json, products_found, error)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      crypto.randomUUID(), run.id, domain, idemKey,
      (result as any).httpStatus ?? null, (result as any).classification ?? null, outcome,
      (result as any).candidateId ?? null,
      (result as any).missingFields ? JSON.stringify((result as any).missingFields) : null,
      (result as any).productsFound ?? 0,
      (result as any).error ?? ((result as any).reason ?? null)
    ).run();
  }

  const nextOffset = run.next_batch_offset + batch.length;
  const isDone = nextOffset >= domains.length;
  await env.DB.prepare(
    `UPDATE supply_sprint_runs SET
       next_batch_offset=?, sources_processed=?, sources_failed=?, candidates_created=?,
       candidates_rejected_weak=?, product_candidates_created=?,
       status=?, completed_at=?
     WHERE id=?`
  ).bind(
    nextOffset, processed, failed, created, rejected, products,
    isDone ? 'COMPLETED' : 'RUNNING', isDone ? new Date().toISOString() : null,
    run.id
  ).run();
}

// A genuinely unexpected exception mid-batch (not a normal per-source failure, which
// processBatch already handles and records per-source) marks the run FAILED with a sanitized
// error rather than propagating into a raw, unstyled 500 with no way back for a phone user.
async function markRunFailed(env: Bindings, runId: string, sanitizedError: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE supply_sprint_runs SET status='FAILED', completed_at=CURRENT_TIMESTAMP, summary_json=? WHERE id=? AND status='RUNNING'`
  ).bind(JSON.stringify({ failure_reason: 'UNEXPECTED_ERROR', reason: sanitizedError }), runId).run();
}

const errorPage = (message: string, retryHref: string) => shell(
  `<div class="card"><p>${esc(message)}</p><div class="row"><a class="btn" href="${esc(retryHref)}">Retry</a><a class="btn secondary" href="/admin/supply/sprint">Back to sprint</a></div></div>`,
  { title: 'Something went wrong' }
);

supplySprintUi.use('*', requireAdminSession);

supplySprintUi.get('/', async c => {
  await recoverStuckSprints(c.env);
  const running = await c.env.DB.prepare(`SELECT * FROM supply_sprint_runs WHERE status='RUNNING' LIMIT 1`).first<any>();
  const lastRun = await c.env.DB.prepare(`SELECT * FROM supply_sprint_runs ORDER BY created_at DESC LIMIT 1`).first<any>();
  const csrf = await csrfField(c.env);

  if (running) {
    return c.redirect(`/admin/supply/sprint/${running.id}`);
  }

  const sourceList = SPRINT_SOURCE_DOMAINS.map(d => `<div class="src">${esc(d)}</div>`).join('');
  const lastRunSummary = lastRun ? `<div class="card"><p class="muted" style="margin:0">Last run: ${esc(lastRun.status)}, ${lastRun.candidates_created} candidate(s) created, ${lastRun.sources_processed}/${SPRINT_SOURCE_DOMAINS.length} source(s) processed. <a href="/admin/supply/sprint/${esc(lastRun.id)}">View</a></p></div>` : '';

  return c.html(shell(`
    <h1 style="font-size:19px;margin:0 0 4px">Initial supply sprint</h1>
    <p class="muted" style="margin:0 0 14px">Processes the 7 CEO-authorized sources in batches of up to ${MAX_SOURCES_PER_BATCH}, without waiting for the normal Cron schedule. Creates PRIVATE candidates only - nothing here publishes anything.</p>
    <div class="notice">This is a real Worker-origin fetch against each provider's own official site. Weak pages create an audit record but no candidate. A source already represented by an existing operator or candidate is skipped automatically.</div>
    <div class="card"><h2 style="font-size:15px;margin:0 0 10px">Sources in this sprint (0/${SPRINT_SOURCE_DOMAINS.length})</h2>${sourceList}</div>
    ${lastRunSummary}
    <form method="POST" action="/admin/supply/sprint/start">
      ${csrf.html}
      <div class="chk-row"><input type="checkbox" id="confirm_start" name="confirm_start" value="1" required>
        <label for="confirm_start" class="lbl">I confirm I want to start the initial supply sprint against the 7 sources listed above</label></div>
      <div class="row"><button class="btn big" type="submit" style="width:100%">Start sprint</button></div>
    </form>
  `, { title: 'Initial supply sprint' }));
});

supplySprintUi.post('/start', async c => {
  if (!originAllowed(c)) {
    await logActivation(c.env, { route: '/start', authenticated: true, originValid: false, failureStage: 'ORIGIN_CHECK', errorCode: 'ORIGIN_BLOCKED' });
    return c.html(shell('<div class="card"><p>Request blocked: origin check failed.</p></div>', { title: 'Blocked' }), 403);
  }
  const body = await c.req.parseBody();
  const nonce = String(body.csrf_nonce || '');
  const sig = String(body.csrf_sig || '');
  const csrfOk = await csrfValid(c.env, nonce, sig);
  if (!csrfOk) {
    await logActivation(c.env, { route: '/start', authenticated: true, csrfValid: false, originValid: true, failureStage: 'CSRF_CHECK', errorCode: 'CSRF_INVALID' });
    return c.html(shell('<div class="card"><p>This form has expired or failed a security check. Please go back and try again.</p><a class="btn secondary" href="/admin/supply/sprint">Back</a></div>', { title: 'Form expired' }), 403);
  }
  if (body.confirm_start !== '1') {
    await logActivation(c.env, { route: '/start', authenticated: true, csrfValid: true, originValid: true, failureStage: 'CONFIRMATION_CHECK', errorCode: 'CONFIRMATION_MISSING' });
    return c.html(shell('<div class="card"><p>Please check the confirmation box to start the sprint.</p><a class="btn secondary" href="/admin/supply/sprint">Back</a></div>', { title: 'Confirmation required' }), 422);
  }

  await recoverStuckSprints(c.env);
  const stillRunning = await c.env.DB.prepare(`SELECT id FROM supply_sprint_runs WHERE status='RUNNING' LIMIT 1`).first<any>();
  if (stillRunning) return c.redirect(`/admin/supply/sprint/${stillRunning.id}`);

  const runId = crypto.randomUUID();
  // P1.4A: the idempotency key is derived from the CSRF nonce itself, not a fresh timestamp+uuid.
  // The nonce is generated once per page render and is identical across a genuine double-tap of
  // the same already-rendered form - so a duplicate submission collides on this table's UNIQUE
  // constraint and the second INSERT OR IGNORE is a verifiable no-op, enforced by D1/SQLite at
  // the write layer regardless of any race in the stillRunning check above.
  const idemKey = `supply-sprint-start-${nonce}`;
  const insertRun = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO supply_sprint_runs (id, idempotency_key, started_by, source_domains_json) VALUES (?,?,?,?)`
  ).bind(runId, idemKey, 'CEO (admin session)', JSON.stringify(SPRINT_SOURCE_DOMAINS)).run();
  if ((insertRun.meta as any).changes === 0) {
    // Either a genuine double-submit of this exact form (nothing new to do - the original
    // request's run already exists) or a stale reused form after a page reload.
    const existing = await c.env.DB.prepare(`SELECT id FROM supply_sprint_runs WHERE idempotency_key=?`).bind(idemKey).first<any>();
    if (existing) return c.redirect(`/admin/supply/sprint/${existing.id}`);
    await logActivation(c.env, { route: '/start', authenticated: true, csrfValid: true, originValid: true, runCreated: false, failureStage: 'RUN_INSERT', errorCode: 'IDEMPOTENCY_COLLISION' });
    return c.html(errorPage('Could not start a new sprint - please go back and try again.', '/admin/supply/sprint'), 409);
  }
  await logActivation(c.env, { route: '/start', authenticated: true, csrfValid: true, originValid: true, runCreated: true, runId });

  const run = await c.env.DB.prepare(`SELECT * FROM supply_sprint_runs WHERE id=?`).bind(runId).first<any>();
  try {
    await processBatch(c.env, run);
  } catch (e: any) {
    await markRunFailed(c.env, runId, String(e?.message || e).slice(0, 300));
    return c.html(errorPage('The sprint started but hit an unexpected error partway through the first batch. It has been marked failed - safe to start a new one.', `/admin/supply/sprint/${runId}`), 500);
  }

  return c.redirect(`/admin/supply/sprint/${runId}`);
});

supplySprintUi.get('/:runId', async c => {
  const runId = c.req.param('runId');
  const run = await c.env.DB.prepare(`SELECT * FROM supply_sprint_runs WHERE id=?`).bind(runId).first<any>();
  if (!run) return c.notFound();

  const scans = await c.env.DB.prepare(`SELECT * FROM supply_sprint_scans WHERE sprint_run_id=? ORDER BY created_at ASC`).bind(runId).all<any>();
  const domains: string[] = JSON.parse(run.source_domains_json);
  const csrf = await csrfField(c.env);

  const outcomeBadge = (o: string) => o === 'CANDIDATE_CREATED' ? '<span class="badge good">CANDIDATE_CREATED</span>'
    : o === 'REJECTED_WEAK' ? '<span class="badge warn">REJECTED_WEAK</span>'
    : o === 'SKIPPED_ALREADY_EXISTS' ? '<span class="badge">SKIPPED_ALREADY_EXISTS</span>'
    : '<span class="badge danger">FETCH_FAILED</span>';

  const scanRows = (scans.results || []).map((s: any) => `<div class="src">
    ${outcomeBadge(s.outcome)} <b>${esc(s.source_domain)}</b><br>
    <span class="muted">http=${s.http_status ?? '—'} ${s.classification ? '· ' + esc(s.classification) : ''} ${s.products_found ? '· ' + s.products_found + ' product(s)' : ''}</span>
    ${s.error ? `<br><span class="muted">${esc(s.error)}</span>` : ''}
    ${s.resulted_candidate_id ? `<br><span class="muted">candidate: ${esc(s.resulted_candidate_id)}</span>` : ''}
  </div>`).join('') || '<p class="muted">No sources processed yet.</p>';

  const remaining = domains.length - run.next_batch_offset;
  const progressPct = Math.round((run.sources_processed / domains.length) * 100);
  const continueForm = (run.status === 'RUNNING' && remaining > 0) ? `
    <form method="POST" action="/admin/supply/sprint/${esc(runId)}/continue">
      ${csrf.html}
      <div class="row"><button class="btn big" type="submit" style="width:100%">Continue (${Math.min(MAX_SOURCES_PER_BATCH, remaining)} more source(s))</button></div>
    </form>` : '';

  return c.html(shell(`
    <p><a href="/admin/supply/sprint" class="muted">&larr; Sprint</a></p>
    <h1 style="font-size:19px;margin:0 0 4px">Sprint run</h1>
    <p class="muted" style="margin:0 0 4px">Run ID: <code>${esc(run.id)}</code></p>
    <div class="progress"><div class="progress-bar" style="width:${progressPct}%"></div></div>
    <div class="strip">
      <span class="pill">status: <b>${esc(run.status)}</b></span>
      <span class="pill">progress: <b>${run.sources_processed}/${domains.length}</b></span>
      <span class="pill">candidates created: <b>${run.candidates_created}</b></span>
      <span class="pill">rejected (weak): <b>${run.candidates_rejected_weak}</b></span>
      <span class="pill">products found: <b>${run.product_candidates_created}</b></span>
    </div>
    <div class="card">${scanRows}</div>
    ${continueForm}
    ${run.status === 'COMPLETED' ? '<div class="notice">Sprint complete. Review the candidates it created at <a href="/admin/review">/admin/review</a>.</div>' : ''}
    ${run.status === 'FAILED' ? '<div class="notice warn">This run ended in a FAILED state - safe to start a new sprint from the sprint home page.</div>' : ''}
  `, { title: 'Sprint run' }));
});

supplySprintUi.post('/:runId/continue', async c => {
  const runId = c.req.param('runId');
  if (!originAllowed(c)) {
    await logActivation(c.env, { route: '/:runId/continue', authenticated: true, originValid: false, runId, failureStage: 'ORIGIN_CHECK', errorCode: 'ORIGIN_BLOCKED' });
    return c.html(shell('<div class="card"><p>Request blocked: origin check failed.</p></div>', { title: 'Blocked' }), 403);
  }
  const body = await c.req.parseBody();
  const nonce = String(body.csrf_nonce || '');
  const sig = String(body.csrf_sig || '');
  if (!(await csrfValid(c.env, nonce, sig))) {
    await logActivation(c.env, { route: '/:runId/continue', authenticated: true, csrfValid: false, originValid: true, runId, failureStage: 'CSRF_CHECK', errorCode: 'CSRF_INVALID' });
    return c.html(shell('<div class="card"><p>This form has expired or failed a security check. Please go back and try again.</p><a class="btn secondary" href="/admin/supply/sprint/' + esc(runId) + '">Back</a></div>', { title: 'Form expired' }), 403);
  }

  const run = await c.env.DB.prepare(`SELECT * FROM supply_sprint_runs WHERE id=?`).bind(runId).first<any>();
  if (!run) return c.notFound();
  if (run.status !== 'RUNNING') return c.redirect(`/admin/supply/sprint/${runId}`);

  try {
    await processBatch(c.env, run);
  } catch (e: any) {
    await markRunFailed(c.env, runId, String(e?.message || e).slice(0, 300));
    await logActivation(c.env, { route: '/:runId/continue', authenticated: true, csrfValid: true, originValid: true, runId, failureStage: 'BATCH_PROCESSING', errorCode: 'UNEXPECTED_ERROR' });
    return c.html(errorPage('This batch hit an unexpected error partway through. The run has been marked failed - safe to start a new sprint.', `/admin/supply/sprint/${runId}`), 500);
  }
  await logActivation(c.env, { route: '/:runId/continue', authenticated: true, csrfValid: true, originValid: true, runCreated: true, runId });
  return c.redirect(`/admin/supply/sprint/${runId}`);
});
