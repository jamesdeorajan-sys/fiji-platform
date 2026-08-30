import { Hono } from 'hono';
import { safeFetchSource, fingerprint, extractOfferFacts, computeExpiryStatus } from './deal-agent';
import { canonicalizeUrl, evaluateQualityGates, type ExtractedFields } from './deal-quality';
import { DEFAULT_MODEL } from './ai';

// Vakaviti P1.3A/P1.3C - CEO-confirmed provider fast-track onboarding. The governed service
// functions below (createCeoConfirmation, revokeCeoConfirmation) are the ONLY code paths in the
// whole app that can ever write provider_ceo_confirmations - both the Bearer-token JSON API in
// this file and the cookie-session HTML console in src/provider-onboarding-ui.ts call the exact
// same functions, so there is only ever one authorization law, never two independently-drifting
// implementations. AI has no import path to either file (see regression-guards.mjs checks 16/18).
//
// `actor` is always a parameter supplied by the CALLING ROUTE from its own authentication
// context - never read out of the request body/input. A client claiming to be "CEO" in a JSON
// payload was, before P1.3C, taken at face value; that gap is closed here structurally, not just
// documented (regression-guards.mjs check 18 verifies neither service function reads an `actor`
// field off its `input` parameter).

// ENVIRONMENT is declared (even though unused directly here) because extractOfferFacts()'s own
// Bindings type in deal-agent.ts requires it - keeping the shape a structural superset avoids a
// widening cast at every call site.
export type Bindings = { DB: D1Database; AI: Ai; ENVIRONMENT: string; ADMIN_TOKEN?: string };
export const providerOnboarding = new Hono<{ Bindings: Bindings }>();

const requireAdmin = async (c: any, next: any) => {
  const expected = c.env.ADMIN_TOKEN;
  if (!expected) return c.json({ error: 'admin_api_not_configured' }, 503);
  const auth = c.req.header('authorization') || '';
  if (auth !== `Bearer ${expected}`) return c.json({ error: 'unauthorized' }, 401);
  await next();
};
providerOnboarding.use('*', requireAdmin);

