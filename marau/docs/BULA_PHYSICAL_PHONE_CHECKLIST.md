# Bula Happiness — physical-phone checklist (not yet performed)
Evidence so far is **local emulation only** (Chromium iPhone-13 profile, 390×844). None of the items below has been done on a real phone. Tick each on a real iPhone (Safari) and Android (Chrome); record device, OS, browser, time, pass/fail, screenshot.

Preconditions: private preview URL for the NEW acceptance Worker (not yet deployed), synthetic guest link, a staff device with an individual staff token. No real guest data.

1. Open the guest link from an email/message on the phone → offers load; URL fragment `#tok=` disappears from the address bar.
2. Offers: today and tomorrow groups are separate; each card shows price, welcome credit and net payable; text legible without zoom; buttons ≥ 44 px.
3. Reserve a request-only offer (qty 2) → "Request sent"; My bookings shows **Requested**; no payment is asked for.
4. Staff phone: sign in (admin credential + staff token), confirm; guest phone pull-to-refresh/reload → **Confirmed**.
5. Instant-confirm offer → Confirmed immediately only when a contract exists; otherwise Requested.
6. Cancel inside and outside the free-cancel window → credit/stock restored or not, as the terms on screen say.
7. **Add to Home Screen**, close, relaunch from the icon: still authorised (stored token); no service worker exists, so there is no offline claim — airplane mode shows a browser error, which is expected.
8. **Update/reload**: after a new build is deployed, relaunch the installed app and pull to reload; footer build id changes; manifest `start_url` unchanged so the install survives.
9. Link isolation: open a second guest's link in another browser profile — the first guest's bookings never appear.
10. Revocation: revoke a session server-side; the app shows "needs your private trip link", no stale data.
11. 18:00 Fiji: at 17:59 tomorrow's offers are absent; after 18:00 they appear without manual action (needs the hosted cron).
12. Dark mode, portrait/landscape, 200 % text size: no clipped prices or buttons.
13. Email link (capture only): subject/body match the booking; no credit promise when the grant is missing.
