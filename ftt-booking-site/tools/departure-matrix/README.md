# Departure displayed-vs-recorded price matrix (issue #59)

Evidence for the allow-list in `src/app.js` (`DEPARTURE_ONLINE_HOTELS`). Not part of the deployed site (outside `src/`).
NOT a fare decision: it only measures whether the amount the widget DISPLAYS equals the amount the deployed Worker would RECORD.

* Client side: the widget's real `src/app.js` executed in a Node `vm` with a stubbed DOM (`calculateTotal`, `computePrices`, `applyModifiers`, add-on rules). Cross-checked against the real browser: Hilton 45/58/81 by day, 49/72/99 at 05:30.
* Server side: the real deployed Worker code via the offline harness (`test-fixtures/worker-harness.js` on branch `ceo/fijidash-fare-display-consistency`; in-memory D1 seeded from a read-only pricing snapshot dated 2026-09-27). Paths in the scripts are machine-specific; point them at that fixture.
* Run: `node departure_matrix.js` and `node departure_capacity.js`. Regenerate whenever `pricing_rules`, the published fare table, the loyalty rule or the night rule change.

## Result (2026-09-27)
`departure_matrix.js`: 45 hotel pickups to NAN x 3 vehicles x 4 add-on combinations (none, child seat FJ$8, surfboard FJ$24, both) x 53 pickup times (every 30 min plus 05:59, 06:00, 06:01, 21:59, 22:00, 22:01, 00:00, 23:59) = **28,620 combinations**: 22,143 recorded exactly as displayed, 6,477 replaced by a different server amount. **29 hotels are consistent in every combination**; all 6,477 mismatches belong to the other 16 hotels (Nadi/Wailoaloa cluster, Hexagon/Smugglers, DoubleTree Sonaisali, First Landing, Suva minibus, Volivoli/Wananavu). The allow-list equals exactly those 29. The loyalty-discount threshold (subtotal > FJ$50, including add-ons), night boundaries (hour >= 22 or < 6, identical on both sides) and add-ons introduce no mismatch for the 29.
`departure_capacity.js`: 7,560 passengers x luggage checks: the displayed price does not depend on passengers or luggage; the enabled vehicles match the fit rule (sedan 3 pax/3 bags, minivan 7/7, minibus 12/14). The UI caps passengers at 12, so over-capacity parties cannot be created.
Not measured: return trips (excluded from online save by the gate), tours (excluded), custom addresses (out of scope).
