function buildWhatsAppURL(ref) {
  const fn    = document.getElementById('firstName').value.trim();
  const ln    = document.getElementById('lastName').value.trim();
  const em    = document.getElementById('email').value.trim();
  const ph    = document.getElementById('phone').value.trim();
  const date  = document.getElementById('travelDate').value;
  const time  = document.getElementById('travelTime').value;
  const flight = document.getElementById('flightNum').value.trim() || 'Not provided';
  const notes  = document.getElementById('notes').value.trim() || 'None';
  const vName  = { sedan:'Private Sedan', minivan:'Private Minivan', minibus:'Minibus' }[state.selectedVehicle];
  const t      = calculateTotal();
  const tripLabel = state.tripType === 'return' ? 'Return' : 'One-way';
  const dateStr = date ? new Date(date+'T00:00:00').toLocaleDateString('en-AU',{weekday:'short',day:'numeric',month:'long',year:'numeric'}) : 'Not set';
  const extras = [];
  if (document.getElementById('extra-lei')?.checked)  extras.push('Shell lei welcome');
  if (document.getElementById('extra-seat')?.checked) extras.push('Child/baby seat (+FJ$8)');
  if (document.getElementById('extra-stop')?.checked) extras.push('Supermarket stop');
  if (document.getElementById('extra-surf')?.checked) extras.push('Surfboard/oversized (+FJ$24)');

  const fromName = stripEmoji(state.pickup?.name) || '—';
  const toName   = stripEmoji(state.destination?.hotel) || '—';
  const areaName = stripEmoji(state.destination?.area)  || '—';

  // Build the price block — three cases:
  //  (a) Tour booking — show transfer + tour line + total. No discount applies.
  //  (b) Transfer-only with discount qualified.
  //  (c) Transfer-only, no discount.
  let priceLines;
  if (t.hasTour) {
    const paxLabel = state.passengers === 1 ? 'person' : 'people';
    priceLines = [
      `Transfer:    FJ$${fareText(t.transferSubtotal)}`,
      `Tour (${state.passengers} ${paxLabel}): FJ$${t.tourPerPax}/pp × ${state.passengers} = FJ$${fareText(t.tourTotal)}`,
      `=====================================`,
      `*TOTAL PRICE: FJ$${fareText(t.final)}*`,
    ];
  } else if (t.qualifies) {
    priceLines = [
      `Subtotal:    FJ$${fareText(t.subtotal)}`,
      `Discount:    -FJ$${fareText(t.discount)} (10% off, orders FJ$50+)`,
      `=====================================`,
      `*TOTAL PRICE: FJ$${fareText(t.final)}*`,
    ];
  } else {
    priceLines = [
      `=====================================`,
      `*TOTAL PRICE: FJ$${fareText(t.final)}*`,
    ];
  }

  // When a tour is in the booking, add a dedicated section above the price
  // block so the driver-coordinator sees the tour name clearly. The notes
  // field already contains 'TOUR BOOKING: ...' from selectTour() but a
  // dedicated section is more reliable than relying on free-text notes.
  const tourSection = t.hasTour
    ? [
        ``,
        `*TOUR BOOKED*`,
        `-------------------------------------`,
        `Tour:       ${state.selectedTour.name}`,
        `Duration:   ${state.selectedTour.duration}`,
        `Per person: FJ$${t.tourPerPax} (min ${state.selectedTour.minPax} pax)`,
      ]
    : [];

  const msg = [
    `*NEW BOOKING REQUEST*`,
    `Fiji Tour Transfers`,
    `Booking ref: *${ref}*`,
    `=====================================`,``,
    `*PASSENGER DETAILS*`,
    `-------------------------------------`,
    `Name:     ${fn} ${ln}`,
    `Email:    ${em}`,
    `WhatsApp: ${ph}`,``,
    `*JOURNEY*`,
    `-------------------------------------`,
    `From:     ${fromName}`,
    `To:       ${toName}`,
    `Area:     ${areaName}`,
    `Date:     ${dateStr}`,
    `Pickup:   ${time}`,
    `Trip:     ${tripLabel}`,
    `Distance: ${state.distanceKm.toFixed(1)} km · approx. ${formatDuration(state.durationMin)}`,``,
    `*VEHICLE & PASSENGERS*`,
    `-------------------------------------`,
    `Vehicle:    ${vName}`,
    `Passengers: ${state.passengers} adult(s)`,
    `Luggage:    ${state.luggage} bag(s)`,
    `Flight:     ${flight}`,
    `Add-ons:    ${extras.length ? extras.join(', ') : 'None'}`,``,
    `*SPECIAL REQUESTS*`,
    `-------------------------------------`,
    notes, ``,
    ...tourSection,
    ``,
    ...priceLines,
    `=====================================`, ``,
    `Please confirm availability and payment options.`,
    `Vinaka!`
  ].join('\n');

  return `https://wa.me/61478886145?text=${encodeURIComponent(msg)}`;
}
