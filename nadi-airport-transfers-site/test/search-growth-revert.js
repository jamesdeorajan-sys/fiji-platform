// Undoes EXACTLY the NAT search-growth release (ceo/nat-search-growth-r1): 8 existing served files edited, 1 new page added.
// Earlier scope checks pass files through undoSearchGrowth() (via undoRouteSource for route pages) and skip SEARCH_GROWTH_NEW when
// walking the upload tree, so they keep proving nothing else changed. The fixtures are the byte-exact files of production 49d0776.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { undoRouteVehicle, undoRouteVehicleBuf } from './route-vehicle-revert.js'; // the route-vehicle candidate sits on top of search-growth: undo it first
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SEARCH_GROWTH_NEW = 'nadi-airport-transfers-with-child-seats/index.html';
export const SEARCH_GROWTH_EDITED = [
  'index.html', 'sitemap.xml',
  'transfer/hilton-fiji-beach-resort.html', 'transfer/naviti-resort.html', 'transfer/pearl-south-pacific-resort.html',
  'transfer/port-denarau-marina.html', 'transfer/port-denarau.html', 'transfer/shangri-la-yanuca-island.html',
];
export function undoSearchGrowth(file, s) {
  s = undoRouteVehicle(file, s); // the newest candidate's edits to app.js / funnel-nat.js (index.html is replaced by the fixture below)
  if (!SEARCH_GROWTH_EDITED.includes(file)) return s;
  return readFileSync(path.join(HERE, 'fixtures', 'pre-search-growth', file.replace(/\//g, '_')), 'utf8');
}
export function undoSearchGrowthBuf(file, buf) {
  buf = undoRouteVehicleBuf(file, buf);
  return SEARCH_GROWTH_EDITED.includes(file) ? Buffer.from(undoSearchGrowth(file, '')) : buf;
}
