import { Hono } from 'hono';
import { candidates } from './candidates';
import { enrichCandidate, providerCopilot, createHumanGate } from './ai';

type Bindings = { DB: D1Database; AI: Ai; ENVIRONMENT: string; ADMIN_TOKEN?: string };
const app = new Hono<{ Bindings: Bindings }>();

const html = (body: string, title = 'Vakaviti Verified Fiji Network') => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>
body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#f6f8f7;color:#12231b}header,main{max-width:1080px;margin:auto;padding:24px}header{display:flex;justify-content:space-between;align-items:center}.hero{padding:64px 0 32px}.hero h1{font-size:clamp(2.4rem,7vw,5rem);line-height:.95;max-width:850px;margin:0 0 20px}.muted{color:#607068}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}.card{background:white;border:1px solid #dde5e0;border-radius:18px;padding:20px}.badge{display:inline-block;border:1px solid #b7c8be;border-radius:999px;padding:5px 9px;font-size:12px}.btn{display:inline-block;background:#12231b;color:white;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:700}.btn.secondary{background:white;color:#12231b;border:1px solid #12231b}input,textarea{width:100%;padding:12px;border:1px solid #ccd7d1;border-radius:10px;box-sizing:border-box;margin:6px 0 14px}footer{max-width:1080px;margin:40px auto;padding:24px;color:#607068}
</style></head><body><header><strong>Vakaviti Verified Fiji Network</strong><nav><a href="/operators">Operators</a> &nbsp; <a href="/partners">Partners</a></nav></header><main>${body}</main><footer>Stage 1 preview — public discovery does not equal Vakaviti verification.</footer></body></html>`;

const requireAdmin = (c: any) => {
  const expected = c.env.ADMIN_TOKEN;
  if (!expected) return c.json({ error: 'admin_api_not_configured' }, 503);
  const auth = c.req.header('authorization') || '';
  if (auth !== `Bearer ${expected}`) return c.json({ error: 'unauthorized' }, 401);
  return null;
};

app.get('/', c => c.html(html(`<section class="hero"><span class="badge">Stage 1</span><h1>Book Fiji. Know who you're booking with.</h1><p class="muted">A verified inventory, distribution and fulfilment network for Fiji tours, activities and ground transport.</p><p><a class="btn" href="/operators">Explore operators</a> <a class="btn secondary" href="/partners">Become a Founding Partner</a></p></section>`)));

app.get('/partners', c => c.html(html(`<section class="hero"><span class="badge">Founding Partner Program</span><h1>Keep running your Fiji business. We help bring the bookings.</h1><p class="muted">No setup fee for selected founding partners. No monthly fee during the founding program. We prepare your public profile and products, you verify the facts, and eligible partners can receive distribution across the Vakaviti network.</p><div class="grid"><div class="card"><h3>We do the setup</h3><p>AI-assisted product structuring, profile preparation and missing-information checklist.</p></div><div class="card"><h3>You control the truth</h3><p>Prices, availability, policies and identity only become verified after evidence and confirmation.</p></div><div class="card"><h3>We earn when you earn</h3><p>Commercial activation is transaction-led rather than forcing a software subscription.</p></div></div><h2>Claim or add your business</h2><form method="post" action="/api/partner-interest"><label>Business name</label><input name="business" required><label>Your name</label><input name="name" required><label>Phone / WhatsApp</label><input name="phone" required><label>Email</label><input name="email" type="email"><label>Website or Facebook page</label><input name="url"><button class="btn" type="submit">Start my profile</button></form></section>`, 'Become a Vakaviti Founding Partner')));

app.get('/operators', async c => {
  const rows = await c.env.DB.prepare(`SELECT id,canonical_name,slug,locality,region,claim_status,verification_status FROM operators ORDER BY canonical_name LIMIT 100`).all<any>();
  const cards = (rows.results || []).map(o => `<article class="card"><span class="badge">${o.verification_status === 'VAKAVITI_VERIFIED' ? '✓ Vakaviti Verified' : o.claim_status === 'CLAIMED' ? 'Claimed profile' : 'Publicly listed · unclaimed'}</span><h3>${o.canonical_name}</h3><p class="muted">${[o.locality,o.region].filter(Boolean).join(', ') || 'Fiji'}</p><a href="/operators/${o.slug}">View profile</a></article>`).join('');
  return c.html(html(`<section class="hero"><span class="badge">Fiji Operator Graph</span><h1>Fiji tourism operators, structured in one place.</h1><p class="muted">Publicly listed means we found public evidence the operator exists. It does not mean identity, licences, prices, availability or products have been verified by Vakaviti.</p></section><section class="grid">${cards || '<div class="card">No operators imported yet. Candidate collection is the next stage.</div>'}</section>`, 'Fiji Tourism Operators'));
});

