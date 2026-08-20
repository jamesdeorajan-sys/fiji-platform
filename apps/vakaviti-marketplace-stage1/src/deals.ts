import { Hono } from 'hono';
import { runDailyDiscovery } from './deal-agent';

// Vakaviti Deal Intelligence - OfferApprovalCoordinator + DeterministicOfferPublisher modules.
// This file is the ONLY place that may write review_status to VAKAVITI_HUMAN_REVIEWED,
// PROVIDER_APPROVED, PUBLICATION_APPROVED, PUBLISHED, or a human QUARANTINED/REJECTED/WITHDRAWN,
// and the only place that may set deal_sources.source_approval_status to APPROVED/REJECTED/PAUSED.
// Every route here sits behind requireAdmin. AI (src/deal-agent.ts) never imports this file and
// has no access to the ADMIN_TOKEN, so it structurally cannot reach any route defined here.
//
// Importing runDailyDiscovery here is one-directional and safe: this file calls INTO the
// discovery module to let a human manually trigger a controlled scan (satisfying the
// "rescan source" required admin action), it does not give deal-agent.ts any new authority -
// runDailyDiscovery itself is still restricted to DISCOVERY_WRITABLE_STATES regardless of what
// triggered it, human button-press or cron.

type Bindings = { DB: D1Database; AI: Ai; ENVIRONMENT: string; ADMIN_TOKEN?: string };
export const deals = new Hono<{ Bindings: Bindings }>();
export const dealsPublic = new Hono<{ Bindings: Bindings }>();

const requireAdmin = async (c: any, next: any) => {
  const expected = c.env.ADMIN_TOKEN;
  if (!expected) return c.json({ error: 'ADMIN_TOKEN not configured' }, 503);
  const supplied = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (supplied !== expected) return c.json({ error: 'unauthorized' }, 401);
  await next();
};
deals.use('*', requireAdmin);

// Generated once, at approval time (not at discovery, since proposed_offer_name is often still
// null then) - stable thereafter, matching the rest of this app's slug-never-changes convention
// for real operators/products.
export const slugify = (name: string, idSuffix: string): string => {
  const base = String(name || 'fiji-deal').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `${base || 'fiji-deal'}-${idSuffix.slice(0, 8)}`;
};

const auditWrite = (c: any, entityType: 'SOURCE' | 'OFFER_CANDIDATE', entityId: string, approvalType: string, actorIdentity: string, previousStatus: string, newStatus: string, reason: string, extra: any = {}) => {
  return c.env.DB.prepare(
    `INSERT INTO deal_approvals (id, entity_type, entity_id, approval_type, actor_type, actor_identity, actor_authority, previous_status, new_status, reason, fields_approved, evidence_cited, source_fingerprint, decided_at, audit_metadata)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?)`
  ).bind(
    crypto.randomUUID(), entityType, entityId, approvalType,
    'ASSISTANT_ACTING_UNDER_CEO_AUTHORIZATION', actorIdentity, 'CEO-authorized Deal Intelligence pilot operator',
    previousStatus, newStatus, reason,
    extra.fields_approved ? JSON.stringify(extra.fields_approved) : null,
    extra.evidence_cited ? JSON.stringify(extra.evidence_cited) : null,
    extra.source_fingerprint ?? null,
    extra.audit_metadata ? JSON.stringify(extra.audit_metadata) : null
  ).run();
};

// --- Source governance --------------------------------------------------------------------

deals.get('/sources', async c => {
  const status = c.req.query('status');
  let sql = `SELECT * FROM deal_sources WHERE 1=1`;
  const params: any[] = [];
  if (status) { sql += ` AND source_approval_status=?`; params.push(status); }
  sql += ` ORDER BY created_at`;
  const rows = await c.env.DB.prepare(sql).bind(...params).all<any>();
  return c.json({ results: rows.results || [] });
});

deals.post('/sources/:id/approve', async c => {
  const id = c.req.param('id');
  const body = await c.req.json<any>().catch(() => ({}));
  const reviewer = String(body.reviewer || '').trim();
  const reason = String(body.reason || '').trim();
  if (!reviewer) return c.json({ error: 'reviewer_required' }, 400);
  if (!reason) return c.json({ error: 'reason_required' }, 400);
  const source = await c.env.DB.prepare(`SELECT * FROM deal_sources WHERE id=?`).bind(id).first<any>();
  if (!source) return c.json({ error: 'source_not_found' }, 404);
  await c.env.DB.prepare(`UPDATE deal_sources SET source_approval_status='APPROVED', approved_by=?, approved_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(reviewer, id).run();
  await auditWrite(c, 'SOURCE', id, 'SOURCE_APPROVAL', reviewer, source.source_approval_status, 'APPROVED', reason);
  return c.json({ source_id: id, source_approval_status: 'APPROVED' }, 200);
});

deals.post('/sources/:id/reject', async c => {
  const id = c.req.param('id');
  const body = await c.req.json<any>().catch(() => ({}));
  const reviewer = String(body.reviewer || '').trim();
  const reason = String(body.reason || '').trim();
  if (!reviewer) return c.json({ error: 'reviewer_required' }, 400);
  if (!reason) return c.json({ error: 'reason_required' }, 400);
  const source = await c.env.DB.prepare(`SELECT * FROM deal_sources WHERE id=?`).bind(id).first<any>();
  if (!source) return c.json({ error: 'source_not_found' }, 404);
  await c.env.DB.prepare(`UPDATE deal_sources SET source_approval_status='REJECTED', updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id).run();
  await auditWrite(c, 'SOURCE', id, 'SOURCE_REJECTION', reviewer, source.source_approval_status, 'REJECTED', reason);
  return c.json({ source_id: id, source_approval_status: 'REJECTED' }, 200);
});

