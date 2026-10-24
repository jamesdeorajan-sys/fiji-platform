// Undoes EXACTLY the booking-attribution release (ceo/nat-booking-attribution-r2, from 7df4a90): its three app.js additions and the
// app.js cache key in index.html. Later scope checks pass files through undoAttribution() before comparing them with production pins
// taken before this release, so they keep proving that nothing else changed. booking-attribution.test.js proves the additions work.
import { readFileSync } from 'node:fs';
const ATTR_BLOCK = JSON.parse(readFileSync(new URL('./booking-attribution-block.json', import.meta.url), 'utf8'));
const APP = [
  [ATTR_BLOCK, ''],
  ['    require_quote_match: true,\n    ...getNatAttributionForPayload(), // booking source only (see captureNatAttribution); no guest data\n', '    require_quote_match: true,\n'],
  ["document.addEventListener('DOMContentLoaded', () => {\n  try { captureNatAttribution(); } catch (e) { /* never blocks page init */ }\n  // The ", "document.addEventListener('DOMContentLoaded', () => {\n  // The "],
];
const INDEX = [['src="app.js?v=20261016-attribution"', 'src="app.js?v=20261012-return-draft"']];
const once = (s, from, to, f) => { const n = s.split(from).length - 1; if (n !== 1) throw new Error(`${f}: expected the attribution edit exactly once, found ${n}`); return s.replace(from, to); };
export function undoAttribution(file, s) {
  if (file === 'app.js') return APP.reduce((t, [a, b]) => once(t, a, b, file), s);
  if (file === 'index.html') return INDEX.reduce((t, [a, b]) => once(t, a, b, file), s);
  return s;
}
