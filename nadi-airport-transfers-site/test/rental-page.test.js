// NAT car-rental request page (/nadi-airport-car-rentals/), local release candidate on the production tree b9dd9a8.
// Pins: the page contract (canonical, indexable, no preview gating), consent and data minimisation, FAQ schema = visible FAQ,
// no unverified claims, shared validation logic, link integrity, and that nothing else in the production tree changed except
// three navigation/footer lines on the home page and one sitemap entry.
// Run: node --test test/rental-page.test.js
import { undoSearchGrowth } from './search-growth-revert.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { a11yRevert } from './a11y-p0-revert.js';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..', 'src');
const rd = (f) => readFileSync(path.join(SRC, f), 'utf8').replace(/\r/g, '');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const shaFile = (f) => createHash('sha256').update(readFileSync(path.join(SRC, f))).digest('hex');
const unesc = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const text = (h) => unesc(h.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const ld = (h) => [...h.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

const PAGE = rd('nadi-airport-car-rentals/index.html');
const JS = rd('rental-assets/rental.js');
const CORE = rd('rental-assets/rental-core.js');
const core = await import(pathToFileURL(path.join(SRC, 'rental-assets', 'rental-core.js')).href);
const HOME_PRODUCTION_SHA = 'c7974bfbea6e1320f3e89b9478ab2eb4ae32072f5feccb4eada7fa2d80b9cb70';
const SITEMAP_PRODUCTION_SHA = 'ca1c6463ae929fb0dffea916aa635c108f5b8385cd89bc903f064e0dd57e1400';
const SITEMAP_BLOCK = '<url>\n<loc>https://nadiairporttransfers.com/nadi-airport-car-rentals/</loc>\n<changefreq>monthly</changefreq>\n<priority>0.6</priority>\n</url>\n';

test('indexing: self-canonical, indexable, and no preview gating or banner left in the page or its scripts', () => {
  assert.equal(PAGE.match(/<link rel="canonical" href="([^"]*)">/)[1], 'https://nadiairporttransfers.com/nadi-airport-car-rentals/');
  assert.equal((PAGE.match(/<link rel="canonical"/g) || []).length, 1);
  assert.ok(!/<meta[^>]+name="robots"/i.test(PAGE) && !/noindex|nofollow/i.test(PAGE), 'the production page carries no noindex; preview hosts are excluded by Cloudflare’s own X-Robots-Tag on *.pages.dev deployment URLs (verified at release time)');
  assert.ok(!/data-preview|REVIEW PREVIEW|preview only|chatgpt\.site|deorajanjames/i.test(PAGE + JS + CORE), 'no review-preview scaffolding or external preview host');
  assert.ok(PAGE.match(/<title>([^<]*)<\/title>/)[1].length <= 70);
  const desc = unesc(PAGE.match(/<meta name="description" content="([^"]*)">/)[1]);
  assert.ok(desc.length >= 80 && desc.length <= 165, 'description length ' + desc.length);
  assert.equal((PAGE.match(/<h1>/g) || []).length, 1);
  assert.match(PAGE, /<meta name="viewport" content="width=device-width, initial-scale=1.0">/);
  assert.equal(existsSync(path.join(SRC, '_headers')), false, 'no new header rules: Cloudflare already marks *.pages.dev deployment URLs noindex');
});

test('HISTORICAL-FIXTURE (reverts this release before comparing): SCOPE: the production tree is byte-identical except the home page (3 added navigation lines) and the sitemap (1 added entry)', () => {
  const PINS = {
    'app.js': '77f9d10d26d9c009f6734d0d21d2fd16c14781ab266e7e21a82bb988de824191', 'styles.css': 'ddfccf65c777f2781ce4f4877625749fa4377edda4c2879d0ee49c94b78dd0ff',
    'route-handoff.js': '8d7f90cc9682aaa1baf91bb4384f6ea12025b5728de8242c7f5e4c9d856147ee', 'chat-widget.js': 'e8a3891fe69c51664d6c2ef6dd2a2d11a9e7b3d6a024f257ce262809503c4836',
    'booking-extras.js': 'e8aef0ce78f8cb1f7eb9ad925d52ad190aa1a4a1ae5329f48493add334276739', 'booking-extras.css': '5da6759b2dc795ade7d5bd67dd98bb689fba7300d04be3749ee1fc657c162e76',
    'fiji-pickup.js': '9ac0ea0e887dbfdd1e9032e465faab27c51f407a5202d013090a3456cbbfafdb', 'robots.txt': '2b6dbb0871547ca5e283f9679be2eac10d0a81ce56d86daffa2a6fcb4f9c10de',
    '_redirects': '578cd6f94e366cbeeba342ec4a34d912dc309e33f000953b8a3a8c3c38189de3',
  };
  for (const [f, want] of Object.entries(PINS)) assert.equal(f === 'app.js' || f === 'styles.css' ? sha(a11yRevert(f, rd(f))) : shaFile(f), want, f + ' changed');
  let home = a11yRevert('index.html', undoSearchGrowth('index.html', rd('index.html')));
  for (const a of ['      <a href="/nadi-airport-car-rentals/">Car rentals</a>\n', '    <a href="/nadi-airport-car-rentals/">Car rentals</a>\n', '        <a href="/nadi-airport-car-rentals/">Request a rental car</a>\n']) {
    assert.equal(home.split(a).length, 2, 'home page line present exactly once: ' + a.trim());
    home = home.replace(a, '');
  }
  assert.equal(sha(home), HOME_PRODUCTION_SHA, 'home page minus the three navigation lines equals the production file');
  const sm = undoSearchGrowth('sitemap.xml', rd('sitemap.xml'));
  assert.equal(sm.split(SITEMAP_BLOCK).length, 2, 'the new sitemap entry appears exactly once');
  assert.equal(sha(sm.replace(SITEMAP_BLOCK, '')), SITEMAP_PRODUCTION_SHA, 'sitemap minus the new entry equals the production file');
  assert.ok(!/nadi-airport-car-rentals/.test(rd('robots.txt')) && !/nadi-airport-car-rentals/.test(rd('_redirects')));
});

test('navigation: the home page and the new page link to each other without touching the transfer booking flow', () => {
  const home = rd('index.html');
  const navBlock = home.slice(home.indexOf('<nav class="nav" id="nav">'), home.indexOf('</nav>'));
  assert.equal((navBlock.match(/href="\/nadi-airport-car-rentals\/"/g) || []).length, 2, 'desktop nav and mobile menu');
  assert.ok(navBlock.indexOf('Book Transfer') < navBlock.indexOf('Car rentals'), 'Book Transfer stays first');
  assert.ok(navBlock.includes('href="#booking" class="btn-nav">Book Now</a>'), 'the Book Now button is unchanged');
  const footer = home.slice(home.indexOf('<footer class="footer">'));
  assert.equal((footer.match(/href="\/nadi-airport-car-rentals\/"/g) || []).length, 1);
  assert.ok(PAGE.includes('href="/#booking"') && PAGE.includes('href="/"'), 'the rental page links back to the transfer booking flow');
  assert.equal((PAGE.match(/href="\/nadi-airport-car-rentals\/" class="active" aria-current="page"/g) || []).length, 2);
});

test('link integrity: every internal link and anchor on the page resolves', () => {
  const ids = new Set([...PAGE.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
  for (const m of PAGE.matchAll(/href="([^"]+)"/g)) {
    const h = m[1];
    if (h.startsWith('#')) assert.ok(ids.has(h.slice(1)), 'anchor ' + h);
    else if (h.startsWith('/transfer/')) assert.ok(existsSync(path.join(SRC, h.replace(/^\//, '') + '.html')), 'transfer page ' + h);
    else if (h.startsWith('/#')) assert.ok(rd('index.html').includes(` id="${h.slice(2)}"`), 'home anchor ' + h);
    else if (h.startsWith('/') && !h.startsWith('//')) assert.ok(existsSync(path.join(SRC, h.split('?')[0].replace(/^\//, ''))) || h === '/' || h === '/nadi-airport-car-rentals/', 'local asset ' + h);
  }
  for (const m of PAGE.matchAll(/(?:src|href)="(\/[^"#?]+\.(?:js|css|png|ico))(?:\?[^"]*)?"/g)) assert.ok(existsSync(path.join(SRC, m[1].slice(1))), m[1]);
  for (const m of PAGE.matchAll(/<a [^>]*target="_blank"[^>]*>/g)) assert.ok(/rel="noopener"/.test(m[0]), 'external link opens safely: ' + m[0]);
});

test('structured data: WebPage, BreadcrumbList and an FAQPage that is word-for-word the visible FAQ; no price, offer, rating or review markup', () => {
  const blocks = ld(PAGE);
  assert.deepEqual(blocks.map((b) => b['@type']), ['WebPage', 'BreadcrumbList', 'FAQPage']);
  const faq = blocks[2].mainEntity;
  const visible = [...PAGE.matchAll(/<div class="rp-faq-item"><h3>(.*?)<\/h3><p>(.*?)<\/p><\/div>/g)].map((m) => [unesc(m[1]).trim(), unesc(m[2]).trim()]);
  assert.equal(faq.length, 10); assert.equal(visible.length, 10);
  faq.forEach((q, i) => { assert.equal(q.name, visible[i][0]); assert.equal(q.acceptedAnswer.text, visible[i][1]); });
  assert.equal(blocks[0].url, 'https://nadiairporttransfers.com/nadi-airport-car-rentals/');
  assert.equal(blocks[1].itemListElement[1].item, 'https://nadiairporttransfers.com/nadi-airport-car-rentals/');
  assert.ok(!/"(Product|Offer|AggregateOffer|AggregateRating|Review|Rating|priceRange|price|AutoRental|LocalBusiness)"/.test(JSON.stringify(blocks)), 'nothing in the markup claims a price, rating, review or that NAT is itself the rental business');
});

test('no unverified or partner-marketing claims: no prices, availability promises, insurance or support promises, reviews, commission or photos of partner vehicles', () => {
  const v = text(PAGE.slice(PAGE.indexOf('<header class="rp-hero">'), PAGE.indexOf('<script>')));
  const bad = /\bFJ\$\s?\d|\$\s?\d|per day|\/day|daily rate of|from \d|\b25%|premium insurance|fully insured|comprehensive insurance|24\/7|around the clock|instant booking|instantly|guarantee[sd]?\b|lowest price|best price|cheapest|\brated\b|\breviews?\b|testimonial|five-star|commission|50\+ locations|free cancellation|no hidden|door-to-door|we operate|our fleet|our cars|our vehicles/i;
  const m = v.match(bad); assert.equal(m, null, 'unverified wording: ' + (m && m[0]));
  assert.ok(!/<img\b/i.test(PAGE), 'no partner photographs are used until the partner confirms reuse permission');
  assert.ok(/not live inventory/i.test(v) && /Catalogue examples only/i.test(v), 'vehicle cards are framed as catalogue examples');
  assert.ok(/not a confirmed rental|does not reserve a vehicle or confirm a rental/i.test(v), 'saved request vs confirmed rental is stated on the page');
  assert.ok(/NAT does not operate the rental business/i.test(v));
});

test('consent and data minimisation: two separate required consents, only quote-needed fields, no uploads, no document or card fields', () => {
  assert.equal((PAGE.match(/<input name="consentShare" type="checkbox" required>/g) || []).length, 1);
  assert.equal((PAGE.match(/<input name="consentWhatsappGroup" type="checkbox" required>/g) || []).length, 1);
  assert.ok(!/checked/.test(PAGE.match(/<label class="rt-consent">[\s\S]*?<\/label>/g).join('')), 'consent boxes start unticked');
  assert.ok(PAGE.includes('share these details with Best Adventure Fiji') && PAGE.includes('Group members can see my WhatsApp number'));
  const names = [...PAGE.match(/<form id="rental-form"[\s\S]*?<\/form>/)[0].matchAll(/<(?:input|select|textarea) [^>]*name="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(names.sort(), ['age', 'bags', 'consentShare', 'consentWhatsappGroup', 'dropoff', 'email', 'flight', 'licenceCountry', 'name', 'notes', 'passengers', 'phone', 'pickup', 'pickupDate', 'pickupTime', 'returnDate', 'returnTime', 'vehicle', 'websiteTrap']);
  assert.ok(!/type="file"|name="(licen[cs]e(Number|No|Doc\w*|Photo|Image|File)|passport\w*|card\w*|cvv|dob|birth\w*)"/i.test(PAGE));
  assert.ok(/Do not enter passport, licence-document or payment-card details/.test(PAGE));
  assert.ok(/<input name="websiteTrap" tabindex="-1" autocomplete="off">/.test(PAGE) && /\.rt-trap\{position:absolute;left:-9999px/.test(PAGE), 'honeypot is present and visually hidden');
  assert.equal(form(PAGE, 'data-consent-version'), core.CONSENT_VERSION);
  assert.equal(form(PAGE, 'data-endpoint'), 'https://api.nadiairporttransfers.com/rental-enquiries');
  assert.equal(JS.match(/localStorage/g), null, 'no personal data is kept in the browser beyond one session-scoped request id');
  assert.ok(/sessionStorage\.(get|set|remove)Item\(ID_KEY/.test(JS));
});
function form(h, attr) { return h.match(new RegExp('<form id="rental-form"[^>]* ' + attr + '="([^"]*)"'))[1]; }

test('form script: safe DOM writes, same-id retry, honest saved-vs-confirmed wording, WhatsApp only as an optional extra or fallback', () => {
  assert.ok(!/\.innerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(JS), 'guest-visible text is only written with textContent');
  assert.match(JS, /body\.saved === true && body\.reference/, 'success is shown only when the server says saved');
  assert.match(JS, /id: requestId\(\)/); assert.match(JS, /resetRequestId\(\);\s*\n\s*\}/);
  assert.match(JS, /This is not a confirmed rental/); assert.match(JS, /Message NAT on WhatsApp \(optional\)/); assert.match(JS, /You do not need to send anything else/);
  assert.match(JS, /WhatsApp-only enquiry/); assert.match(JS, /same request is never saved twice/);
  assert.ok(!/Press Send|automatically notify staff/i.test(JS + PAGE.replace(/<noscript>[\s\S]*?<\/noscript>/, '')), 'for a saved request the guest is never asked to press Send for staff to be told (only the JavaScript-off WhatsApp path mentions Send)');
  assert.match(JS, /trip\.hidden = n === 2;/); assert.ok(!/trip\.disabled/.test(JS), 'step 1 stays enabled so its values are still submitted from step 2');
  assert.match(JS, /signal: controller\.signal/); assert.match(JS, /20000/);
  assert.ok(!/fetch\([^)]*(?!endpoint)/.test(JS.replace(/fetch\(endpoint/g, '')), 'the only network call is to the form endpoint');
});

test('changed details are never silently dropped: a request-id conflict gets a fresh id and a clear message, and a linked save says so', () => {
  assert.match(JS, /res\.status === 409 && body && body\.code === 'REQUEST_ID_CONFLICT'\) resetRequestId\(\)/, 'a 409 conflict resets the request id so the next send saves the changes as a new request');
  assert.match(JS, /body\.related_reference/); assert.match(JS, /We saved these details as a new request and linked the two/);
  assert.ok(!/duplicate\s*\?[^:]*changed/i.test(JS));
  assert.match(JS, /showSaved\(d, body\.reference, !!body\.duplicate, body\.related_reference \|\| ''\)/);
  assert.match(JS, /We already have this request\./, 'the duplicate wording is only reachable when the server says duplicate:true');
});
test('shared validation (browser copy): Fiji-time dates, impossible dates, country-code phone, consent, data-minimisation rules', () => {
  const base = { pickupDate: '2026-10-20', pickupTime: '10:00', returnDate: '2026-10-27', returnTime: '10:00', passengers: '2', bags: '2', pickup: 'Nadi International Airport (NAN)', dropoff: 'Same as collection', notes: '' };
  const now = '2026-10-14T23:30';
  assert.equal(core.validateTrip(base, now), '');
  assert.match(core.validateTrip({ ...base, pickupDate: '2026-10-14', pickupTime: '23:00', returnDate: '2026-10-15' }, now), /future/);
  assert.match(core.validateTrip({ ...base, pickupDate: '2026-02-30' }, now), /valid/);
  assert.match(core.validateTrip({ ...base, returnDate: base.pickupDate, returnTime: '10:00' }, now), /after collection/);
  assert.match(core.validateTrip({ ...base, returnDate: '2027-03-01' }, now), /120 days/);
  assert.match(core.validateTrip({ ...base, passengers: '0' }, now), /people and bags/);
  assert.match(core.validateTrip({ ...base, pickup: 'Other — specify below' }, now), /notes/);
  assert.equal(core.fijiNow(new Date('2026-10-14T11:30:00Z')), '2026-10-14T23:30'); assert.equal(core.fijiNow(new Date('2026-10-14T12:30:00Z')), '2026-10-15T00:30');
  assert.equal(core.normalisePhone('+61 400 000 111'), '+61400000111'); assert.equal(core.normalisePhone('0061400000111'), '+61400000111');
  for (const b of ['0400 000 111', '61 400 000 111', '9123456', '+12', 'x']) assert.equal(core.normalisePhone(b), null, b);
  const good = { name: 'Guest', phone: '+61400000111', email: '', age: '25–69', licenceCountry: 'Australia', flight: '', notes: '', consentShare: true, consentWhatsappGroup: true };
  assert.equal(core.validateContact(good), null);
  assert.equal(core.validateContact({ ...good, consentWhatsappGroup: false }).field, 'consentShare');
  assert.equal(core.validateContact({ ...good, licenceCountry: 'N123456' }).field, 'licenceCountry');
  assert.equal(core.validateContact({ ...good, notes: 'card 4111 1111 1111 1111' }).field, 'notes');
  assert.match(core.whatsappMessage({ ...good, ...base, vehicle: 'Toyota Aqua' }, null), /WhatsApp-only enquiry\. Not saved online\./);
  assert.match(core.whatsappMessage({ ...good, ...base, vehicle: 'Toyota Aqua' }, 'NAT-R-ABC234'), /Rental reference: NAT-R-ABC234/);
});

test('request id: a valid v4 UUID even where crypto.randomUUID is unavailable (plain-http previews, iOS 15.0-15.3); the script never calls crypto.randomUUID directly', () => {
  const uuid4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  assert.match(core.newRequestId(), uuid4);
  const noRandomUuid = { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = (i * 37 + 11) & 255; return a; } };
  assert.match(core.newRequestId(noRandomUuid), uuid4);
  assert.equal(new Set(Array.from({ length: 50 }, () => core.newRequestId({ getRandomValues: (a) => globalThis.crypto.getRandomValues(a) }))).size, 50);
  assert.ok(!/crypto\.randomUUID/.test(JS), 'rental.js uses newRequestId()');
});
test('mobile experience: NAT shell, 16px inputs (no iOS zoom), 44px targets, stacked layout under 768px, sticky request bar that steps aside for the form', () => {
  assert.ok(PAGE.includes('<link rel="stylesheet" href="/styles.css?v=20260908a">') && PAGE.includes('family=Sora') && PAGE.includes('family=DM+Sans'));
  assert.match(PAGE, /\.rt-form input,\.rt-form select,\.rt-form textarea\{font:inherit;font-size:16px/);
  assert.match(PAGE, /min-height:46px/); assert.match(PAGE, /\.rt-btn\{[^}]*min-height:48px/);
  assert.match(PAGE, /@media\(max-width:768px\)\{[\s\S]*\.rt-grid\{grid-template-columns:1fr\}[\s\S]*\.rp-sticky-cta\{display:flex\}/);
  assert.match(PAGE, /id="rpStickyBar"/); assert.match(PAGE, /formSeen/); assert.match(PAGE, /env\(safe-area-inset-bottom\)/);
  assert.match(PAGE, /id="hamburger" aria-label="Menu" aria-expanded="false"/);
  assert.equal((PAGE.match(/href="#request"/g) || []).length, 3, 'hero, CTA band and sticky bar all lead to the form');
});

test('HYGIENE: no control characters in the page, scripts or this test', () => {
  for (const f of ['nadi-airport-car-rentals/index.html', 'rental-assets/rental.js', 'rental-assets/rental-core.js']) {
    const b = readFileSync(path.join(SRC, f)); const bad = [...b].filter((c) => c < 32 && c !== 9 && c !== 10);
    assert.equal(bad.length, 0, f);
  }
  const me = readFileSync(fileURLToPath(import.meta.url)); assert.equal([...me].filter((c) => c < 32 && c !== 9 && c !== 10).length, 0);
});