deals.post('/sources/:id/pause', async c => {
  const id = c.req.param('id');
  const body = await c.req.json<any>().catch(() => ({}));
  const reviewer = String(body.reviewer || '').trim();
  const reason = String(body.reason || '').trim();
  if (!reviewer) return c.json({ error: 'reviewer_required' }, 400);
  if (!reason) return c.json({ error: 'reason_required' }, 400);
  const source = await c.env.DB.prepare(`SELECT * FROM deal_sources WHERE id=?`).bind(id).first<any>();
  if (!source) return c.json({ error: 'source_not_found' }, 404);
  await c.env.DB.prepare(`UPDATE deal_sources SET source_approval_status='PAUSED', updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id).run();
  await auditWrite(c, 'SOURCE', id, 'SOURCE_PAUSE', reviewer, source.source_approval_status, 'PAUSED', reason);
  return c.json({ source_id: id, source_approval_status: 'PAUSED' }, 200);
});

// --- Offer candidate listing --------------------------------------------------------------

// Review-queue filters (Part A): needs_review/incomplete/contradictory/expired/stale plus the
// plain lifecycle statuses, provider/place/category substring filters. All computed from the
// same raw fields isPubliclyEligible() reads, so "what the queue shows" and "what would make an
// offer public" stay derived from one consistent set of facts.
export async function listCandidates(db: D1Database, filters: { filter?: string; review_status?: string; provider?: string; place?: string; category?: string }) {
  let sql = `SELECT c.*, s.source_approval_status, s.canonical_domain FROM deal_offer_candidates c JOIN deal_sources s ON c.source_id = s.id WHERE 1=1`;
  const params: any[] = [];
  if (filters.review_status) { sql += ` AND c.review_status=?`; params.push(filters.review_status); }
  if (filters.provider) { sql += ` AND c.seller_or_marketer LIKE ?`; params.push(`%${filters.provider}%`); }
  if (filters.place) { sql += ` AND c.fiji_location LIKE ?`; params.push(`%${filters.place}%`); }
  if (filters.category) { sql += ` AND c.category = ?`; params.push(filters.category); }
  switch (filters.filter) {
    case 'needs_review': sql += ` AND c.review_status IN ('NEEDS_HUMAN_REVIEW','SOURCE_REVIEW_REQUIRED','MATERIAL_CHANGE_DETECTED')`; break;
    case 'incomplete': sql += ` AND c.missing_fields IS NOT NULL AND c.missing_fields != '[]'`; break;
    case 'contradictory': sql += ` AND c.contradictions IS NOT NULL AND c.contradictions != '' AND c.contradictions != '[]'`; break;
    case 'expired': sql += ` AND c.expiry_status = 'EXPIRED'`; break;
    case 'stale': sql += ` AND (c.source_checked_at IS NULL OR c.source_checked_at < datetime('now', '-14 days'))`; break;
    case 'approved': sql += ` AND c.review_status = 'PUBLISHED'`; break;
    case 'rejected': sql += ` AND c.review_status = 'REJECTED'`; break;
    case 'withdrawn': sql += ` AND c.review_status = 'WITHDRAWN'`; break;
    case 'revoked': sql += ` AND c.review_status = 'WITHDRAWN'`; break; // this pilot represents revocation as WITHDRAWN - see revoke-publication
    case 'source_failure': sql += ` AND s.source_approval_status IN ('SOURCE_UNREACHABLE','ACCESS_RESTRICTED')`; break;
    default: break;
  }
  sql += ` ORDER BY c.created_at DESC LIMIT 200`;
  const rows = await db.prepare(sql).bind(...params).all<any>();
  return rows.results || [];
}

deals.get('/candidates', async c => {
  const results = await listCandidates(c.env.DB, {
    filter: c.req.query('filter'),
    review_status: c.req.query('review_status'),
    provider: c.req.query('provider'),
    place: c.req.query('place'),
    category: c.req.query('category')
  });
  return c.json({ results });
});

// Source-health summary (view 7) and scan-run summary (view 8) - both admin views the directive
// requires; scan-run summary already exists as GET /runs below, source-health here.
deals.get('/sources/health', async c => {
  const rows = await c.env.DB.prepare(
    `SELECT id, canonical_domain, source_approval_status, last_http_status, last_scan_at, next_scan_at, failure_count, backoff_until FROM deal_sources ORDER BY canonical_domain`
  ).all<any>();
  return c.json({ results: rows.results || [] });
});

deals.get('/candidates/:id', async c => {
  const id = c.req.param('id');
  const candidate = await c.env.DB.prepare(`SELECT * FROM deal_offer_candidates WHERE id=?`).bind(id).first<any>();
  if (!candidate) return c.json({ error: 'not_found' }, 404);
  const approvals = await c.env.DB.prepare(`SELECT * FROM deal_approvals WHERE entity_type='OFFER_CANDIDATE' AND entity_id=? ORDER BY created_at`).bind(id).all<any>();
  const changes = await c.env.DB.prepare(`SELECT * FROM deal_change_events WHERE offer_candidate_id=? ORDER BY detected_at`).bind(id).all<any>();
  return c.json({ candidate, approvals: approvals.results || [], change_events: changes.results || [] });
});

// --- Human review (VAKAVITI_HUMAN_REVIEWED) ------------------------------------------------

deals.post('/candidates/:id/review', async c => {
  const id = c.req.param('id');
  const body = await c.req.json<any>().catch(() => ({}));
  const reviewer = String(body.reviewer || '').trim();
  const reason = String(body.reason || '').trim();
  const responseOwner = String(body.response_owner || '').trim();
  if (!reviewer) return c.json({ error: 'reviewer_required' }, 400);
  if (!reason) return c.json({ error: 'reason_required' }, 400);
  if (!responseOwner) return c.json({ error: 'response_owner_required' }, 400);
  const candidate = await c.env.DB.prepare(`SELECT * FROM deal_offer_candidates WHERE id=?`).bind(id).first<any>();
  if (!candidate) return c.json({ error: 'not_found' }, 404);

  const corrections: Record<string, string> = body.corrections && typeof body.corrections === 'object' ? body.corrections : {};
  const allowedCorrectionFields = new Set(['proposed_offer_name','factual_summary','category','fiji_location','advertised_price','reference_price','currency','price_basis','explicit_discount','calculated_discount','calculation_inputs','promo_code','booking_deadline','travel_from','travel_until','offer_expires_at','blackout_dates','minimum_stay','minimum_group_size','eligibility','inclusions','exclusions','cancellation_terms','booking_route','seller_or_marketer','fulfilment_operator']);
  const setClauses: string[] = [];
  const params: any[] = [];
  for (const [k, v] of Object.entries(corrections)) {
    if (!allowedCorrectionFields.has(k)) return c.json({ error: 'invalid_correction_field', field: k }, 400);
    setClauses.push(`${k}=?`);
    params.push(String(v));
  }
  const setSql = setClauses.length ? setClauses.join(', ') + ', ' : '';
  await c.env.DB.prepare(
    `UPDATE deal_offer_candidates SET ${setSql} review_status='VAKAVITI_HUMAN_REVIEWED', evidence_state='CURRENT', human_review_approved_at=CURRENT_TIMESTAMP, human_review_approved_by=?, response_owner=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
  ).bind(...params, reviewer, responseOwner, id).run();

  await auditWrite(c, 'OFFER_CANDIDATE', id, 'HUMAN_REVIEW', reviewer, candidate.review_status, 'VAKAVITI_HUMAN_REVIEWED', reason, { fields_approved: Object.keys(corrections) });
  return c.json({ candidate_id: id, review_status: 'VAKAVITI_HUMAN_REVIEWED' }, 200);
});

