-- Seed the five reviewed source families (CEO directive "FAST-TRACK VAKAVITI 24/7 OFFER AGENTS",
-- Phase 3), approved by CEO-directive authority based on live research completed 2026-08-29 (see
-- src/seed-source-families.ts / PHASE3_SOURCE_RESEARCH.md for the full evidence trail). This is a
-- SEPARATE, deliberately-named file, not a numbered migration - re-runnable via INSERT OR IGNORE,
-- never re-applied automatically by a migrate script.

INSERT OR IGNORE INTO offer_source_families (
  id, legal_provider_or_seller_identity, approved_domain, allowed_path_patterns_json, excluded_path_patterns_json,
  authoritative_fields_json, extraction_profile, currency_expectations_json, permitted_page_types_json,
  recheck_schedule_hours, rate_limit_per_hour, robots_access_policy, source_approval_status,
  approval_actor_id, approval_evidence, approved_at
) VALUES
('sf-hideaway-holidays', 'Hideaway Holidays (AU travel agency)', 'www.hideawayholidays.com.au',
 '["/fiji-islands-hot-deals/*","/fiji-packages/*","/fiji-airways-on-sale-holiday-deals/*","/fiji-christmas-deals/*","/honeymoon-deals/*","/fiji-package/*"]',
 '["/search/*"]',
 '["price","currency","price_basis","booking_deadline","travel_window","inclusions","booking_route"]',
 'STANDARD_HTML', '["AUD"]', '["OFFER_PAGE","MULTI_OFFER_PAGE"]', 24, 6, 'ROBOTS_TXT_HONORED', 'APPROVED',
 'ceo-directive-2026-08-29-emergency-priority', 'Live research 2026-08-29: robots.txt allows all; real deal paths confirmed via direct browse; known Cloudflare bot-mitigation on deep pages, not bypassed.', CURRENT_TIMESTAMP),

('sf-south-sea-cruises', 'South Sea Cruises Fiji', 'southseacruisesfiji.com',
 '["/returnee-deal/*","/day-trips/*"]',
 '["/malamala-book-now/*"]',
 '["price","currency","price_basis","inclusions","booking_route","locality"]',
 'STANDARD_HTML', '["FJD"]', '["OFFER_PAGE","MULTI_OFFER_PAGE"]', 24, 6, 'ROBOTS_TXT_HONORED', 'APPROVED',
 'ceo-directive-2026-08-29-emergency-priority', 'Live research 2026-08-29: robots.txt disallows only wp-admin/wp-includes/wp-json; target paths unrestricted; booking subdomain is a different hostname, excluded structurally.', CURRENT_TIMESTAMP),

('sf-malamala-beach-club', 'Malamala Beach Club', 'www.malamalabeachclub.com',
 '["/price","/upgrades"]',
 '["/book*","/mclub-membership*"]',
 '["price","currency","price_basis","inclusions"]',
 'STANDARD_HTML', '["FJD"]', '["OFFER_PAGE"]', 24, 6, 'ROBOTS_TXT_HONORED', 'APPROVED',
 'ceo-directive-2026-08-29-emergency-priority', 'Live research 2026-08-29: /price is server-rendered despite Wix platform; robots.txt disallows ?lightbox= query strings (honored by construction - discovery never builds lightbox URLs) and blocks PetalBot.', CURRENT_TIMESTAMP),

('sf-taveuni-palms', 'Taveuni Palms Resort', 'taveunipalms.com',
 '["/rates-specials"]',
 '["/book*"]',
 '["price","currency","price_basis","inclusions","booking_route"]',
 'STANDARD_HTML', '["USD"]', '["OFFER_PAGE"]', 24, 6, 'ROBOTS_TXT_HONORED', 'APPROVED',
 'ceo-directive-2026-08-29-emergency-priority', 'Live research 2026-08-29: robots.txt disallows only /wp-admin; /book redirects off-domain to book-directonline.com, excluded and never followed.', CURRENT_TIMESTAMP),

('sf-vakaviti-own', 'Vakaviti (own public directory)', 'vakaviti-marketplace-stage1.helpronline.workers.dev',
 '["/experiences*","/operators*"]',
 '["/enquire/*","/admin/*","/go/deal/*","/api/*"]',
 '["price","currency","price_basis","locality"]',
 'STANDARD_HTML', '["FJD"]', '["MULTI_OFFER_PAGE","PRODUCT_PAGE"]', 24, 6, 'ROBOTS_TXT_HONORED', 'APPROVED',
 'ceo-directive-2026-08-29-emergency-priority', 'Chosen per explicit confirmation over fijitourtransfers.com, which remains out of scope without separate authorization per a standing note from earlier this engagement.', CURRENT_TIMESTAMP);