// --- domain canonicalization (identity engine) --------------------------------------------------
// Deliberately simpler than canonicalizeUrl() in deal-quality.ts (that one preserves path/query
// for deduping a specific PAGE; this one only needs the host, for deduping a PROVIDER).
export function canonicalizeDomain(input: string): string {
  let host = String(input || '').trim().toLowerCase();
  host = host.replace(/^https?:\/\//, '').split('/')[0];
  host = host.replace(/^www\./, '');
  return host;
}

const auditWrite = (db: D1Database, entityType: string, entityId: string, actionType: string, actor: string, note: string, before: any, after: any) =>
  db.prepare(`INSERT INTO review_actions (id, entity_type, entity_id, action_type, actor, note, before_json, after_json) VALUES (?,?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(), entityType, entityId, actionType, actor, note, JSON.stringify(before), JSON.stringify(after)).run();

// --- Profile+product extraction (profile engine + product engine) --------------------------------
interface ProfileExtraction {
  description: string | null;
  locality: string | null;
  region: string | null;
  phone: string | null;
  email: string | null;
  whatsapp: string | null;
  products: { canonical_name: string; category: string | null; description: string | null }[];
}

function extractJsonPayload(raw: string): any {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.search(/[{[]/);
  if (start === -1) return null;
  const fromStart = candidate.slice(start).trim();
  try { return JSON.parse(fromStart); } catch { /* fall through */ }
  const lastClose = Math.max(fromStart.lastIndexOf('}'), fromStart.lastIndexOf(']'));
  if (lastClose > 0) { try { return JSON.parse(fromStart.slice(0, lastClose + 1)); } catch { /* fall through */ } }
  return null;
}

async function extractProfileAndProducts(env: Bindings, pageText: string): Promise<ProfileExtraction | null> {
  const prompt = `You extract FACTUAL profile and product information from a Fiji tourism provider's own official web page. Only report a fact explicitly stated in the text below - never guess, infer, or invent a value, especially contact details. Return ONLY a JSON object: {"description": string|null (max 200 chars, factual only, do not copy long copyrighted marketing text - summarise plainly), "locality": string|null, "region": string|null, "phone": string|null, "email": string|null, "whatsapp": string|null, "products": [{"canonical_name": string, "category": string|null, "description": string|null}]}. products should list genuine bookable accommodation, activity, tour, or transfer offerings actually named on the page - omit anything vague. Return an empty products array if none are clearly named.

Page text:
${pageText.slice(0, 12000)}`;
  let aiResp: any;
  try {
    aiResp = await env.AI.run(DEFAULT_MODEL, { messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' } });
  } catch {
    return null;
  }
  const text = typeof aiResp === 'string' ? aiResp : (aiResp?.response ?? JSON.stringify(aiResp));
  const parsed = extractJsonPayload(text);
  if (!parsed || typeof parsed !== 'object') return null;
  const clean = (v: any) => (v === undefined || v === null || v === '' ? null : String(v));
  return {
    description: clean(parsed.description),
    locality: clean(parsed.locality),
    region: clean(parsed.region),
    phone: clean(parsed.phone),
    email: clean(parsed.email),
    whatsapp: clean(parsed.whatsapp),
    products: Array.isArray(parsed.products) ? parsed.products.filter((p: any) => p?.canonical_name).slice(0, 20).map((p: any) => ({
      canonical_name: String(p.canonical_name), category: clean(p.category), description: clean(p.description)
    })) : [],
  };
}

// --- Shared governed service: createCeoConfirmation ----------------------------------------------
// Bounded field lengths, matching what a genuine confirmation call ever needs - defends against
// a malformed/oversized payload regardless of which route (JSON API or session UI) calls this.
const MAX_LEN = { name: 200, domain: 253, date: 40, contact: 200, notes: 2000, reason: 500 };
const clip = (s: string, max: number) => s.slice(0, max);

export interface CeoConfirmInput {
  canonicalProviderName: string;
  officialDomain: string;
  dateSpoken: string;
  providerContactName?: string;
  providerContactRole?: string;
  websiteContentMayBeUsed: boolean;
  officialDealsMayBePrepared: boolean;
  imagesMayBeDisplayed: boolean;
  notes?: string;
  reason?: string;
  authorizationSource?: string;
  initialEnquiryHandler?: 'VAKAVITI' | 'PROVIDER';
}

export type CeoConfirmResult =
  | { ok: true; confirmationId: string; canonicalDomain: string; engines: any }
  | { ok: false; status: number; error: string; detail?: any };

export async function createCeoConfirmation(env: Bindings, input: CeoConfirmInput, actor: string): Promise<CeoConfirmResult> {
  const canonicalName = clip(String(input.canonicalProviderName || '').trim(), MAX_LEN.name);
  const officialDomainRaw = clip(String(input.officialDomain || '').trim(), MAX_LEN.domain);
  const dateSpoken = clip(String(input.dateSpoken || '').trim(), MAX_LEN.date);

  const missing: string[] = [];
  if (!canonicalName) missing.push('canonical_provider_name');
  if (!officialDomainRaw) missing.push('official_domain');
  if (!dateSpoken) missing.push('date_spoken');
  if (missing.length) return { ok: false, status: 422, error: 'missing_required_confirmation_fields', detail: { missing } };

  const canonicalDomain = canonicalizeDomain(officialDomainRaw);
  if (!canonicalDomain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(canonicalDomain)) {
    return { ok: false, status: 422, error: 'invalid_official_domain', detail: { supplied: officialDomainRaw } };
  }

  // Identity engine: duplicate/ambiguity check across every existing identity surface. Fails
  // closed on ANY match - a human resolves ambiguity, this function never does. The partial
  // unique index on provider_ceo_confirmations(canonical_domain) WHERE revoked_at IS NULL backs
  // this at the DB level too, in case of a race between two near-simultaneous confirmations.
  const existingConfirmation = await env.DB.prepare(
    `SELECT id, canonical_provider_name FROM provider_ceo_confirmations WHERE canonical_domain=? AND revoked_at IS NULL`
  ).bind(canonicalDomain).first<any>();
  if (existingConfirmation) {
    return { ok: false, status: 409, error: 'duplicate_provider_confirmation', detail: { existing_confirmation_id: existingConfirmation.id, existing_provider_name: existingConfirmation.canonical_provider_name } };
  }
  const existingOperator = await env.DB.prepare(
    `SELECT id, canonical_name, slug FROM operators WHERE website_url LIKE ? OR website_url LIKE ?`
  ).bind(`%${canonicalDomain}%`, `%www.${canonicalDomain}%`).first<any>();
  if (existingOperator) {
    return { ok: false, status: 409, error: 'ambiguous_identity_existing_operator', detail: { existing_operator: existingOperator } };
  }
  const existingCandidate = await env.DB.prepare(
    `SELECT id, canonical_name FROM candidate_operators WHERE primary_url LIKE ? OR website_url LIKE ?`
  ).bind(`%${canonicalDomain}%`, `%${canonicalDomain}%`).first<any>();
  if (existingCandidate) {
    return { ok: false, status: 409, error: 'ambiguous_identity_existing_candidate', detail: { existing_candidate: existingCandidate } };
  }
  const existingDealSource = await env.DB.prepare(
    `SELECT id, canonical_domain FROM deal_sources WHERE canonical_domain=?`
  ).bind(canonicalDomain).first<any>();
  if (existingDealSource) {
    return { ok: false, status: 409, error: 'ambiguous_identity_existing_deal_source', detail: { existing_source: existingDealSource } };
  }

  const reason = clip(String(input.reason || 'CEO-confirmed pilot partner onboarding').trim(), MAX_LEN.reason);
  const enquiryHandler = input.initialEnquiryHandler === 'PROVIDER' ? 'PROVIDER' : 'VAKAVITI';
  const confirmationId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO provider_ceo_confirmations (
      id, canonical_provider_name, official_domain, canonical_domain, date_spoken,
      provider_contact_name, provider_contact_role, participation_confirmed,
      scope_website_content_allowed, scope_deals_allowed, scope_images_allowed,
      notes, status, actor, authorization_source, reason, initial_enquiry_handler
    ) VALUES (?,?,?,?,?, ?,?,?, ?,?,?, ?,'CEO_CONFIRMED_PILOT',?,?,?,?)`
  ).bind(
    confirmationId, canonicalName, officialDomainRaw, canonicalDomain, dateSpoken,
    input.providerContactName ? clip(String(input.providerContactName), MAX_LEN.contact) : null,
    input.providerContactRole ? clip(String(input.providerContactRole), MAX_LEN.contact) : null,
    1,
    input.websiteContentMayBeUsed === true ? 1 : 0,
    input.officialDealsMayBePrepared === true ? 1 : 0,
    input.imagesMayBeDisplayed === true ? 1 : 0,
    input.notes ? clip(String(input.notes), MAX_LEN.notes) : null,
    actor, clip(String(input.authorizationSource || 'CEO_VERBAL_CONFIRMATION'), 60),
    reason, enquiryHandler
  ).run();

  await auditWrite(env.DB, 'PROVIDER_CEO_CONFIRMATION', confirmationId, 'CEO_CONFIRMED_PILOT', actor, reason,
    { existed: false },
    { confirmation_id: confirmationId, canonical_provider_name: canonicalName, canonical_domain: canonicalDomain });

  // Bounded engines run synchronously, in the same authenticated call that created the
  // confirmation - never as a later, unauthenticated, AI-triggered action.
  const engines = await runOnboardingEngines(env, confirmationId, actor);
  return { ok: true, confirmationId, canonicalDomain, engines };
}

