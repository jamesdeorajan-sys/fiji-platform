import { Hono } from 'hono';

type Bindings = { DB: D1Database; ENVIRONMENT: string };
const app = new Hono<{ Bindings: Bindings }>();

const html = (body: string, title = 'Vakaviti Verified Fiji Network') => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>
body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#f6f8f7;color:#12231b}header,main{max-width:1080px;margin:auto;padding:24px}header{display:flex;justify-content:space-between;align-items:center}.hero{padding:64px 0 32px}.hero h1{font-size:clamp(2.4rem,7vw,5rem);line-height:.95;max-width:850px;margin:0 0 20px}.muted{color:#607068}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}.card{background:white;border:1px solid #dde5e0;border-radius:18px;padding:20px}.badge{display:inline-block;border:1px solid #b7c8be;border-radius:999px;padding:5px 9px;font-size:12px}.btn{display:inline-block;background:#12231b;color:white;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:700}.btn.secondary{background:white;color:#12231b;border:1px solid #12231b}input,textarea{width:100%;padding:12px;border:1px solid #ccd7d1;border-radius:10px;box-sizing:border-box;margin:6px 0 14px}footer{max-width:1080px;margin:40px auto;padding:24px;color:#607068}
</style></head><body><header><strong>Vakaviti Verified Fiji Network</strong><nav><a href="/operators">Operators</a> &nbsp; <a href="/partners">Partners</a></nav></header><main>${body}</main><footer>Stage 1 preview — public discovery does not equal Vakaviti verification.</footer></body></html>`;

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
  return c.html(html(`<section class="hero"><h1>Claim received.</h1><p>Reference: ${id}</p><p class="muted">The profile remains unverified until the evidence review is completed.</p><a class="btn" href="/operators">Back to operators</a></section>`));
});

app.post('/api/partner-interest', async c => {
  const body = await c.req.parseBody();
  const id = crypto.randomUUID();
  await c.env.DB.prepare(`INSERT INTO evidence(id,entity_type,entity_id,field_name,source_type,source_url,observed_value,evidence_status,confidence) VALUES(?,?,?,?,?,?,?,?,?)`).bind(id,'PARTNER_LEAD',id,'interest','SELF_SUBMITTED',String(body.url||''),JSON.stringify(body),'CANDIDATE',1).run();
  return c.html(html(`<section class="hero"><h1>Founding Partner interest received.</h1><p>Reference: ${id}</p><p class="muted">Next step is candidate enrichment and verification, not automatic publication.</p><a class="btn" href="/">Return home</a></section>`));
});

app.get('/api/health', c => c.json({ ok:true, service:'vakaviti-marketplace-stage1', environment:c.env.ENVIRONMENT }));

export default app;