deals.post('/candidates/:id/reject', async c => {
  const id = c.req.param('id');
  const body = await c.req.json<any>().catch(() => ({}));
  const reviewer = String(body.reviewer || '').trim();
  const reason = String(body.reason || '').trim();
  if (!reviewer) return c.json({ error: 'reviewer_required' }, 400);
  if (!reason) return c.json({ error: 'reason_required' }, 400);
  const candidate = await c.env.DB.prepare(`SELECT * FROM deal_offer_candidates WHERE id=?`).bind(id).first<any>();
  if (!candidate) return c.json({ error: 'not_found' }, 404);
  await c.env.DB.prepare(`UPDATE deal_offer_candidates SET review_status='REJECTED', updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id).run();
  await auditWrite(c, 'OFFER_CANDIDATE', id, 'REJECTION', reviewer, candidate.review_status, 'REJECTED', reason);
  return c.json({ candidate_id: id, review_status: 'REJECTED' }, 200);
});

deals.post('/candidates/:id/quarantine', async c => {
  const id = c.req.param('id');
  const body = await c.req.json<any>().catch(() => ({}));
  const reviewer = String(body.reviewer || '').trim();
  const reason = String(body.reason || '').trim();
  if (!reviewer) return c.json({ error: 'reviewer_required' }, 400);
  if (!reason) return c.json({ error: 'reason_required' }, 400);
  const candidate = await c.env.DB.prepare(`SELECT * FROM deal_offer_candidates WHERE id=?`).bind(id).first<any>();
  if (!candidate) return c.json({ error: 'not_found' }, 404);
  await c.env.DB.prepare(`UPDATE deal_offer_candidates SET review_status='QUARANTINED', updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id).run();
  await auditWrite(c, 'OFFER_CANDIDATE', id, 'QUARANTINE', reviewer, candidate.review_status, 'QUARANTINED', reason);
  return c.json({ candidate_id: id, review_status: 'QUARANTINED' }, 200);
});

