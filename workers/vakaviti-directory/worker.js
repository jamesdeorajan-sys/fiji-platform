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

function mapCategory(raw) { return CATEGORY_MAP[raw] || 'Other'; }
function mapRegion(raw)   { return REGION_MAP[raw] || 'Other'; }

function normalizeName(s) { return String(s || '').trim().toLowerCase(); }

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

    const partners = partnersResult.results || [];
    const deals     = dealsResult.results || [];
    const stats     = statsResult.results || [];

    const dealsByName = new Map();
    for (const d of deals) dealsByName.set(normalizeName(d.partner_name), d);

    const statsById = new Map();
    for (const s of stats) statsById.set(s.partner_id, s);

    const matchedDealIds = new Set();

    const listings = partners.map(p => {
      const deal   = dealsByName.get(normalizeName(p.name)) || null;
      if (deal) matchedDealIds.add(deal.id);
      const rating = statsById.get(p.id) || null;

      return {
        id: p.id,
        partner: p.name,
        category: mapCategory(p.category),
        region: mapRegion(p.region),
        title: deal ? deal.title : p.name,
        desc: deal ? deal.description : (p.description || ''),
        price: deal ? deal.price_from : null,
        currency: deal ? deal.currency : null,
        rating: rating ? { stars: Math.round(rating.avg_rating), count: rating.total_reviews } : null,
        whatsapp: p.whatsapp_number || null,
        url: p.website_url || null,
        hasDeal: !!deal,
      };
    });

    // Deals whose partner_name doesn't match any active partner row —
    // legacy marketing content that predates the partners table. Still
    // shown, so nothing currently live silently disappears.
    for (const d of deals) {
      if (matchedDealIds.has(d.id)) continue;
      listings.push({
        id: 'deal_' + d.id,
        partner: d.partner_name,
        category: mapCategory(d.category) === 'Other' ? (d.category || 'Other') : mapCategory(d.category),
        region: 'Other',
        title: d.title,
        desc: d.description,
        price: d.price_from,
        currency: d.currency,
        rating: null,
        whatsapp: null,
        url: null,
        hasDeal: true,
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
      return json({ ok: true, worker: 'vakaviti-directory', version: 1 }, 200, cors);
    }

    return json({ error: 'Not found.' }, 404, cors);
  },
};
