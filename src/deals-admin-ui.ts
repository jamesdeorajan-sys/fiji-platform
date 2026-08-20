import { Hono } from 'hono';
import { listCandidates, slugify } from './deals';

// Vakaviti Deal Intelligence - P1 Part A: the Human Review Centre, as real server-rendered
// mobile-usable HTML (this app has always been zero-client-JS; this file follows that pattern -
// every decision here is a plain HTML <form method="POST">, no fetch/JS required).
//
// AUTH MODEL: the JSON API (src/deals.ts) requires an `Authorization: Bearer <ADMIN_TOKEN>`
// header, which a browser navigating to a page cannot set. This file adds a second, additive
// admin-auth path specifically for browser use: a login form posts the token once, this sets an
// HttpOnly, Secure, SameSite=Strict session cookie (named vakaviti_admin_session, value is the
// token itself - there is no separate session store to keep in sync, and the cookie is never
// readable by page JS since none exists), and subsequent page loads are gated by checking that
// cookie against env.ADMIN_TOKEN. The JSON API's own Bearer-token requirement is completely
// unchanged - this is a new, parallel path for the HTML surface only, not a weakening of the
// existing one. AI has no route to either: it never receives ADMIN_TOKEN and never sees this file.
//
// Every decision endpoint here (approve/reject/dispute/withdraw/request-more-evidence) performs
// the exact same DB writes and deal_approvals audit record as the JSON API in src/deals.ts (in
// fact several call the same underlying pattern) - this file is a presentation layer over the
// same governed actions, not a second, less-guarded write path.

type Bindings = { DB: D1Database; ADMIN_TOKEN?: string };
export const dealsAdminUi = new Hono<{ Bindings: Bindings }>();

const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const COOKIE_NAME = 'vakaviti_admin_session';

const getCookie = (c: any, name: string): string | undefined => {
  const header = c.req.header('cookie') || '';
  const match = header.split(';').map((s: string) => s.trim()).find((s: string) => s.startsWith(name + '='));
  return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : undefined;
};

const requireAdminSession = async (c: any, next: any) => {
  const expected = c.env.ADMIN_TOKEN;
  if (!expected) return c.html(shell('<p>Admin not configured.</p>', { title: 'Admin unavailable' }), 503);
  const session = getCookie(c, COOKIE_NAME);
  if (session !== expected) return c.redirect('/admin/deals/login');
  await next();
};

