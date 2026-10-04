# Round-trip preview - short physical-phone checklist (candidate `marau-roundtrip-pilot-rc2`)

*This is for the ROUND-TRIP preview (`marau-stage1-preview-legs`). The older checklist in `MARAU_PHONE_WALKTHROUGH.md` is for **RC1** and is unchanged.*

**Synthetic data only. Rewards are OFF for every check below.** Your two private trip links are sent to you **privately in chat** - they are not in this repository. Treat them like passwords. Do not type real details anywhere.

| # | On | Do this | You should see | Result |
|---|---|---|---|---|
| 1 | Phone A | Open **Link A**. | A trip with **two** tabs: "Nadi Airport -> Denarau" (the arrival) and "Sofitel Denarau lobby -> Nadi Airport" (the return, a week later). Both say **Confirmed**. | |
| 2 | Phone A | Tap the return tab. | Pickup is **Sofitel Denarau lobby**, destination Nadi Airport. No fare box (no credit exists). | |
| 3 | Phone A | Scroll to **Invite a friend**. | "Referral rewards are not switched on yet." No amount promised. A QR code. | |
| 4 | Phone B | Scan Phone A's QR with the **camera**. | A page ending `/r/XXXXXXXX` with an invitation banner and **nothing** about Phone A's trip. Note whether the scan worked first time. | |
| 5 | Phone A | Open **Link B**. | Tap the return tab: status **Awaiting human confirmation** and the sentence "The booking system shows this trip as completed, but this return transfer is still ahead. Our team is checking it." It must **not** say Confirmed. | |
| 6 | Phone A | On Link B, look at the arrival tab. | The arrival is shown as it was; nothing says the return is confirmed or used. | |
| 7 | Phone A | Reopen Link A from your home screen/history. | Your original round trip again (not Link B's). | |

Record: phone models/OS/browser · did the camera scan work first time · anything that looked wrong or showed someone else's information.
**Until this table is filled in, physical-phone evidence for the round-trip preview does not exist.**

## Update: leg clarity (Worker `efc611e1`, commit `4e510ea`)
On your Trip you should now see two cards, each with its OWN values:
- **ARRIVAL** - Date (with year), Pickup time "... Fiji time", Pickup location, Destination, Status.
- **RETURN TO AIRPORT** - Return date (with year), Hotel pickup time "... Fiji time", Pickup location (the hotel), Destination (the airport), Status.
Anything not recorded reads **Awaiting pickup details** - the return never borrows the arrival's date/time, and the hotel pickup time is never worked out from a flight time.
Tapping the ARRIVAL / RETURN chips changes the selected leg only; both cards keep their own dates after a reload or reopening the link.
**Synthetic test form:** choose Arrival, Return to airport (standalone) or Round trip. Labels change to "Arrival pickup date & time" / "Return pickup date & time (Fiji time)"; Round trip asks for separate return date/time, return hotel and return fare. A contradictory direction (e.g. Return with Nadi Airport -> Denarau) is explained and not saved. Old RC1 link = the previous single-date form; use the RC2 link instead.
