/* Marau (PREVIEW/TEST ONLY) - QR code as an inline SVG, for the PUBLIC referral link only.
 *
 * The module matrix comes from the vendored, MIT-licensed `qrcode-generator` (see ./vendor/README.md). This wrapper only
 * renders it: black modules on a white field with a 4-module quiet zone, which scanners require regardless of the page's
 * dark mode. Never pass anything private here - the input is a public URL by construction.
 */
import qrcode from './vendor/qrcode_generator.cjs';

export function qrMatrix(text, errorCorrection = 'M') {
  const qr = qrcode(0, errorCorrection); // type 0 = smallest version that fits
  qr.addData(String(text), 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const rows = [];
  for (let r = 0; r < n; r += 1) {
    const row = [];
    for (let c = 0; c < n; c += 1) row.push(qr.isDark(r, c));
    rows.push(row);
  }
  return rows;
}

export function qrSvg(text, { cell = 8, quiet = 4, label = 'QR code for the referral link' } = {}) {
  const m = qrMatrix(text);
  const n = m.length;
  const size = (n + quiet * 2) * cell;
  let d = '';
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (m[r][c]) d += `M${(c + quiet) * cell} ${(r + quiet) * cell}h${cell}v${cell}h-${cell}z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${label}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#ffffff"/><path d="${d}" fill="#000000"/></svg>`;
}
