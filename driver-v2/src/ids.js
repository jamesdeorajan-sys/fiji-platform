// Opaque identifiers using the Web Crypto API (available in Node 22 AND Cloudflare Workers; no node: imports so the same module bundles for Workers).
const hex = (n) => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');
export const opaqueId = (prefix) => `${prefix}_${hex(16)}`;
export const defaultIds = { offer: () => opaqueId('ofr'), evidence: () => opaqueId('evd') };
