// Capture-only adapters backed by the ISOLATED D1. There is no network client here: an intent is a row, never a message.
const iso = () => new Date().toISOString();

export class D1CaptureNotifier {
  constructor(db) { this.db = db; }
  async mode() { const r = await this.db.prepare(`SELECT v FROM gate15_meta WHERE k = 'delivery_mode'`).first(); return r ? r.v : 'DELIVERED'; }
  // intent: { kind, channel, booking_id, offer_id?, to: { driver_id } | { role } }
  async send(intent) {
    const driverId = intent.to?.driver_id ?? null; const role = intent.to?.role ?? null;
    const mode = role ? null : await this.mode();
    if (mode === 'PROVIDER_ERROR') { const e = new Error('simulated provider failure'); e.code = 'NOTIFICATION_PROVIDER_ERROR'; throw e; }
    const delivered = mode === 'DELIVERED' ? 1 : 0;
    await this.db.prepare(
      `INSERT OR IGNORE INTO gate15_capture (kind, channel, booking_id, offer_id, to_role, to_driver_id, delivered, suppressed, real_send, created_at) VALUES (?,?,?,?,?,?,?,1,0,?)`,
    ).bind(intent.kind, intent.channel ?? null, intent.booking_id ?? null, intent.offer_id ?? null, role, driverId, delivered, iso()).run();
    return { suppressed: true, delivered: !!delivered };
  }
}

// Evidence "object storage" is not provisioned in Gate 1.5: only the reference + metadata are kept (driver_evidence); no binary exists anywhere.
export class D1CaptureEvidenceStore { async put({ key }) { return { key }; } }
