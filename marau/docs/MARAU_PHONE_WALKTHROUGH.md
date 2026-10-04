# Marau preview - real-phone walkthrough for James (about 15 minutes)

**Synthetic data only.** This is an isolated preview: nothing here is a real booking, message or payment, and rewards are **OFF**.
Use made-up details only: email like `you.test1@example.test`, phone like `+15005550142`. Never type a real phone number, email or name.
You need **two phones** (call them Phone A and Phone B). Phone B must be a different device (not just another tab) so it has no saved session.

Preview address: `https://marau-stage1-preview.helpronline.workers.dev/`  (release candidate Worker `496b4d98`)

## Steps

| # | On | Do this | You should see | Result (fill in) |
|---|---|---|---|---|
| 1 | Phone A | Open the preview address. Under "Create a synthetic booking" enter the made-up email and phone, leave the deals box UNticked, pick **Arrival transfer**, set a date a few days ahead, tap **Save booking request**. | A "Saved" message, then your **Trip** with one booking. The address bar now ends in `#tok=...` - that is your **private link**. Do not share it. | |
| 2 | Phone A | Scroll the Trip: find **Invite a friend**. | The wording says **"Referral rewards are not switched on yet. You can still share the link."** No amount is promised. A QR code is shown. | |
| 3 | Phone A | Tap the **Offers** tab. Browse; tap **Request** on one open offer (once). | "Request ... received. Nothing was charged." The card shows your request. A sold-out offer has no Request button. | |
| 4 | Phone A | Tap **Copy link** (or **Share**). | "Link copied." If your phone blocks copying you should instead see "Could not copy automatically - the link is selected" and the link highlighted. (It must NOT say "copied" if it did not copy.) | |
| 5 | Phone B | **Scan Phone A's QR code with the camera app.** Open the address it offers. | The preview opens at an address ending `/r/XXXXXXXX`. A short banner says a friend invited you. **It shows nothing about Phone A's trip, name or details.** Note whether the camera scan worked first time. | |
| 6 | Phone B | Still on Phone B, look for any sign of Phone A's booking (email, phone, trip). | **None.** Only the start form and the invitation banner. | |
| 7 | Phone B | (Optional) Create a second synthetic booking with different made-up details. | Its own Trip; rewards wording says "not switched on yet" (rewards are off, so nothing is promised or earned). | |
| 8 | Phone A | Return to Phone A. Open the app from your home screen / browser history, or paste your private link from step 1. | Your **original Trip** (the booking from step 1 and your request from step 3), not Phone B's. | |
| 9 | Phone A | Turn on airplane mode, tap **Request** on another open offer, then turn it off. | "No connection - nothing was sent. Please try again." and the button works again afterwards. | |
| 10 | Phone A | In a browser (not the app) open the preview address plus `/preview/trip`. | `{"error":"unauthorized ..."}` - the private data is not served without the private link. | |

## Record (please send back)

- Phone A model / OS / browser: ______   Phone B model / OS / browser: ______
- Did the camera scan the QR first time (step 5)? Yes / No. If no, what happened? ______
- Anything that looked wrong, confusing, or showed another guest's information: ______
- Screenshots of steps 2, 5 and 8 (blur anything you typed): attached? Yes / No

**Evidence status:** until this table is filled in, **physical-phone evidence does not exist** - everything else in the release-candidate document is local, hosted-synthetic or embedded-browser evidence.

## If something fails

Stop and tell us the step number and what you saw. Do not retry with real details. The preview can be reset by restoring the D1 bookmark in `MARAU_RELEASE_CANDIDATE.md`.
