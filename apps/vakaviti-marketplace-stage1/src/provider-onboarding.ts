import { Hono } from 'hono';
import { safeFetchSource, fingerprint, extractOfferFacts, computeExpiryStatus } from './deal-agent';
import { canonicalizeUrl, evaluateQualityGates, type ExtractedFields } from './deal-quality';
import { DEFAULT_MODEL } from './ai';

// Vakaviti P1.3A - CEO-confirmed provider fast-track onboarding. This file is the ONLY place
// a CEO confirmation can ever be created, revoked, or read (requireAdmin end-to-end, no
// exemptions) - AI has no import path to this file (see regression-guards.mjs check 16), so it
// structurally cannot create the authorization event this whole pipeline is gated on. Everything
// this file does AFTER a confirmation exists is either a direct reuse of already-governed
// pipelines (extractOfferFacts/evaluateQualityGates/classifyPage from the P1.2 Deal Intelligence
// work, safeFetchSource/fingerprint from deal-agent.ts) or a narrow, fail-closed, additive step -
// nothing here invents a commercial fact, grants Vakaviti's own human-only verified status, or publishes a Deal without
// the same human review gate every other candidate goes through.

// ENVIRONMENT is declared (even though unused directly here) because extractOfferFacts()'s own
// Bindings type in deal-agent.ts requires it - keeping the shape a structural superset avoids a
// widening cast at every call site.
type Bindings = { DB: D1Database; AI: Ai; ENVIRONMENT: string; ADMIN_TOKEN?: string };
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
function canonicalizeDomain(input: string): string {
  let host = String(input || '').trim().toLowerCase();
  host = host.replace(/^https?:\/\//, '').split('/')[0];
  host = host.replace(/^www\./, '');
  return host;
}

const auditWrite = (db: D1Database, entityType: string, entityId: string, actionType: string, actor: string, note: string, before: any, after: any) =>
  db.prepare(`INSERT INTO review_actions (id, entity_type, entity_id, action_type, actor, note, before_json, after_json) VALUES (?,?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(), entityType, entityId, actionType, actor, note, JSON.stringify(before), JSON.stringify(after)).run();

// --- Profile+product extraction (profile engine + product engine) --------------------------------
// A single AI read of the authorized official page - never guesses, never invents; every field
// left null/omitted by the model stays missing. Distinct field shape from deal-agent.ts's
// EXTRACTION_FIELDS on purpose (this is about the PROVIDER and its PRODUCTS, not a promotional
// offer) - the deal signal itself is extracted separately, by reusing extractOfferFacts() as-is,
// so it's evaluated by the exact same P1.2 gate every other scanned deal goes through.
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

// --- POST /ceo-confirm - the single governed authorization event -------------------------------
providerOnboarding.post('/ceo-confirm', async c => {
  const body = await c.req.json<any>().catch(() => ({}));
  const canonicalName = String(body.canonical_provider_name || '').trim();
  const officialDomain = String(body.official_domain || '').trim();
  const dateSpoken = String(body.date_spoken || '').trim();
  const participationConfirmed = body.participation_confirmed === true;
  const actor = String(body.actor || 'CEO').trim();

  const missing: string[] = [];
  if (!canonicalName) missing.push('canonical_provider_name');
  if (!officialDomain) missing.push('official_domain');
  if (!dateSpoken) missing.push('date_spoken');
  if (!participationConfirmed) missing.push('participation_confirmed (must be true)');
  if (missing.length) return c.json({ error: 'missing_required_confirmation_fields', missing }, 422);

  const canonicalDomain = canonicalizeDomain(officialDomain);

  // Identity engine: duplicate/ambiguity check across every existing identity surface. Fails
  // closed on ANY match rather than guessing whether it's the same provider - a human resolves
  // ambiguity, this endpoint never does. The partial unique index on
  // provider_ceo_confirmations(canonical_domain) WHERE revoked_at IS NULL backs this at the DB
  // level too, in case of a race between two near-simultaneous confirmations for the same domain.
  const existingConfirmation = await c.env.DB.prepare(
    `SELECT id, canonical_provider_name FROM provider_ceo_confirmations WHERE canonical_domain=? AND revoked_at IS NULL`
  ).bind(canonicalDomain).first<any>();
  if (existingConfirmation) {
    return c.json({ error: 'duplicate_provider_confirmation', existing_confirmation_id: existingConfirmation.id, existing_provider_name: existingConfirmation.canonical_provider_name }, 409);
  }
  const existingOperator = await c.env.DB.prepare(
    `SELECT id, canonical_name, slug FROM operators WHERE website_url LIKE ? OR website_url LIKE ?`
  ).bind(`%${canonicalDomain}%`, `%www.${canonicalDomain}%`).first<any>();
  if (existingOperator) {
    return c.json({ error: 'ambiguous_identity_existing_operator', existing_operator: existingOperator }, 409);
  }
  const existingCandidate = await c.env.DB.prepare(
    `SELECT id, canonical_name FROM candidate_operators WHERE primary_url LIKE ? OR website_url LIKE ?`
  ).bind(`%${canonicalDomain}%`, `%${canonicalDomain}%`).first<any>();
  if (existingCandidate) {
    return c.json({ error: 'ambiguous_identity_existing_candidate', existing_candidate: existingCandidate }, 409);
  }
  const existingDealSource = await c.env.DB.prepare(
    `SELECT id, canonical_domain FROM deal_sources WHERE canonical_domain=?`
  ).bind(canonicalDomain).first<any>();
  if (existingDealSource) {
    return c.json({ error: 'ambiguous_identity_existing_deal_source', existing_source: existingDealSource }, 409);
  }

  const confirmationId = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO provider_ceo_confirmations (
      id, canonical_provider_name, official_domain, canonical_domain, date_spoken,
      provider_contact_name, provider_contact_role, participation_confirmed,
      scope_website_content_allowed, scope_deals_allowed, scope_images_allowed,
      notes, status, actor, authorization_source, reason
    ) VALUES (?,?,?,?,?, ?,?,?, ?,?,?, ?,'CEO_CONFIRMED_PILOT',?,?,?)`
  ).bind(
    confirmationId, canonicalName, officialDomain, canonicalDomain, dateSpoken,
    body.provider_contact_name ? String(body.provider_contact_name) : null,
    body.provider_contact_role ? String(body.provider_contact_role) : null,
    1,
    body.website_content_may_be_used === true ? 1 : 0,
    body.official_deals_may_be_prepared === true ? 1 : 0,
    body.images_may_be_displayed === true ? 1 : 0,
    body.notes ? String(body.notes) : null,
    actor, String(body.authorization_source || 'CEO_VERBAL_CONFIRMATION'),
    String(body.reason || 'CEO-confirmed pilot partner onboarding')
  ).run();

  await auditWrite(c.env.DB, 'PROVIDER_CEO_CONFIRMATION', confirmationId, 'CEO_CONFIRMED_PILOT', actor,
    String(body.reason || 'CEO-confirmed pilot partner onboarding'),
    { existed: false },
    { confirmation_id: confirmationId, canonical_provider_name: canonicalName, canonical_domain: canonicalDomain });

  // Bounded engines run synchronously, in the same authenticated request that created the
  // confirmation - never as a later, unauthenticated, AI-triggered action.
  const summary = await runOnboardingEngines(c.env, confirmationId);

  return c.json({ confirmation_id: confirmationId, status: 'CEO_CONFIRMED_PILOT', engines: summary }, 201);
});

