import { Hono } from 'hono';
import { evaluateDirectoryListingGates } from './directory-gate';

export type Bindings = { DB: D1Database; ADMIN_TOKEN?: string };
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

// Controlled candidate_operator -> operator promotion (2026-08-19, Evidence Engine Pilot 2).
//
// This is the missing governance step: previously NO code path anywhere in this app promoted a
// candidate into the live operators table, and NO code path anywhere set VAKAVITI_VERIFIED - both
// live operators were inserted directly outside this pipeline under explicit CEO authorization.
// This endpoint closes that gap for FUTURE supply while leaving that fact true of the existing 2
// operators (untouched by this change).
//
// Fails closed on every axis: wrong/missing admin token -> 401 (via the router-level requireAdmin
// already applied above); candidate not in an approved review state -> 409; already promoted once
// -> 409 (checked via review_actions, not a new column - zero schema change); any mandatory field
// unsupported -> 422 naming exactly what's missing. On success the new operator is ALWAYS created
// with verification_status='NOT_VERIFIED' and commercial_status='INACTIVE' - there is no branch of
// this function that can produce VAKAVITI_VERIFIED. Reaching that status remains a wholly separate,
// later, human decision outside this endpoint (there is still no code anywhere that sets it).
//
// P1.3D NOTE: this general-purpose endpoint is left completely unchanged. The new, narrower
// AI-DISCOVERED PUBLIC DIRECTORY LISTING path (Path A) below is a separate, additionally-gated
// promotion route used only by the batch review console - it does not replace or alter this one.
candidates.post('/:id/promote', async c => {
  const id = c.req.param('id');
  const body = await c.req.json<any>().catch(() => ({}));

  const candidateRow = await c.env.DB.prepare(`SELECT * FROM candidate_operators WHERE id=?`).bind(id).first<any>();
  if (!candidateRow) return c.json({ error: 'not_found' }, 404);

  if (!['QUALIFIED', 'SHORTLISTED'].includes(String(candidateRow.workflow_state))) {
    return c.json({ error: 'candidate_not_approved_for_promotion', workflow_state: candidateRow.workflow_state }, 409);
  }

  const priorPromotion = await c.env.DB.prepare(
    `SELECT id, after_json FROM review_actions WHERE entity_type='CANDIDATE_OPERATOR' AND entity_id=? AND action_type='PROMOTED_TO_OPERATOR' LIMIT 1`
  ).bind(id).first<any>();
  if (priorPromotion) return c.json({ error: 'already_promoted', review_action_id: priorPromotion.id }, 409);

  // Mandatory evidence coverage - deliberately minimal: only what's commercially necessary to
  // publish a listing at all (name, a place, a way to contact them, a declared category). Optional
  // facts (website, legal identity, etc.) are never required to promote.
  const missing: string[] = [];
  if (!candidateRow.canonical_name) missing.push('canonical_name');
  if (!candidateRow.locality && !candidateRow.region) missing.push('location');
  if (!candidateRow.whatsapp && !candidateRow.phone && !candidateRow.email) missing.push('contact');
  let categories: any[] = [];
  try { categories = JSON.parse(candidateRow.categories_json || '[]'); } catch { categories = []; }
  if (!Array.isArray(categories) || categories.length === 0) missing.push('category');
  const sourceCountRow = await c.env.DB.prepare(`SELECT COUNT(*) as n FROM candidate_sources WHERE candidate_id=?`).bind(id).first<any>();
  if (!sourceCountRow || Number(sourceCountRow.n) < 1) missing.push('provenance_source');
  if (missing.length) return c.json({ error: 'missing_mandatory_evidence', missing }, 422);

  const operatorId = crypto.randomUUID();
  const normalized = normalizeName(String(candidateRow.canonical_name)).replace(/\s+/g, '-');
  const slug = `${normalized}-${operatorId.slice(0, 8)}`;

  await c.env.DB.prepare(`INSERT INTO operators(
    id,canonical_name,slug,website_url,facebook_url,instagram_url,whatsapp,email,phone,locality,region,country_code,discovery_status,claim_status,verification_status,commercial_status
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?, 'FJ', 'PUBLICLY_LISTED', 'UNCLAIMED', 'NOT_VERIFIED', 'INACTIVE')`)
    .bind(operatorId, candidateRow.canonical_name, slug, candidateRow.website_url, candidateRow.facebook_url, candidateRow.instagram_url, candidateRow.whatsapp, candidateRow.email, candidateRow.phone, candidateRow.locality, candidateRow.region).run();

  const reviewActionId = crypto.randomUUID();
  await c.env.DB.prepare(`INSERT INTO review_actions(id,entity_type,entity_id,action_type,actor,note,before_json,after_json) VALUES(?,?,?,?,?,?,?,?)`)
    .bind(reviewActionId, 'CANDIDATE_OPERATOR', id, 'PROMOTED_TO_OPERATOR', String(body.reviewer || 'CEO_REVIEW'), String(body.note || ''), JSON.stringify(candidateRow), JSON.stringify({ operator_id: operatorId, slug, verification_status: 'NOT_VERIFIED', commercial_status: 'INACTIVE' })).run();

  return c.json({ operator_id: operatorId, slug, verification_status: 'NOT_VERIFIED', commercial_status: 'INACTIVE', review_action_id: reviewActionId }, 201);
});

