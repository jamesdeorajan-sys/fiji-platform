// Route-page title/description candidate (ceo/nat-route-titles): 14 route pages get a search-length <title> (<= 60) and
// meta description (<= 160) in the pattern already used on the optimised pages ("Nadi Airport to X: Private Transfer").
// The old titles ended "— Fixed Whole-Vehicle Price", wording the round-2 SEO tests already list as unverified.
// TITLES maps each page to [old title, new title, old description, new description]; undoRouteTitles() restores the old pair
// so scope pins keep proving nothing else changed. DoubleTree is HELD and not listed.

export const TITLES = {
  'transfer/crowne-plaza-fiji-nadi-bay.html': ['Nadi Airport to Crowne Plaza Nadi Bay Resort & Spa Transfer — Fixed Whole-Vehicle Price', 'Nadi Airport to Crowne Plaza Nadi Bay: Private Transfer',
    'Private transfer from Nadi International Airport to Crowne Plaza Nadi Bay Resort & Spa, Wailoaloa. Current sedan fare FJ$39, whole vehicle, no payment now, confirmed by a real Fiji team member.',
    'Private Nadi Airport to Crowne Plaza Nadi Bay transfer: sedan fare FJ$39, whole vehicle. Final total shown before you confirm; no payment to request.'],
  'transfer/fiji-marriott-resort-momi-bay.html': ['Nadi Airport to Fiji Marriott Resort Momi Bay Transfer — Fixed Whole-Vehicle Price', 'Nadi Airport to Fiji Marriott Momi Bay: Private Transfer',
    'Private transfer from Nadi International Airport to Fiji Marriott Resort Momi Bay, Momi Bay. Current sedan fare FJ$99, whole vehicle, no payment now, confirmed by a real Fiji team member.',
    'Private Nadi Airport to Fiji Marriott Momi Bay transfer: sedan fare FJ$99, whole vehicle. Final total shown before you confirm; no payment to request.'],
  'transfer/first-landing-beach-resort.html': ['Nadi Airport to First Landing Beach Resort & Villas Transfer — Fixed Whole-Vehicle Price', 'Nadi Airport to First Landing Resort: Private Transfer',
    'Private transfer from Nadi International Airport to First Landing Beach Resort & Villas, Vuda Point. Current sedan fare FJ$79, whole vehicle, no payment now, confirmed by a real Fiji team member.',
    'Private Nadi Airport to First Landing, Vuda Point transfer: sedan fare FJ$79, whole vehicle. Final total shown before you confirm; no payment to request.'],
  'transfer/grand-pacific-hotel-suva.html': ['Nadi Airport to Grand Pacific Hotel, Suva Transfer — Fixed Whole-Vehicle Price', 'Nadi Airport to Grand Pacific Hotel Suva: Private Transfer',
    'Private transfer from Nadi International Airport to Grand Pacific Hotel, Suva, Suva. Current sedan fare FJ$319, whole vehicle, no payment now, confirmed by a real Fiji team member.',
    'Private Nadi Airport to Grand Pacific Hotel, Suva transfer: sedan fare FJ$319, whole vehicle. Final total shown before you confirm; no payment to request.'],
  'transfer/intercontinental-fiji-natadola.html': ['Nadi Airport to InterContinental Fiji Golf Resort & Spa, Natadola Transfer — Fixed Whole-Vehicle Price', 'Nadi Airport to InterContinental Natadola: Private Transfer',
    'Private transfer from Nadi International Airport to InterContinental Fiji Golf Resort & Spa, Natadola, Natadola. Current sedan fare FJ$99, whole vehicle, no payment now, confirmed by a real Fiji team member.',
    'Private Nadi Airport to InterContinental Natadola transfer: sedan fare FJ$99, whole vehicle. Final total shown before you confirm; no payment to request.'],
  'transfer/pacific-harbour.html': ['Nadi Airport to Pacific Harbour Transfer — Fixed Whole-Vehicle Price', 'Nadi Airport to Pacific Harbour: Private Transfer',
    'Private transfer from Nadi International Airport to Pacific Harbour. Current sedan fare FJ$199, whole vehicle, no payment now, confirmed by a real Fiji team member.',
    'Private Nadi Airport to Pacific Harbour transfer: sedan fare FJ$199, whole vehicle. Final total shown before you confirm; no payment to request.'],
  'transfer/radisson-blu-resort-fiji-denarau.html': ['Nadi Airport to Radisson Blu Resort Fiji Denarau Island Transfer — Fixed Whole-Vehicle Price', 'Nadi Airport to Radisson Blu Denarau: Private Transfer',
    'Private transfer from Nadi International Airport to Radisson Blu Resort Fiji Denarau Island, Denarau. Current sedan fare FJ$49, whole vehicle, no payment now, confirmed by a real Fiji team member.',
    'Private Nadi Airport to Radisson Blu Denarau transfer: sedan fare FJ$49, whole vehicle. Final total shown before you confirm; no payment to request.'],
  'transfer/sheraton-fiji-golf-beach-resort.html': ['Nadi Airport to Sheraton Fiji Golf & Beach Resort Transfer — Fixed Whole-Vehicle Price', 'Nadi Airport to Sheraton Fiji Golf & Beach Resort Transfer',
    'Private transfer from Nadi International Airport to Sheraton Fiji Golf & Beach Resort, Denarau. Current sedan fare FJ$49, whole vehicle, no payment now, confirmed by a real Fiji team member.',
    'Private Nadi Airport to Sheraton Fiji Golf & Beach transfer: sedan fare FJ$49, whole vehicle. Final total shown before you confirm; no payment to request.'],
  'transfer/sofitel-fiji-resort-spa.html': ['Nadi Airport to Sofitel Fiji Resort & Spa Transfer — Fixed Whole-Vehicle Price', 'Nadi Airport to Sofitel Fiji Resort & Spa: Private Transfer',
    'Private transfer from Nadi International Airport to Sofitel Fiji Resort & Spa, Denarau. Current sedan fare FJ$49, whole vehicle, no payment now, confirmed by a real Fiji team member.',
    'Private Nadi Airport to Sofitel Fiji Resort & Spa transfer: sedan fare FJ$49, whole vehicle. Final total shown before you confirm; no payment to request.'],
  'transfer/tanoa-international-hotel.html': ['Nadi Airport to Tanoa International Hotel Transfer — Fixed Whole-Vehicle Price', 'Nadi Airport to Tanoa International Hotel: Private Transfer',
    'Private transfer from Nadi International Airport to Tanoa International Hotel, Nadi Airport. Current sedan fare FJ$15, whole vehicle, no payment now, confirmed by a real Fiji team member.',
    'Private Nadi Airport to Tanoa International Hotel transfer: sedan fare FJ$15, whole vehicle. Final total shown before you confirm; no payment to request.'],
  'transfer/tokatoka-resort-hotel.html': ['Nadi Airport to Tokatoka Resort Hotel Transfer — Fixed Whole-Vehicle Price', 'Nadi Airport to Tokatoka Resort Hotel: Private Transfer',
    'Private transfer from Nadi International Airport to Tokatoka Resort Hotel, Nadi Airport. Current sedan fare FJ$15, whole vehicle, no payment now, confirmed by a real Fiji team member.',
    'Private Nadi Airport to Tokatoka Resort Hotel transfer: sedan fare FJ$15, whole vehicle. Final total shown before you confirm; no payment to request.'],
  'transfer/warwick-fiji.html': ['Nadi Airport to The Warwick Fiji Transfer — Fixed Whole-Vehicle Price', 'Nadi Airport to The Warwick Fiji: Private Transfer',
    'Private transfer from Nadi International Airport to The Warwick Fiji, Coral Coast. Current sedan fare FJ$149, whole vehicle, no payment now, confirmed by a real Fiji team member.',
    'Private Nadi Airport to The Warwick Fiji transfer: sedan fare FJ$149, whole vehicle. Final total shown before you confirm; no payment to request.'],
  'transfer/westin-denarau-island-resort.html': ['Nadi Airport to The Westin Denarau Island Resort & Spa Transfer — Fixed Whole-Vehicle Price', 'Nadi Airport to The Westin Denarau: Private Transfer',
    'Private transfer from Nadi International Airport to The Westin Denarau Island Resort & Spa, Denarau. Current sedan fare FJ$49, whole vehicle, no payment now, confirmed by a real Fiji team member.',
    'Private Nadi Airport to The Westin Denarau transfer: sedan fare FJ$49, whole vehicle. Final total shown before you confirm; no payment to request.'],
};

const tag = (t) => `<title>${t}</title>`;
const desc = (d) => `<meta name="description" content="${d}">`;

export function applyRouteTitles(file, s) {
  const e = TITLES[file]; if (!e) return s;
  const [ot, nt, od, nd] = e;
  if (s.split(tag(ot)).length !== 2 || s.split(desc(od)).length !== 2) throw new Error('anchor not unique in ' + file);
  return s.replace(tag(ot), tag(nt)).replace(desc(od), desc(nd));
}
export function undoRouteTitles(file, s) {
  const e = TITLES[file]; if (!e) return s;
  const [ot, nt, od, nd] = e;
  return s.replace(tag(nt), tag(ot)).replace(desc(nd), desc(od));
}
