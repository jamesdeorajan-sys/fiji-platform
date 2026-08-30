// The five reviewed seed source families (CEO directive Phase 3), based on live research completed
// 2026-08-29 (real domains verified, real deal paths confirmed, real exclusions identified from
// each site's own robots.txt and booking-flow structure - see PHASE3_SOURCE_RESEARCH.md for the
// full research record).
export interface SeedSourceFamily {
  id: string;
  legalProviderOrSellerIdentity: string;
  approvedDomain: string;
  allowedPathPatterns: string[];
  excludedPathPatterns: string[];
  authoritativeFields: string[];
  extractionProfile: 'STANDARD_HTML' | 'JS_RENDERED' | 'FEED_XML' | 'FEED_JSON';
  currencyExpectations: string[];
  permittedPageTypes: string[];
  recheckScheduleHours: number;
  rateLimitPerHour: number;
  categoryPageUrls: string[];
  notes: string;
}

export const SEED_SOURCE_FAMILIES: SeedSourceFamily[] = [
  {
    id: 'sf-hideaway-holidays',
    legalProviderOrSellerIdentity: 'Hideaway Holidays (AU travel agency)',
    approvedDomain: 'www.hideawayholidays.com.au',
    allowedPathPatterns: ['/fiji-islands-hot-deals/*', '/fiji-packages/*', '/fiji-airways-on-sale-holiday-deals/*', '/fiji-christmas-deals/*', '/honeymoon-deals/*', '/fiji-package/*'],
    excludedPathPatterns: ['/search/*'],
    authoritativeFields: ['price', 'currency', 'price_basis', 'booking_deadline', 'travel_window', 'inclusions', 'booking_route'],
    extractionProfile: 'STANDARD_HTML',
    currencyExpectations: ['AUD'],
    permittedPageTypes: ['OFFER_PAGE', 'MULTI_OFFER_PAGE'],
    recheckScheduleHours: 24,
    rateLimitPerHour: 6,
    categoryPageUrls: ['https://www.hideawayholidays.com.au/fiji-islands-hot-deals/', 'https://www.hideawayholidays.com.au/fiji-packages/'],
    notes: 'KNOWN LIMITATION: this domain runs Cloudflare bot-mitigation that blocks a bare/generic User-Agent on deep package pages. safeFetchSource() uses an honest, self-identifying bot UA and is NOT modified to impersonate a browser to bypass this - per the master directive\'s "no bypassing access controls" rule. Expect this family to show ACCESS_DENIED on some fetches; that is the correct, policy-compliant outcome, not a defect to route around. Note also: "Hideaway Holidays" (AU agency) is a distinct business from "Fiji Hideaway Resort & Spa" (fijihideawayresort.com) - confirmed we mean the former.',
  },
  {
    id: 'sf-south-sea-cruises',
    legalProviderOrSellerIdentity: 'South Sea Cruises Fiji',
    approvedDomain: 'southseacruisesfiji.com',
    allowedPathPatterns: ['/returnee-deal/*', '/day-trips/*'],
    excludedPathPatterns: ['/malamala-book-now/*'],
    authoritativeFields: ['price', 'currency', 'price_basis', 'inclusions', 'booking_route', 'locality'],
    extractionProfile: 'STANDARD_HTML',
    currencyExpectations: ['FJD'],
    permittedPageTypes: ['OFFER_PAGE', 'MULTI_OFFER_PAGE'],
    recheckScheduleHours: 24,
    rateLimitPerHour: 6,
    categoryPageUrls: ['https://southseacruisesfiji.com/returnee-deal/', 'https://southseacruisesfiji.com/day-trips/'],
    notes: 'bookings.southseacruisesfiji.com and apps.customlinc.com.au are different hostnames, already excluded by the discovery agent\'s same-domain check, not by path pattern.',
  },
  {
    id: 'sf-malamala-beach-club',
    legalProviderOrSellerIdentity: 'Malamala Beach Club',
    approvedDomain: 'www.malamalabeachclub.com',
    allowedPathPatterns: ['/price', '/upgrades'],
    excludedPathPatterns: ['/book*', '/mclub-membership*'],
    authoritativeFields: ['price', 'currency', 'price_basis', 'inclusions'],
    extractionProfile: 'STANDARD_HTML', // Wix site, but /price is server-rendered - confirmed via live fetch during research
    currencyExpectations: ['FJD'],
    permittedPageTypes: ['OFFER_PAGE'],
    recheckScheduleHours: 24,
    rateLimitPerHour: 6,
    categoryPageUrls: ['https://www.malamalabeachclub.com/price'],
    notes: 'Their own robots.txt additionally disallows any "?lightbox=" query string - this discovery agent extracts href links from HTML and does not construct lightbox URLs, so this exclusion is honored by construction; flagged here for completeness.',
  },
  {
    id: 'sf-taveuni-palms',
    legalProviderOrSellerIdentity: 'Taveuni Palms Resort',
    approvedDomain: 'taveunipalms.com',
    allowedPathPatterns: ['/rates-specials'],
    excludedPathPatterns: ['/book*'],
    authoritativeFields: ['price', 'currency', 'price_basis', 'inclusions', 'booking_route'],
    extractionProfile: 'STANDARD_HTML',
    currencyExpectations: ['USD'],
    permittedPageTypes: ['OFFER_PAGE'],
    recheckScheduleHours: 24,
    rateLimitPerHour: 6,
    categoryPageUrls: ['https://taveunipalms.com/rates-specials'],
    notes: '/book 301-redirects off-domain to book-directonline.com - excluded both by path pattern and because the redirect target is a different hostname the discovery agent never follows into.',
  },
  {
    id: 'sf-vakaviti-own',
    legalProviderOrSellerIdentity: 'Vakaviti (own public directory)',
    approvedDomain: 'vakaviti-marketplace-stage1.helpronline.workers.dev',
    allowedPathPatterns: ['/experiences*', '/operators*'],
    excludedPathPatterns: ['/enquire/*', '/admin/*', '/go/deal/*', '/api/*'],
    authoritativeFields: ['price', 'currency', 'price_basis', 'locality'],
    extractionProfile: 'STANDARD_HTML',
    currencyExpectations: ['FJD'],
    permittedPageTypes: ['MULTI_OFFER_PAGE', 'PRODUCT_PAGE'],
    recheckScheduleHours: 24,
    rateLimitPerHour: 6,
    categoryPageUrls: ['https://vakaviti-marketplace-stage1.helpronline.workers.dev/experiences', 'https://vakaviti-marketplace-stage1.helpronline.workers.dev/operators'],
    notes: 'Chosen instead of fijitourtransfers.com per explicit confirmation - a standing note from earlier this engagement holds fijitourtransfers.com out of scope without separate authorization. This family exercises the pipeline against Vakaviti\'s own already-known, zero-risk content.',
  },
];

export const CATEGORY_PAGE_URLS_BY_FAMILY: Record<string, string[]> = Object.fromEntries(
  SEED_SOURCE_FAMILIES.map(f => [f.id, f.categoryPageUrls])
);