const shell = (body: string, opts: { title?: string } = {}) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.title || 'Deal Intelligence Review')} — Vakaviti Admin</title>
<meta name="robots" content="noindex,nofollow">
<style>
:root{--ink:#12231b;--muted:#607068;--line:#dde5e0;--bg:#f6f8f7;--accent:#0f6e6a;--warn:#a15c00;--danger:#a1272b}
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
.badge.review{background:#fff3d6;color:var(--warn)}
.badge.published{background:#e9f5f0;color:var(--accent)}
.badge.stopped{background:#fde8e8;color:var(--danger)}
.btn{display:inline-block;background:var(--ink);color:#fff;border:none;text-decoration:none;padding:12px 16px;border-radius:10px;font-weight:700;font-size:14px;min-height:44px;min-width:44px;cursor:pointer}
.btn.secondary{background:#fff;color:var(--ink);border:1px solid var(--ink)}
.btn.danger{background:var(--danger)}
.btn.warn{background:var(--warn)}
.row{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.filters{display:flex;gap:6px;overflow-x:auto;padding:10px 16px;background:#fff;border-bottom:1px solid var(--line);position:sticky;top:53px;z-index:9;-webkit-overflow-scrolling:touch}
.filters a{white-space:nowrap;font-size:12px;padding:8px 12px;border-radius:999px;background:var(--bg);color:var(--ink);text-decoration:none;border:1px solid var(--line);min-height:32px;display:flex;align-items:center}
.filters a.active{background:var(--ink);color:#fff;border-color:var(--ink)}
table{width:100%;border-collapse:collapse}
label{display:block;font-size:12px;font-weight:700;margin:12px 0 4px}
input,textarea,select{width:100%;padding:11px;border:1px solid var(--line);border-radius:8px;font-size:15px;min-height:44px}
textarea{min-height:70px}
.field-grid{display:grid;grid-template-columns:1fr;gap:0}
@media (min-width:600px){.field-grid{grid-template-columns:1fr 1fr;gap:0 16px}}
fieldset{border:1px solid var(--line);border-radius:10px;margin-top:14px;padding:12px}
legend{font-weight:700;font-size:13px;padding:0 6px}
a:focus-visible,button:focus-visible,input:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
</style></head>
<body>
<header><a href="/admin/deals">Deal Intelligence</a><nav><a href="/admin/deals">Queue</a><a href="/admin/deals/sources">Sources</a><a href="/admin/deals/runs">Runs</a></nav></header>
<main>${body}</main>
</body></html>`;

// --- Login (Part A auth) ---------------------------------------------------------------------

dealsAdminUi.get('/login', c => {
  return c.html(shell(`
<div class="card">
  <h1 style="font-size:20px;margin:0 0 6px">Deal Intelligence admin</h1>
  <p class="muted">Enter the admin token to review candidates on this device. The session cookie is HttpOnly and Secure - never readable by page scripts (this site has none).</p>
  <form method="POST" action="/admin/deals/login">
    <label for="token">Admin token</label>
    <input id="token" name="token" type="password" autocomplete="off" required>
    <div class="row"><button class="btn" type="submit" style="width:100%">Sign in</button></div>
  </form>
</div>`, { title: 'Sign in' }));
});

dealsAdminUi.post('/login', async c => {
  const body = await c.req.parseBody();
  const token = String(body.token || '');
  if (!c.env.ADMIN_TOKEN || token !== c.env.ADMIN_TOKEN) {
    return c.html(shell(`<div class="card"><p>Incorrect token.</p><a class="btn secondary" href="/admin/deals/login">Try again</a></div>`, { title: 'Sign in failed' }), 401);
  }
  c.header('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`);
  return c.redirect('/admin/deals');
});

dealsAdminUi.post('/logout', async c => {
  c.header('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
  return c.redirect('/admin/deals/login');
});

dealsAdminUi.use('*', requireAdminSession);

// --- Review queue (view 1) --------------------------------------------------------------------

const FILTERS = ['needs_review','incomplete','contradictory','expired','stale','approved','rejected','withdrawn','revoked','source_failure'];

dealsAdminUi.get('/', async c => {
  const filter = c.req.query('filter') || 'needs_review';
  const candidates = await listCandidates(c.env.DB, { filter: FILTERS.includes(filter) ? filter : undefined });
  const filterLinks = ['needs_review', ...FILTERS.filter(f => f !== 'needs_review')].map(f =>
    `<a class="${f === filter ? 'active' : ''}" href="/admin/deals?filter=${f}">${f.replace(/_/g, ' ')}</a>`
  ).join('');

  const rows = candidates.map((cand: any) => {
    const missing = cand.missing_fields ? JSON.parse(cand.missing_fields) : [];
    const badgeClass = cand.review_status === 'PUBLISHED' ? 'published' : ['WITHDRAWN', 'REJECTED', 'DISPUTED', 'QUARANTINED'].includes(cand.review_status) ? 'stopped' : 'review';
    return `<a href="/admin/deals/candidates/${esc(cand.id)}" style="text-decoration:none;color:inherit">
      <div class="card">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:start">
          <strong>${esc(cand.proposed_offer_name || '(no title extracted)')}</strong>
          <span class="badge ${badgeClass}">${esc(cand.review_status)}</span>
        </div>
        <p class="muted" style="margin:6px 0">${esc(cand.canonical_domain)} · discovered ${esc(cand.created_at)} · checked ${esc(cand.source_checked_at || 'never')}</p>
        <p class="muted">Confidence ${cand.extraction_confidence != null ? Math.round(cand.extraction_confidence * 100) + '%' : 'n/a'} · ${missing.length} field(s) missing · source ${esc(cand.source_approval_status)}</p>
      </div>
    </a>`;
  }).join('') || `<div class="card"><p class="muted">No candidates match this filter.</p></div>`;

  return c.html(shell(`
    <h1 style="font-size:18px;margin:0 0 4px">Review queue</h1>
    <p class="muted" style="margin:0 0 10px">${candidates.length} candidate(s)</p>
    ${rows}`,
    { title: 'Review queue' }
  ).replace('<main>', `<div class="filters">${filterLinks}</div><main>`));
});

// --- Source-health and scan-run summary (views 7, 8) -------------------------------------------

dealsAdminUi.get('/sources', async c => {
  const rows = await c.env.DB.prepare(`SELECT * FROM deal_sources ORDER BY canonical_domain`).all<any>();
  const items = (rows.results || []).map((s: any) => `<div class="card">
    <div style="display:flex;justify-content:space-between"><strong>${esc(s.canonical_domain)}</strong><span class="badge ${s.source_approval_status === 'APPROVED' ? 'published' : 'stopped'}">${esc(s.source_approval_status)}</span></div>
    <p class="muted">Last scan ${esc(s.last_scan_at || 'never')} · next due ${esc(s.next_scan_at || 'now')} · failures ${s.failure_count}</p>
  </div>`).join('');
  return c.html(shell(`<h1 style="font-size:18px">Source health</h1>${items}`, { title: 'Sources' }));
});

dealsAdminUi.get('/runs', async c => {
  const rows = await c.env.DB.prepare(`SELECT * FROM deal_scan_runs ORDER BY started_at DESC LIMIT 30`).all<any>();
  const items = (rows.results || []).map((r: any) => `<div class="card">
    <div style="display:flex;justify-content:space-between"><strong>${esc(r.run_type)}</strong><span class="badge ${r.status === 'COMPLETED' ? 'published' : r.status === 'RUNNING' ? 'review' : 'stopped'}">${esc(r.status)}</span></div>
    <p class="muted">${esc(r.started_at)} → ${esc(r.completed_at || 'in progress')} · scanned ${r.sources_scanned} · failed ${r.sources_failed} · created ${r.candidates_created}</p>
  </div>`).join('');
  return c.html(shell(`<h1 style="font-size:18px">Scan runs</h1>${items}`, { title: 'Scan runs' }));
});

// --- Candidate detail (views 2-6) + decision forms ---------------------------------------------

dealsAdminUi.get('/candidates/:id', async c => {
  const id = c.req.param('id');
  const candidate = await c.env.DB.prepare(
    `SELECT c.*, s.source_approval_status, s.canonical_domain, s.content_fingerprint AS current_source_fingerprint FROM deal_offer_candidates c JOIN deal_sources s ON c.source_id = s.id WHERE c.id = ?`
  ).bind(id).first<any>();
  if (!candidate) return c.html(shell('<p>Not found.</p>'), 404);
  const approvals = await c.env.DB.prepare(`SELECT * FROM deal_approvals WHERE entity_type='OFFER_CANDIDATE' AND entity_id=? ORDER BY created_at DESC`).bind(id).all<any>();
  const changes = await c.env.DB.prepare(`SELECT * FROM deal_change_events WHERE offer_candidate_id=? ORDER BY detected_at DESC`).bind(id).all<any>();
  const missing = candidate.missing_fields ? JSON.parse(candidate.missing_fields) : [];

  const factRow = (label: string, value: any) => `<tr><td class="muted" style="padding:6px 8px 6px 0;white-space:nowrap;vertical-align:top">${esc(label)}</td><td style="padding:6px 0">${value != null && value !== '' ? esc(value) : '<span class="muted">missing</span>'}</td></tr>`;

  const fingerprintStale = candidate.source_fingerprint !== candidate.current_source_fingerprint;
  const decisionsBlock = ['WITHDRAWN', 'REJECTED', 'DISPUTED'].includes(candidate.review_status) ? `<p class="muted">This candidate is stopped (${esc(candidate.review_status)}) - no further action needed unless you want to re-open it via a fresh scan.</p>` : `
    <form method="POST" action="/admin/deals/candidates/${esc(id)}/approve" onsubmit="return confirm('Publish this offer? It will become publicly visible on /deals immediately.')">
      <legend>Approve for publication</legend>
      <label for="response_owner">Response owner (who handles enquiries)</label>
      <input id="response_owner" name="response_owner" required>
      <label for="fulfilment_operator">Fulfilment operator</label>
      <input id="fulfilment_operator" name="fulfilment_operator" value="${esc(candidate.seller_or_marketer || '')}" required>
      <label for="content_rights_status">Content rights</label>
      <select id="content_rights_status" name="content_rights_status" required><option value="">Select</option><option value="APPROVED">APPROVED</option></select>
      <label for="image_rights_status">Image rights</label>
      <select id="image_rights_status" name="image_rights_status"><option value="NO_IMAGE" selected>NO_IMAGE</option><option value="APPROVED">APPROVED</option></select>
      <label for="evidence_references">Evidence reference(s), one per line</label>
      <textarea id="evidence_references" name="evidence_references" required>${esc(candidate.source_url)}</textarea>
      <label for="reason">Reason</label>
      <textarea id="reason" name="reason" required></textarea>
      ${fingerprintStale ? '<p style="color:var(--danger);font-weight:700">Source content has changed since discovery - approval will be rejected until re-scanned.</p>' : ''}
      <div class="row"><button class="btn" type="submit">Approve &amp; publish</button></div>
    </form>
    <fieldset>
      <legend>Other decisions</legend>
      <div class="row">
        <form method="POST" action="/admin/deals/candidates/${esc(id)}/reject" onsubmit="return promptReason(this)"><input type="hidden" name="reason" value=""><button class="btn secondary" type="submit">Reject</button></form>
        <form method="POST" action="/admin/deals/candidates/${esc(id)}/dispute" onsubmit="return promptReason(this)"><input type="hidden" name="reason" value=""><button class="btn warn" type="submit">Mark disputed</button></form>
        <form method="POST" action="/admin/deals/candidates/${esc(id)}/withdraw" onsubmit="return promptReason(this)"><input type="hidden" name="reason" value=""><button class="btn danger" type="submit">Withdraw</button></form>
        <form method="POST" action="/admin/deals/candidates/${esc(id)}/request-more-evidence" onsubmit="return promptReason(this)"><input type="hidden" name="reason" value=""><button class="btn secondary" type="submit">Request more evidence</button></form>
      </div>
    </fieldset>`;

  return c.html(shell(`
    <p><a href="/admin/deals" class="muted">&larr; Back to queue</a></p>
    <div class="card">
      <div style="display:flex;justify-content:space-between"><h1 style="font-size:18px;margin:0">${esc(candidate.proposed_offer_name || '(no title)')}</h1><span class="badge review">${esc(candidate.review_status)}</span></div>
      <p class="muted">Source: <a href="${esc(candidate.source_url)}" target="_blank" rel="noopener">${esc(candidate.canonical_domain)}</a> (${esc(candidate.source_approval_status)}) · confidence ${candidate.extraction_confidence != null ? Math.round(candidate.extraction_confidence * 100) + '%' : 'n/a'}</p>
      ${missing.length ? `<p style="color:var(--warn)"><strong>Missing:</strong> ${missing.map(esc).join(', ')}</p>` : ''}
      ${fingerprintStale ? `<p style="color:var(--danger)"><strong>Source content has changed since this candidate was created.</strong></p>` : ''}
    </div>
    <div class="card"><h2 style="font-size:15px;margin:0 0 8px">Evidence</h2><table>
      ${factRow('Factual summary', candidate.factual_summary)}
      ${factRow('Category', candidate.category)}
      ${factRow('Fiji location', candidate.fiji_location)}
      ${factRow('Advertised price', candidate.advertised_price)}
      ${factRow('Reference price', candidate.reference_price)}
      ${factRow('Currency', candidate.currency)}
      ${factRow('Price basis', candidate.price_basis)}
      ${factRow('Explicit discount', candidate.explicit_discount)}
      ${factRow('Booking deadline', candidate.booking_deadline)}
      ${factRow('Travel window', [candidate.travel_from, candidate.travel_until].filter(Boolean).join(' → '))}
      ${factRow('Offer expires at', candidate.offer_expires_at)}
      ${factRow('Expiry status', candidate.expiry_status)}
      ${factRow('Inclusions', candidate.inclusions)}
      ${factRow('Exclusions', candidate.exclusions)}
      ${factRow('Cancellation terms', candidate.cancellation_terms)}
      ${factRow('Seller/marketer', candidate.seller_or_marketer)}
      ${factRow('Fulfilment operator', candidate.fulfilment_operator)}
      ${factRow('Contradictions', candidate.contradictions)}
      ${factRow('Duplicate of', candidate.duplicate_of_id)}
      ${factRow('Last checked', candidate.source_checked_at)}
    </table></div>
    <div class="card"><h2 style="font-size:15px;margin:0 0 8px">Decisions</h2>${decisionsBlock}</div>
    <div class="card"><h2 style="font-size:15px;margin:0 0 8px">Approval history (append-only)</h2>
      ${(approvals.results || []).map((a: any) => `<p class="muted" style="border-top:1px solid var(--line);padding-top:8px">${esc(a.created_at)} · <strong>${esc(a.approval_type)}</strong> by ${esc(a.actor_identity)} (${esc(a.actor_type)}) · ${esc(a.previous_status)} → ${esc(a.new_status)}<br>"${esc(a.reason)}"</p>`).join('') || '<p class="muted">No decisions recorded yet.</p>'}
    </div>
    <div class="card"><h2 style="font-size:15px;margin:0 0 8px">Change history</h2>
      ${(changes.results || []).map((e: any) => `<p class="muted">${esc(e.detected_at)} · ${esc(e.event_type)}: ${esc(e.old_value)} → ${esc(e.new_value)}</p>`).join('') || '<p class="muted">No material changes recorded.</p>'}
    </div>
    <script>function promptReason(f){var r=prompt('Reason (required):');if(!r)return false;f.reason.value=r;return true;}</script>
    `, { title: candidate.proposed_offer_name || 'Candidate' }));
});

// Decision form handlers - parse form-encoded bodies, perform the write, redirect back. Each
// mirrors the corresponding JSON API route in src/deals.ts exactly (same columns, same
// deal_approvals audit shape) - this is a presentation layer, not a second write path.
const auditWriteForm = (c: any, id: string, approvalType: string, actor: string, prev: string, next: string, reason: string, extra: any = {}) =>
  c.env.DB.prepare(
    `INSERT INTO deal_approvals (id, entity_type, entity_id, approval_type, actor_type, actor_identity, actor_authority, previous_status, new_status, reason, fields_approved, evidence_cited, source_fingerprint, decided_at, audit_metadata)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?)`
  ).bind(
    crypto.randomUUID(), 'OFFER_CANDIDATE', id, approvalType,
    'HUMAN', actor, 'Authenticated Vakaviti admin session',
    prev, next, reason,
    extra.fields_approved ? JSON.stringify(extra.fields_approved) : null,
    extra.evidence_cited ? JSON.stringify(extra.evidence_cited) : null,
    extra.source_fingerprint ?? null,
    extra.audit_metadata ? JSON.stringify(extra.audit_metadata) : null
  ).run();

dealsAdminUi.post('/candidates/:id/reject', async c => {
  const id = c.req.param('id');
  const body = await c.req.parseBody();
  const candidate = await c.env.DB.prepare(`SELECT review_status FROM deal_offer_candidates WHERE id=?`).bind(id).first<any>();
  if (candidate) {
    await c.env.DB.prepare(`UPDATE deal_offer_candidates SET review_status='REJECTED', updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id).run();
    await auditWriteForm(c, id, 'REJECTION', 'Admin (session)', candidate.review_status, 'REJECTED', String(body.reason || 'No reason given'));
  }
  return c.redirect(`/admin/deals/candidates/${id}`);
});

dealsAdminUi.post('/candidates/:id/dispute', async c => {
  const id = c.req.param('id');
  const body = await c.req.parseBody();
  const candidate = await c.env.DB.prepare(`SELECT review_status FROM deal_offer_candidates WHERE id=?`).bind(id).first<any>();
  if (candidate) {
    await c.env.DB.prepare(`UPDATE deal_offer_candidates SET review_status='DISPUTED', updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id).run();
    await auditWriteForm(c, id, 'QUARANTINE', 'Admin (session)', candidate.review_status, 'DISPUTED', String(body.reason || 'No reason given'));
  }
  return c.redirect(`/admin/deals/candidates/${id}`);
});

dealsAdminUi.post('/candidates/:id/withdraw', async c => {
  const id = c.req.param('id');
  const body = await c.req.parseBody();
  const candidate = await c.env.DB.prepare(`SELECT review_status FROM deal_offer_candidates WHERE id=?`).bind(id).first<any>();
  if (candidate) {
    await c.env.DB.prepare(`UPDATE deal_offer_candidates SET review_status='WITHDRAWN', updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id).run();
    await auditWriteForm(c, id, 'REJECTION', 'Admin (session)', candidate.review_status, 'WITHDRAWN', String(body.reason || 'No reason given'));
  }
  return c.redirect(`/admin/deals/candidates/${id}`);
});

dealsAdminUi.post('/candidates/:id/request-more-evidence', async c => {
  const id = c.req.param('id');
  const body = await c.req.parseBody();
  const candidate = await c.env.DB.prepare(`SELECT review_status FROM deal_offer_candidates WHERE id=?`).bind(id).first<any>();
  if (candidate) {
    await auditWriteForm(c, id, 'CORRECTION', 'Admin (session)', candidate.review_status, candidate.review_status, String(body.reason || 'No reason given'), { audit_metadata: { action: 'REQUEST_MORE_EVIDENCE' } });
  }
  return c.redirect(`/admin/deals/candidates/${id}`);
});

dealsAdminUi.post('/candidates/:id/approve', async c => {
  const id = c.req.param('id');
  const body = await c.req.parseBody();
  const responseOwner = String(body.response_owner || '').trim();
  const fulfilmentOperator = String(body.fulfilment_operator || '').trim();
  const contentRights = String(body.content_rights_status || '');
  const imageRights = String(body.image_rights_status || 'NO_IMAGE');
  const reason = String(body.reason || '').trim();
  const evidenceRefs = String(body.evidence_references || '').split('\n').map(s => s.trim()).filter(Boolean);

  const candidate = await c.env.DB.prepare(
    `SELECT c.*, s.source_approval_status, s.content_fingerprint AS current_source_fingerprint FROM deal_offer_candidates c JOIN deal_sources s ON c.source_id=s.id WHERE c.id=?`
  ).bind(id).first<any>();
  if (!candidate) return c.html(shell('<p>Not found.</p>'), 404);

  const problems: string[] = [];
  if (!responseOwner) problems.push('Response owner is required.');
  if (!fulfilmentOperator) problems.push('Fulfilment operator is required.');
  if (contentRights !== 'APPROVED') problems.push('Content rights must be APPROVED.');
  if (evidenceRefs.length === 0) problems.push('At least one evidence reference is required.');
  if (candidate.source_approval_status !== 'APPROVED') problems.push('Source is not currently approved.');
  if (candidate.source_fingerprint !== candidate.current_source_fingerprint) problems.push('Source content has changed since discovery - a fresh scan and review is required.');
  if (!candidate.seller_or_marketer) problems.push('Missing seller_or_marketer - correct this fact before approving (edit not yet available in this UI; use the API).');
  if (!candidate.factual_summary) problems.push('Missing factual_summary.');
  if (!candidate.category) problems.push('Missing category.');
  if (!candidate.fiji_location) problems.push('Missing fiji_location.');
  if (candidate.advertised_price && (!candidate.currency || !candidate.price_basis)) problems.push('Price is set but currency/price basis is missing.');

  if (problems.length > 0) {
    return c.html(shell(`<div class="card"><h1 style="font-size:16px;color:var(--danger)">Cannot approve - missing or contradictory facts</h1><ul>${problems.map(p => `<li>${esc(p)}</li>`).join('')}</ul><a class="btn secondary" href="/admin/deals/candidates/${esc(id)}">Back</a></div>`, { title: 'Approval blocked' }), 422);
  }

  const slug = candidate.slug || slugify(candidate.proposed_offer_name, id);

  await c.env.DB.prepare(
    `UPDATE deal_offer_candidates SET
       review_status='PUBLISHED', evidence_state='CURRENT', slug=COALESCE(slug, ?),
       human_review_approved_at=CURRENT_TIMESTAMP, human_review_approved_by=?,
       provider_approved_at=CURRENT_TIMESTAMP, provider_approved_by=?,
       publication_approved_at=CURRENT_TIMESTAMP, publication_approved_by=?,
       content_rights_status=?, image_rights_status=?, response_owner=?, fulfilment_operator=?,
       source_fingerprint_at_approval=?, updated_at=CURRENT_TIMESTAMP
     WHERE id=?`
  ).bind(slug, 'Admin (session)', 'Admin (session)', 'Admin (session)', contentRights, imageRights, responseOwner, fulfilmentOperator, candidate.source_fingerprint, id).run();

  await auditWriteForm(c, id, 'PUBLICATION_APPROVAL', 'Admin (session)', candidate.review_status, 'PUBLISHED', reason || 'Approved via admin review centre', { evidence_cited: evidenceRefs, source_fingerprint: candidate.source_fingerprint });
  return c.redirect(`/admin/deals/candidates/${id}`);
});