// --- Shared governed service: revokeCeoConfirmation -----------------------------------------------
export async function revokeCeoConfirmation(env: Bindings, confirmationId: string, reason: string, actor: string): Promise<{ ok: true; operatorId: string | null } | { ok: false; status: number; error: string }> {
  const row = await env.DB.prepare(`SELECT * FROM provider_ceo_confirmations WHERE id=?`).bind(confirmationId).first<any>();
  if (!row) return { ok: false, status: 404, error: 'not_found' };
  if (row.revoked_at) return { ok: false, status: 409, error: 'already_revoked' };
  const cleanReason = clip(String(reason || '').trim(), MAX_LEN.reason);
  if (!cleanReason) return { ok: false, status: 422, error: 'revocation_reason_required' };

  await env.DB.prepare(
    `UPDATE provider_ceo_confirmations SET revoked_at=CURRENT_TIMESTAMP, revoked_by=?, revocation_reason=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
  ).bind(actor, cleanReason, confirmationId).run();

  if (row.operator_id) {
    await env.DB.prepare(`UPDATE operators SET commercial_status='INACTIVE', updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(row.operator_id).run();
    await auditWrite(env.DB, 'OPERATOR', row.operator_id, 'CEO_CONFIRMATION_REVOKED', actor, cleanReason, { commercial_status: 'ACTIVE' }, { commercial_status: 'INACTIVE' });
  }
  return { ok: true, operatorId: row.operator_id ?? null };
}

