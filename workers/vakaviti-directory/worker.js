// ============================================================
// Vakaviti.ai — Directory Worker (standalone, read-only)
// Deploy as: vakaviti-directory
// Bindings:
//   DB (D1 → vakaviti-kb)
// Endpoints:
//   GET /listings — real partner data for lagi.vakaviti.ai's Categories
//                   directory, replacing the hardcoded LISTINGS array
//   GET /health
//
// Read-only by design — this Worker never writes to D1. It only joins
// partners + deals + partner_review_stats and maps the onboarding form's
// simpler category/region vocabulary onto display labels. It does not
// touch, import, or modify workers/chat-widget/worker.js (protected core)
// or its DEAL_TRIGGERS array in any way.
// ============================================================

const ALLOWED_ORIGINS_SUFFIXES = ['.vakaviti.ai', '.pages.dev'];
const ALLOWED_ORIGINS_EXACT = ['http://localhost:8000', 'http://localhost:8811'];

function getCors(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed =
    ALLOWED_ORIGINS_EXACT.includes(origin) ||
    ALLOWED_ORIGINS_SUFFIXES.some(suf => origin.endsWith(suf))
      ? origin
      : 'https://lagi.vakaviti.ai';
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age':       '86400',
    'Vary': 'Origin',
  };
}

function json(data, status = 200, cors = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}

// ── Category/region vocabulary mapping ──────────────────────
// The self-serve onboarding form (join.vakaviti.ai) uses a small, simple
// set of dropdown values. The PWA directory (Session 53) uses a richer
// taxonomy. This maps one onto the other — best-effort, not lossless.
// Known limitation, not fixed here: the onboarding form has no dropdown
// options for Pacific Harbour, Lautoka, or any secondary region at all
// (Labasa/Ba/Tavua/Rakiraki/Levuka/Lami/Nasinu/Kadavu) — those can never
// be populated via self-serve today. Flagged in BUILD.md, not this
// Worker's job to fix (that's an onboarding-form change).

const CATEGORY_MAP = {
  resort:     'Accommodation',
  apartment:  'Accommodation',
  tours:      'Day Tours & Island Trips',
  transfers:  'Airport & Ground Transfers',
  diving:     'Water Sports & Diving',
  ferry:      'Day Tours & Island Trips',
  restaurant: 'Dining',
  other:      'Other',
};

const REGION_MAP = {
  nadi:         'Nadi/Denarau',
  coral_coast:  'Coral Coast/Sigatoka',
  yasawa:       'Yasawa Islands',
  mamanuca:     'Mamanuca Islands',
  suva:         'Suva/Nausori',
  savusavu:     'Savusavu',
  taveuni:      'Taveuni',
  other:        'Other',
};

// Legacy partners (pre-dating the onboarding form, hand-entered across many
// past sessions) don't reliably use the form's exact vocabulary — plurals,
// different casing, or entirely different words. Rather than collapsing
// every unmapped value into a generic, uninformative "Other" bucket, an
// unmapped-but-present raw value is shown as its own reasonably-formatted
// label. "Other" is reserved for genuinely empty/null values only.
function titleCase(s) { return String(s).replace(/[_-]+/g,' ').trim().replace(/\b\w/g, c => c.toUpperCase()); }
function mapCategory(raw) {
  if (!raw) return 'Other';
  const key = String(raw).trim().toLowerCase();
  return CATEGORY_MAP[key] || titleCase(key);
}
function mapRegion(raw) {
  if (!raw) return 'Other';
  const key = String(raw).trim().toLowerCase();
  return REGION_MAP[key] || titleCase(key);
}

function normalizeName(s) { return String(s || '').trim().toLowerCase(); }

// Partner IDs that represent internal/platform records, not real bookable
// businesses — excluded from the directory. 'lagi_public' is the SITE_ID
// constant used throughout the codebase for lagi.vakaviti.ai's own config
// row, not an operator.
const EXCLUDED_IDS = new Set(['lagi_public']);

// ── Main handler ──────────────────────────────────────────