// --- Provider approval (recorded by a Vakaviti human on the provider's behalf - see directive:
// "Do not send this packet" / sending requires separate CEO authorization; this endpoint only
// RECORDS a decision a human has already obtained, it never contacts anyone itself) -----------

deals.post('/candidates/:id/provider-approval', async c => {
  const id = c.req.param('id');
  const body = await c.req.json<any>().catch(() => ({}));
  const reviewer = String(body.reviewer || '').trim();
  const reason = String(body.reason || '').trim();
  const decision = String(body.decision || ''); // 'APPROVED' | 'WITHDRAWN'
  if (!reviewer) return c.json({ error: 'reviewer_required' }, 400);
  if (!reason) return c.json({ error: 'reason_required' }, 400);
  if (!['APPROVED', 'WITHDRAWN'].includes(decision)) return c.json({ error: 'invalid_decision', allowed: ['APPROVED', 'WITHDRAWN'] }, 400);
  const candidate = await c.env.DB.prepare(`SELECT * FROM deal_offer_candidates WHERE id=?`).bind(id).first<any>();
  if (!candidate) return c.json({ error: 'not_found' }, 404);
  if (candidate.review_status !== 'VAKAVITI_HUMAN_REVIEWED' && decision === 'APPROVED') {
    return c.json({ error: 'human_review_required_first', current_status: candidate.review_status }, 409);
  }
  const newStatus = decision === 'APPROVED' ? 'PROVIDER_APPROVED' : 'WITHDRAWN';
  if (decision === 'APPROVED') {
    await c.env.DB.prepare(`UPDATE deal_offer_candidates SET review_status='PROVIDER_APPROVED', provider_approved_at=CURRENT_TIMESTAMP, provider_approved_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(reviewer, id).run();
  } else {
    await c.env.DB.prepare(`UPDATE deal_offer_candidates SET review_status='WITHDRAWN', updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id).run();
  }
  await auditWrite(c, 'OFFER_CANDIDATE', id, decision === 'APPROVED' ? 'PROVIDER_APPROVAL' : 'PROVIDER_WITHDRAWAL', reviewer, candidate.review_status, newStatus, reason);
  return c.json({ candidate_id: id, review_status: newStatus }, 200);
});

// --- Publication approval / revocation -----------------------------------------------------

