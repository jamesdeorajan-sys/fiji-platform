import { safeFetchSource } from './deal-agent';

// Vakaviti P1.4 - the missing governed bridge from an official, provider-controlled domain to
// PROVIDER discovery (candidate_operators), as distinct from deal-agent.ts's existing OFFER
// discovery (deal_offer_candidates) - the two have always run on the same source list in spirit
// (the CEO's 7 authorized providers) but only the offer side was ever wired up before this file.
//
// AI-facing code. Structurally incapable of publication: every write here lands in
// candidate_operators/candidate_sources/candidate_claims/product_candidates only, all of which
// stay private by construction (workflow_state is DISCOVERED or ENRICHED, never QUALIFIED/
// SHORTLISTED - promotion to a public directory listing is a separate, later, human-authorized
// step in src/candidates.ts's promoteCandidateToDirectoryListing(), which this file never calls
// or imports). No function here ever writes to `operators`, `products`, `provider_ceo_confirmations`,
// or `standing_policies`.
//
// Reuses safeFetchSource()/fingerprint() from deal-agent.ts as-is (same SSRF-safe fetch, same
// redirect/TLS/timeout/size discipline already proven in production) rather than duplicating
// fetch logic. Does not import deal-quality.ts's classifyPage()/evaluateQualityGates() - those are
// shaped specifically around commercial OFFER pages (price/discount/booking-deadline signals);
// this file's own weak-page bar (name + locality + contact) is the provider-identity equivalent.

type Bindings = { DB: D1Database; AI: Ai; ENVIRONMENT: string; ADMIN_TOKEN?: string };

const canonicalizeDomain = (input: string): string => {
  let host = String(input || '').trim().toLowerCase();
  host = host.replace(/^https?:\/\//, '').split('/')[0];
  host = host.replace(/^www\./, '');
  return host;
};

const normalizeName = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();

const PROFILE_FIELDS = ['canonical_name', 'description', 'locality', 'region', 'phone', 'email', 'whatsapp', 'category'];

// Generic navigation/marketing labels a model might mistake for a "product" - filtered out before
// anything reaches product_candidates, per the CEO directive's "do not turn generic page headings
// into products" instruction.
const GENERIC_PRODUCT_WORDS = new Set([
  'home', 'about', 'about us', 'contact', 'contact us', 'gallery', 'blog', 'news', 'faq', 'faqs',
  'terms', 'terms and conditions', 'privacy', 'privacy policy', 'booking', 'book now', 'offers',
  'special offers', 'specials', 'accommodation', 'rooms', 'rates', 'reviews', 'testimonials',
  'careers', 'sitemap', 'menu',
]);

function extractJsonPayload(raw: string): any | null {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  try { return JSON.parse(s); } catch {}
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try { return JSON.parse(s.slice(first, last + 1)); } catch {}
  }
  return null;
}

interface ProfileExtraction {
  fields: Record<string, string | null>;
  missingFields: string[];
  confidence: number;
  products: string[];
}

async function extractProviderProfile(env: Bindings, pageText: string, sourceUrl: string): Promise<ProfileExtraction | null> {
  const truncated = pageText.slice(0, 12000);
  const prompt = `You are extracting FACTUAL business profile fields from a Fiji tourism provider's own official website. Only report a fact if it is explicitly stated in the text below. If a field is not clearly present, use null - never guess, infer, or invent a value (especially phone, email, WhatsApp, and locality). Return ONLY a JSON object with exactly these keys: ${PROFILE_FIELDS.join(', ')}, products.

"products" must be a JSON array of at most 5 concrete, bookable tour/package/service names explicitly offered on this page (e.g. "Sunset Lagoon Cruise", "Full Day Island Tour"). Never include generic navigation or marketing labels such as "Home", "About Us", "Contact", "Gallery", "Special Offers", or "Book Now" - only real, named things a traveller could book. Use an empty array if none are clearly named.

Source URL: ${sourceUrl}
Page text:
${truncated}`;

  let aiResp: any;
  try {
    aiResp = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fp8', {
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });
  } catch {
    return null; // AI call failure - no candidate is fabricated
  }
  const text = typeof aiResp === 'string' ? aiResp : (aiResp?.response ?? JSON.stringify(aiResp));
  const parsed = extractJsonPayload(text);
  if (!parsed || typeof parsed !== 'object') return null;

  const fields: Record<string, string | null> = {};
  const missingFields: string[] = [];
  for (const key of PROFILE_FIELDS) {
    const v = parsed[key];
    if (v === undefined || v === null || v === '' || String(v).toLowerCase() === 'null') {
      fields[key] = null;
      missingFields.push(key);
    } else {
      fields[key] = String(v).slice(0, 500);
    }
  }
  const confidence = Math.max(0, 1 - missingFields.length / PROFILE_FIELDS.length);

  let products: string[] = [];
  if (Array.isArray(parsed.products)) {
    products = parsed.products
      .map((p: any) => String(p || '').trim())
      .filter((p: string) => p.length >= 3 && p.length <= 120)
      .filter((p: string) => !GENERIC_PRODUCT_WORDS.has(p.toLowerCase()))
      .slice(0, 5);
  }

  return { fields, missingFields, confidence, products };
}

export type DiscoveryOutcome =
  | { outcome: 'SKIPPED_ALREADY_EXISTS'; reason: string }
  | { outcome: 'FETCH_FAILED'; httpStatus?: number; classification?: string; error?: string }
  | { outcome: 'REJECTED_WEAK'; httpStatus?: number; missingFields?: string[]; error: string }
  | { outcome: 'CANDIDATE_CREATED'; httpStatus?: number; classification?: string; candidateId: string; workflowState: string; missingFields: string[]; productsFound: number; identityConflict: boolean };

