import { Hono } from 'hono';
import { createCeoConfirmation, revokeCeoConfirmation, type Bindings as ServiceBindings } from './provider-onboarding';
import { isPubliclyEligible } from './deals';

// Vakaviti P1.3C - the CEO Provider Onboarding Console. Removes the operational dependency on
// this session possessing ADMIN_TOKEN: James signs in through the browser (the SAME cookie
// session already used at /admin/deals - vakaviti_admin_session, HttpOnly/Secure/SameSite=Strict,
// value is the token itself, compared to env.ADMIN_TOKEN server-side) and can activate a
// CEO-confirmed provider without any code path ever reading or transmitting ADMIN_TOKEN itself.
//
// AUTHORIZATION LAW: this file contains ZERO business logic of its own for creating or revoking
// a confirmation - every write goes through createCeoConfirmation()/revokeCeoConfirmation() in
// src/provider-onboarding.ts, the exact same functions the Bearer-token JSON API calls. There is
// one governed service, two front doors. `actor` is always the fixed string
// 'CEO (admin session)' - never read from the submitted form - so a request can never claim to
// be a different actor than the session that made it.
//
// AI has no import path to this file (see regression-guards.mjs check 18).

type Bindings = ServiceBindings;
export const providerOnboardingUi = new Hono<{ Bindings: Bindings }>();

const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const COOKIE_NAME = 'vakaviti_admin_session'; // same cookie namespace as deals-admin-ui.ts - one login, both consoles

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

// --- CSRF: a stateless synchronizer token, HMAC-signed with ADMIN_TOKEN as the key. ADMIN_TOKEN
// itself is never transmitted anywhere by this - it is used only as a local signing key inside
// the Worker, the same way it's already compared (never sent) for the session cookie check. Every
// GET that renders a mutating form embeds a fresh nonce+signature pair; every POST recomputes the
// signature server-side and rejects on any mismatch, proving the form was issued by this server
// for this request, independent of and in addition to the SameSite=Strict cookie protection. -----
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

