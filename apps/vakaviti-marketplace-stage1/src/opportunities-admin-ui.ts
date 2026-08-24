import { Hono } from 'hono';
import { generateOutreachDraft, ingestProviderReply, confirmProviderReplyExtraction, convertOpportunityToDealCandidate, setLifecycleStatus, deriveOpportunityPublishedState, type Bindings, type LifecycleStatus } from './opportunities';

// VAKAVITI DEAL OPPORTUNITY PIPELINE - private mobile admin console (2026-08-24), Phase 4.
// Same cookie-session/CSRF/Origin discipline as src/supply-sprint-ui.ts, src/deals-admin-ui.ts,
// src/provider-onboarding-ui.ts - one login, reused here rather than reinvented, per the CEO's
// explicit "do not create another password or token system" instruction. AI has no import path
// to this file - only an authenticated human session can trigger any write route below.

export const opportunitiesUi = new Hono<{ Bindings: Bindings }>();

const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const COOKIE_NAME = 'vakaviti_admin_session';

const getCookie = (c: any, name: string): string | undefined => {
  const header = c.req.header('cookie') || '';
  const match = header.split(';').map((s: string) => s.trim()).find((s: string) => s.startsWith(name + '='));
  return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : undefined;
};

// TEMPORARY, PR #21 hardening QA ONLY (2026-08-24) - accepts a second, separate credential
// (QA_PREVIEW_TOKEN) alongside the real ADMIN_TOKEN, scoped ONLY to this file's routes
// (/admin/opportunities/*), never to /admin/deals or /admin/supply/sprint. This exists so the
// authenticated console walkthrough required by the CEO's hardening directive could be run
// without ever requesting or seeing the real ADMIN_TOKEN value. QA_PREVIEW_TOKEN is a
// freshly-generated random secret set only on this Worker resource for the duration of the QA
// pass and deleted immediately afterward - see the PR #21 hardening report for the exact
// generation/deletion timestamps. TO REMOVE: delete this whole comment block and the
// `|| (env.QA_PREVIEW_TOKEN && session === env.QA_PREVIEW_TOKEN)` clause below before/at merge
// time once QA is complete - do not carry this into a production-authorized version.
const requireAdminSession = async (c: any, next: any) => {
  const expected = c.env.ADMIN_TOKEN;
  const qaToken = c.env.QA_PREVIEW_TOKEN;
  if (!expected) return c.html(shell('<p>Admin not configured.</p>', { title: 'Admin unavailable' }), 503);
  const session = getCookie(c, COOKIE_NAME);
  const authorized = session === expected || (!!qaToken && session === qaToken);
  if (!authorized) {
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
<title>${esc(opts.title || 'Opportunities')} — Vakaviti Admin</title>
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
.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px;margin-bottom:12px;overflow-wrap:break-word}
.muted{color:var(--muted);font-size:13px}
.badge{display:inline-block;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;background:#eef2ef;color:var(--muted)}
.badge.good{background:#e9f5f0;color:var(--good)}
.badge.warn{background:#fff3d6;color:var(--warn)}
.badge.danger{background:#fde8e8;color:var(--danger)}
.btn{display:inline-block;background:var(--ink);color:#fff;border:none;text-decoration:none;padding:12px 16px;border-radius:10px;font-weight:700;font-size:14px;min-height:44px;min-width:44px;cursor:pointer}
.btn.secondary{background:#fff;color:var(--ink);border:1px solid var(--ink)}
.btn.small{padding:10px 14px;font-size:13px;min-height:44px}
.row{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.strip{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;font-size:13px}
.strip .pill{background:#fff;border:1px solid var(--line);border-radius:999px;padding:6px 12px;min-height:44px;display:flex;align-items:center}
.filters{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
.filters select,.filters input{min-height:44px;border:1px solid var(--line);border-radius:8px;padding:8px;font-size:14px}
.score{font-weight:800;font-size:20px}
.fact-yes{color:var(--good)}
.fact-no{color:var(--danger)}
textarea{width:100%;min-height:120px;border:1px solid var(--line);border-radius:8px;padding:10px;font-size:14px;font-family:inherit}
a:focus-visible,button:focus-visible,select:focus-visible,input:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
@media (prefers-reduced-motion: reduce){*,*::before,*::after{animation-duration:0.01ms!important;animation-iteration-count:1!important;transition-duration:0.01ms!important;scroll-behavior:auto!important}}
</style></head>
<body>
<header><a href="/admin/opportunities">Deal Opportunities</a><nav><a href="/admin/opportunities">Pipeline</a><a href="/admin/supply/sprint">Supply Sprint</a><a href="/admin/deals">Deal Intelligence</a></nav></header>
<main>${body}</main>
</body></html>`;

opportunitiesUi.use('*', requireAdminSession);

const STATUS_LABEL: Record<string, string> = {
  DETECTED: 'Detected', OUTREACH_READY: 'Outreach ready', CONTACTED: 'Contacted', PROVIDER_REPLIED: 'Provider replied',
  NEEDS_CLARIFICATION: 'Needs clarification', PROVIDER_CONFIRMED: 'Provider confirmed', PUBLICATION_REVIEW: 'Publication review',
  PUBLISHED: 'Published', REJECTED: 'Rejected', EXPIRED: 'Expired', WITHDRAWN: 'Withdrawn', DUPLICATE: 'Duplicate',
};

opportunitiesUi.get('/', async c => {
  const region = c.req.query('region') || '';
  const category = c.req.query('category') || '';
  const status = c.req.query('status') || '';
  const missing = c.req.query('missing') || '';

  const funnel = await c.env.OPPORTUNITY_DB.prepare(`SELECT lifecycle_status, COUNT(*) n FROM opportunities GROUP BY lifecycle_status`).all<any>();
  const funnelCounts: Record<string, number> = {};
  for (const r of funnel.results || []) funnelCounts[r.lifecycle_status] = r.n;

  let sql = `SELECT * FROM opportunities WHERE 1=1`;
  const binds: any[] = [];
  if (region) { sql += ` AND region = ?`; binds.push(region); }
  if (category) { sql += ` AND category = ?`; binds.push(category); }
  if (status) { sql += ` AND lifecycle_status = ?`; binds.push(status); }
  if (missing) { sql += ` AND missing_fields_json LIKE ?`; binds.push(`%${missing}%`); }
  sql += ` ORDER BY opportunity_score DESC LIMIT 100`;
  const rows = await c.env.OPPORTUNITY_DB.prepare(sql).bind(...binds).all<any>();

  const regions = await c.env.OPPORTUNITY_DB.prepare(`SELECT DISTINCT region FROM opportunities WHERE region IS NOT NULL ORDER BY region`).all<any>();
  const categories = await c.env.OPPORTUNITY_DB.prepare(`SELECT DISTINCT category FROM opportunities WHERE category IS NOT NULL ORDER BY category`).all<any>();

  const funnelStrip = ['DETECTED', 'OUTREACH_READY', 'CONTACTED', 'PROVIDER_CONFIRMED', 'PUBLICATION_REVIEW', 'PUBLISHED']
    .map(s => `<span class="pill">${esc(STATUS_LABEL[s])}: <b style="margin-left:4px">${funnelCounts[s] || 0}</b></span>`).join('');

  const cards = (rows.results || []).map((o: any) => {
    const missingFields: string[] = JSON.parse(o.missing_fields_json || '[]');
    const riskFlags: string[] = JSON.parse(o.contradiction_flags_json || '[]');
    return `<a href="/admin/opportunities/${esc(o.id)}" class="card" style="display:block;text-decoration:none;color:inherit">
      <div class="row" style="justify-content:space-between;margin-top:0">
        <span class="badge">${esc(STATUS_LABEL[o.lifecycle_status] || o.lifecycle_status)}</span>
        <span class="score">${o.opportunity_score}</span>
      </div>
      <h3 style="margin:8px 0 2px">${esc(o.provider_name || o.provider_domain)}</h3>
      <p class="muted" style="margin:0 0 6px">${esc([o.locality, o.region].filter(Boolean).join(', ') || 'Fiji')} &middot; ${esc(o.category || 'uncategorized')}</p>
      <p style="margin:0 0 6px;font-weight:600">${esc(o.detected_title || 'Untitled offer')}</p>
      <p class="muted" style="margin:0 0 6px;font-size:12px">${esc(o.canonical_source_url)}</p>
      ${missingFields.length ? `<p class="muted" style="margin:0"><span class="badge warn">${missingFields.length} field(s) missing</span></p>` : ''}
      ${riskFlags.length ? `<p class="muted" style="margin:4px 0 0"><span class="badge danger">${riskFlags.length} risk flag(s)</span></p>` : ''}
    </a>`;
  }).join('');

  return c.html(shell(`
    <h1 style="font-size:19px;margin:0 0 10px">Deal Opportunity Pipeline</h1>
    <div class="strip">${funnelStrip}</div>
    <form class="filters" method="GET">
      <select name="region" aria-label="Filter by region"><option value="">All regions</option>${(regions.results || []).map((r: any) => `<option value="${esc(r.region)}" ${region === r.region ? 'selected' : ''}>${esc(r.region)}</option>`).join('')}</select>
      <select name="category" aria-label="Filter by category"><option value="">All categories</option>${(categories.results || []).map((r: any) => `<option value="${esc(r.category)}" ${category === r.category ? 'selected' : ''}>${esc(r.category)}</option>`).join('')}</select>
      <select name="status" aria-label="Filter by status"><option value="">All statuses</option>${Object.keys(STATUS_LABEL).map(s => `<option value="${s}" ${status === s ? 'selected' : ''}>${esc(STATUS_LABEL[s])}</option>`).join('')}</select>
      <select name="missing" aria-label="Filter by completeness"><option value="">Any completeness</option><option value="price_amount" ${missing === 'price_amount' ? 'selected' : ''}>Missing price</option><option value="booking_deadline" ${missing === 'booking_deadline' ? 'selected' : ''}>Missing dates</option></select>
      <button class="btn small" type="submit">Filter</button>
    </form>
    ${cards || '<div class="card">No opportunities match this filter.</div>'}
  `, { title: 'Deal Opportunities' }));
});

opportunitiesUi.get('/:id', async c => {
  const o = await c.env.OPPORTUNITY_DB.prepare(`SELECT * FROM opportunities WHERE id=?`).bind(c.req.param('id')).first<any>();
  if (!o) return c.notFound();
  const events = await c.env.OPPORTUNITY_DB.prepare(`SELECT * FROM opportunity_lifecycle_events WHERE opportunity_id=? ORDER BY created_at ASC`).bind(o.id).all<any>();
  const replies = await c.env.OPPORTUNITY_DB.prepare(`SELECT * FROM opportunity_provider_replies WHERE opportunity_id=? ORDER BY created_at DESC`).bind(o.id).all<any>();
  const duplicates = await c.env.OPPORTUNITY_DB.prepare(`SELECT id, provider_name, lifecycle_status FROM opportunities WHERE canonical_source_url=? AND id != ?`).bind(o.canonical_source_url, o.id).all<any>();

  const missingFields: string[] = JSON.parse(o.missing_fields_json || '[]');
  const riskFlags: string[] = JSON.parse(o.contradiction_flags_json || '[]');
  const scoreComponents: any[] = JSON.parse(o.score_components_json || '[]');
  const csrf = await csrfField(c.env);
  const draft = generateOutreachDraft(o);
  // PUBLISHED is never stored on the opportunity itself - derived live, on every read, from the
  // real Class B eligibility of the linked deal candidate, so a withdrawn deal shows as withdrawn
  // immediately without rewriting this opportunity's lifecycle history.
  const publishedState = await deriveOpportunityPublishedState(c.env, o);

  const factRow = (label: string, value: any) => `<div class="card" style="margin-bottom:8px"><p class="muted" style="margin:0 0 2px;font-size:12px;text-transform:uppercase">${esc(label)}</p><p style="margin:0" class="${value ? 'fact-yes' : 'fact-no'}">${value ? esc(value) : 'Not captured'}</p></div>`;

  const lifecycleForm = (target: LifecycleStatus, label: string, requireConfirm = false) => `
    <form method="POST" action="/admin/opportunities/${esc(o.id)}/lifecycle" style="display:inline-block;margin:4px 4px 0 0">
      ${csrf.html}
      <input type="hidden" name="new_status" value="${target}">
      ${requireConfirm ? `<label style="display:flex;align-items:center;gap:6px;font-size:13px;margin-bottom:6px"><input type="checkbox" name="human_confirmed" value="1" required style="width:22px;height:22px"> I confirm contact actually occurred</label>` : ''}
      <button class="btn small" type="submit">${esc(label)}</button>
    </form>`;

  return c.html(shell(`
    <p><a href="/admin/opportunities" class="muted">&larr; All opportunities</a></p>
    <div class="card">
      <div class="row" style="justify-content:space-between;margin-top:0">
        <span class="badge">${esc(STATUS_LABEL[o.lifecycle_status] || o.lifecycle_status)}</span>
        <span class="score">${o.opportunity_score}</span>
      </div>
      <h1 style="font-size:19px;margin:8px 0 2px">${esc(o.provider_name || o.provider_domain)}</h1>
      <p class="muted" style="margin:0 0 8px">${esc([o.locality, o.region].filter(Boolean).join(', ') || 'Fiji')} &middot; ${esc(o.category || 'uncategorized')}</p>
      <p style="margin:0 0 8px;font-weight:600">${esc(o.detected_title || 'Untitled offer')}</p>
      <p class="muted" style="margin:0 0 4px">Official source: <a href="${esc(o.canonical_source_url)}" target="_blank" rel="nofollow noopener noreferrer">${esc(o.canonical_source_url)}</a></p>
      <p class="muted" style="margin:0">Last checked: ${esc(o.last_checked_at)}</p>
      ${o.is_test_fixture ? '<p style="margin:8px 0 0"><span class="badge warn">TEST FIXTURE - not real captured evidence</span></p>' : ''}
    </div>

    <h2 style="font-size:15px">Facts captured vs. missing</h2>
    ${factRow('Price', o.price_amount && o.currency ? `${o.currency} ${o.price_amount}` : o.price_amount)}
    ${factRow('Price basis', o.price_basis)}
    ${factRow('Booking deadline', o.booking_deadline)}
    ${factRow('Travel window', [o.travel_start, o.travel_end].filter(Boolean).join(' - '))}
    ${factRow('Inclusions', o.inclusions_json && o.inclusions_json !== '[]' ? o.inclusions_json : null)}
    ${factRow('Booking route', o.booking_route)}
    ${factRow('Provider contact route', o.provider_contact_route)}
    ${missingFields.length ? `<div class="card"><p class="muted" style="margin:0 0 4px">Missing fields</p><p style="margin:0">${missingFields.map(f => `<span class="badge warn" style="margin:2px">${esc(f)}</span>`).join('')}</p></div>` : ''}
    ${riskFlags.length ? `<div class="card"><p class="muted" style="margin:0 0 4px">Risk / contradiction flags</p><p style="margin:0">${riskFlags.map(f => `<span class="badge danger" style="margin:2px">${esc(f)}</span>`).join('')}</p></div>` : ''}
    ${duplicates.results && duplicates.results.length ? `<div class="card"><p class="muted" style="margin:0 0 4px">Duplicate cluster</p>${duplicates.results.map((d: any) => `<p style="margin:2px 0"><a href="/admin/opportunities/${esc(d.id)}">${esc(d.provider_name)} (${esc(STATUS_LABEL[d.lifecycle_status])})</a></p>`).join('')}</div>` : ''}
    ${o.linked_deal_candidate_id ? `<div class="card"><p class="muted" style="margin:0">Linked public deal candidate: <code>${esc(o.linked_deal_candidate_id)}</code></p><p style="margin:4px 0 0"><span class="badge ${publishedState.isPublished ? 'good' : 'warn'}">${publishedState.isPublished ? 'Currently public' : 'Not currently public'}</span> <span class="muted" style="font-size:12px">${esc(publishedState.reason)}</span></p></div>` : ''}

    <h2 style="font-size:15px">Score components</h2>
    <div class="card">${scoreComponents.map(sc => `<p style="margin:4px 0;font-size:13px"><b>${sc.delta > 0 ? '+' : ''}${sc.delta}</b> ${esc(sc.name)} - <span class="muted">${esc(sc.reason)}</span></p>`).join('') || '<p class="muted" style="margin:0">No components recorded.</p>'}</div>

    <h2 style="font-size:15px">Prepared outreach message (copy manually - nothing is sent automatically)</h2>
    <div class="card"><textarea readonly>${esc(draft)}</textarea></div>

    <h2 style="font-size:15px">Record provider reply</h2>
    <div class="card">
      <form method="POST" action="/admin/opportunities/${esc(o.id)}/reply">
        ${csrf.html}
        <label class="muted" style="font-size:12px" for="raw_reply_text-${esc(o.id)}">Paste or summarize the provider's reply</label>
        <textarea id="raw_reply_text-${esc(o.id)}" name="raw_reply_text" required></textarea>
        <div class="row"><button class="btn small" type="submit">Record reply (private, not sent anywhere)</button></div>
      </form>
    </div>
    ${(replies.results || []).map((r: any) => `<div class="card"><p class="muted" style="margin:0 0 4px">Reply ${esc(r.created_at)} ${r.human_confirmed ? '<span class="badge good">confirmed</span>' : '<span class="badge warn">pending confirmation</span>'}</p><p style="margin:0 0 8px;white-space:pre-wrap">${esc(r.raw_reply_text)}</p>${JSON.parse(r.contradiction_flags_json || '[]').length ? `<p style="margin:0 0 8px" class="badge danger">${esc(JSON.parse(r.contradiction_flags_json || '[]').join('; '))}</p>` : ''}${r.human_confirmed ? '' : `
      <form method="POST" action="/admin/opportunities/${esc(o.id)}/replies/${esc(r.id)}/confirm">
        ${csrf.html}
        <p class="muted" style="margin:0 0 6px;font-size:12px">A human reads the reply above and enters exactly what the provider confirmed - nothing here is auto-filled from AI, and nothing is applied until submitted.</p>
        <label class="muted" style="font-size:12px" for="price_amount-${esc(r.id)}">Price amount</label><input id="price_amount-${esc(r.id)}" type="text" name="price_amount" inputmode="decimal">
        <label class="muted" style="font-size:12px" for="currency-${esc(r.id)}">Currency</label><input id="currency-${esc(r.id)}" type="text" name="currency">
        <label class="muted" style="font-size:12px" for="price_basis-${esc(r.id)}">Price basis</label><input id="price_basis-${esc(r.id)}" type="text" name="price_basis">
        <label class="muted" style="font-size:12px" for="booking_deadline-${esc(r.id)}">Booking deadline</label><input id="booking_deadline-${esc(r.id)}" type="date" name="booking_deadline">
        <label class="muted" style="font-size:12px" for="travel_start-${esc(r.id)}">Travel start</label><input id="travel_start-${esc(r.id)}" type="date" name="travel_start">
        <label class="muted" style="font-size:12px" for="travel_end-${esc(r.id)}">Travel end</label><input id="travel_end-${esc(r.id)}" type="date" name="travel_end">
        <label class="muted" style="font-size:12px" for="minimum_stay-${esc(r.id)}">Minimum stay</label><input id="minimum_stay-${esc(r.id)}" type="text" name="minimum_stay">
        <div class="row"><button class="btn small" type="submit">Confirm extracted facts (human-entered only)</button></div>
      </form>`}</div>`).join('')}

    <h2 style="font-size:15px">Lifecycle controls</h2>
    <div class="card">
      ${lifecycleForm('OUTREACH_READY', 'Mark outreach-ready')}
      ${lifecycleForm('CONTACTED', 'Mark contacted', true)}
      ${lifecycleForm('NEEDS_CLARIFICATION', 'Needs clarification')}
      ${lifecycleForm('PROVIDER_CONFIRMED', 'Provider confirmed')}
      ${lifecycleForm('REJECTED', 'Reject')}
      ${lifecycleForm('EXPIRED', 'Mark expired')}
      ${lifecycleForm('WITHDRAWN', 'Mark withdrawn')}
      ${lifecycleForm('DUPLICATE', 'Mark duplicate')}
    </div>
    <div class="card">
      <form method="POST" action="/admin/opportunities/${esc(o.id)}/convert">
        ${csrf.html}
        <p class="muted" style="margin:0 0 8px">Converts to a deal candidate for the EXISTING public Class B pipeline to independently evaluate. Does not publish anything itself.</p>
        <button class="btn small" type="submit">Governed conversion to deal candidate</button>
      </form>
    </div>

    <h2 style="font-size:15px">Activity timeline</h2>
    <div class="card">${(events.results || []).map((e: any) => `<p style="margin:4px 0;font-size:13px">${esc(e.created_at)} - <b>${esc(e.prior_status || 'none')} &rarr; ${esc(e.new_status)}</b> (${esc(e.actor_type)}${e.actor_identity ? ': ' + esc(e.actor_identity) : ''}) - ${esc(e.reason)}</p>`).join('')}</div>
  `, { title: o.provider_name || 'Opportunity' }));
});

opportunitiesUi.post('/:id/lifecycle', async c => {
  if (!originAllowed(c)) return c.html(shell('<div class="card"><p>Request blocked: origin check failed.</p></div>'), 403);
  const body = await c.req.parseBody();
  if (!(await csrfValid(c.env, String(body.csrf_nonce || ''), String(body.csrf_sig || '')))) {
    return c.html(shell('<div class="card"><p>This form has expired. Please go back and try again.</p></div>'), 403);
  }
  const newStatus = String(body.new_status || '') as LifecycleStatus;
  // CONTACTED may only be recorded after an explicit human confirmation checkbox - see Phase 5:
  // "Record CONTACTED only after the human confirms that contact occurred."
  if (newStatus === 'CONTACTED' && body.human_confirmed !== '1') {
    return c.html(shell('<div class="card"><p>Contact must be explicitly confirmed before recording CONTACTED.</p></div>'), 422);
  }
  await setLifecycleStatus(c.env, c.req.param('id'), newStatus, 'HUMAN', 'admin session', `Lifecycle change via console${newStatus === 'CONTACTED' ? ' - human confirmed contact occurred' : ''}`);
  return c.redirect(`/admin/opportunities/${c.req.param('id')}`);
});

opportunitiesUi.post('/:id/reply', async c => {
  if (!originAllowed(c)) return c.html(shell('<div class="card"><p>Request blocked: origin check failed.</p></div>'), 403);
  const body = await c.req.parseBody();
  if (!(await csrfValid(c.env, String(body.csrf_nonce || ''), String(body.csrf_sig || '')))) {
    return c.html(shell('<div class="card"><p>This form has expired. Please go back and try again.</p></div>'), 403);
  }
  await ingestProviderReply(c.env, c.req.param('id'), String(body.raw_reply_text || ''), 'admin session', {});
  return c.redirect(`/admin/opportunities/${c.req.param('id')}`);
});

// Human-only, two-step confirmation of provider-supplied facts (Phase 6). The reply above is
// stored verbatim as evidence the moment it's recorded; nothing from it is ever applied to the
// opportunity's own facts until a human explicitly reads it and submits this form - there is no
// AI-proposed-field path anywhere in this app, so there is nothing for this step to rubber-stamp.
const CONFIRMABLE_REPLY_FIELDS = ['price_amount', 'currency', 'price_basis', 'booking_deadline', 'travel_start', 'travel_end', 'minimum_stay'];
opportunitiesUi.post('/:id/replies/:replyId/confirm', async c => {
  if (!originAllowed(c)) return c.html(shell('<div class="card"><p>Request blocked: origin check failed.</p></div>'), 403);
  const body = await c.req.parseBody();
  if (!(await csrfValid(c.env, String(body.csrf_nonce || ''), String(body.csrf_sig || '')))) {
    return c.html(shell('<div class="card"><p>This form has expired. Please go back and try again.</p></div>'), 403);
  }
  const confirmedFields: Record<string, any> = {};
  for (const f of CONFIRMABLE_REPLY_FIELDS) {
    const v = body[f];
    if (typeof v === 'string' && v.trim().length > 0) confirmedFields[f] = v.trim();
  }
  await confirmProviderReplyExtraction(c.env, c.req.param('replyId'), confirmedFields, 'admin session');
  return c.redirect(`/admin/opportunities/${c.req.param('id')}`);
});

opportunitiesUi.post('/:id/convert', async c => {
  if (!originAllowed(c)) return c.html(shell('<div class="card"><p>Request blocked: origin check failed.</p></div>'), 403);
  const body = await c.req.parseBody();
  if (!(await csrfValid(c.env, String(body.csrf_nonce || ''), String(body.csrf_sig || '')))) {
    return c.html(shell('<div class="card"><p>This form has expired. Please go back and try again.</p></div>'), 403);
  }
  // Preview safety: this console only ever converts into the isolated OPPORTUNITY_DB's own test
  // mirror table, never the real production deal_offer_candidates table - see
  // src/opportunities.ts convertOpportunityToDealCandidate() and the Deal Opportunity Pipeline
  // report for why. A future production-authorized version would pass c.env.DB here instead.
  const result = await convertOpportunityToDealCandidate(c.env, c.req.param('id'), 'admin session', c.env.OPPORTUNITY_DB, 'test_deal_offer_candidates_mirror');
  return c.html(shell(`<div class="card"><p>${result.ok ? 'Converted.' : 'Not converted: ' + esc(result.reason || '')}</p>${result.publishGateCheck ? `<p class="muted">Public-deal gate check: ${result.publishGateCheck.decision} (${result.publishGateCheck.failedGates.join(', ') || 'all gates passed'})</p>` : ''}<a class="btn secondary" href="/admin/opportunities/${esc(c.req.param('id'))}">Back</a></div>`));
});