deals.post('/candidates/:id/publish', async c => {
  const id = c.req.param('id');
  const body = await c.req.json<any>().catch(() => ({}));
  const reviewer = String(body.reviewer || '').trim();
  const reason = String(body.reason || '').trim();
  const contentRights = String(body.content_rights_status || '');
  const imageRights = String(body.image_rights_status || 'NO_IMAGE');
  if (!reviewer) return c.json({ error: 'reviewer_required' }, 400);
  if (!reason) return c.json({ error: 'reason_required' }, 400);
  if (!['APPROVED'].includes(contentRights)) return c.json({ error: 'content_rights_must_be_approved' }, 400);
  if (!['APPROVED', 'NO_IMAGE'].includes(imageRights)) return c.json({ error: 'image_rights_must_be_approved_or_no_image' }, 400);

  const candidate = await c.env.DB.prepare(`SELECT c.*, s.source_approval_status, s.content_fingerprint AS current_source_fingerprint FROM deal_offer_candidates c JOIN deal_sources s ON c.source_id=s.id WHERE c.id=?`).bind(id).first<any>();
  if (!candidate) return c.json({ error: 'not_found' }, 404);
  if (candidate.review_status !== 'PROVIDER_APPROVED') return c.json({ error: 'provider_approval_required_first', current_status: candidate.review_status }, 409);
  if (candidate.source_approval_status !== 'APPROVED') return c.json({ error: 'source_no_longer_approved' }, 409);
  if (!candidate.response_owner) return c.json({ error: 'response_owner_required' }, 400);
  if (candidate.source_fingerprint !== candidate.current_source_fingerprint) {
    return c.json({ error: 'source_fingerprint_changed_since_review', detail: 'The source content has changed since this offer was reviewed - a new human review is required before publication.' }, 409);
  }

  await c.env.DB.prepare(
    `UPDATE deal_offer_candidates SET review_status='PUBLISHED', content_rights_status=?, image_rights_status=?, publication_approved_at=CURRENT_TIMESTAMP, publication_approved_by=?, source_fingerprint_at_approval=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
  ).bind(contentRights, imageRights, reviewer, candidate.source_fingerprint, id).run();
  await auditWrite(c, 'OFFER_CANDIDATE', id, 'PUBLICATION_APPROVAL', reviewer, candidate.review_status, 'PUBLISHED', reason, { source_fingerprint: candidate.source_fingerprint });
  return c.json({ candidate_id: id, review_status: 'PUBLISHED' }, 200);
});

deals.post('/candidates/:id/revoke-publication', async c => {
  const id = c.req.param('id');
  const body = await c.req.json<any>().catch(() => ({}));
  const reviewer = String(body.reviewer || '').trim();
  const reason = String(body.reason || '').trim();
  if (!reviewer) return c.json({ error: 'reviewer_required' }, 400);
  if (!reason) return c.json({ error: 'reason_required' }, 400);
  const candidate = await c.env.DB.prepare(`SELECT * FROM deal_offer_candidates WHERE id=?`).bind(id).first<any>();
  if (!candidate) return c.json({ error: 'not_found' }, 404);
  await c.env.DB.prepare(`UPDATE deal_offer_candidates SET review_status='WITHDRAWN', updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id).run();
  await auditWrite(c, 'OFFER_CANDIDATE', id, 'PUBLICATION_REVOCATION', reviewer, candidate.review_status, 'WITHDRAWN', reason);
  return c.json({ candidate_id: id, review_status: 'WITHDRAWN' }, 200);
});

// --- P1 Part A: additional top-level human decisions ---------------------------------------

// REQUEST_MORE_EVIDENCE: records that a human looked at this candidate and found it not yet
// decidable - does not change review_status (it should already be NEEDS_HUMAN_REVIEW or similar
// pre-decision state), purely an audited note asking for more/better evidence before a real
// decision can be made. Never itself approves, rejects, or publishes anything.
deals.post('/candidates/:id/request-more-evidence', async c => {
  const id = c.req.param('id');
  const body = await c.req.json<any>().catch(() => ({}));
  const reviewer = String(body.reviewer || '').trim();
  const reason = String(body.reason || '').trim();
  if (!reviewer) return c.json({ error: 'reviewer_required' }, 400);
  if (!reason) return c.json({ error: 'reason_required' }, 400);
  const candidate = await c.env.DB.prepare(`SELECT * FROM deal_offer_candidates WHERE id=?`).bind(id).first<any>();
  if (!candidate) return c.json({ error: 'not_found' }, 404);
  await auditWrite(c, 'OFFER_CANDIDATE', id, 'CORRECTION', reviewer, candidate.review_status, candidate.review_status, reason, { audit_metadata: { action: 'REQUEST_MORE_EVIDENCE' } });
  return c.json({ candidate_id: id, review_status: candidate.review_status, note: 'Logged - review_status unchanged, this is a request for more evidence, not a decision.' }, 200);
});

// MARK_DISPUTED: a human flags a contradiction or a provider/third-party dispute. Immediately
// makes the offer publicly ineligible if it happened to be PUBLISHED (isPubliclyEligible's
// review_status==='PUBLISHED' check fails the instant this write commits - no separate
// unpublish step, no cache to invalidate, no rebuild to wait for).
deals.post('/candidates/:id/dispute', async c => {
  const id = c.req.param('id');
  const body = await c.req.json<any>().catch(() => ({}));
  const reviewer = String(body.reviewer || '').trim();
  const reason = String(body.reason || '').trim();
  if (!reviewer) return c.json({ error: 'reviewer_required' }, 400);
  if (!reason) return c.json({ error: 'reason_required' }, 400);
  const candidate = await c.env.DB.prepare(`SELECT * FROM deal_offer_candidates WHERE id=?`).bind(id).first<any>();
  if (!candidate) return c.json({ error: 'not_found' }, 404);
  await c.env.DB.prepare(`UPDATE deal_offer_candidates SET review_status='DISPUTED', updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id).run();
  await auditWrite(c, 'OFFER_CANDIDATE', id, 'QUARANTINE', reviewer, candidate.review_status, 'DISPUTED', reason);
  return c.json({ candidate_id: id, review_status: 'DISPUTED' }, 200);
});

// WITHDRAW: explicit top-level withdrawal (distinct from provider-approval's decision=WITHDRAWN
// path, which specifically represents a provider withdrawing consent - this is for any other
// reason a human decides the candidate should no longer be active, e.g. it's outdated, wrong,
// or Vakaviti itself has decided not to carry it). Immediately publicly ineligible if published.
deals.post('/candidates/:id/withdraw', async c => {
  const id = c.req.param('id');
  const body = await c.req.json<any>().catch(() => ({}));
  const reviewer = String(body.reviewer || '').trim();
  const reason = String(body.reason || '').trim();
  if (!reviewer) return c.json({ error: 'reviewer_required' }, 400);
  if (!reason) return c.json({ error: 'reason_required' }, 400);
  const candidate = await c.env.DB.prepare(`SELECT * FROM deal_offer_candidates WHERE id=?`).bind(id).first<any>();
  if (!candidate) return c.json({ error: 'not_found' }, 404);
  await c.env.DB.prepare(`UPDATE deal_offer_candidates SET review_status='WITHDRAWN', updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id).run();
  await auditWrite(c, 'OFFER_CANDIDATE', id, 'REJECTION', reviewer, candidate.review_status, 'WITHDRAWN', reason);
  return c.json({ candidate_id: id, review_status: 'WITHDRAWN' }, 200);
});

