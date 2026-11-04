# Sprint 21 — Fiji travel essentials

Fiji time is calculated client-side with the IANA Pacific/Fiji timezone and refreshed each second. It relies on the guest device clock; not an authoritative time service. Official weather, biosecurity and travel advice are linked to their sources. Currency is clearly labelled FJD; no live rate is displayed until a vetted rate provider, caching, timestamp, failure handling and appropriate attribution are connected.

Next phase: server-fed Nadi/Suva weather cards with source timestamp and stale-state fallback; 4-6 guest-selected currency pairs (AUD, NZD, USD, EUR, GBP, CAD) with FJD as the anchor; flight-status links, immigration and emergency resource review; mobile testing; source availability monitoring. Do not fabricate live data or claim the feed is connected.

Security: external links use noopener/noreferrer; no client-side secrets; weather warnings remain linked to Fiji Met official source. Keep noindex until real content, quality and production approval. No production changes.
