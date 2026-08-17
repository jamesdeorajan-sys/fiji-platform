import { Hono } from 'hono';

type Bindings = { DB: D1Database; ADMIN_TOKEN?: string };
export const candidates = new Hono<{ Bindings: Bindings }>();

const normalizeName = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,' ').trim();
const requireAdmin = async (c: any, next: any) => {
  const expected = c.env.ADMIN_TOKEN;
  if (!expected) return c.json({ error: 'ADMIN_TOKEN not configured' }, 503);
  const supplied = c.req.header('authorization')?.replace(/^Bearer\s+/i,'');
  if (supplied !== expected) return c.json({ error: 'unauthorized' }, 401);
  await next();
};

candidates.use('*', requireAdmin);

candidates.post('/ingest', async c => {
  const body = await c.req.json<any>();
  const name = String(body.canonical_name || '').trim();
  const primaryUrl = String(body.primary_url || '').trim();
  if (!name || !primaryUrl) return c.json({ error: 'canonical_name and primary_url required' }, 400);
  const normalized = normalizeName(name);
  const existing = await c.env.DB.prepare(`SELECT id,canonical_name,primary_url,workflow_state FROM candidate_operators WHERE normalized_name=? LIMIT 1`).bind(normalized).first<any>();
  if (existing) return c.json({ candidate: existing, duplicate_suspected: true }, 200);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(`INSERT INTO candidate_operators(
    id,canonical_name,normalized_name,primary_url,website_url,facebook_url,instagram_url,phone,email,whatsapp,locality,region,categories_json,probable_products_json,booking_method,transport_need,digital_maturity_score,commercial_score,transport_attach_score,onboarding_friction_score,confidence,last_enriched_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`)
    .bind(id,name,normalized,primaryUrl,body.website_url||null,body.facebook_url||null,body.instagram_url||null,body.phone||null,body.email||null,body.whatsapp||null,body.locality||null,body.region||null,JSON.stringify(body.categories||[]),JSON.stringify(body.probable_products||[]),body.booking_method||null,body.transport_need||null,Number(body.digital_maturity_score||0),Number(body.commercial_score||0),Number(body.transport_attach_score||0),Number(body.onboarding_friction_score||0),Number(body.confidence||0)).run();

  const sourceId = crypto.randomUUID();
  await c.env.DB.prepare(`INSERT INTO candidate_sources(id,candidate_id,source_type,source_url,source_title,extracted_json,confidence) VALUES(?,?,?,?,?,?,?)`)
    .bind(sourceId,id,String(body.source_type||'PUBLIC_WEB'),primaryUrl,body.source_title||null,JSON.stringify(body.extracted||body),Number(body.confidence||0)).run();

  return c.json({ id, workflow_state: 'DISCOVERED', verification_status: 'NOT_VERIFIED' }, 201);
});

candidates.get('/', async c => {
  const state = c.req.query('state') || 'DISCOVERED';
  const rows = await c.env.DB.prepare(`SELECT id,canonical_name,primary_url,locality,region,commercial_score,transport_attach_score,onboarding_friction_score,confidence,workflow_state FROM candidate_operators WHERE workflow_state=? ORDER BY commercial_score DESC LIMIT 100`).bind(state).all<any>();
  return c.json({ results: rows.results || [] });
});

candidates.get('/:id', async c => {
  const id = c.req.param('id');
  const candidate = await c.env.DB.prepare(`SELECT * FROM candidate_operators WHERE id=?`).bind(id).first<any>();
  if (!candidate) return c.json({ error: 'not found' }, 404);
  const sources = await c.env.DB.prepare(`SELECT * FROM candidate_sources WHERE candidate_id=? ORDER BY observed_at DESC`).bind(id).all<any>();
  const claims = await c.env.DB.prepare(`SELECT * FROM candidate_claims WHERE candidate_id=? ORDER BY created_at DESC`).bind(id).all<any>();
  return c.json({ candidate, sources: sources.results || [], claims: claims.results || [] });
});

candidates.post('/:id/review', async c => {
  const id = c.req.param('id');
  const body = await c.req.json<any>();
  const allowed = new Set(['ENRICHED','DUPLICATE_RESOLVED','QUALIFIED','SHORTLISTED','REJECTED']);
  const nextState = String(body.workflow_state || '');
  if (!allowed.has(nextState)) return c.json({ error: 'invalid workflow_state' }, 400);
  const before = await c.env.DB.prepare(`SELECT * FROM candidate_operators WHERE id=?`).bind(id).first<any>();
  if (!before) return c.json({ error: 'not found' }, 404);
  await c.env.DB.prepare(`UPDATE candidate_operators SET workflow_state=?, reviewed_at=CURRENT_TIMESTAMP, reviewed_by=?, commercial_score=COALESCE(?,commercial_score), transport_attach_score=COALESCE(?,transport_attach_score), onboarding_friction_score=COALESCE(?,onboarding_friction_score) WHERE id=?`)
    .bind(nextState,String(body.reviewer||'CEO_REVIEW'),body.commercial_score ?? null,body.transport_attach_score ?? null,body.onboarding_friction_score ?? null,id).run();
  const after = await c.env.DB.prepare(`SELECT * FROM candidate_operators WHERE id=?`).bind(id).first<any>();
  await c.env.DB.prepare(`INSERT INTO review_actions(id,entity_type,entity_id,action_type,actor,note,before_json,after_json) VALUES(?,?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(),'CANDIDATE_OPERATOR',id,'WORKFLOW_REVIEW',String(body.reviewer||'CEO_REVIEW'),String(body.note||''),JSON.stringify(before),JSON.stringify(after)).run();
  return c.json({ candidate: after });
});