// --- The bounded onboarding workflow (engines 1-6; place/claim/monitoring are wiring, not new code) ---
async function runOnboardingEngines(env: Bindings, confirmationId: string): Promise<any> {
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
  await env.DB.prepare(`UPDATE candidate_operators SET workflow_state='QUALIFIED', reviewed_at=CURRENT_TIMESTAMP, reviewed_by=? WHERE id=?`).bind(confirmation.actor, candidateId).run();
  await env.DB.prepare(`UPDATE provider_ceo_confirmations SET operator_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(operatorId, confirmationId).run();
  await auditWrite(env.DB, 'CANDIDATE_OPERATOR', candidateId, 'PROMOTED_TO_OPERATOR', confirmation.actor, 'CEO-confirmed fast-track promotion', candidateRow, { operator_id: operatorId, slug, verification_status: 'NOT_VERIFIED', commercial_status: 'INACTIVE' });
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
    ).bind(sourceId, dealSourceUrl, confirmation.canonical_domain, confirmation.actor, pageFingerprint).run();

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
    await auditWrite(env.DB, 'OPERATOR', operatorId, 'CEO_CONFIRMED_PUBLISH', confirmation.actor, 'Published as Vakaviti Pilot Partner under CEO confirmation', { commercial_status: 'INACTIVE' }, { commercial_status: 'ACTIVE' });
    summary.publish = { published: true, operator_id: operatorId };
  } else {
    summary.publish = { published: false, reason: 'no_enquiry_contact_extracted_or_supplied' };
  }

  await env.DB.prepare(`UPDATE provider_ceo_confirmations SET onboarding_summary_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(JSON.stringify(summary), confirmationId).run();
  return summary;
}

// --- GET /:id - admin view of one confirmation record -------------------------------------------
providerOnboarding.get('/:id', async c => {
  const row = await c.env.DB.prepare(`SELECT * FROM provider_ceo_confirmations WHERE id=?`).bind(c.req.param('id')).first<any>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ confirmation: row });
});

// --- POST /:id/revoke - the only path back out; removes Pilot Partner eligibility immediately ---
providerOnboarding.post('/:id/revoke', async c => {
  const id = c.req.param('id');
  const body = await c.req.json<any>().catch(() => ({}));
  const row = await c.env.DB.prepare(`SELECT * FROM provider_ceo_confirmations WHERE id=?`).bind(id).first<any>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (row.revoked_at) return c.json({ error: 'already_revoked' }, 409);

  const reason = String(body.reason || '').trim();
  if (!reason) return c.json({ error: 'revocation_reason_required' }, 422);
  const actor = String(body.actor || 'CEO').trim();

  await c.env.DB.prepare(
    `UPDATE provider_ceo_confirmations SET revoked_at=CURRENT_TIMESTAMP, revoked_by=?, revocation_reason=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
  ).bind(actor, reason, id).run();

  if (row.operator_id) {
    await c.env.DB.prepare(`UPDATE operators SET commercial_status='INACTIVE', updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(row.operator_id).run();
    await auditWrite(c.env.DB, 'OPERATOR', row.operator_id, 'CEO_CONFIRMATION_REVOKED', actor, reason, { commercial_status: 'ACTIVE' }, { commercial_status: 'INACTIVE' });
  }

  return c.json({ confirmation_id: id, status: 'REVOKED', operator_id: row.operator_id, operator_deactivated: !!row.operator_id }, 200);
});
