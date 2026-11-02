# 5. Support WhatsApp

NUMBER FOUND: **+61 478 886 145** (Australian mobile) — in the guest site's own source (`ftt-booking-site/src/index.html`: nav "Chat with us on WhatsApp", footer "WhatsApp us", and the existing `bulaWaBtn` button; 83 occurrences across site pages, last changed 2026-09-02). Two other numbers appear once each on other pages (`+679 776 6223`, `+679 675 0104`); they are not the site-wide contact and I did not use them.
SOURCE: published NAT/FijiDash site source (James-authorised project content), not a Bula configuration. `admin_alert_phone` in NAT is blank in the schema seed and I did not read its production value.
VERIFIED FOR PRODUCTION: **NO.** Nobody has confirmed this number is the intended Bula support line, is monitored for Bula questions, and is the one to print in guest emails. It is also not confirmed to be distinct from the NAT sending (Meta WABA) number.
Messaging: **OFF.** No message was sent, no group created. `BULA_SUPPORT_WHATSAPP` / `BULA_SUPPORT_VERIFIED` stay unset; until James sets both, production guest receipts are blocked by design (`support_contact_unverified`). **Remains a blocker.**
Action for James: reply "VERIFIED: +61 478 886 145 is the Bula support line" (or give the correct number).