// --- The bounded onboarding workflow (engines 1-6; place/claim/monitoring are wiring, not new code) ---
async function runOnboardingEngines(env: Bindings, confirmationId: string, actor: string): Promise<any> {
  const confirmation = await env.DB.prepare(`SELECT * FROM provider_ceo_confirmations WHERE id=?`).bind(confirmationId).first<any>();
  if (!confirmation) return { error: 'confirmation_not_found' };

  const summary: any = { identity: null, profile: null, product: null, deal: null, publish: null };

  // 1. Identity engine: create the candidate_operators row (DISCOVERED), matching the exact
  // shape candidates.ts's own /ingest endpoint uses, so this provider is visible through the
  // same admin tooling as any AI-discovered candidate.
  const candidateId = crypto.randomUUID();
  const normalized = String(confirmation.canonical_provider_name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
  const primaryUrl = `https://${confirmation.canonical_domain}`;
  await env.DB.prepare(
    `INSERT INTO candidate_operators (id, canonical_name, normalized_name, primary_url, website_url, workflow_state, last_enriched_at)
     VALUES (?,?,?,?,?, 'DISCOVERED', NULL)`
  ).bind(candidateId, confirmation.canonical_provider_name, normalized, primaryUrl, primaryUrl).run();
  summary.identity = { candidate_operator_id: candidateId, canonical_domain: confirmation.canonical_domain };

  // 2. Profile engine + 3. Product engine: only if the CEO explicitly authorized reading the
  // official site. A single safe fetch, reused for the profile extraction, the product
  // extraction, AND (if authorized) the deal-quality scan below - one authorized read, not three.
  let pageText: string | null = null;
  let pageFingerprint: string | null = null;
  let profile: ProfileExtraction | null = null;

  if (confirmation.scope_website_content_allowed === 1) {
    const fetchResult = await safeFetchSource(primaryUrl);
    if (fetchResult.ok && fetchResult.body) {
      pageText = fetchResult.body;
      pageFingerprint = await fingerprint(fetchResult.body);
      await env.DB.prepare(
        `INSERT INTO candidate_sources (id, candidate_id, source_type, source_url, source_title, extracted_json, confidence) VALUES (?,?,?,?,?,?,?)`
      ).bind(crypto.randomUUID(), candidateId, 'CEO_CONFIRMED_OFFICIAL_SITE', primaryUrl, null, JSON.stringify({ fetched: true, fingerprint: pageFingerprint }), 1).run();

      profile = await extractProfileAndProducts(env, pageText);
      if (profile) {
        await env.DB.prepare(
          `UPDATE candidate_operators SET locality=COALESCE(?,locality), region=COALESCE(?,region), phone=COALESCE(?,phone), email=COALESCE(?,email), whatsapp=COALESCE(?,whatsapp), workflow_state='ENRICHED', last_enriched_at=CURRENT_TIMESTAMP WHERE id=?`
        ).bind(profile.locality, profile.region, profile.phone, profile.email, profile.whatsapp, candidateId).run();
      }
    } else {
      summary.profile = { fetched: false, reason: fetchResult.classification };
    }
  }
  summary.profile = summary.profile ?? { fetched: !!pageText, extracted: !!profile };

  // Identity engine step 2: since a single CEO confirmation is the whole authorization for this
  // introductory pilot (no further per-stage human pause), the candidate is qualified and
  // promoted to a real operator immediately - always NOT_VERIFIED and UNCLAIMED, matching
  // candidates.ts's own promote endpoint exactly (verification and claiming stay wholly separate,
  // untouched by this fast-track).
  const candidateRow = await env.DB.prepare(`SELECT * FROM candidate_operators WHERE id=?`).bind(candidateId).first<any>();
  const operatorId = crypto.randomUUID();
  const slugBase = normalized.replace(/\s+/g, '-');
  const slug = `${slugBase}-${operatorId.slice(0, 8)}`;
  await env.DB.prepare(
    `INSERT INTO operators (id, canonical_name, slug, description, website_url, whatsapp, email, phone, locality, region, country_code, discovery_status, claim_status, verification_status, commercial_status)
     VALUES (?,?,?,?,?,?,?,?,?,?, 'FJ', 'PUBLICLY_LISTED', 'UNCLAIMED', 'NOT_VERIFIED', 'INACTIVE')`
  ).bind(operatorId, candidateRow.canonical_name, slug, profile?.description ?? null, primaryUrl, candidateRow.whatsapp, candidateRow.email, candidateRow.phone, candidateRow.locality, candidateRow.region).run();
  await env.DB.prepare(`UPDATE candidate_operators SET workflow_state='QUALIFIED', reviewed_at=CURRENT_TIMESTAMP, reviewed_by=? WHERE id=?`).bind(actor, candidateId).run();
  await env.DB.prepare(`UPDATE provider_ceo_confirmations SET operator_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(operatorId, confirmationId).run();
  await auditWrite(env.DB, 'CANDIDATE_OPERATOR', candidateId, 'PROMOTED_TO_OPERATOR', actor, 'CEO-confirmed fast-track promotion', candidateRow, { operator_id: operatorId, slug, verification_status: 'NOT_VERIFIED', commercial_status: 'INACTIVE' });
  summary.identity.operator_id = operatorId;
  summary.identity.slug = slug;

  // 3. Product engine: create + promote product candidates with a real name and category -
  // missing price simply means no `offers` row exists yet, which the public template already
  // renders as "Contact for price" (never invented).
  const createdProducts: string[] = [];
  if (profile && profile.products.length > 0) {
    for (const p of profile.products) {
      if (!p.canonical_name || !p.category) continue; // minimum bar: name + category, matching operators' own promote bar
      const pcId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO product_candidates (id, operator_id, canonical_name, category, description, source_url, source_type, review_status)
         VALUES (?,?,?,?,?,?, 'CEO_CONFIRMED_OFFICIAL_SITE', 'APPROVED')`
      ).bind(pcId, operatorId, p.canonical_name, p.category, p.description ?? null, primaryUrl).run();
      const productId = crypto.randomUUID();
      const pSlug = `${p.canonical_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${productId.slice(0, 8)}`;
      await env.DB.prepare(
        `INSERT INTO products (id, operator_id, canonical_name, slug, category, description, verification_status, commercial_status) VALUES (?,?,?,?,?,?, 'NOT_VERIFIED','INACTIVE')`
      ).bind(productId, operatorId, p.canonical_name, pSlug, p.category, p.description ?? null).run();
      await env.DB.prepare(`UPDATE product_candidates SET promoted_product_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(productId, pcId).run();
      createdProducts.push(productId);
    }
  }
  summary.product = { created_count: createdProducts.length, product_ids: createdProducts };

  // 4. Deal engine: only if explicitly authorized, and only via the exact same P1.2 gate every
  // scheduled scan uses - never a relaxed path just because a human introduced this source.
  if (confirmation.scope_deals_allowed === 1 && pageText) {
    const sourceId = crypto.randomUUID();
    const dealSourceUrl = `https://${confirmation.canonical_domain}/`;
    await env.DB.prepare(
      `INSERT INTO deal_sources (id, source_url, canonical_domain, source_type, source_approval_status, approved_by, approved_at, content_fingerprint, last_scan_at, last_http_status, failure_count)
       VALUES (?,?,?, 'PROVIDER_WEBSITE', 'APPROVED', ?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP, 200, 0)`
    ).bind(sourceId, dealSourceUrl, confirmation.canonical_domain, actor, pageFingerprint).run();

    const extraction = await extractOfferFacts(env, pageText, dealSourceUrl);
    if (extraction) {
      const canonicalUrl = canonicalizeUrl(dealSourceUrl);
      const quality = evaluateQualityGates(canonicalUrl, extraction.fields as unknown as ExtractedFields, extraction.confidence, pageText);
      if (quality.decision === 'ACCEPTED') {
        const dealCandidateId = crypto.randomUUID();
        const expiryStatus = computeExpiryStatus(extraction.fields.offer_expires_at);
        await env.DB.prepare(
          `INSERT INTO deal_offer_candidates (
            id, source_id, source_url, source_checked_at, source_fingerprint,
            proposed_offer_name, factual_summary, category, fiji_location, advertised_price,
            reference_price, currency, price_basis, explicit_discount, promo_code,
            booking_deadline, travel_from, travel_until, offer_expires_at, expiry_status,
            blackout_dates, minimum_stay, minimum_group_size, eligibility, inclusions, exclusions,
            cancellation_terms, booking_route, seller_or_marketer,
            evidence_state, extraction_confidence, missing_fields, review_status, created_by
          ) VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?,?, ?,?,?, ?,?,?,?,?)`
        ).bind(
          dealCandidateId, sourceId, dealSourceUrl, new Date().toISOString(), pageFingerprint,
          extraction.fields.proposed_offer_name ?? null, extraction.fields.factual_summary ?? null,
          extraction.fields.category ?? null, extraction.fields.fiji_location ?? null, extraction.fields.advertised_price ?? null,
          extraction.fields.reference_price ?? null, extraction.fields.currency ?? null, extraction.fields.price_basis ?? null,
          extraction.fields.explicit_discount ?? null, extraction.fields.promo_code ?? null,
          extraction.fields.booking_deadline ?? null, extraction.fields.travel_from ?? null, extraction.fields.travel_until ?? null,
          extraction.fields.offer_expires_at ?? null, expiryStatus,
          extraction.fields.blackout_dates ?? null, extraction.fields.minimum_stay ?? null, extraction.fields.minimum_group_size ?? null,
          extraction.fields.eligibility ?? null, extraction.fields.inclusions ?? null, extraction.fields.exclusions ?? null,
          extraction.fields.cancellation_terms ?? null, extraction.fields.booking_route ?? null, extraction.fields.seller_or_marketer ?? null,
          'CANDIDATE', extraction.confidence, JSON.stringify(extraction.missingFields),
          'NEEDS_HUMAN_REVIEW', 'AI_AGENT'
        ).run();
        summary.deal = { source_id: sourceId, candidate_id: dealCandidateId, quality_decision: 'ACCEPTED', review_status: 'NEEDS_HUMAN_REVIEW' };
      } else {
        summary.deal = { source_id: sourceId, candidate_id: null, quality_decision: 'QUALITY_REJECTED', rejection_reason: quality.rejectionReason };
      }
    } else {
      summary.deal = { source_id: sourceId, candidate_id: null, quality_decision: 'EXTRACTION_FAILED' };
    }
  } else {
    summary.deal = { skipped: true, reason: confirmation.scope_deals_allowed !== 1 ? 'scope_not_authorized' : 'no_page_text' };
  }

  // Publish gate: an operator profile may go publicly ACTIVE only once it has a genuine enquiry
  // route (whatsapp/phone/email) - CEO confirmation authorizes publication, but "enquiry routing
  // works" is still a hard requirement, never waived. No image is ever attached without
  // scope_images_allowed, and none is fabricated here regardless - image_url stays untouched.
  const finalOperator = await env.DB.prepare(`SELECT whatsapp, phone, email FROM operators WHERE id=?`).bind(operatorId).first<any>();
  const hasContact = !!(finalOperator?.whatsapp || finalOperator?.phone || finalOperator?.email);
  if (hasContact) {
    await env.DB.prepare(`UPDATE operators SET commercial_status='ACTIVE', updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(operatorId).run();
    for (const pid of createdProducts) {
      await env.DB.prepare(`UPDATE products SET commercial_status='ACTIVE', updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(pid).run();
    }
    await auditWrite(env.DB, 'OPERATOR', operatorId, 'CEO_CONFIRMED_PUBLISH', actor, 'Published as Vakaviti Pilot Partner under CEO confirmation', { commercial_status: 'INACTIVE' }, { commercial_status: 'ACTIVE' });
    summary.publish = { published: true, operator_id: operatorId };
  } else {
    summary.publish = { published: false, reason: 'no_enquiry_contact_extracted_or_supplied' };
  }

  await env.DB.prepare(`UPDATE provider_ceo_confirmations SET onboarding_summary_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(JSON.stringify(summary), confirmationId).run();
  return summary;
}

// --- POST /ceo-confirm - Bearer-token JSON API, calls the shared service ------------------------
providerOnboarding.post('/ceo-confirm', async c => {
  const body = await c.req.json<any>().catch(() => ({}));
  const result = await createCeoConfirmation(c.env, {
    canonicalProviderName: body.canonical_provider_name,
    officialDomain: body.official_domain,
    dateSpoken: body.date_spoken,
    providerContactName: body.provider_contact_name,
    providerContactRole: body.provider_contact_role,
    websiteContentMayBeUsed: body.website_content_may_be_used === true,
    officialDealsMayBePrepared: body.official_deals_may_be_prepared === true,
    imagesMayBeDisplayed: body.images_may_be_displayed === true,
    notes: body.notes,
    reason: body.reason,
    authorizationSource: body.authorization_source,
    initialEnquiryHandler: body.initial_enquiry_handler === 'PROVIDER' ? 'PROVIDER' : 'VAKAVITI',
  }, 'CEO (Bearer API session)'); // actor is fixed by the calling route, never taken from the request body

  if (!result.ok) return c.json({ error: result.error, ...(result.detail || {}) }, result.status as any);
  return c.json({ confirmation_id: result.confirmationId, status: 'CEO_CONFIRMED_PILOT', engines: result.engines }, 201);
});

// --- GET /:id - admin view of one confirmation record -------------------------------------------
providerOnboarding.get('/:id', async c => {
  const row = await c.env.DB.prepare(`SELECT * FROM provider_ceo_confirmations WHERE id=?`).bind(c.req.param('id')).first<any>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ confirmation: row });
});

// --- POST /:id/revoke - Bearer-token JSON API, calls the shared service -------------------------
providerOnboarding.post('/:id/revoke', async c => {
  const id = c.req.param('id');
  const body = await c.req.json<any>().catch(() => ({}));
  const result = await revokeCeoConfirmation(c.env, id, String(body.reason || ''), 'CEO (Bearer API session)');
  if (!result.ok) return c.json({ error: result.error }, result.status as any);
  return c.json({ confirmation_id: id, status: 'REVOKED', operator_id: result.operatorId, operator_deactivated: !!result.operatorId }, 200);
});
