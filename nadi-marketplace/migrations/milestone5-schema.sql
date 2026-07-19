-- Nadi Airport Transfers — Driver Marketplace
-- Milestone 5: fuel index automation (spec Section 7)
--
-- fuel_index/fuel_index_pending already existed (Milestone 1 schema) but were
-- verified empty on the live DB before writing this — no baseline existed to
-- compare future FCCC price changes against.
--
-- Seeded with REAL, currently-published data: Fijian Competition and Consumer
-- Commission (Price Control) (Petroleum Prices) (No. 6) Order 2026, LN 89/26,
-- Schedule 1 (Viti Levu, within 3km of a public road — covers all of Nadi
-- Airport Transfers' 16 operating zones), Gasoil (diesoline), Retail, Bulk
-- Sale = $3.39/L, in force from 1 July 2026. Source PDF read directly:
-- https://fccc.gov.fj/wp-content/uploads/2026/06/LN-89-FCCC-Price-Control-Petroleum-Prices-No.-6-Order-2026.pdf
-- This is a one-time bootstrap of an empty table, not a "change" — the ≥5%
-- confirm gate in Section 7 only applies once a prior baseline exists to
-- diff against.
INSERT INTO fuel_index (fuel_price_fjd_per_litre, effective_from, multiplier, order_reference, updated_by)
VALUES (3.39, '2026-07-01', 1.0, 'LN 89/26 - Petroleum Prices (No. 6) Order 2026 - Schedule 1, Gasoil (diesoline), Retail, Bulk Sale', 'Claude Code - seeded from real FCCC PDF, no prior baseline existed');

-- Tracks the most recently detected FCCC order (by PDF filename) so the
-- weekly cron doesn't re-notify the admin every week about the same
-- still-unconfirmed order.
INSERT INTO platform_settings (key, value) VALUES ('fuel_index_last_seen_order', 'LN-89-FCCC-Price-Control-Petroleum-Prices-No.-6-Order-2026.pdf');

-- Left empty deliberately - no real admin phone number for fuel alerts was
-- given, and guessing one (e.g. reusing the Vosa Vakaviti WhatsApp Business
-- number from the platform architecture) risks sending a real WhatsApp
-- message to the wrong real person. checkFuelIndexUpdate()/
-- handleAdminFuelIndexSubmit() both no-op cleanly with a clear reason until
-- this is set - same pattern as WHATSAPP_TOKEN being unset.
INSERT INTO platform_settings (key, value) VALUES ('admin_alert_phone', '');