app.get('/operators/:slug', async c => {
  const o = await c.env.DB.prepare(`SELECT * FROM operators WHERE slug=?`).bind(c.req.param('slug')).first<any>();
  if (!o) return c.notFound();
  const products = await c.env.DB.prepare(`SELECT id,canonical_name,category,verification_status FROM products WHERE operator_id=? ORDER BY canonical_name`).bind(o.id).all<any>();
  const status = o.verification_status === 'VAKAVITI_VERIFIED' ? '✓ Vakaviti Verified' : o.claim_status === 'CLAIMED' ? 'Profile claimed — verification in progress' : 'Publicly listed — information not yet verified by Vakaviti';
  const list = (products.results || []).map(p => `<div class="card"><h3>${p.canonical_name}</h3><p>${p.category}</p><span class="badge">${p.verification_status}</span></div>`).join('');
  return c.html(html(`<section class="hero"><span class="badge">${status}</span><h1>${o.canonical_name}</h1><p class="muted">${[o.locality,o.region].filter(Boolean).join(', ')}</p>${o.claim_status !== 'CLAIMED' ? `<p><a class="btn" href="/claim/${o.slug}">Claim this business</a></p>`:''}</section><h2>Products</h2><section class="grid">${list || '<div class="card">No verified products yet.</div>'}</section>`, o.canonical_name)));
});

app.get('/claim/:slug', async c => {
  const o = await c.env.DB.prepare(`SELECT id,canonical_name,slug FROM operators WHERE slug=?`).bind(c.req.param('slug')).first<any>();
  if (!o) return c.notFound();
  return c.html(html(`<section class="hero"><span class="badge">Business claim</span><h1>Claim ${o.canonical_name}</h1><p class="muted">Claiming a profile does not automatically create Vakaviti Verified status. Verification happens separately.</p><form method="post" action="/api/claim"><input type="hidden" name="operator_id" value="${o.id}"><label>Your name</label><input name="name" required><label>Email</label><input name="email" type="email"><label>Phone / WhatsApp</label><input name="phone" required><button class="btn" type="submit">Submit claim</button></form></section>`)));
});

app.post('/api/claim', async c => {
  const body = await c.req.parseBody();
  const id = crypto.randomUUID();
  await c.env.DB.prepare(`INSERT INTO claims(id,operator_id,claimant_name,claimant_email,claimant_phone,channel) VALUES(?,?,?,?,?,'WEB')`).bind(id,String(body.operator_id),String(body.name||''),String(body.email||''),String(body.phone||'')).run();
  const sessionId = crypto.randomUUID();
  await c.env.DB.prepare(`INSERT INTO provider_copilot_sessions(id,operator_id,claimant_phone,claimant_email) VALUES(?,?,?,?)`).bind(sessionId,String(body.operator_id),String(body.phone||''),String(body.email||'')).run();
  return c.html(html(`<section class="hero"><h1>Claim received.</h1><p>Reference: ${id}</p><p class="muted">We have opened an onboarding copilot session so we can ask only for missing information. The profile remains unverified until evidence review is completed.</p><a class="btn" href="/operators">Back to operators</a></section>`));
});

app.post('/api/partner-interest', async c => {
  const body = await c.req.parseBody();
  const id = crypto.randomUUID();
  await c.env.DB.prepare(`INSERT INTO evidence(id,entity_type,entity_id,field_name,source_type,source_url,observed_value,evidence_status,confidence) VALUES(?,?,?,?,?,?,?,?,?)`).bind(id,'PARTNER_LEAD',id,'interest','SELF_SUBMITTED',String(body.url||''),JSON.stringify(body),'CANDIDATE',1).run();
  return c.html(html(`<section class="hero"><h1>Founding Partner interest received.</h1><p>Reference: ${id}</p><p class="muted">Next step is AI-assisted candidate enrichment and verification, not automatic publication.</p><a class="btn" href="/">Return home</a></section>`));
});

app.post('/api/admin/ai/enrich-candidate', async c => {
  const denied = requireAdmin(c); if (denied) return denied;
  const body = await c.req.json<any>();
  if (!body?.candidate_id || !body?.canonical_name || !body?.source_text) return c.json({ error: 'candidate_id_canonical_name_source_text_required' }, 400);
  const result = await enrichCandidate(c.env, {
    candidate_id: String(body.candidate_id),
    canonical_name: String(body.canonical_name),
    source_text: String(body.source_text),
    source_url: body.source_url ? String(body.source_url) : undefined
  });
  return c.json(result);
});

app.post('/api/admin/ai/provider-copilot', async c => {
  const denied = requireAdmin(c); if (denied) return denied;
  const body = await c.req.json<any>();
  if (!body?.session_id || !body?.operator_name || !body?.provider_message) return c.json({ error: 'session_id_operator_name_provider_message_required' }, 400);
  const result = await providerCopilot(c.env, {
    session_id: String(body.session_id),
    operator_name: String(body.operator_name),
    current_step: String(body.current_step || 'IDENTITY'),
    verified_context: body.verified_context || {},
    candidate_context: body.candidate_context || {},
    provider_message: String(body.provider_message)
  });
  const outputText = JSON.stringify(result.output);
  if (outputText.includes('"needs_human_gate":true')) {
    await createHumanGate(c.env, { gate_type:'PROVIDER_COPILOT_EXCEPTION', entity_type:'PROVIDER_SESSION', entity_id:String(body.session_id), reason:'AI identified a trust/legal/money/verification boundary requiring human review.', evidence:result.output });
  }
  return c.json(result);
});

app.get('/api/admin/human-gates', async c => {
  const denied = requireAdmin(c); if (denied) return denied;
  const rows = await c.env.DB.prepare(`SELECT * FROM human_gates WHERE status='PENDING' ORDER BY created_at ASC LIMIT 100`).all<any>();
  return c.json({ results: rows.results || [] });
});

app.route('/api/admin/candidates', candidates);
app.get('/api/health', c => c.json({ ok:true, service:'vakaviti-marketplace-stage1', environment:c.env.ENVIRONMENT, ai:true }));

export default app;