# Metrics — How we know we're winning

> What to measure. None of this is yet wired up to a dashboard. This is the agreed-upon list so when we DO add analytics, we know what to track.

## North-star metric

**Confirmed bookings per week** (counted by paid + confirmed-via-WhatsApp).

Currently: unmeasured.
Target by Q4 2026: 50/week direct from the widget alone (excluding hotel-partner volume).

## Conversion funnel metrics

| Stage | Metric | Target |
|---|---|---|
| Visitor | Unique sessions | (track) |
| Engaged | Scrolled to booking widget | 50%+ of sessions |
| Quote shown | Clicked vehicle / saw price | 30%+ of engaged |
| Step 4 reached | Filled in passenger details | 40%+ of quotes |
| Submitted | Tapped "Confirm & send WhatsApp" | 70%+ of step 4 |
| Confirmed | WhatsApp message sent + replied | 80%+ of submissions |

So our ultimate widget conversion target is:
**unique visit → confirmed booking ≈ 50% × 30% × 40% × 70% × 80% = 3.4%**

For 1,000 weekly visitors, that's 34 bookings. To hit 50/week we need ~1,500 visitors weekly.

## Tour vs transfer split

| Booking type | Current | Target |
|---|---|---|
| Transfer-only | (track) | 50% |
| Tour-only | (track) | 30% |
| Tour + transfer combo | (track) | 20% |

Transfer-only has lower margin but high volume. Tours have higher margin. Combos are gold — they're a single customer paying premium for both.

## Customer behaviour metrics

| Metric | Why it matters |
|---|---|
| % of bookings that select recommended vehicle | If low, our recommendations are wrong |
| % of customers who add a return trip | Discount nudge effectiveness |
| % triggering 10% discount | Should be 60%+ given the FJ$50 threshold |
| Avg distance booked | Mix of short Denarau hops vs long Coral Coast trips |
| Avg add-ons per booking | Upsell effectiveness (target 1.5 add-ons/booking) |
| % using "Custom location" | If high (>20%), we need more hotels in dropdown |
| % using typeahead search | If high (>50%), feature is winning |

## Operational metrics

| Metric | Target |
|---|---|
| Time from WhatsApp send to confirmation | < 15 minutes |
| Driver on-time rate | > 95% (within 5 min of pickup time) |
| Customer cancellation rate | < 5% |
| 5-star Google review rate | > 80% |
| Repeat customer rate within same Fiji trip | > 30% (pharmacy run, return trip etc) |
| Repeat customer rate across different Fiji trips | > 20% (gold standard) |

## Brand-level metrics

| Metric | Current (April 2026) | Target |
|---|---|---|
| Facebook page views (90 days) | 3.19M | Maintain |
| Facebook engagements (90 days) | 35,908 | 50K |
| Facebook followers | 7,412 | 15K by EOY 2026 |
| Google Business reviews | (track) | 100+ at 4.8+ stars |
| TripAdvisor ranking (Nadi transfers) | (track) | Top 3 |

## Technical / quality metrics

| Metric | Target |
|---|---|
| Page LCP (4G mobile) | < 2.5s |
| Form abandonment rate | < 30% |
| Error rate (JS exceptions) | < 0.5% |
| Cache hit rate | > 90% |
| WhatsApp delivery success | > 99% |

## Equity / social impact metrics

| Metric | Why |
|---|---|
| Drivers employed | Local Fijian employment |
| Avg driver earning per week | Fair wage benchmark |
| Hours of work delivered to local guides | Tour-side employment |
| Village partner payments (kava ceremonies, lovo lunches) | Community share |

## How to measure (when we get to it)

### Phase 1: Free analytics (no infra)
- Cloudflare Web Analytics (already available, just enable)
- Track page views, unique visitors, top pages, country breakdown
- Won't capture booking funnel — just traffic.

### Phase 2: Booking funnel events (small build)
- Add event tracking on key booking actions:
  - `widget_opened`, `vehicle_selected`, `step_2_reached`, ..., `confirm_clicked`
- Send to Cloudflare Web Analytics or Plausible custom events
- Build a funnel chart from this

### Phase 3: Real CRM (after Stripe integration)
- All paid bookings flow into a CRM (HubSpot Free, Notion DB, or custom)
- Customer lifetime value, repeat rate, NPS scores all derive from here
- Tied to email + phone for cross-trip identification

### Phase 4: Operational dashboards
- Driver on-time tracking (driver app data)
- Real-time booking pipeline view
- Hotel partner reconciliation reports

## What NOT to obsess over

- ❌ Page bounce rate alone (tourists often Google → land → leave to read elsewhere → return)
- ❌ Time on site (a 30-second booking is a successful booking, not a low-engagement session)
- ❌ Pageviews per session (we WANT to be the answer, not a rabbit hole)
- ❌ Vanity metrics like "millions of views" without conversion context

## Reporting cadence (when set up)

- **Daily:** confirmed bookings, WhatsApp inbox health, driver on-time
- **Weekly:** funnel conversion, top routes, top tours
- **Monthly:** repeat customer rate, NPS, brand metrics
- **Quarterly:** strategic review against ROADMAP.md

## Owner

Project owner reviews metrics weekly. When metrics indicate a problem (e.g. step-4 abandonment > 50%), open a ticket on the roadmap.
