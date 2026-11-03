// Capture / no-send adapters for Gate 1. There is NO real messaging or object-storage adapter in this module by design:
// every outbound intent is recorded, nothing leaves the process. Guest / admin / driver WhatsApp and email are always suppressed.
import { opaqueId, defaultIds } from './ids.js';
export { opaqueId, defaultIds };

export class CaptureNotifier {
  // deliveryMode(driverId) => 'DELIVERED' | 'NO_RECEIPT' | 'PROVIDER_ERROR'
  constructor({ deliveryMode = () => 'DELIVERED' } = {}) { this.intents = []; this.deliveryMode = deliveryMode; }
  async send(intent) {
    const rec = { ...intent, suppressed: true, real_send: false, seq: this.intents.length + 1 };
    this.intents.push(rec);
    if (intent.to && intent.to.role) return { suppressed: true, delivered: false };       // guest/admin: capture intent only
    const mode = this.deliveryMode(intent.to?.driver_id);
    if (mode === 'PROVIDER_ERROR') { const e = new Error('simulated provider failure'); e.code = 'NOTIFICATION_PROVIDER_ERROR'; throw e; }
    return { suppressed: true, delivered: mode === 'DELIVERED' };
  }
  byKind(kind) { return this.intents.filter((i) => i.kind === kind); }
}

export class CaptureEvidenceStore {
  constructor() { this.objects = new Map(); this.failuresLeft = 0; this.putCalls = 0; }
  failNext(n = 1) { this.failuresLeft = n; }
  async put({ key, sha256, bytes }) {
    this.putCalls++;
    if (this.failuresLeft > 0) { this.failuresLeft--; throw new Error('simulated object-storage failure'); }
    this.objects.set(key, { sha256, bytes });
    return { key };
  }
}

