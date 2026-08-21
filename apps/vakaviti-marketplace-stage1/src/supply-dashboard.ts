import { Hono } from 'hono';
import { isPubliclyEligible } from './deals';

// Vakaviti P1.3B/P1.3D - the supply dashboard. Read-only, admin-gated, no write path at all -
// this file exists purely to make onboarding bottlenecks visible, not to act on them. Every
// count is computed live from the same tables the rest of the app writes to (never a cached
// snapshot), and "deals live" specifically reuses isPubliclyEligible() from src/deals.ts rather
// than approximating it with a second, potentially-drifting SQL definition of "live" - the same
// "one gate, everywhere" discipline the P1 public hub itself relies on. P1.3D extends this with
// AI-discovery-pipeline counts. "batch_review_ready" mirrors the 5 data-driven conditions from
// evaluateDirectoryListingGates() (src/directory-gate.ts) directly in SQL rather than importing
// and running the function per row just to total them - the batch review console itself always
// runs the real function per candidate before ever acting on eligibility, so this count is a
// display-only approximation, never a decision point.
//
// KNOWN SCHEMA GAP (disclosed, not worked around): the `enquiries` table has no "qualified" flag
// and no booking/outcome column. `enquiries_total` and `enquiry_response_status` are the closest
// available proxies for "qualified enquiries" / "provider responses"; `bookings_or_outcomes` is
// reported as untracked (null) rather than fabricated from data that doesn't exist.

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

  // --- P1.3D: AI discovery pipeline (Path A) --------------------------------------------------
  const discoveredProviders = await db.prepare(
    `SELECT COUNT(*) n FROM candidate_operators WHERE workflow_state = 'DISCOVERED'`
  ).first<any>();

  // "Source-evidenced" (directive status 2) maps onto the existing ENRICHED workflow_state - see
  // migrations/0014's header comment: no new column/enum value was added for this distinction.
  const sourceEvidencedProviders = await db.prepare(
    `SELECT COUNT(*) n FROM candidate_operators WHERE workflow_state = 'ENRICHED'`
  ).first<any>();

  const publicDirectoryListingsLive = await db.prepare(
    `SELECT COUNT(*) n FROM operators WHERE last_public_check_at IS NOT NULL AND commercial_status = 'ACTIVE'`
  ).first<any>();
  const publicDirectoryListingsPrivate = await db.prepare(
    `SELECT COUNT(*) n FROM operators WHERE last_public_check_at IS NOT NULL AND commercial_status != 'ACTIVE'`
  ).first<any>();

  // batch_review_ready mirrors evaluateDirectoryListingGates()'s 5 data-driven conditions in raw
  // SQL, purely so this single count doesn't require pulling every candidate row into the Worker
  // just to total them - the batch review console itself (src/batch-review-ui.ts) always
  // re-evaluates the real function per candidate before ever showing or acting on eligibility.
  const batchReviewReady = await db.prepare(
    `SELECT COUNT(*) n FROM candidate_operators co
     WHERE co.workflow_state IN ('ENRICHED','QUALIFIED','SHORTLISTED')
       AND co.duplicate_of_id IS NULL
       AND LENGTH(TRIM(COALESCE(co.canonical_name,''))) >= 3
       AND (co.website_url IS NOT NULL OR co.primary_url IS NOT NULL)
       AND (co.locality IS NOT NULL OR co.region IS NOT NULL)
       AND (SELECT COUNT(*) FROM product_candidates pcand WHERE pcand.operator_candidate_id = co.id) > 0
       AND NOT EXISTS (
         SELECT 1 FROM review_actions ra WHERE ra.entity_type='CANDIDATE_OPERATOR' AND ra.entity_id=co.id
           AND ra.action_type IN ('PROMOTED_TO_OPERATOR','PROMOTED_TO_DIRECTORY_LISTING')
       )`
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

  const enquiriesTotal = await db.prepare(`SELECT COUNT(*) n FROM enquiries`).first<any>();
  const enquiryResponseStatus = await db.prepare(
    `SELECT status, COUNT(*) n FROM enquiries GROUP BY status`
  ).all<any>();

  return c.json({
    ceo_confirmed_providers: ceoConfirmedProviders?.n ?? 0,
    profiles_ready: profilesReady?.n ?? 0,
    profiles_live: profilesLive?.n ?? 0,
    products_prepared: productsPrepared?.n ?? 0,
    discovered_providers: discoveredProviders?.n ?? 0,
    source_evidenced_providers: sourceEvidencedProviders?.n ?? 0,
    public_directory_listings_live: publicDirectoryListingsLive?.n ?? 0,
    public_directory_listings_private: publicDirectoryListingsPrivate?.n ?? 0,
    batch_review_ready: batchReviewReady?.n ?? 0,
    deal_candidates_total: dealCandidatesTotal?.n ?? 0,
    deals_awaiting_team_review: dealsAwaitingReview?.n ?? 0,
    deals_live: dealsLive,
    deals_expiring_within_7_days: dealsExpiringSoon?.n ?? 0,
    deals_expired: dealsExpired?.n ?? 0,
    sources_failing: sourcesFailing?.n ?? 0,
    enquiries_total: enquiriesTotal?.n ?? 0,
    enquiries_by_provider: enquiriesByProvider.results || [],
    enquiry_response_status: enquiryResponseStatus.results || [],
    bookings_or_outcomes_tracked: null,
    generated_at: new Date().toISOString(),
  });
});