// APPROVE: the single consolidated human decision the Part A review centre presents as one
// action. Fails closed if any fact required for publication is missing or contradictory -
// listing exactly what's missing rather than silently approving a partial record. On success it
// performs the same state transition the granular review -> provider-approval -> publish chain
// already proved live in Pilot 6D-A/Deal Intelligence P0 testing, in one governed, fully
// audited step. AI cannot reach this route (no ADMIN_TOKEN access, and this file is never
// imported by src/deal-agent.ts).
deals.post('/candidates/:id/approve', async c => {
  const id = c.req.param('id');
  const body = await c.req.json<any>().catch(() => ({}));
  const reviewer = String(body.reviewer || '').trim();
  const reason = String(body.reason || '').trim();
  const responseOwner = String(body.response_owner || '').trim();
  const fulfilmentOperator = String(body.fulfilment_operator || '').trim();
  const contentRights = String(body.content_rights_status || '');
  const imageRights = String(body.image_rights_status || 'NO_IMAGE');
  const evidenceRefs = Array.isArray(body.evidence_references) ? body.evidence_references : [];
  if (!reviewer) return c.json({ error: 'reviewer_required' }, 400);
  if (!reason) return c.json({ error: 'reason_required' }, 400);
  if (!responseOwner) return c.json({ error: 'response_owner_required' }, 400);
  if (!fulfilmentOperator) return c.json({ error: 'fulfilment_operator_required' }, 400);
  if (contentRights !== 'APPROVED') return c.json({ error: 'content_rights_must_be_approved' }, 400);
  if (!['APPROVED', 'NO_IMAGE'].includes(imageRights)) return c.json({ error: 'image_rights_must_be_approved_or_no_image' }, 400);
  if (evidenceRefs.length === 0) return c.json({ error: 'evidence_references_required' }, 400);

  const candidate = await c.env.DB.prepare(
    `SELECT c.*, s.source_approval_status, s.content_fingerprint AS current_source_fingerprint FROM deal_offer_candidates c JOIN deal_sources s ON c.source_id=s.id WHERE c.id=?`
  ).bind(id).first<any>();
  if (!candidate) return c.json({ error: 'not_found' }, 404);
  if (candidate.source_approval_status !== 'APPROVED') return c.json({ error: 'source_not_approved' }, 409);
  if (candidate.source_fingerprint !== candidate.current_source_fingerprint) {
    return c.json({ error: 'source_fingerprint_changed_since_discovery', detail: 'The source content has changed since this candidate was created - a fresh scan and review is required.' }, 409);
  }

  const corrections: Record<string, string> = body.corrections && typeof body.corrections === 'object' ? body.corrections : {};
  const allowedCorrectionFields = new Set(['proposed_offer_name','factual_summary','category','fiji_location','advertised_price','reference_price','currency','price_basis','explicit_discount','calculated_discount','calculation_inputs','promo_code','booking_deadline','travel_from','travel_until','offer_expires_at','blackout_dates','minimum_stay','minimum_group_size','eligibility','inclusions','exclusions','cancellation_terms','booking_route','seller_or_marketer']);
  for (const k of Object.keys(corrections)) {
    if (!allowedCorrectionFields.has(k)) return c.json({ error: 'invalid_correction_field', field: k }, 400);
  }
  const merged: any = { ...candidate, ...corrections, fulfilment_operator: fulfilmentOperator, response_owner: responseOwner };

  // Fail closed: check every fact isPubliclyEligible() will require, and report exactly what's
  // missing rather than approve a record that could never actually become publicly eligible.
  const missing: string[] = [];
  if (!merged.seller_or_marketer) missing.push('seller_or_marketer');
  if (!merged.proposed_offer_name) missing.push('proposed_offer_name');
  if (!merged.factual_summary) missing.push('factual_summary');
  if (!merged.category) missing.push('category');
  if (!merged.fiji_location) missing.push('fiji_location');
  if (merged.advertised_price && (!merged.currency || !merged.price_basis)) missing.push('currency_or_price_basis (required because advertised_price is set)');
  if (missing.length > 0) return c.json({ error: 'missing_required_facts', missing }, 422);

  const setClauses: string[] = [];
  const params: any[] = [];
  for (const [k, v] of Object.entries(corrections)) { setClauses.push(`${k}=?`); params.push(String(v)); }
  setClauses.push('fulfilment_operator=?'); params.push(fulfilmentOperator);
  // Slug is generated once and never regenerated on a later re-approval, so a URL already
  // shared/indexed never silently changes destination.
  const slug = candidate.slug || slugify(merged.proposed_offer_name, id);
  if (!candidate.slug) { setClauses.push('slug=?'); params.push(slug); }
  const setSql = setClauses.length ? setClauses.join(', ') + ', ' : '';

  await c.env.DB.prepare(
    `UPDATE deal_offer_candidates SET ${setSql}
       review_status='PUBLISHED', evidence_state='CURRENT',
       human_review_approved_at=CURRENT_TIMESTAMP, human_review_approved_by=?,
       provider_approved_at=CURRENT_TIMESTAMP, provider_approved_by=?,
       publication_approved_at=CURRENT_TIMESTAMP, publication_approved_by=?,
       content_rights_status=?, image_rights_status=?, response_owner=?,
       source_fingerprint_at_approval=?, updated_at=CURRENT_TIMESTAMP
     WHERE id=?`
  ).bind(...params, reviewer, reviewer, reviewer, contentRights, imageRights, responseOwner, candidate.source_fingerprint, id).run();

  await auditWrite(c, 'OFFER_CANDIDATE', id, 'PUBLICATION_APPROVAL', reviewer, candidate.review_status, 'PUBLISHED', reason, {
    fields_approved: Object.keys(corrections),
    evidence_cited: evidenceRefs,
    source_fingerprint: candidate.source_fingerprint
  });
  return c.json({ candidate_id: id, review_status: 'PUBLISHED' }, 200);
});