// --- Origin/Referer enforcement for browser mutations - fails closed if neither header is
// present and valid, which a genuine same-origin form POST always sends. -------------------------
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
<title>${esc(opts.title || 'Provider Onboarding')} — Vakaviti Admin</title>
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
table{width:100%;border-collapse:collapse;font-size:13px}
table td,table th{padding:8px 6px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
.tbl-wrap{overflow-x:auto}
label{display:block;font-size:12px;font-weight:700;margin:12px 0 4px}
input[type=text],input[type=date],textarea,select{width:100%;padding:11px;border:1px solid var(--line);border-radius:8px;font-size:15px;min-height:44px}
textarea{min-height:70px}
.chk-row{display:flex;align-items:flex-start;gap:10px;margin:12px 0;padding:12px 10px;background:var(--bg);border-radius:8px;min-height:44px}
.chk-row input{width:26px;height:26px;flex-shrink:0;margin-top:1px}
.chk-row .lbl{font-size:14px;font-weight:600;cursor:pointer;display:block;min-height:24px}
.chk-row .hint{font-size:12px;color:var(--muted);margin-top:2px}
.field-grid{display:grid;grid-template-columns:1fr;gap:0}
@media (min-width:600px){.field-grid{grid-template-columns:1fr 1fr;gap:0 16px}}
fieldset{border:1px solid var(--line);border-radius:10px;margin-top:14px;padding:12px}
legend{font-weight:700;font-size:13px;padding:0 6px}
.notice{background:#e9f5f0;border:1px solid #a9d9c6;border-radius:10px;padding:12px 14px;font-size:13px;margin-bottom:16px}
.mono{font-family:"SF Mono",Consolas,monospace;font-size:12px;word-break:break-all}
.notice ul{margin:6px 0 0;padding-left:18px}
a:focus-visible,button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
</style></head>
<body>
<header><a href="/admin/providers">Provider Onboarding</a><nav><a href="/admin/providers">Providers</a><a href="/admin/providers/onboard">+ Onboard</a><a href="/admin/review">Batch Review</a><a href="/admin/deals">Deal Intelligence</a></nav></header>
<main>${body}</main>
<script>function confirmRevoke(f){var r=prompt('Type a short reason for revoking this authorization:');if(!r)return false;f.reason.value=r;return confirm('Revoke pilot authorization? This immediately removes the provider from public view.');}</script>
</body></html>`;

providerOnboardingUi.use('*', requireAdminSession);

// --- GET /onboard - the mobile-first CEO confirmation form ---------------------------------------
providerOnboardingUi.get('/onboard', async c => {
  const csrf = await csrfField(c.env);
  return c.html(shell(`
    <p><a href="/admin/providers" class="muted">&larr; Providers</a></p>
    <div class="notice">
      <strong>Before you submit:</strong>
      <ul>
        <li><b>Pilot Partner is not Vakaviti Verified.</b> Verification is a separate, later, evidence-backed decision - this form never grants it.</li>
        <li>Claiming their own profile is optional for the provider and is never shown publicly either way.</li>
        <li>Our AI prepares information from their official site - it cannot approve verification or invent commercial facts (price, dates, inclusions).</li>
        <li>Any current deal found still needs supported facts and a human review before it can go live - nothing publishes automatically.</li>
      </ul>
    </div>
    <div class="card">
      <h1 style="font-size:19px;margin:0 0 12px">Onboard a CEO-confirmed provider</h1>
      <form method="POST" action="/admin/providers/onboard">
        ${csrf}
        <div class="field-grid">
          <div><label for="canonical_provider_name">Canonical provider name</label><input id="canonical_provider_name" name="canonical_provider_name" type="text" maxlength="200" required></div>
          <div><label for="official_domain">Official website / domain</label><input id="official_domain" name="official_domain" type="text" maxlength="253" placeholder="www.example.com.fj" required></div>
        </div>
        <div class="field-grid">
          <div><label for="date_spoken">Date you spoke with them</label><input id="date_spoken" name="date_spoken" type="date" required></div>
          <div><label for="provider_contact_name">Provider contact name or role (optional)</label><input id="provider_contact_name" name="provider_contact_name" type="text" maxlength="200"></div>
        </div>

        <div class="chk-row"><input type="checkbox" id="participation_confirmed" name="participation_confirmed" value="1" required>
          <div><label for="participation_confirmed" class="lbl" style="margin:0">Provider agreed to participate</label><div class="hint">You personally spoke with them and they agreed to join the Vakaviti pilot.</div></div></div>

        <div class="chk-row"><input type="checkbox" id="website_content_may_be_used" name="website_content_may_be_used" value="1">
          <div><label for="website_content_may_be_used" class="lbl" style="margin:0">May use their official website to prepare the profile/products</label></div></div>

        <div class="chk-row"><input type="checkbox" id="official_deals_may_be_prepared" name="official_deals_may_be_prepared" value="1">
          <div><label for="official_deals_may_be_prepared" class="lbl" style="margin:0">May prepare official current deals for human review</label><div class="hint">Nothing publishes without a separate human approval.</div></div></div>

        <div class="chk-row"><input type="checkbox" id="images_may_be_displayed" name="images_may_be_displayed" value="1">
          <div><label for="images_may_be_displayed" class="lbl" style="margin:0">May display provider-supplied or separately authorized images</label><div class="hint">This never means Vakaviti may assume rights to arbitrary images found on their site.</div></div></div>

        <label for="initial_enquiry_handler">Initial enquiry handler</label>
        <select id="initial_enquiry_handler" name="initial_enquiry_handler">
          <option value="VAKAVITI" selected>Vakaviti (enquiries route to Vakaviti first)</option>
          <option value="PROVIDER">Provider (recorded for reference)</option>
        </select>

        <label for="notes">Notes / limitations (optional)</label>
        <textarea id="notes" name="notes" maxlength="2000"></textarea>

        <fieldset>
          <legend>Final authorization</legend>
          <div class="chk-row"><input type="checkbox" id="final_authorization" name="final_authorization" value="1" required>
            <div><label for="final_authorization" class="lbl" style="margin:0">I am the CEO and this is my authorization to activate this provider's pilot fast-track under the scope selected above</label></div></div>
        </fieldset>

        <div class="row"><button class="btn" type="submit" style="width:100%">Activate provider</button></div>
      </form>
    </div>`, { title: 'Onboard a provider' }));
});

// --- POST /onboard - validates session (middleware), Origin, CSRF, then calls the ONE governed
// service function. actor is fixed here, never read from the form. -------------------------------
providerOnboardingUi.post('/onboard', async c => {
  if (!originAllowed(c)) return c.html(shell('<div class="card"><p>Request blocked: origin check failed.</p></div>', { title: 'Blocked' }), 403);

  const body = await c.req.parseBody();
  const nonce = String(body.csrf_nonce || '');
  const sig = String(body.csrf_sig || '');
  if (!(await csrfValid(c.env, nonce, sig))) {
    return c.html(shell('<div class="card"><p>This form has expired or failed a security check. Please go back and try again.</p><a class="btn secondary" href="/admin/providers/onboard">Back to form</a></div>', { title: 'Form expired' }), 403);
  }
  if (body.final_authorization !== '1') {
    return c.html(shell('<div class="card"><p>Final authorization checkbox is required.</p><a class="btn secondary" href="/admin/providers/onboard">Back to form</a></div>', { title: 'Missing authorization' }), 422);
  }

  const result = await createCeoConfirmation(c.env, {
    canonicalProviderName: String(body.canonical_provider_name || ''),
    officialDomain: String(body.official_domain || ''),
    dateSpoken: String(body.date_spoken || ''),
    providerContactName: body.provider_contact_name ? String(body.provider_contact_name) : undefined,
    providerContactRole: body.provider_contact_role ? String(body.provider_contact_role) : undefined,
    websiteContentMayBeUsed: body.website_content_may_be_used === '1',
    officialDealsMayBePrepared: body.official_deals_may_be_prepared === '1',
    imagesMayBeDisplayed: body.images_may_be_displayed === '1',
    notes: body.notes ? String(body.notes) : undefined,
    initialEnquiryHandler: body.initial_enquiry_handler === 'PROVIDER' ? 'PROVIDER' : 'VAKAVITI',
    reason: 'CEO-confirmed pilot partner onboarding (admin console)',
  }, 'CEO (admin session)'); // actor is fixed by this authenticated session - never taken from the form

  if (!result.ok) {
    const friendly: Record<string, string> = {
      missing_required_confirmation_fields: 'Please fill in the provider name, domain, and date spoken.',
      invalid_official_domain: 'That doesn\'t look like a valid domain - check for typos.',
      duplicate_provider_confirmation: 'This domain is already CEO-confirmed for another active pilot record.',
      ambiguous_identity_existing_operator: 'A Vakaviti operator already exists with a matching website - resolve this manually before proceeding.',
      ambiguous_identity_existing_candidate: 'A discovery candidate already exists with a matching website - resolve this manually before proceeding.',
      ambiguous_identity_existing_deal_source: 'A Deal Intelligence source already exists for this domain - resolve this manually before proceeding.',
    };
    return c.html(shell(`<div class="card"><p>${esc(friendly[result.error] || 'This provider could not be onboarded.')}</p><a class="btn secondary" href="/admin/providers/onboard">Back to form</a></div>`, { title: 'Could not onboard' }), result.status as any);
  }

  return c.redirect(`/admin/providers/${result.confirmationId}`);
});

// --- GET / - the provider list, linked to supply-dashboard-style per-row status --------------------
providerOnboardingUi.get('/', async c => {
  const rows = await c.env.DB.prepare(
    `SELECT pc.*, o.slug AS operator_slug, o.commercial_status AS operator_commercial_status,
            o.description AS operator_description, o.locality, o.whatsapp, o.phone, o.email
     FROM provider_ceo_confirmations pc LEFT JOIN operators o ON o.id = pc.operator_id
     ORDER BY pc.created_at DESC LIMIT 100`
  ).all<any>();

  const cards = await Promise.all((rows.results || []).map(async (r: any) => {
    const productCount = await c.env.DB.prepare(`SELECT COUNT(*) n FROM products WHERE operator_id=?`).bind(r.operator_id || '').first<any>();
    const dealSourceRow = await c.env.DB.prepare(`SELECT id, last_scan_at FROM deal_sources WHERE canonical_domain=?`).bind(r.canonical_domain).first<any>();
    let dealCandidateCount = 0, liveDealCount = 0;
    if (dealSourceRow) {
      const dealRows = await c.env.DB.prepare(
        `SELECT c.*, s.source_approval_status, s.content_fingerprint AS current_source_fingerprint FROM deal_offer_candidates c JOIN deal_sources s ON c.source_id=s.id WHERE c.source_id=?`
      ).bind(dealSourceRow.id).all<any>();
      dealCandidateCount = (dealRows.results || []).length;
      liveDealCount = (dealRows.results || []).filter(isPubliclyEligible).length;
    }
    const enquiryCount = r.operator_id ? (await c.env.DB.prepare(`SELECT COUNT(*) n FROM enquiries WHERE operator_id=?`).bind(r.operator_id).first<any>())?.n ?? 0 : 0;
    const missingCount = [r.operator_description, r.locality, (r.whatsapp || r.phone || r.email)].filter(v => !v).length;

    const revoked = !!r.revoked_at;
    const publicStatus = revoked ? 'Revoked' : r.operator_commercial_status === 'ACTIVE' ? 'Live' : r.operator_id ? 'Prepared, not published' : 'Preparing';
    const attention: string[] = [];
    if (!revoked && r.operator_id && r.operator_commercial_status !== 'ACTIVE') attention.push('Missing enquiry contact - not yet publishable');
    if (!revoked && dealCandidateCount > 0 && liveDealCount === 0) attention.push('Deal candidate awaiting team review');
    if (revoked) attention.push('Authorization revoked');

    return `<div class="card">
      <div style="display:flex;justify-content:space-between;gap:8px"><strong>${esc(r.canonical_provider_name)}</strong><span class="badge ${revoked ? 'danger' : r.operator_commercial_status === 'ACTIVE' ? 'good' : 'warn'}">${esc(publicStatus)}</span></div>
      <p class="muted" style="margin:4px 0">${esc(r.canonical_domain)} &middot; confirmed ${esc(r.created_at)}</p>
      <p class="muted">${productCount?.n ?? 0} product(s) &middot; ${dealCandidateCount} deal candidate(s) &middot; ${liveDealCount} live deal(s) &middot; ${missingCount} field(s) missing &middot; ${enquiryCount} enquir${enquiryCount === 1 ? 'y' : 'ies'} &middot; last checked ${esc(dealSourceRow?.last_scan_at || 'n/a')}</p>
      ${attention.length ? `<p style="color:var(--warn);font-size:13px;margin:6px 0 0">${attention.map(esc).join(' &middot; ')}</p>` : ''}
      <div class="row"><a class="btn secondary" href="/admin/providers/${esc(r.id)}">View</a>${r.operator_slug && r.operator_commercial_status === 'ACTIVE' ? `<a class="btn secondary" href="/operators/${esc(r.operator_slug)}" target="_blank" rel="noopener">Public profile</a>` : ''}</div>
    </div>`;
  }));

  return c.html(shell(`
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:12px">
      <h1 style="font-size:19px;margin:0">CEO-confirmed providers</h1>
      <a class="btn" href="/admin/providers/onboard">+ Onboard</a>
    </div>
    ${cards.join('') || '<div class="card"><p class="muted">No providers onboarded yet.</p></div>'}
  `, { title: 'Providers' }));
});

// --- GET /:id - result/detail page ----------------------------------------------------------------
providerOnboardingUi.get('/:id', async c => {
  const id = c.req.param('id');
  const r = await c.env.DB.prepare(`SELECT * FROM provider_ceo_confirmations WHERE id=?`).bind(id).first<any>();
  if (!r) return c.html(shell('<p>Not found.</p>'), 404);

  const operator = r.operator_id ? await c.env.DB.prepare(`SELECT * FROM operators WHERE id=?`).bind(r.operator_id).first<any>() : null;
  const products = r.operator_id ? await c.env.DB.prepare(`SELECT id, canonical_name, category, commercial_status FROM products WHERE operator_id=?`).bind(r.operator_id).all<any>() : { results: [] };
  const dealSourceRow = await c.env.DB.prepare(`SELECT id FROM deal_sources WHERE canonical_domain=?`).bind(r.canonical_domain).first<any>();
  let dealCandidates: any[] = [];
  if (dealSourceRow) {
    const dr = await c.env.DB.prepare(`SELECT id, proposed_offer_name, review_status, missing_fields FROM deal_offer_candidates WHERE source_id=?`).bind(dealSourceRow.id).all<any>();
    dealCandidates = dr.results || [];
  }
  let summary: any = {};
  try { summary = JSON.parse(r.onboarding_summary_json || '{}'); } catch { summary = {}; }

  const revoked = !!r.revoked_at;
  const publicEligible = !!(operator && operator.commercial_status === 'ACTIVE');
  const publicUrl = publicEligible ? `/operators/${operator.slug}` : null;
  const missing: string[] = [];
  if (!operator?.description) missing.push('description');
  if (!operator?.locality) missing.push('locality');
  if (!(operator?.whatsapp || operator?.phone || operator?.email)) missing.push('enquiry contact');

  return c.html(shell(`
    <p><a href="/admin/providers" class="muted">&larr; Providers</a></p>
    <div class="card">
      <div style="display:flex;justify-content:space-between;gap:8px"><h1 style="font-size:19px;margin:0">${esc(r.canonical_provider_name)}</h1><span class="badge ${revoked ? 'danger' : publicEligible ? 'good' : 'warn'}">${revoked ? 'Revoked' : publicEligible ? 'Live' : 'Not yet published'}</span></div>
      <table style="margin-top:10px">
        <tr><td class="muted">Confirmation ID</td><td class="mono">${esc(r.id)}</td></tr>
        <tr><td class="muted">Official domain</td><td>${esc(r.canonical_domain)}</td></tr>
        <tr><td class="muted">Date spoken</td><td>${esc(r.date_spoken)}</td></tr>
        <tr><td class="muted">Scope</td><td>${r.scope_website_content_allowed ? 'Website ✓' : 'Website ✗'} &middot; ${r.scope_deals_allowed ? 'Deals ✓' : 'Deals ✗'} &middot; ${r.scope_images_allowed ? 'Images ✓' : 'Images ✗'}</td></tr>
        <tr><td class="muted">Initial enquiry handler</td><td>${esc(r.initial_enquiry_handler)}</td></tr>
        <tr><td class="muted">Identity result</td><td>${operator ? `Operator created (${esc(operator.verification_status)}, ${esc(operator.claim_status)} internally - never shown publicly)` : 'Not yet created'}</td></tr>
        <tr><td class="muted">Profile status</td><td>${operator?.description ? 'Description prepared' : 'No description extracted yet'}</td></tr>
        <tr><td class="muted">Products prepared</td><td>${(products.results || []).length}</td></tr>
        <tr><td class="muted">Deal candidates</td><td>${dealCandidates.length}</td></tr>
        <tr><td class="muted">Missing facts</td><td>${missing.length ? missing.map(esc).join(', ') : 'None blocking publication'}</td></tr>
        <tr><td class="muted">Public eligibility</td><td>${publicEligible ? 'Yes' : 'No'}</td></tr>
        <tr><td class="muted">Public URL</td><td>${publicUrl ? `<a href="${esc(publicUrl)}" target="_blank" rel="noopener">${esc(publicUrl)}</a>` : 'Not yet published'}</td></tr>
      </table>
    </div>
    <div class="card"><h2 style="font-size:15px;margin:0 0 8px">Products</h2>
      ${(products.results || []).map((p: any) => `<p class="muted">${esc(p.canonical_name)} (${esc(p.category)}) - ${esc(p.commercial_status)}</p>`).join('') || '<p class="muted">None yet.</p>'}
    </div>
    <div class="card"><h2 style="font-size:15px;margin:0 0 8px">Deal candidates</h2>
      ${dealCandidates.map((d: any) => `<p class="muted">${esc(d.proposed_offer_name || '(no title extracted)')} - ${esc(d.review_status)}</p>`).join('') || '<p class="muted">None yet.</p>'}
      ${dealCandidates.length ? `<div class="row"><a class="btn secondary" href="/admin/deals">Review deal candidates</a></div>` : ''}
    </div>
    ${!revoked ? `<div class="card"><h2 style="font-size:15px;margin:0 0 8px">Revoke pilot authorization</h2><p class="muted">Immediately removes this provider from public view. Requires a separate confirmation.</p>
      <form method="POST" action="/admin/providers/${esc(id)}/revoke" onsubmit="return confirmRevoke(this)">
        ${await csrfField(c.env)}
        <input type="hidden" name="reason" value="">
        <button class="btn danger" type="submit">Revoke authorization</button>
      </form></div>` : `<div class="card"><p class="muted">Revoked ${esc(r.revoked_at)} by ${esc(r.revoked_by)}: ${esc(r.revocation_reason)}</p></div>`}
    `, { title: r.canonical_provider_name }));
});

// --- POST /:id/revoke - separate confirmation step, same governed service ------------------------
providerOnboardingUi.post('/:id/revoke', async c => {
  if (!originAllowed(c)) return c.html(shell('<div class="card"><p>Request blocked: origin check failed.</p></div>', { title: 'Blocked' }), 403);
  const id = c.req.param('id');
  const body = await c.req.parseBody();
  const nonce = String(body.csrf_nonce || '');
  const sig = String(body.csrf_sig || '');
  if (!(await csrfValid(c.env, nonce, sig))) {
    return c.html(shell('<div class="card"><p>This action expired or failed a security check.</p><a class="btn secondary" href="/admin/providers/' + esc(id) + '">Back</a></div>', { title: 'Expired' }), 403);
  }
  const reason = String(body.reason || '').trim();
  const result = await revokeCeoConfirmation(c.env, id, reason, 'CEO (admin session)');
  if (!result.ok) {
    return c.html(shell(`<div class="card"><p>Could not revoke: ${esc(result.error)}</p><a class="btn secondary" href="/admin/providers/${esc(id)}">Back</a></div>`, { title: 'Could not revoke' }), result.status as any);
  }
  return c.redirect(`/admin/providers/${id}`);
});
