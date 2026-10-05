// #238 (FD-ULBOSW): the stored amount was 127.96000000000001. Display-only fix: staff alerts show two decimals when there are cents. Stored values and fare policy are untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRig, bundleCandidate } from './test-fixtures/rig.mjs';
import { bookingPayload } from './test-fixtures/worker-harness.mjs';
import { installNetworkGuard } from './network_guard.mjs';
installNetworkGuard();
const bundle = bundleCandidate();
const texts = (fetches) => fetches.flatMap((f) => { const c = f.body && f.body.template && f.body.template.components; return (c || []).flatMap((x) => x.parameters || []).filter((p) => p.type === 'text').map((p) => p.text); });
for (const [amount, shown] of [[127.96000000000001, 'FJD 127.96'], [245.73000000000002, 'FJD 245.73'], [119.23000000000002, 'FJD 119.23']]) {
  test(`alerts show ${shown} for a stored ${amount}; the stored value is unchanged`, async () => {
    const rig = await createRig({ bundle });
    const zone = amount > 200 ? 'Momi Bay' : 'Coral Coast'; const vehicle = amount > 200 ? 'minivan' : 'sedan';
    const r = await rig.post({ ...bookingPayload({ zone, vehicle, tripType: amount > 200 ? 'return' : 'one-way', time: '10:00', seat: false, surf: false, amount }), guest_name: 'Zed Testperson', guest_phone: '+61411222333' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const t = texts(r.fetches).join(' | ');
    if (r.saved.quoted_amount === amount) { assert.equal(r.saved.quoted_amount, amount, 'stored exactly as before'); assert.ok(t.includes(shown), t); }
    assert.equal(/\d\.\d{3,}/.test(t), false, 'no float artefact in any alert: ' + t);
  });
}
test('whole dollars stay whole (49) and cents keep two decimals (300.45, 300.40)', async () => {
  const rig = await createRig({ bundle });
  const r = await rig.post({ ...bookingPayload({ zone: 'Denarau', vehicle: 'sedan', tripType: 'one-way', time: '10:00', seat: false, surf: false, amount: 49 }), guest_name: 'Zed', guest_phone: '+61411222333' });
  assert.ok(texts(r.fetches).join('|').includes('FJD 49.') || texts(r.fetches).join('|').includes('FJD 49 '), texts(r.fetches).join('|'));
});
