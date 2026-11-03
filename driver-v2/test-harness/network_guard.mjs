// Any outbound network attempt during a Gate 1 test is recorded AND throws. Tests assert guard.attempts.length === 0.
// Covers fetch, raw sockets (http/https/tls/net), and DNS. Loopback sockets are allowed only when `allowLoopback` is set
// (the browser dev-server process), never in the unit/stress suites.
import net from 'node:net';
import dns from 'node:dns';
import tls from 'node:tls';

export function installNetworkGuard({ allowLoopback = false } = {}) {
  const attempts = [];
  const orig = { fetch: globalThis.fetch, connect: net.Socket.prototype.connect, lookup: dns.lookup, tls: tls.connect };
  const isLoopback = (h) => !h || h === 'localhost' || h === '127.0.0.1' || h === '::1';
  globalThis.fetch = async (url) => { attempts.push({ via: 'fetch', url: String(url) }); throw new Error(`NETWORK_GUARD: unexpected fetch to ${url}`); };
  net.Socket.prototype.connect = function (...a) {
    const o = typeof a[0] === 'object' && a[0] ? a[0] : { port: a[0], host: a[1] };
    if (allowLoopback && isLoopback(o.host)) return orig.connect.apply(this, a);
    attempts.push({ via: 'socket', host: o.host, port: o.port, path: o.path });
    throw new Error(`NETWORK_GUARD: unexpected socket connect ${o.host || o.path}:${o.port}`);
  };
  dns.lookup = (host, ...rest) => { if (allowLoopback && isLoopback(host)) return orig.lookup(host, ...rest); attempts.push({ via: 'dns', host }); const cb = rest[rest.length - 1]; if (typeof cb === 'function') return cb(new Error('NETWORK_GUARD: dns blocked')); throw new Error('NETWORK_GUARD: dns blocked'); };
  tls.connect = (...a) => { attempts.push({ via: 'tls', args: String(a[0]?.host || a[0]) }); throw new Error('NETWORK_GUARD: tls blocked'); };
  return {
    attempts,
    uninstall() { globalThis.fetch = orig.fetch; net.Socket.prototype.connect = orig.connect; dns.lookup = orig.lookup; tls.connect = orig.tls; },
  };
}
