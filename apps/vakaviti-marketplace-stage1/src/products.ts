import { Hono } from 'hono';
import { DEFAULT_MODEL } from './ai';

type Bindings = { DB: D1Database; AI: Ai; ADMIN_TOKEN?: string };
export const products = new Hono<{ Bindings: Bindings }>();

const requireAdmin = (c: any) => {
  const expected = c.env.ADMIN_TOKEN;
  if (!expected) return c.json({ error: 'admin_api_not_configured' }, 503);
  if ((c.req.header('authorization') || '') !== `Bearer ${expected}`) return c.json({ error: 'unauthorized' }, 401);
  return null;
};

// Workers AI (this model, this prompt) does not reliably honour response_format:{type:
// 'json_object'} - it frequently wraps genuinely well-formed JSON in a conversational preamble
// ("Here is the JSON output:") and a markdown code fence, and inconsistently returns either a
// bare array or an {products:[...]} object. Confirmed empirically (2026-08-19, Evidence Engine
// Pilot 4) across 5 synthetic categories (transfer/accommodation/diving/dining/wedding): 5/5
// raw model responses contained correct, extractable product facts, but 5/5 failed a naive
// JSON.parse(result.response) because of the wrapper text - not because the model failed to
// extract facts. This function tolerates the wrapper without ever inventing data: if no
// genuinely parseable JSON structure can be found, it returns null so the caller reports an
// honest, specific failure reason instead of a silent, unexplained zero.
function extractJsonPayload(raw: string): any {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.search(/[{[]/);
  if (start === -1) return null;
  const fromStart = candidate.slice(start).trim();
  try { return JSON.parse(fromStart); } catch { /* fall through */ }
  const lastClose = Math.max(fromStart.lastIndexOf('}'), fromStart.lastIndexOf(']'));
  if (lastClose > 0) {
    try { return JSON.parse(fromStart.slice(0, lastClose + 1)); } catch { /* fall through */ }
  }
  return null;
}

products.post('/digitise', async c => {
  const denied = requireAdmin(c); if (denied) return denied;
  const body = await c.req.json<any>();
  if (!body?.operator_candidate_id || !body?.source_text) return c.json({ error: 'operator_candidate_id_source_text_required' }, 400);

  const prompt = `You structure Fiji tourism products from public source material. Return JSON only with key products as an array. Each product must contain: canonical_name, category, description, destination_text, duration_minutes, currency, amount_minor, pricing_basis, availability_mode, pickup_claim, cancellation_claim, confidence, transport_attach_score, commercial_score. Never invent missing facts. Use null or UNKNOWN when absent. Prices are candidate claims only. Source:\n${String(body.source_text).slice(0,18000)}`;
  const result: any = await c.env.AI.run(DEFAULT_MODEL, { messages:[{ role:'system', content:'Extract only supported facts. Never mark anything verified.' },{ role:'user', content:prompt }], response_format:{ type:'json_object' } });

  // AI may discover, extract, normalise and structure - it never verifies. Every candidate this
  // route creates is forced into evidence_status='CANDIDATE' below (the table's own default) and
  // is only ever reachable through the existing human-gated /candidates/:id/review ->
  // /candidates/:id/promote path, which itself always forces verification_status='NOT_VERIFIED'
  // (see /candidates/:id/promote below - unchanged by this fix). Nothing in this function can
  // mark anything verified or publish anything.
  const rawText = typeof result?.response === 'string' ? result.response : null;
  const parsedPayload = rawText !== null
    ? extractJsonPayload(rawText)
    : (result?.response && typeof result.response === 'object' ? result.response : null);

  let items: any[] = [];
  let reason: string | null = null;
  if (Array.isArray(parsedPayload)) {
    items = parsedPayload;
  } else if (parsedPayload && Array.isArray(parsedPayload.products)) {
    items = parsedPayload.products;
  } else if (parsedPayload === null) {
    reason = 'ai_response_not_parseable_as_json';
  } else {
    reason = 'ai_response_missing_products_array';
  }

  const created:string[] = [];
  for (const p of items.slice(0,30)) {
    if (!p?.canonical_name) continue;
    const id = crypto.randomUUID();
    await c.env.DB.prepare(`INSERT INTO product_candidates(id,operator_candidate_id,canonical_name,category,description,destination_text,duration_minutes,currency,amount_minor,pricing_basis,availability_mode,pickup_claim,cancellation_claim,source_url,source_type,ai_confidence,transport_attach_score,commercial_score) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      id,String(body.operator_candidate_id),String(p.canonical_name),p.category?String(p.category):null,p.description?String(p.description):null,p.destination_text?String(p.destination_text):null,Number.isFinite(p.duration_minutes)?Number(p.duration_minutes):null,p.currency?String(p.currency):null,Number.isFinite(p.amount_minor)?Number(p.amount_minor):null,String(p.pricing_basis||'UNKNOWN'),String(p.availability_mode||'UNKNOWN'),p.pickup_claim?String(p.pickup_claim):null,p.cancellation_claim?String(p.cancellation_claim):null,body.source_url?String(body.source_url):null,String(body.source_type||'PUBLIC_WEB'),Number(p.confidence||0),Number(p.transport_attach_score||0),Number(p.commercial_score||0)
    ).run();
    created.push(id);
  }
  if (created.length === 0 && !reason) reason = items.length === 0 ? 'ai_response_had_no_products' : 'no_item_had_a_canonical_name';
  return c.json({ created, count: created.length, verified:false, ...(created.length === 0 ? { reason } : {}) });
});

products.get('/candidates', async c => {
  const denied = requireAdmin(c); if (denied) return denied;
  const rows = await c.env.DB.prepare(`SELECT * FROM product_candidates ORDER BY commercial_score DESC, created_at ASC LIMIT 200`).all<any>();
  return c.json({ results: rows.results || [] });
});

products.post('/candidates/:id/promote', async c => {
  const denied = requireAdmin(c); if (denied) return denied;
  const id = c.req.param('id');
  const body = await c.req.json<any>();
  if (!body?.operator_id) return c.json({ error: 'operator_id_required' }, 400);
  const candidate:any = await c.env.DB.prepare(`SELECT * FROM product_candidates WHERE id=?`).bind(id).first();
  if (!candidate) return c.json({ error:'not_found' },404);
  if (candidate.review_status !== 'APPROVED') return c.json({ error:'human_approval_required_before_promotion' },409);
  const productId = crypto.randomUUID();
  const slug = `${String(candidate.canonical_name).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}-${productId.slice(0,8)}`;
  await c.env.DB.prepare(`INSERT INTO products(id,operator_id,canonical_name,slug,category,description,verification_status,commercial_status,transport_attachable) VALUES(?,?,?,?,?,?, 'NOT_VERIFIED','INACTIVE',?)`).bind(productId,String(body.operator_id),candidate.canonical_name,slug,candidate.category||'OTHER',candidate.description||null,Number(candidate.transport_attach_score||0)>=0.5?1:0).run();
  await c.env.DB.prepare(`UPDATE product_candidates SET promoted_product_id=?, review_status='PROMOTED', updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(productId,id).run();
  return c.json({ product_id:productId, verification_status:'NOT_VERIFIED', commercial_status:'INACTIVE' });
});

products.post('/candidates/:id/review', async c => {
  const denied = requireAdmin(c); if (denied) return denied;
  const body = await c.req.json<any>();
  if (!['APPROVED','REJECTED','NEEDS_EVIDENCE'].includes(String(body?.status))) return c.json({ error:'invalid_status' },400);
  await c.env.DB.prepare(`UPDATE product_candidates SET review_status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(String(body.status),c.req.param('id')).run();
  return c.json({ ok:true, status:String(body.status) });
});
