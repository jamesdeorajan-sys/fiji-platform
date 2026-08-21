import { Hono } from 'hono';
import { promoteCandidateToDirectoryListing, type Bindings as ServiceBindings } from './candidates';
import { evaluateDirectoryListingGates } from './directory-gate';

// Vakaviti P1.3D - the Batch Review Console for AI-DISCOVERED PUBLIC DIRECTORY listings (Path A).
//
// AUTHORIZATION LAW: this file contains ZERO promotion logic of its own - every publish goes
// through promoteCandidateToDirectoryListing() in src/candidates.ts, which independently
// re-validates every gate, the standing policy, and duplicate/already-promoted state for EACH
// candidate on every call. A tampered or replayed candidate_ids list cannot bypass anything: the
// worst a malicious form submission can do is ask this service function to re-check a candidate
// that will then simply fail the same gates a legitimate request would have failed.
//
// Reuses the exact cookie-session auth, CSRF (stateless HMAC synchronizer token), and Origin/
// Referer pattern already proven in src/provider-onboarding-ui.ts and src/deals-admin-ui.ts - one
// login (at /admin/deals/login) serves all three consoles. `actor` is always the fixed literal
// 'CEO (batch review session)', never read from the submitted form, so a request can never claim
// a different actor than the authenticated session that made it.
//
// AI has no import path to this file (see regression-guards.mjs check 20). AI cannot select or
// submit an approval - only an authenticated human session reaching these routes can.
//
// Deal candidates (commercial offers) are deliberately NOT batch-approved from this console. The
// CEO directive's own DEAL DISCOVERY section keeps every P1.2 quality/injection/dedup gate in
// force, and commercial deal publication carries rights/price/availability risk that a factual
// directory listing does not - so deal review stays on the existing, individually-scrutinised
// queue at /admin/deals rather than gaining a second, looser bulk-approval surface here. This page
// only shows a live count with a link across, so a reviewer always knows both queues exist.

type Bindings = ServiceBindings;
export const batchReviewUi = new Hono<{ Bindings: Bindings }>();

