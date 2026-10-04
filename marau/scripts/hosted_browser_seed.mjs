/* Seeds SYNTHETIC data in the ISOLATED PREVIEW for the guest-browser acceptance run (nothing real; nothing is sent).
 *   node scripts/hosted_browser_seed.mjs <base url> <admin test token>
 * Leaves rewards OFF so the guest browser first sees the rewards-off wording. Prints the ids/tokens the browser run needs
 * (preview-only throwaway staff tokens). */
const [BASE, ADMIN] = process.argv.slice(2);
const RUN = Date.now().toString(36);
const api = async (path, { method = 'GET', body, headers = {} } = {}) => {
  const r = await fetch(BASE + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); try { return { status: r.status, data: JSON.parse(t) }; } catch { return { status: r.status, data: t }; }
};
const A = { authorization: `Bearer ${ADMIN}` };
const ANA = `br-ana-${RUN}`; const staff = { ...A, 'x-marau-staff-token': ANA };
const inDays = (d, h = 0) => new Date(Date.now() + d * 86400_000 + h * 3600_000).toISOString();
await api('/preview/admin/staff-identities', { method: 'POST', headers: A, body: { token: ANA, operator_name: `Ana (browser demo ${RUN})` } });
await api('/preview/admin/rewards/policy', { method: 'POST', headers: staff, body: { mode: 'off' } });
const sup = await api('/preview/admin/suppliers', { method: 'POST', headers: staff, body: { name: `Synthetic Reef Tours ${RUN}`, fulfilment_owner: `Ana (browser demo ${RUN})` } });
await api(`/preview/admin/suppliers/${sup.data.supplier_id}/verify`, { method: 'POST', headers: staff });
const mk = async (title, extra = {}) => {
  const c = await api('/preview/admin/offers', { method: 'POST', headers: staff, body: { supplier_id: sup.data.supplier_id, title, location: 'Mamanuca reef (synthetic)', inclusions: ['boat', 'lunch'], starts_at: inDays(6), book_by: inDays(5), expires_at: inDays(5, 12), capacity: 6, price_per_place_fjd: 120, cost_per_place_fjd: 80, ...extra } });
  await api(`/preview/admin/offers/${c.data.offer_id}/publish`, { method: 'POST', headers: staff });
  return c.data.offer_id;
};
const open = await mk(`Synthetic snorkel ${RUN}`);
const soldOut = await mk(`Synthetic sold-out sunset ${RUN}`, { capacity: 1 });
const lapsing = await mk(`Synthetic lapsing deal ${RUN}`);
// take the only place of the sold-out offer with a synthetic guest
const g = await api('/preview/bookings', { method: 'POST', body: { guest_email: `br.sold.${RUN}@example.test`, guest_phone: '+15005557001', whatsapp_available: true, pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', vehicle_type: 'Sedan', quoted_amount: 80, pickup_datetime: inDays(2).slice(0, 16) } });
await api(`/preview/offers/${soldOut}/request`, { method: 'POST', headers: { authorization: `Bearer ${g.data.access_token}` }, body: { places: 1 } });
console.log(JSON.stringify({ run: RUN, staff_token: ANA, open_offer: open, sold_out_offer: soldOut, lapsing_offer: lapsing }));
