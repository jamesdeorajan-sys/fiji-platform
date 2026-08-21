import { Hono } from 'hono';
import { isPubliclyEligible } from './deals';

// Vakaviti P1.3B Phase 8 - the supply dashboard. Read-only, admin-gated, no write path at all -
// this file exists purely to make onboarding bottlenecks visible, not to act on them. Every
// count is computed live from the same tables the rest of the app writes to (never a cached
// snapshot), and "deals live" specifically reuses isPubliclyEligible() from src/deals.ts rather
// than approximating it with a second, potentially-drifting SQL definition of "live" - the same
// "one gate, everywhere" discipline the P1 public hub itself relies on.

type Bindings = { DB: D1Database; ADMIN_TOKEN?: string };
export const supplyDashboard = new Hono<{ Bindings: Bindings }>();

const requireAdmin = async (c: any, next: any) => {
  const expected = c.env.ADMIN_TOKEN;
  if (!expected) return c.json({ error: 'admin_api_not_configured' }, 503);
  const auth = c.req.header('authorization') || '';
  if (auth !== `Bearer ${expected}`) return c.json({ error: 'unauthorized' }, 401);
  await next();
};
supplyDashboard.use('*', requireAdmin);

supplyDashboard.get('/', async c => {
  const db = c.env.DB;

  const ceoConfirmedProviders = await db.prepare(
    `SELECT COUNT(*) n FROM provider_ceo_confirmations WHERE revoked_at IS NULL`
  ).first<any>();

  const profilesReady = await db.prepare(
    `SELECT COUNT(*) n FROM operators o JOIN provider_ceo_confirmations pc ON pc.operator_id = o.id
     WHERE pc.revoked_at IS NULL AND o.commercial_status != 'ACTIVE'`
  ).first<any>();

  const profilesLive = await db.prepare(
    `SELECT COUNT(*) n FROM operators o JOIN provider_ceo_confirmations pc ON pc.operator_id = o.id
     WHERE pc.revoked_at IS NULL AND o.commercial_status = 'ACTIVE'`
  ).first<any>();

  const productsPrepared = await db.prepare(
    `SELECT COUNT(*) n FROM products p JOIN provider_ceo_confirmations pc ON pc.operator_id = p.operator_id
     WHERE pc.revoked_at IS NULL`
  ).first<any>();

  const dealCandidatesTotal = await db.prepare(`SELECT COUNT(*) n FROM deal_offer_candidates`).first<any>();

  const dealsAwaitingReview = await db.prepare(
    `SELECT COUNT(*) n FROM deal_offer_candidates WHERE review_status IN ('NEEDS_HUMAN_REVIEW','MATERIAL_CHANGE_DETECTED','SOURCE_REVIEW_REQUIRED')`
  ).first<any>();

  // "Deals live" is computed by re-running the exact same eligibility function the public hub
  // uses, not a second SQL approximation - if the two definitions of "live" ever disagreed, that
  // would itself be a bug worth surfacing, not something to paper over with a looser count here.
  const publishedRows = await db.prepare(
    `SELECT c.*, s.source_approval_status, s.content_fingerprint AS current_source_fingerprint
     FROM deal_offer_candidates c JOIN deal_sources s ON c.source_id = s.id
     WHERE c.review_status = 'PUBLISHED'`
  ).all<any>();
  const dealsLive = (publishedRows.results || []).filter(isPubliclyEligible).length;

  const dealsExpiringSoon = await db.prepare(
    `SELECT COUNT(*) n FROM deal_offer_candidates
     WHERE review_status = 'PUBLISHED' AND offer_expires_at IS NOT NULL
       AND offer_expires_at BETWEEN datetime('now') AND datetime('now', '+7 days')`
  ).first<any>();

  const dealsExpired = await db.prepare(
    `SELECT COUNT(*) n FROM deal_offer_candidates WHERE expiry_status = 'EXPIRED' OR review_status = 'EXPIRED'`
  ).first<any>();

  const sourcesFailing = await db.prepare(
    `SELECT COUNT(*) n FROM deal_sources WHERE failure_count > 0 OR source_approval_status IN ('SOURCE_UNREACHABLE','ACCESS_RESTRICTED')`
  ).first<any>();

  const enquiriesByProvider = await db.prepare(
    `SELECT o.id AS operator_id, o.canonical_name, COUNT(e.id) AS enquiry_count
     FROM operators o LEFT JOIN enquiries e ON e.operator_id = o.id
     GROUP BY o.id HAVING enquiry_count > 0 ORDER BY enquiry_count DESC LIMIT 50`
  ).all<any>();

  const enquiryResponseStatus = await db.prepare(
    `SELECT status, COUNT(*) n FROM enquiries GROUP BY status`
  ).all<any>();

  return c.json({
    ceo_confirmed_providers: ceoConfirmedProviders?.n ?? 0,
    profiles_ready: profilesReady?.n ?? 0,
    profiles_live: profilesLive?.n ?? 0,
    products_prepared: productsPrepared?.n ?? 0,
    deal_candidates_total: dealCandidatesTotal?.n ?? 0,
    deals_awaiting_team_review: dealsAwaitingReview?.n ?? 0,
    deals_live: dealsLive,
    deals_expiring_within_7_days: dealsExpiringSoon?.n ?? 0,
    deals_expired: dealsExpired?.n ?? 0,
    sources_failing: sourcesFailing?.n ?? 0,
    enquiries_by_provider: enquiriesByProvider.results || [],
    enquiry_response_status: enquiryResponseStatus.results || [],
    generated_at: new Date().toISOString(),
  });
});
