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

deals.get('/candidates', async c => {
  const status = c.req.query('review_status');
  let sql = `SELECT * FROM deal_offer_candidates WHERE 1=1`;
  const params: any[] = [];
  if (status) { sql += ` AND review_status=?`; params.push(status); }
  sql += ` ORDER BY created_at DESC LIMIT 200`;
  const rows = await c.env.DB.prepare(sql).bind(...params).all<any>();
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
  c.executionCtx.waitUntil(runDailyDiscovery(c.env).catch(() => {}));
  return c.json({ triggered: true, note: 'Run started in the background - poll GET /api/admin/deals/runs to observe status.' }, 202);
});

// --- DeterministicOfferPublisher: the ONE function every public query must pass through -------
//
// Recomputes eligibility from raw stored fields on every call - never trusts a cached flag.
// "If any condition becomes false, public eligibility becomes false immediately" is satisfied
// structurally: there is nowhere for staleness to hide, because this function is the only
// thing that decides what the public route returns, and it re-derives the answer from source
// fields every time it runs.

export function isPubliclyEligible(candidate: any): boolean {
  if (candidate.review_status !== 'PUBLISHED') return false;
  if (candidate.source_approval_status !== 'APPROVED') return false;
  if (!candidate.source_url) return false;
  if (candidate.evidence_state !== 'CURRENT') return false; // set only at human review time
  if (!candidate.human_review_approved_at) return false;
  if (!candidate.provider_approved_at) return false;
  if (!candidate.publication_approved_at) return false;
  if (!candidate.response_owner) return false;
  if (candidate.source_fingerprint !== candidate.current_source_fingerprint) return false;
  if (candidate.content_rights_status !== 'APPROVED') return false;
  if (!['APPROVED', 'NO_IMAGE'].includes(candidate.image_rights_status)) return false;
  if (candidate.expiry_status === 'EXPIRED') return false;
  if (candidate.offer_expires_at) {
    const exp = Date.parse(candidate.offer_expires_at);
    if (!Number.isNaN(exp) && exp < Date.now()) return false; // synchronous expiry, belt-and-suspenders
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
