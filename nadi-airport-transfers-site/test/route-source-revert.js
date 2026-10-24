// Undoes EXACTLY the route-source release (ceo/nat-route-source): one script line before </body> on 22 route pages, and the new
// file src/route-source.js. Earlier scope checks pass route pages through undoRouteSource() and skip ROUTE_SOURCE_FILE when walking
// the upload tree, so they keep proving nothing else changed. route-source.test.js proves the script itself.
export const ROUTE_SOURCE_TAG = '<script src="../route-source.js"></script>\n';
export const ROUTE_SOURCE_FILE = 'route-source.js';
export const ROUTE_SOURCE_HELD = 'transfer/doubletree-sonaisali-island.html';
export function undoRouteSource(file, s) {
  if (!file.startsWith('transfer/') || file === ROUTE_SOURCE_HELD) return s;
  const n = s.split(ROUTE_SOURCE_TAG + '</body>').length - 1;
  if (n !== 1) throw new Error(`${file}: expected the route-source line exactly once before </body>, found ${n}`);
  return s.replace(ROUTE_SOURCE_TAG + '</body>', '</body>');
}
