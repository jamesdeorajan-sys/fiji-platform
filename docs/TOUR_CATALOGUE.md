# Tour Catalogue

> The 16 featured tours currently in the booking widget. Pricing and discounts must match the live site at https://fijitourtransfers.com.

## Currency conversion

**Live site = AU$.** This widget = FJ$. Conversion rate: **1 AU$ = 1.45 FJ$** (approximate).

If the AUD/FJD exchange rate moves significantly, update the conversion in `app.js` and re-render all tour prices.

## The 16 featured tours (synced 28 April 2026)

### Cultural & Heritage

| Tour | Live AU$ | Widget FJ$ | Discount | Duration | Live URL |
|---|---|---|---|---|---|
| Nadi Cultural Night Tour | AU$135 (was $159) | FJ$196 | 15% OFF | 4 hrs | [Live](https://fijitourtransfers.com/st_tour/nadi-cultural-night-tour-fiji-up-to-15-off/) |
| Suva City Day Tour | AU$180 | FJ$261 | — | 2 hrs in Suva | [Live](https://fijitourtransfers.com/st_tour/suva-city-tour/) |
| Naihehe Cave Tour (Sigatoka) | AU$160 | FJ$232 | — | 3 hrs | [Live](https://fijitourtransfers.com/st_tour/explore-nahehe-cave-tour-sigatoka-fiji/) |

### Beach Adventures (Horse Riding)

| Tour | Live AU$ | Widget FJ$ | Discount | Duration | Live URL |
|---|---|---|---|---|---|
| Natadola Beach Horse Riding | AU$95 | FJ$138 | — | 50 min | [Live](https://fijitourtransfers.com/st_tour/natadola-beach-horse-riding-fiji-au95/) |
| Natadola Cross Country Horse Riding | AU$125 | FJ$181 | — | 1 hr | [Live](https://fijitourtransfers.com/st_tour/natadola-beach-cross-country-horse-riding-fiji/) |
| Coral Coast Beach Horse Riding | AU$95 (was $127) | FJ$138 | 25% OFF | 1 hr | [Live](https://fijitourtransfers.com/st_tour/coral-coast-beach-horse-riding-tour-fiji/) |

### Waterfalls & Day Tours

| Tour | Live AU$ | Widget FJ$ | Discount | Duration | Live URL |
|---|---|---|---|---|---|
| Biausevu Waterfall & Village Trek | AU$187 (was $267) | FJ$271 | 30% OFF | 3 hrs | [Live](https://fijitourtransfers.com/st_tour/biausevu-waterfall-hiking-tour-in-sigatoka-fiji/) |
| Sigatoka River + Biausevu Combo | AU$150 | FJ$218 | — | 6 hrs | [Live](https://fijitourtransfers.com/st_tour/sigatoka-river-cruise-tour-biausevu-waterfall-tour/) |
| Coral Coast Full Day Experience | AU$120 | FJ$174 | — | 6 hrs | [Live](https://fijitourtransfers.com/st_tour/coral-coast-full-day-tour-fiji/) |

### Adrenaline & Adventure

| Tour | Live AU$ | Widget FJ$ | Discount | Duration | Live URL |
|---|---|---|---|---|---|
| Nadi Zip Line Tour | AU$221 (was $245) | FJ$320 | 10% OFF | 3 hrs | [Live](https://fijitourtransfers.com/st_tour/nadi-zip-line-tour-fiji-2025/) |
| Nausori Highland ATV Adventure | AU$299 (was $427) | FJ$434 | 30% OFF | 5 hrs | [Live](https://fijitourtransfers.com/st_tour/nausori-highland-off-road-atv-bike-adventure-fiji/) |

### Marine & Cruises

| Tour | Live AU$ | Widget FJ$ | Discount | Duration | Live URL |
|---|---|---|---|---|---|
| Snorkel with Sharks | AU$168 | FJ$244 | — | 4 hrs | [Live](https://fijitourtransfers.com/st_tour/snorkel-with-sharks-in-fiji/) |
| Mamanuca Sailing Cruise | AU$181 | FJ$262 | — | 7 hrs | [Live](https://fijitourtransfers.com/st_tour/fiji-mamanuca-islands-all-inclusive-sailing-cruise/) |
| Whale's Tale Day Cruise | AU$249 | FJ$361 | — | 7 hrs | [Live](https://fijitourtransfers.com/st_tour/whales-tale-day-cruise/) |
| Sigatoka Coastal Fishing Charter | AU$375 | FJ$544 | — | 3 hrs | [Live](https://fijitourtransfers.com/st_tour/sigatoka-coastal-fishing-charter-fiji/) |

### Wellness

| Tour | Live AU$ | Widget FJ$ | Discount | Duration | Live URL |
|---|---|---|---|---|---|
| Sabeto Hot Springs & Mud Pool | AU$190 | FJ$276 | — | 4 hrs | [Live](https://fijitourtransfers.com/st_tour/mud-pool-tour-fiji/) |

## Tours NOT yet in widget (158 still on live site)

The live site has 174 total tours. We've featured the top 16. Other notable ones to consider for future inclusion:

- Coral Coast cruises (Captain Cook, Whale's Tale variants)
- Mamanuca day-trip variants
- Yasawa overnight stays
- Sea kayaking
- Stand-up paddleboarding
- Day trips to Tivua, Wakaya, Sawa-i-Lau
- Savusavu / Taveuni domestic-flight day trips
- Cultural village stays (overnight)

When ready to expand, fetch from `https://fijitourtransfers.com/tours/page/N/` and pick by category.

## Sync workflow

**Currently:** Manual sync. When prices change on live site, manually update `app.js` and this doc.

**Target:** Automated sync via WordPress REST API or weekly `tours.json` snapshot. See `INTEGRATION_BACKLOG.md` for the technical plan.

### Manual sync checklist

When asked to refresh tour prices:

1. Fetch `https://fijitourtransfers.com/` (homepage, shows featured tours)
2. Fetch `https://fijitourtransfers.com/tours/` (full list)
3. For each of our 16 tours, check:
   - [ ] Current price in AU$
   - [ ] "Was" price (strikethrough)
   - [ ] Discount % badge
   - [ ] Duration
   - [ ] Hero image URL (if changed)
4. Update `TOURS_DATA` in `app.js`
5. Update this MD file with new live prices
6. Bump cache version
7. Test that tour cards still render and "Book this tour →" still auto-fills

## Tour-to-booking-form mapping

Each tour pre-fills the booking form when "Book this tour →" is clicked:

```javascript
bookingData: {
  pickupValue: 'NAN',                  // Default pickup
  destValue: 'INTERCONTINENTAL_NATADOLA', // Maps to a hotel in dropdown
  tripType: 'return',                  // Most tours are round-trip
  passengers: 2,                       // Reasonable default
  notes: 'TOUR BOOKING: ...'           // Pre-filled notes for the driver
}
```

When mapping a new tour:
- Pick a `destValue` that's the closest sensible destination from our hotel database
- For general-area tours (e.g. "Coral Coast Full Day"), pick a representative hotel like Shangri-La
- For tour-specific destinations (e.g. "Sigatoka Sand Dunes"), use that exact destination
