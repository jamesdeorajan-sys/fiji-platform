// Undoes EXACTLY the NAT route-to-vehicle conversion candidate (ceo/nat-route-vehicle-conversion-r1, from production 9eff91b):
// app.js (optional flight, Sedan preselect when it fits), index.html (flight markup + two cache keys) and funnel-nat.js (measurement events,
// OFF). Earlier scope checks pass files through undoRouteVehicle() so they keep proving nothing else changed. The fixtures are the
// byte-exact files of production 9eff91b; route-vehicle.test.js proves the new behaviour and that everything else is unchanged.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROUTE_VEHICLE_EDITED = ['app.js', 'index.html', 'funnel-nat.js'];
export function routeVehicleBase(file) { return readFileSync(path.join(HERE, 'fixtures', 'pre-route-vehicle', file), 'utf8'); }
export function undoRouteVehicle(file, s) { return ROUTE_VEHICLE_EDITED.includes(file) ? routeVehicleBase(file) : s; }
export function undoRouteVehicleBuf(file, buf) { return ROUTE_VEHICLE_EDITED.includes(file) ? Buffer.from(routeVehicleBase(file)) : buf; }