// --- P1.3D Path A: AI-DISCOVERED PUBLIC DIRECTORY LISTING promotion --------------------------------
//
// Distinct in law from both /:id/promote above (a general-purpose, individually-approved
// promotion with no directory-specific gate) and from CEO-confirmed Pilot Partner promotion in
// src/provider-onboarding.ts (which requires a named human conversation record). This function is
// the ONLY code path that can promote a candidate under the standing AI-discovered-directory
// publication policy, and it is called ONLY from the authenticated, human-operated batch review
// console (src/batch-review-ui.ts) - AI has no path to invoke it (see regression-guards.mjs
// check 19). `actor` is always supplied by the calling route from its own session, never taken
// from request input, matching the actor-integrity discipline established in P1.3C.
//
// Every one of the CEO directive's 9 deterministic conditions must hold (evaluateDirectoryListingGates
// covers 5 data-driven ones directly; the other 4 - concise factual wording, no unsupported
// review/rating/price/award/verification claim, and correction/claim/withdrawal routes - are
// guaranteed by the fixed public template in src/index.ts, never by candidate-supplied data), AND
// a standing_policies row for AI_DISCOVERED_DIRECTORY_PUBLICATION must be active, or the promotion
// is refused. On success the resulting operator is exactly like any other PUBLICLY_LISTED,
// UNCLAIMED, NOT_VERIFIED operator (same as /:id/promote) EXCEPT it also stamps
// last_public_check_at - the one field that lets the public template (src/index.ts) show the
// "Vakaviti-discovered Fiji provider / information sourced from..." wording instead of the
// generic fallback, without needing any new column (see migrations/0014's own header comment for
// why no listing_basis column exists).
export type DirectoryPromotionResult =
  | { ok: true; operatorId: string; slug: string; published: boolean; gate: ReturnType<typeof evaluateDirectoryListingGates> }
  | { ok: false; status: number; error: string; detail?: any };

export async function promoteCandidateToDirectoryListing(env: Bindings, candidateId: string, actor: string): Promise<DirectoryPromotionResult> {
  const candidateRow = await env.DB.prepare(`SELECT * FROM candidate_operators WHERE id=?`).bind(candidateId).first<any>();
  if (!candidateRow) return { ok: false, status: 404, error: 'not_found' };

  if (!['ENRICHED', 'QUALIFIED', 'SHORTLISTED'].includes(String(candidateRow.workflow_state))) {
    return { ok: false, status: 409, error: 'candidate_not_ready', detail: { workflow_state: candidateRow.workflow_state } };
  }

  const priorPromotion = await env.DB.prepare(
    `SELECT id FROM review_actions WHERE entity_type='CANDIDATE_OPERATOR' AND entity_id=? AND action_type IN ('PROMOTED_TO_OPERATOR','PROMOTED_TO_DIRECTORY_LISTING') LIMIT 1`
  ).bind(candidateId).first<any>();
  if (priorPromotion) return { ok: false, status: 409, error: 'already_promoted' };

  const policy = await env.DB.prepare(
    `SELECT id FROM standing_policies WHERE policy_name='AI_DISCOVERED_DIRECTORY_PUBLICATION' AND active=1 LIMIT 1`
  ).first<any>();
  if (!policy) return { ok: false, status: 403, error: 'standing_policy_inactive' };

  const productCountRow = await env.DB.prepare(`SELECT COUNT(*) n FROM product_candidates WHERE operator_candidate_id=?`).bind(candidateId).first<any>();
  const gate = evaluateDirectoryListingGates({
    canonical_name: candidateRow.canonical_name,
    website_url: candidateRow.website_url,
    primary_url: candidateRow.primary_url,
    locality: candidateRow.locality,
    region: candidateRow.region,
    duplicate_of_id: candidateRow.duplicate_of_id,
    product_count: Number(productCountRow?.n || 0),
  });
  if (gate.decision !== 'ELIGIBLE') return { ok: false, status: 422, error: 'directory_gate_failed', detail: gate };

  const operatorId = crypto.randomUUID();
  const normalized = normalizeName(String(candidateRow.canonical_name)).replace(/\s+/g, '-');
  const slug = `${normalized}-${operatorId.slice(0, 8)}`;

  // Created INACTIVE first, exactly like /:id/promote and the CEO-confirmed pilot flow, then
  // flipped to ACTIVE only if a contact route exists - a directory listing with no way to reach
  // the provider cannot honestly show an "Ask Vakaviti" CTA, so it stays a private record instead
  // of a broken public promise.
  await env.DB.prepare(`INSERT INTO operators(
    id,canonical_name,slug,website_url,facebook_url,instagram_url,whatsapp,email,phone,locality,region,country_code,discovery_status,claim_status,verification_status,commercial_status,last_public_check_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?, 'FJ', 'PUBLICLY_LISTED', 'UNCLAIMED', 'NOT_VERIFIED', 'INACTIVE', CURRENT_TIMESTAMP)`)
    .bind(operatorId, candidateRow.canonical_name, slug, candidateRow.website_url, candidateRow.facebook_url, candidateRow.instagram_url, candidateRow.whatsapp, candidateRow.email, candidateRow.phone, candidateRow.locality, candidateRow.region).run();

  const hasContact = !!(candidateRow.whatsapp || candidateRow.phone || candidateRow.email);
  if (hasContact) {
    await env.DB.prepare(`UPDATE operators SET commercial_status='ACTIVE', updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(operatorId).run();
  }

  const reviewActionId = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO review_actions(id,entity_type,entity_id,action_type,actor,note,before_json,after_json) VALUES(?,?,?,?,?,?,?,?)`)
    .bind(reviewActionId, 'CANDIDATE_OPERATOR', candidateId, 'PROMOTED_TO_DIRECTORY_LISTING', actor,
      'AI-discovered public directory listing, approved via batch review under standing policy AI_DISCOVERED_DIRECTORY_PUBLICATION.',
      JSON.stringify(candidateRow),
      JSON.stringify({ operator_id: operatorId, slug, verification_status: 'NOT_VERIFIED', commercial_status: hasContact ? 'ACTIVE' : 'INACTIVE', gate })).run();

  return { ok: true, operatorId, slug, published: hasContact, gate };
}
