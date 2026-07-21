-- Nadi Airport Transfers — Driver Marketplace
-- Milestone 7: dynamic destinations system (Item 2)
--
-- Seeded from the real, live ftt-booking-site/src/app.js ROUTES_DATA array
-- (read-only — that file was not modified). Extracted directly, not
-- summarized: 35 entries, lines 1090-1136 at the time of extraction, one
-- INSERT per entry below in source order. Verified the destination count
-- (35, counted via `sed -n '1090,1136p' app.js | grep -c "destValue:"`,
-- not the looser whole-file grep which double-counts destValue references
-- elsewhere in the file, e.g. deep-link config) and that all 16 distinct
-- `area` values in ROUTES_DATA exactly match the 16 zones already seeded
-- in Milestone 1's schema.sql — clean 1:1 mapping, no missing or extra
-- zones, no destination spans more than one zone.
--
-- `type` is a judgment call made per destination (ROUTES_DATA has no type
-- field of its own) using these rules: name contains "Airport" -> airport;
-- name contains "Marina"/"Cruise Terminal" -> port; name is a
-- town/city-centre reference -> town; a standalone attraction/venue that
-- isn't accommodation (an adventure park, an arts village) -> custom;
-- everything else (the large majority — actual hotels/resorts) -> hotel.

CREATE TABLE destinations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- hotel / airport / port / town / custom
  zone_id INTEGER NOT NULL REFERENCES zones(id),
  active INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Nadi & Wailoaloa
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Nadi Town Centre', 'town', (SELECT id FROM zones WHERE name = 'Nadi'), 1);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Tanoa International / Tokatoka', 'hotel', (SELECT id FROM zones WHERE name = 'Nadi Airport'), 2);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Mercure / Tradewinds Hotel', 'hotel', (SELECT id FROM zones WHERE name = 'Nadi'), 3);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Wailoaloa Beach Hotels', 'hotel', (SELECT id FROM zones WHERE name = 'Wailoaloa'), 4);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Crowne Plaza / Smugglers / Ramada', 'hotel', (SELECT id FROM zones WHERE name = 'Wailoaloa'), 5);
-- Denarau
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Hilton / Sheraton / Westin Denarau', 'hotel', (SELECT id FROM zones WHERE name = 'Denarau'), 6);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Sofitel / Radisson / Wyndham', 'hotel', (SELECT id FROM zones WHERE name = 'Denarau'), 7);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Port Denarau Marina (Yasawa Flyer)', 'port', (SELECT id FROM zones WHERE name = 'Denarau'), 8);
-- Sonaisali / Vuda
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('DoubleTree Sonaisali Island', 'hotel', (SELECT id FROM zones WHERE name = 'Sonaisali'), 9);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('First Landing Beach Resort', 'hotel', (SELECT id FROM zones WHERE name = 'Vuda Point'), 10);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Vuda Marina (Yacht Haven)', 'port', (SELECT id FROM zones WHERE name = 'Vuda Point'), 11);
-- Lautoka
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Lautoka City Centre', 'town', (SELECT id FROM zones WHERE name = 'Lautoka'), 12);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Tanoa Waterfront / Cathay Lautoka', 'hotel', (SELECT id FROM zones WHERE name = 'Lautoka'), 13);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Lautoka Cruise Terminal', 'port', (SELECT id FROM zones WHERE name = 'Lautoka'), 14);
-- Momi / Natadola
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Fiji Marriott Resort Momi Bay', 'hotel', (SELECT id FROM zones WHERE name = 'Momi Bay'), 15);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('InterContinental Natadola / Yatule', 'hotel', (SELECT id FROM zones WHERE name = 'Natadola'), 16);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Robinson Crusoe Island (Likuri)', 'custom', (SELECT id FROM zones WHERE name = 'Natadola'), 17);
-- Sigatoka
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Sigatoka Town / Sand Dunes', 'town', (SELECT id FROM zones WHERE name = 'Sigatoka'), 18);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Bedarra / Gecko''s / Sandy Point', 'hotel', (SELECT id FROM zones WHERE name = 'Sigatoka'), 19);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Kula Wild Adventure Park', 'custom', (SELECT id FROM zones WHERE name = 'Sigatoka'), 20);
-- Coral Coast
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Shangri-La Yanuca Island', 'hotel', (SELECT id FROM zones WHERE name = 'Coral Coast'), 21);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Hideaway Resort / Tambua Sands', 'hotel', (SELECT id FROM zones WHERE name = 'Coral Coast'), 22);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Crusoe''s Retreat / Mango Bay', 'hotel', (SELECT id FROM zones WHERE name = 'Coral Coast'), 23);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Outrigger Fiji Beach Resort', 'hotel', (SELECT id FROM zones WHERE name = 'Coral Coast'), 24);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('The Warwick / The Naviti', 'hotel', (SELECT id FROM zones WHERE name = 'Coral Coast'), 25);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('The Beachouse Fiji', 'hotel', (SELECT id FROM zones WHERE name = 'Coral Coast'), 26);
-- Pacific Harbour
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Pacific Harbour Arts Village', 'custom', (SELECT id FROM zones WHERE name = 'Pacific Harbour'), 27);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Pearl South Pacific Resort', 'hotel', (SELECT id FROM zones WHERE name = 'Pacific Harbour'), 28);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Uprising Beach Resort', 'hotel', (SELECT id FROM zones WHERE name = 'Pacific Harbour'), 29);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Nanuku Resort Fiji (Auberge)', 'hotel', (SELECT id FROM zones WHERE name = 'Pacific Harbour'), 30);
-- North
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Ba Town', 'town', (SELECT id FROM zones WHERE name = 'Ba'), 31);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Volivoli / Wananavu Beach Resort', 'hotel', (SELECT id FROM zones WHERE name = 'Rakiraki'), 32);
-- Suva
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Grand Pacific Hotel Suva', 'hotel', (SELECT id FROM zones WHERE name = 'Suva'), 33);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Tanoa Plaza / Holiday Inn Suva', 'hotel', (SELECT id FROM zones WHERE name = 'Suva'), 34);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Nausori Airport (SUV)', 'airport', (SELECT id FROM zones WHERE name = 'Nausori'), 35);