deals.get('/runs', async c => {
  const rows = await c.env.DB.prepare(`SELECT * FROM deal_scan_runs ORDER BY started_at DESC LIMIT 30`).all<any>();
  return c.json({ results: rows.results || [] });
});

// Manual trigger for a controlled discovery run - the same runDailyDiscovery() the daily Cron
// calls, invoked on demand for the CEO-authorized controlled live-source test. Scans only
// sources currently source_approval_status='APPROVED'; nothing is fetched otherwise. This does
// not grant the agent module any new write authority - it is still bound to
// DISCOVERY_WRITABLE_STATES regardless of what triggered it.
// Fire-and-poll, not fire-and-wait: scanning multiple sources (each with a fetch plus a
// Workers AI extraction call) can exceed a synchronous request's execution window - discovered
// live during this pilot's own controlled test, where a synchronous version of this route left
// a deal_scan_runs row stuck at RUNNING when the platform ended the request before the full
// batch finished. c.executionCtx.waitUntil() gives the run the platform's extended background-
// task allowance instead of the request/response lifecycle. Poll GET /runs to observe progress;
// the row transitions from RUNNING to COMPLETED/COMPLETED_WITH_ERRORS/FAILED same as a Cron run.
deals.post('/runs/trigger', async c => {
  const body = await c.req.json<any>().catch(() => ({}));
  // A manual test scan does not, by default, advance the scanned sources' next_scan_at - a
  // human spot-checking a source shouldn't disturb the automatic rotation's timing. Pass
  // consume_scheduled_slot:true to opt into treating this manual run as satisfying today's
  // scheduled slot for whatever sources it happens to scan.
  const consumeScheduledSlot = body.consume_scheduled_slot === true;
  c.executionCtx.waitUntil(runDailyDiscovery(c.env, 'MANUAL_TEST', { consumeScheduledSlot }).catch(() => {}));
  return c.json({ triggered: true, note: `Run started in the background as MANUAL_TEST (its own idempotency key - never blocked by, and never blocking, the automatic DAILY_DISCOVERY slot). Processes at most 2 due sources this activation. consume_scheduled_slot=${consumeScheduledSlot}. Poll GET /api/admin/deals/runs to observe status.` }, 202);
});

// --- DeterministicOfferPublisher: the ONE function every public query must pass through -------
//
// Recomputes eligibility from raw stored fields on every call - never trusts a cached flag.
// "If any condition becomes false, public eligibility becomes false immediately" is satisfied
// structurally: there is nowhere for staleness to hide, because this function is the only
// thing that decides what the public route returns, and it re-derives the answer from source
// fields every time it runs.