// Idempotency guard runs BEFORE any fetch: a domain already represented by a live operator or an
// existing discovery candidate is skipped entirely, so a duplicate rerun never re-fetches, never
// re-calls the model, and never creates a second row. This is the whole idempotency guarantee -
// deliberately simple and easy to prove (rerun the same domain twice; the second call returns
// SKIPPED_ALREADY_EXISTS and no new row exists).
export async function discoverProviderFromSource(env: Bindings, sourceDomainOrUrl: string): Promise<DiscoveryOutcome> {
  const domain = canonicalizeDomain(sourceDomainOrUrl);
  const rootUrl = `https://${domain}/`;
  const likeDomain = `%${domain}%`;

  const existingOperator = await env.DB.prepare(
    `SELECT id FROM operators WHERE website_url LIKE ? LIMIT 1`
  ).bind(likeDomain).first<any>();
  if (existingOperator) return { outcome: 'SKIPPED_ALREADY_EXISTS', reason: 'operator_already_exists' };

  const existingCandidate = await env.DB.prepare(
    `SELECT id FROM candidate_operators WHERE website_url LIKE ? OR primary_url LIKE ? LIMIT 1`
  ).bind(likeDomain, likeDomain).first<any>();
  if (existingCandidate) return { outcome: 'SKIPPED_ALREADY_EXISTS', reason: 'candidate_already_exists' };

  const fetchResult = await safeFetchSource(rootUrl);
  if (!fetchResult.ok) {
    return { outcome: 'FETCH_FAILED', httpStatus: fetchResult.status, classification: fetchResult.classification, error: fetchResult.error };
  }

  const extraction = await extractProviderProfile(env, fetchResult.body || '', rootUrl);
  if (!extraction || !extraction.fields.canonical_name) {
    return {
      outcome: 'REJECTED_WEAK', httpStatus: fetchResult.status,
      missingFields: extraction?.missingFields, error: !extraction
        ? 'AI extraction failed or returned unparseable output - no fields to gate.'
        : 'No canonical provider name could be extracted - page too weak to create a candidate.',
    };
  }

  const canonicalName: string = extraction.fields.canonical_name;
  const hasLocality = !!(extraction.fields.locality || extraction.fields.region);
  const hasContact = !!(extraction.fields.phone || extraction.fields.email || extraction.fields.whatsapp);
  const workflowState = (hasLocality && hasContact) ? 'ENRICHED' : 'DISCOVERED';

  const normalized = normalizeName(canonicalName);
  // Identity-contradiction detection: an existing candidate with the SAME normalized name but a
  // DIFFERENT domain on file is flagged via duplicate_of_id, which directory-gate.ts's gate #6
  // already treats as a hard block on public promotion - the contradiction stays private without
  // any new gate logic needed.
  const nameConflict = await env.DB.prepare(
    `SELECT id FROM candidate_operators WHERE normalized_name=? AND (website_url IS NULL OR website_url NOT LIKE ?) LIMIT 1`
  ).bind(normalized, likeDomain).first<any>();

  const candidateId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO candidate_operators (
      id, canonical_name, normalized_name, primary_url, website_url, phone, email, whatsapp,
      locality, region, categories_json, probable_products_json, confidence, workflow_state,
      duplicate_of_id, last_enriched_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`
  ).bind(
    candidateId, extraction.fields.canonical_name, normalized, rootUrl, rootUrl,
    extraction.fields.phone, extraction.fields.email, extraction.fields.whatsapp,
    extraction.fields.locality, extraction.fields.region,
    JSON.stringify(extraction.fields.category ? [extraction.fields.category] : []),
    JSON.stringify(extraction.products),
    extraction.confidence, workflowState, nameConflict ? nameConflict.id : null
  ).run();

  const sourceId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO candidate_sources (id, candidate_id, source_type, source_url, source_title, extracted_json, confidence) VALUES (?,?,?,?,?,?,?)`
  ).bind(sourceId, candidateId, 'PUBLIC_WEB', rootUrl, extraction.fields.canonical_name, JSON.stringify(extraction.fields), extraction.confidence).run();

  for (const field of PROFILE_FIELDS) {
    const value = extraction.fields[field];
    if (!value) continue;
    await env.DB.prepare(
      `INSERT INTO candidate_claims (id, candidate_id, field_name, observed_value, normalized_value, source_id, status, confidence) VALUES (?,?,?,?,?,?,?,?)`
    ).bind(crypto.randomUUID(), candidateId, field, value, value, sourceId, 'CANDIDATE', extraction.confidence).run();
  }

  for (const productName of extraction.products) {
    await env.DB.prepare(
      `INSERT INTO product_candidates (id, operator_candidate_id, canonical_name, category, source_url, source_type, evidence_status, review_status) VALUES (?,?,?,?,?,?,?,?)`
    ).bind(crypto.randomUUID(), candidateId, productName, extraction.fields.category || null, rootUrl, 'PUBLIC_WEB', 'CANDIDATE', 'PENDING').run();
  }

  return {
    outcome: 'CANDIDATE_CREATED', httpStatus: fetchResult.status, classification: fetchResult.classification,
    candidateId, workflowState, missingFields: extraction.missingFields, productsFound: extraction.products.length,
    identityConflict: !!nameConflict,
  };
}
