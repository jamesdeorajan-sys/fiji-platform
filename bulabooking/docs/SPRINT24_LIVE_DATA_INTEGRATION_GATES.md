# Sprint 24 — live-data provider adapters

## Scope
Provider-independent weather and FJD conversion validators, not live integrations. Three Fiji weather locations: Nadi, Denarau, Suva. Currencies: AUD, NZD, USD, EUR, GBP.

## Provider research
Open-Meteo documents a non-commercial free API; commercial deployment needs an appropriate agreement or another licensed provider. Official Fiji Meteorological Service warnings must remain prominent and authoritative. Frankfurter documents date-stamped exchange-rate data; verify FJD pair availability, legal usage and rate freshness before production.

## Required operational integration
1. Server-side scheduled fetch with provider contract and attribution, caching, rate limits, monitoring and failure handling.
2. Normalize source observation time to offset-aware ISO timestamps. Reject stale/malformed weather.
3. FX source must explicitly provide FJD base and each quoted currency. Do not silently invert rates without a reviewed implementation.
4. Label FX estimates indicative and include rate date, source, bank/card/cash spread disclaimer.
5. Never fabricate temperatures, warnings, FX quotes, or live availability.
6. Client UI must show unavailable/stale states, never a fake live badge.
7. Unit tests written but not executed; GitHub clone blocked by environment DNS; CI not confirmed.
8. No production changes.