async function handleListings(request, env, cors) {
  if (!env.DB) return json({ listings: [] }, 200, cors);

  try {
    const [partnersResult, dealsResult, statsResult] = await Promise.all([
      env.DB.prepare(`
        SELECT id, name, category, region, description, website_url, whatsapp_number
        FROM partners WHERE status = 'active'
      `).all(),
      env.DB.prepare(`
        SELECT id, partner_id, partner_name, title, description, price_from, currency, category
        FROM deals WHERE active = 1
      `).all(),
      env.DB.prepare(`
        SELECT partner_id, total_reviews, avg_rating, five_star_count
        FROM partner_review_stats WHERE total_reviews > 0
      `).all().catch(() => ({ results: [] })), // table may not exist on every env — degrade gracefully, never fabricate
    ]);

    const partners = (partnersResult.results || []).filter(p => !EXCLUDED_IDS.has(p.id));
    const deals     = dealsResult.results || [];
    const stats     = statsResult.results || [];

    const partnersById = new Map();
    for (const p of partners) partnersById.set(p.id, p);
    // First match wins for a name shared by more than one partner row (a
    // real, pre-existing data duplicate — "Tour Fiji Tours" appears twice
    // in production — not something this Worker resolves on its own).
    const partnersByName = new Map();
    for (const p of partners) {
      const key = normalizeName(p.name);
      if (!partnersByName.has(key)) partnersByName.set(key, p);
    }

    const statsById = new Map();
    for (const s of stats) statsById.set(s.partner_id, s);

    function listingFromDeal(d, p) {
      const rating = p ? statsById.get(p.id) : null;
      return {
        id: d.id, // deal ids already carry a 'deal_' prefix by convention
        partner: p ? p.name : d.partner_name,
        category: p ? mapCategory(p.category) : (mapCategory(d.category) === 'Other' ? (d.category || 'Other') : mapCategory(d.category)),
        region: p ? mapRegion(p.region) : 'Other',
        title: d.title,
        desc: d.description,
        price: d.price_from,
        currency: d.currency,
        rating: rating ? { stars: Math.round(rating.avg_rating), count: rating.total_reviews } : null,
        whatsapp: p ? (p.whatsapp_number || null) : null,
        url: p ? (p.website_url || null) : null,
        hasDeal: true,
      };
    }

    // One listing PER DEAL, not per partner — a partner with 3 real deals
    // (Fiji Tour Transfers: ATV, Horse Riding, Zip Line) becomes 3 separate
    // bookable listings, matching the original Session 53 design where
    // those were always 3 cards despite being one business. An earlier
    // version of this Worker capped it at one deal per partner and
    // silently mis-filed the other 2 as "unmatched legacy" — caught by
    // testing against the real backfilled data, not by local testing.
    const listings = [];
    const partnersWithADeal = new Set();

    for (const d of deals) {
      const p = d.partner_id ? partnersById.get(d.partner_id) : partnersByName.get(normalizeName(d.partner_name));
      if (p) partnersWithADeal.add(p.id);
      listings.push(listingFromDeal(d, p || null));
    }

    // Exactly one bare listing for every active partner with zero deals —
    // the common case for a fresh self-onboarded signup.
    for (const p of partners) {
      if (partnersWithADeal.has(p.id)) continue;
      const rating = statsById.get(p.id) || null;
      listings.push({
        id: p.id,
        partner: p.name,
        category: mapCategory(p.category),
        region: mapRegion(p.region),
        title: p.name,
        desc: p.description || '',
        price: null,
        currency: null,
        rating: rating ? { stars: Math.round(rating.avg_rating), count: rating.total_reviews } : null,
        whatsapp: p.whatsapp_number || null,
        url: p.website_url || null,
        hasDeal: false,
      });
    }

    return json({ listings, generated_at: new Date().toISOString() }, 200, cors);
  } catch (err) {
    console.error('Listings query error:', err);
    return json({ listings: [], error: err.message }, 500, cors);
  }
}

export default {
  async fetch(request, env) {
    const cors = getCors(request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/listings') {
      return handleListings(request, env, cors);
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, worker: 'vakaviti-directory', version: 4 }, 200, cors);
    }

    return json({ error: 'Not found.' }, 404, cors);
  },
};
