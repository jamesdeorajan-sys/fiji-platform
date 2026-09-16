/* Route visitors enter the existing booking form after app.js has prefilled it.
   Never submit, select a vehicle, change price, or overwrite an explicit anchor. */
(function () {
  function enterPrefilledBooking(win, doc) {
    const params = new URLSearchParams(win.location.search);
    const pickup = params.get('pickup');
    const dest = params.get('dest');
    if (!pickup || !dest || (win.location.hash && win.location.hash !== '#booking')) return false;
    if (doc.getElementById('pickup')?.value !== pickup ||
        doc.getElementById('destination')?.value !== dest) return false;
    const booking = doc.getElementById('booking');
    if (!booking) return false;
    booking.scrollIntoView({ behavior: 'auto', block: 'start' });
    return true;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { enterPrefilledBooking };
  if (typeof window !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function () {
      window.requestAnimationFrame(function () { enterPrefilledBooking(window, document); });
    });
  }
})();