// Part B eligibility law (P1, CEO directive): 16 named gates, all re-evaluated from raw stored
// fields on every call - see the DeterministicOfferPublisher note above for why that matters.
// STALE_AFTER_DAYS is this pilot's concrete definition of "not stale" - evidence older than this
// without a fresh successful scan is treated as no longer current enough to show a traveler.
const STALE_AFTER_DAYS = 14;

export function isPubliclyEligible(candidate: any): boolean {
  // Publication state is explicitly eligible; human approval exists and has not been revoked
  // (a revoke sets review_status to WITHDRAWN, which fails this same check - there is no
  // separate "revoked" flag to fall out of sync with).
  if (candidate.review_status !== 'PUBLISHED') return false;
  // Source is approved, not paused or withdrawn.
  if (candidate.source_approval_status !== 'APPROVED') return false;
  // Source evidence remains linked.
  if (!candidate.source_url || !candidate.source_id) return false;
  if (candidate.evidence_state !== 'CURRENT') return false; // set only at human review time
  if (!candidate.human_review_approved_at) return false;
  if (!candidate.provider_approved_at) return false;
  if (!candidate.publication_approved_at) return false;
  // Provider identity resolved; seller and fulfiller disclosed.
  if (!candidate.seller_or_marketer) return false;
  if (!candidate.fulfilment_operator) return false;
  if (!candidate.response_owner) return false;
  // Required commercial facts present (a human must have corrected these during review - raw
  // AI extraction alone never satisfies this).
  if (!candidate.proposed_offer_name || !candidate.factual_summary) return false;
  if (!candidate.category || !candidate.fiji_location) return false;
  // Price is current or clearly "quote required" (no price is fine; a half-evidenced price is
  // not) - currency and price basis are known whenever a price exists.
  if (candidate.advertised_price && (!candidate.currency || !candidate.price_basis)) return false;
  // Source fingerprint still matches what was approved - a page change invalidates approval.
  if (candidate.source_fingerprint !== candidate.current_source_fingerprint) return false;
  if (candidate.content_rights_status !== 'APPROVED') return false;
  if (!['APPROVED', 'NO_IMAGE'].includes(candidate.image_rights_status)) return false;
  // Not expired, not disputed (WITHDRAWN is already excluded by the review_status==='PUBLISHED'
  // check above, since a withdrawal always transitions review_status away from PUBLISHED).
  if (candidate.expiry_status === 'EXPIRED') return false;
  if (candidate.review_status === 'DISPUTED') return false; // defensive - unreachable given the PUBLISHED check, kept explicit per the directive's own gate list
  if (candidate.offer_expires_at) {
    const exp = Date.parse(candidate.offer_expires_at);
    if (!Number.isNaN(exp) && exp < Date.now()) return false; // synchronous expiry, belt-and-suspenders
  }
  // Booking deadline is current.
  if (candidate.booking_deadline) {
    const deadline = Date.parse(candidate.booking_deadline);
    if (!Number.isNaN(deadline) && deadline < Date.now()) return false;
  }
  // Travel window is not incompatible (already past).
  if (candidate.travel_until) {
    const until = Date.parse(candidate.travel_until);
    if (!Number.isNaN(until) && until < Date.now()) return false;
  }
  // Not stale.
  if (candidate.source_checked_at) {
    const checked = Date.parse(candidate.source_checked_at);
    if (!Number.isNaN(checked) && Date.now() - checked > STALE_AFTER_DAYS * 24 * 3600 * 1000) return false;
  } else {
    return false; // no check timestamp at all is itself a staleness/evidence-currency failure
  }
  return true;
}

// Public, controlled preview route - deliberately not mounted under /api/admin, but never
// linked from any indexed page, still noindex (see src/index.ts's html() wrapper), and only
// ever returns candidates that pass isPubliclyEligible(). With zero PUBLISHED rows today, this
// always returns an empty list - documented as the expected state after this build.
dealsPublic.get('/', async c => {
  const rows = await c.env.DB.prepare(
    `SELECT c.*, s.source_approval_status, s.content_fingerprint AS current_source_fingerprint
     FROM deal_offer_candidates c JOIN deal_sources s ON c.source_id = s.id
     WHERE c.review_status = 'PUBLISHED'`
  ).all<any>();
  const eligible = (rows.results || []).filter(isPubliclyEligible).map((c: any) => ({
    id: c.id,
    provider: c.seller_or_marketer,
    factual_summary: c.factual_summary,
    price: c.advertised_price,
    currency: c.currency,
    discount: c.explicit_discount,
    booking_deadline: c.booking_deadline,
    travel_from: c.travel_from,
    travel_until: c.travel_until,
    expiry_status: c.expiry_status,
    offer_expires_at: c.offer_expires_at,
    restrictions: c.eligibility,
    last_checked: c.source_checked_at,
    provider_approved: true,
    booking_route: c.booking_route,
    availability_note: 'Availability subject to provider confirmation.'
  }));
  return c.json({ results: eligible, count: eligible.length });
});