const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const COOKIE_NAME = 'vakaviti_admin_session'; // same cookie namespace as deals-admin-ui.ts / provider-onboarding-ui.ts

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
async function csrfField(env: Bindings): Promise<string> {
  const nonce = crypto.randomUUID();
  const sig = await hmacHex(env.ADMIN_TOKEN || '', nonce);
  return `<input type="hidden" name="csrf_nonce" value="${esc(nonce)}"><input type="hidden" name="csrf_sig" value="${esc(sig)}">`;
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
<title>${esc(opts.title || 'Batch Review')} — Vakaviti Admin</title>
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
.btn.danger{background:var(--danger)}
.row{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.strip{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;font-size:13px}
.strip .pill{background:#fff;border:1px solid var(--line);border-radius:999px;padding:6px 12px}
.cand{border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:10px}
.cand.eligible{border-color:#a9d9c6}
.cand.blocked{background:#fbfbfa}
.cand h3{margin:0 0 4px;font-size:15px}
.chk-row{display:flex;align-items:flex-start;gap:10px;margin:8px 0 0;padding:10px;background:var(--bg);border-radius:8px;min-height:44px}
.chk-row input{width:26px;height:26px;flex-shrink:0;margin-top:1px}
.chk-row .lbl{font-size:14px;font-weight:600;cursor:pointer;display:block}
.gatelist{list-style:none;margin:8px 0 0;padding:0;font-size:12px}
.gatelist li{padding:2px 0}
.gatelist li.pass::before{content:"✓ ";color:var(--good)}
.gatelist li.fail::before{content:"✗ ";color:var(--danger)}
fieldset{border:1px solid var(--line);border-radius:10px;margin-top:14px;padding:12px}
legend{font-weight:700;font-size:13px;padding:0 6px}
label{display:block;font-size:12px;font-weight:700;margin:12px 0 4px}
textarea,select,input[type=text]{width:100%;padding:11px;border:1px solid var(--line);border-radius:8px;font-size:15px;min-height:44px}
textarea{min-height:70px}
.notice{background:#e9f5f0;border:1px solid #a9d9c6;border-radius:10px;padding:12px 14px;font-size:13px;margin-bottom:16px}
.notice.warn{background:#fff3d6;border-color:#e8c877}
a:focus-visible,button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
</style></head>
<body>
<header><a href="/admin/review">Batch Review</a><nav><a href="/admin/review">Directory Queue</a><a href="/admin/supply/sprint">Supply Sprint</a><a href="/admin/deals">Deal Intelligence</a><a href="/admin/providers">Providers</a></nav></header>
<main>${body}</main>
</body></html>`;

batchReviewUi.use('*', requireAdminSession);

// --- GET / - the directory-listing batch review queue --------------------------------------------
batchReviewUi.get('/', async c => {
  const db = c.env.DB;
  const locality = (c.req.query('locality') || '').trim();
  const category = (c.req.query('category') || '').trim();
  const sort = c.req.query('sort') === 'newest' ? 'newest' : 'score';

  const policy = await db.prepare(`SELECT id FROM standing_policies WHERE policy_name='AI_DISCOVERED_DIRECTORY_PUBLICATION' AND active=1 LIMIT 1`).first<any>();

  const rows = await db.prepare(
    `SELECT co.*, (SELECT COUNT(*) FROM product_candidates pcand WHERE pcand.operator_candidate_id = co.id) AS product_count
     FROM candidate_operators co
     WHERE co.workflow_state IN ('ENRICHED','QUALIFIED','SHORTLISTED')
       AND NOT EXISTS (
         SELECT 1 FROM review_actions ra WHERE ra.entity_type='CANDIDATE_OPERATOR' AND ra.entity_id=co.id
           AND ra.action_type IN ('PROMOTED_TO_OPERATOR','PROMOTED_TO_DIRECTORY_LISTING')
       )
     ORDER BY ${sort === 'newest' ? 'co.discovered_at DESC' : 'co.commercial_score DESC'}
     LIMIT 50`
  ).all<any>();

  let candidates = (rows.results || []) as any[];
  if (locality) candidates = candidates.filter(cd => `${cd.locality || ''} ${cd.region || ''}`.toLowerCase().includes(locality.toLowerCase()));
  if (category) candidates = candidates.filter(cd => (cd.categories_json || '').toLowerCase().includes(category.toLowerCase()));

  const withGates = candidates.map(cd => ({
    row: cd,
    gate: evaluateDirectoryListingGates({
      canonical_name: cd.canonical_name, website_url: cd.website_url, primary_url: cd.primary_url,
      locality: cd.locality, region: cd.region, duplicate_of_id: cd.duplicate_of_id,
      product_count: Number(cd.product_count || 0),
    }),
  }));
  const eligible = withGates.filter(x => x.gate.decision === 'ELIGIBLE');

  const dealsAwaiting = await db.prepare(
    `SELECT COUNT(*) n FROM deal_offer_candidates WHERE review_status IN ('NEEDS_HUMAN_REVIEW','MATERIAL_CHANGE_DETECTED','SOURCE_REVIEW_REQUIRED')`
  ).first<any>();

  const csrf = await csrfField(c.env);

  const policyBanner = policy
    ? ''
    : `<div class="notice warn"><strong>Standing publication policy is not active.</strong> No directory listing can be approved until an active AI_DISCOVERED_DIRECTORY_PUBLICATION row exists in standing_policies. This is a safety default, not an error - it fails closed.</div>`;

  const rowsHtml = withGates.map(({ row, gate }) => {
    const isEligible = gate.decision === 'ELIGIBLE';
    const domain = row.website_url || row.primary_url || '';
    const gateList = [...gate.passedGates.map((g: string) => `<li class="pass">${esc(g)}</li>`), ...gate.failedGates.map((g: string) => `<li class="fail">${esc(g)}</li>`)].join('');
    return `<div class="cand ${isEligible ? 'eligible' : 'blocked'}">
      <span class="badge ${isEligible ? 'good' : 'warn'}">${isEligible ? 'ELIGIBLE' : 'NOT ELIGIBLE'}</span>
      <h3>${esc(row.canonical_name)}</h3>
      <p class="muted">${esc([row.locality, row.region].filter(Boolean).join(', ') || 'No locality on file')} &middot; ${esc(domain || 'no domain on file')} &middot; ${Number(row.product_count || 0)} product(s)</p>
      <ul class="gatelist">${gateList}</ul>
      ${isEligible ? `<div class="chk-row"><input type="checkbox" id="c_${esc(row.id)}" name="candidate_ids" value="${esc(row.id)}"><label for="c_${esc(row.id)}" class="lbl">Select for approval</label></div>` : ''}
    </div>`;
  }).join('') || '<div class="card"><p class="muted">No directory-listing candidates are currently in ENRICHED/QUALIFIED/SHORTLISTED state.</p></div>';

  return c.html(shell(`
    <h1 style="font-size:19px;margin:0 0 4px">AI-discovered directory listings</h1>
    <p class="muted" style="margin:0 0 14px">Factual profiles only - never a partnership or verification claim. Every approval is independently re-checked against the 9 deterministic gates at the moment of publish.</p>
    <div class="strip">
      <span class="pill"><b>${withGates.length}</b> shown</span>
      <span class="pill"><b>${eligible.length}</b> eligible now</span>
      <span class="pill"><a href="/admin/deals" style="color:inherit;text-decoration:none"><b>${dealsAwaiting?.n ?? 0}</b> deal candidates awaiting review &rarr;</a></span>
    </div>
    ${policyBanner}
    <form method="GET" action="/admin/review" class="card">
      <div class="row">
        <div style="flex:1;min-width:140px"><label for="locality">Locality/region contains</label><input type="text" id="locality" name="locality" value="${esc(locality)}"></div>
        <div style="flex:1;min-width:140px"><label for="category">Category contains</label><input type="text" id="category" name="category" value="${esc(category)}"></div>
        <div style="flex:1;min-width:140px"><label for="sort">Sort</label><select id="sort" name="sort"><option value="score" ${sort === 'score' ? 'selected' : ''}>Highest launch value</option><option value="newest" ${sort === 'newest' ? 'selected' : ''}>Newest discovered</option></select></div>
      </div>
      <div class="row"><button class="btn secondary" type="submit">Filter</button></div>
    </form>

    <form method="POST" action="/admin/review/directory/approve">
      ${csrf}
      ${rowsHtml}
      ${eligible.length ? `<div class="row"><button class="btn" type="submit" ${policy ? '' : 'disabled'}>Approve selected</button></div>` : ''}
    </form>

    ${eligible.length ? `<div class="card">
      <form method="POST" action="/admin/review/directory/approve">
        ${csrf}
        ${eligible.map(x => `<input type="hidden" name="candidate_ids" value="${esc(x.row.id)}">`).join('')}
        <div class="chk-row"><input type="checkbox" id="confirm_all" name="confirm_all" value="1" required>
          <label for="confirm_all" class="lbl">I confirm I want to approve all ${eligible.length} eligible listings shown above</label></div>
        <div class="row"><button class="btn" type="submit" ${policy ? '' : 'disabled'}>Approve all ${eligible.length} eligible</button></div>
      </form>
    </div>` : ''}

    <div class="card">
      <form method="POST" action="/admin/review/directory/reject">
        ${csrf}
        <p class="muted" style="margin:0 0 8px">Reject candidates shown above (they will not be reconsidered without a fresh review). Select by ID:</p>
        <label for="reject_ids">Candidate IDs to reject (comma-separated)</label>
        <input type="text" id="reject_ids" name="candidate_ids" placeholder="paste one or more candidate IDs">
        <label for="reject_reason">Reason</label>
        <textarea id="reject_reason" name="reason" maxlength="500" required></textarea>
        <div class="row"><button class="btn danger" type="submit">Reject selected</button></div>
      </form>
    </div>
  `, { title: 'Batch review' }));
});

function normalizeIds(body: any): string[] {
  const raw = body['candidate_ids'];
  if (Array.isArray(raw)) return raw.map((s: any) => String(s).trim()).filter(Boolean);
  if (typeof raw === 'string') return raw.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}

// --- POST /directory/approve - each candidate is independently re-validated inside
// promoteCandidateToDirectoryListing(); this handler never assumes the submitted list is safe on
// its own. actor is fixed, never read from the form. -----------------------------------------------
batchReviewUi.post('/directory/approve', async c => {
  if (!originAllowed(c)) return c.html(shell('<div class="card"><p>Request blocked: origin check failed.</p></div>', { title: 'Blocked' }), 403);
  const body = await c.req.parseBody({ all: true });
  const nonce = String(body.csrf_nonce || '');
  const sig = String(body.csrf_sig || '');
  if (!(await csrfValid(c.env, nonce, sig))) {
    return c.html(shell('<div class="card"><p>This form has expired or failed a security check. Please go back and try again.</p><a class="btn secondary" href="/admin/review">Back to review</a></div>', { title: 'Form expired' }), 403);
  }
  const ids = normalizeIds(body);
  if (!ids.length) return c.html(shell('<div class="card"><p>No candidates were selected.</p><a class="btn secondary" href="/admin/review">Back to review</a></div>', { title: 'Nothing selected' }), 422);

  const actor = 'CEO (batch review session)';
  const results: { id: string; ok: boolean; detail: string }[] = [];
  for (const id of ids) {
    try {
      const r = await promoteCandidateToDirectoryListing(c.env, id, actor);
      results.push(r.ok
        ? { id, ok: true, detail: r.published ? `Published (slug: ${r.slug})` : `Created privately - no contact route yet (slug: ${r.slug})` }
        : { id, ok: false, detail: r.error });
    } catch (e: any) {
      results.push({ id, ok: false, detail: `unexpected_error: ${String(e?.message || e)}` });
    }
  }
  const approved = results.filter(r => r.ok).length;
  const rowsHtml = results.map(r => `<li><span class="badge ${r.ok ? 'good' : 'danger'}">${r.ok ? 'OK' : 'SKIPPED'}</span> ${esc(r.id)} - ${esc(r.detail)}</li>`).join('');
  return c.html(shell(`<div class="card">
    <h1 style="font-size:18px;margin:0 0 8px">Batch approval result</h1>
    <p>${approved} of ${results.length} candidate(s) were promoted. Each decision has its own audit record in review_actions. A "SKIPPED" result means that candidate failed independent re-validation at the moment of publish (already promoted, gate no longer passing, or policy inactive) - it was not silently approved.</p>
    <ul class="gatelist" style="font-size:13px">${rowsHtml}</ul>
    <div class="row"><a class="btn secondary" href="/admin/review">Back to review</a></div>
  </div>`, { title: 'Approval result' }));
});

// --- POST /directory/reject ------------------------------------------------------------------------
batchReviewUi.post('/directory/reject', async c => {
  if (!originAllowed(c)) return c.html(shell('<div class="card"><p>Request blocked: origin check failed.</p></div>', { title: 'Blocked' }), 403);
  const body = await c.req.parseBody();
  const nonce = String(body.csrf_nonce || '');
  const sig = String(body.csrf_sig || '');
  if (!(await csrfValid(c.env, nonce, sig))) {
    return c.html(shell('<div class="card"><p>This form has expired or failed a security check. Please go back and try again.</p><a class="btn secondary" href="/admin/review">Back to review</a></div>', { title: 'Form expired' }), 403);
  }
  const ids = String(body.candidate_ids || '').split(',').map(s => s.trim()).filter(Boolean);
  const reason = String(body.reason || '').trim();
  if (!ids.length || !reason) return c.html(shell('<div class="card"><p>Candidate ID(s) and a reason are both required.</p><a class="btn secondary" href="/admin/review">Back to review</a></div>', { title: 'Missing information' }), 422);

  const actor = 'CEO (batch review session)';
  let rejected = 0;
  for (const id of ids) {
    const before = await c.env.DB.prepare(`SELECT * FROM candidate_operators WHERE id=?`).bind(id).first<any>();
    if (!before) continue;
    await c.env.DB.prepare(`UPDATE candidate_operators SET workflow_state='REJECTED', reviewed_at=CURRENT_TIMESTAMP, reviewed_by=? WHERE id=?`).bind(actor, id).run();
    await c.env.DB.prepare(`INSERT INTO review_actions(id,entity_type,entity_id,action_type,actor,note,before_json,after_json) VALUES(?,?,?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(), 'CANDIDATE_OPERATOR', id, 'DIRECTORY_REJECTED', actor, reason, JSON.stringify(before), JSON.stringify({ workflow_state: 'REJECTED' })).run();
    rejected++;
  }
  return c.html(shell(`<div class="card"><p>${rejected} of ${ids.length} candidate(s) rejected.</p><div class="row"><a class="btn secondary" href="/admin/review">Back to review</a></div></div>`, { title: 'Rejected' }));
});
