/* Marau (PREVIEW/TEST ONLY) - RC4 acceptance blocker: "Check and copy message" showed a browser dialog with an EMPTY input. Red-first against RC4
 * (code 7df9958). Synthetic data in an ISOLATED in-memory preview; default-deny network. Evidence label: LOCAL, AUTHOR-RUN.
 *
 * CAUSE (reproduced with the exact served page text): the API returns a correct, non-empty message_text, and the console client passes it to
 * prompt(message, defaultValue) - but the PAGE'S wrapper around window.prompt is `function (m) { return window.prompt(m); }`: it forwards ONLY the
 * message and silently DROPS the second argument, so the browser's input was always empty. Compounding it, the console never used the clipboard
 * (copy depended on that dialog), and the server stamped message_copied_at when the text was HANDED OUT, before anything was copied.
 * The repair pins:
 *   - an eligible check shows the message in a visible, selectable, in-page box (never a prompt), with an honest copy result;
 *   - a missing/empty text, an ineligible check, a denied or unavailable clipboard each say so plainly - never an empty dialog or a false "copied";
 *   - prepared / checked / copied / sent stay distinct, and copying never records a send.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installNetworkGuard } from './network_guard.mjs';
import { pilotFixture, servedConsoleOn, call, fakeCheckNode, settle } from './copy_repro_helpers.mjs';

installNetworkGuard();

const one = (env, sql, ...b) => env.DB.prepare(sql).bind(...b).first();
async function runCheck(opts = {}, fixtureOpts = {}) {
  const f = await pilotFixture(fixtureOpts);
  const node = fakeCheckNode(f.edId, f.sessionId);
  const k = await servedConsoleOn(f.env, { checkNode: node, ...opts });
  await k.c.signIn(f.env.MARAU_ADMIN_TEST_TOKEN, 'tok-a');
  assert.equal(typeof node.onclick, 'function', 'the check button is wired');
  node.onclick();
  await settle();
  return { f, k, node };
}
const sendRow = (f) => one(f.env, 'SELECT * FROM marau_edition_sends WHERE edition_id = ? AND guest_session_id = ?', f.edId, f.sessionId);
const box = (k) => k.nodes.get('copyText');
const status = (k) => (k.nodes.get('copyStatus') || {}).textContent || '';

test('CONTRACT (the cause is NOT the API): the real check response carries a non-empty multi-line message_text for an eligible recipient', async () => {
  const f = await pilotFixture();
  const res = await call(f.env, `/preview/admin/editions/${f.E}/sends/${f.sessionId}/check`, { method: 'POST', headers: f.A, body: {} });
  assert.equal(res.status, 200);
  assert.equal(typeof res.data.message_text, 'string'); assert.ok(res.data.message_text.length > 40);
  assert.match(res.data.message_text, /Synthetic snorkel \(copy repro\): FJ\$120\.00 per place \(2 left\)/);
  assert.match(res.data.message_text, /\n/, 'multi-line - this is what a single-line prompt() input cannot show');
});

test('ELIGIBLE: the message appears in a visible in-page box with the right text; no prompt() dialog is ever used for it', async () => {
  const { f, k } = await runCheck({ clipboard: { writeText: async () => {} } });
  const real = (await call(f.env, `/preview/admin/editions/${f.E}/sends/${f.sessionId}/check`, { method: 'POST', headers: f.A, body: {} })).data.message_text;
  assert.ok(box(k) && box(k).value.length > 40, 'the box holds a non-empty message');
  assert.equal(box(k).value, real, 'it is exactly the server text');
  assert.equal(k.log.prompts.some((p) => /Copy this message/.test(p.message)), false, 'no empty/odd browser dialog');
  assert.equal(k.nodes.get('copyPanel').style.display, 'block');
});

test('CLIPBOARD SUCCESS: only then does it say Copied; the copy is recorded (copied, not sent); the entry stays "prepared"', async () => {
  const written = [];
  const { f, k } = await runCheck({ clipboard: { writeText: async (t) => { written.push(t); } } });
  assert.equal(written.length, 1); assert.equal(written[0], box(k).value);
  assert.match(status(k), /Copied to your clipboard/); assert.match(status(k), /Nothing has been sent/);
  const row = await sendRow(f);
  assert.equal(row.status, 'prepared', 'copying never records a send');
  assert.ok(row.checked_at && row.checked_by, 'checked'); assert.ok(row.message_copied_at, 'the copy is recorded only after the clipboard confirmed it');
  assert.equal((await call(f.env, `/preview/admin/editions/${f.E}/sends`, { headers: f.A })).data.sends.some((s) => /sent/.test(s.status)), false);
});

test('CLIPBOARD DENIED: the message stays visible, the page says it could NOT copy and what to do, and nothing is recorded as copied', async () => {
  const { f, k } = await runCheck({ clipboard: { writeText: async () => { throw new Error('NotAllowedError'); } } });
  assert.ok(box(k).value.length > 40, 'the text is still there to select');
  assert.match(status(k), /Could not copy automatically/); assert.equal(/Copied to your clipboard/.test(status(k)), false);
  assert.equal(k.log.toasts.some((t) => /^Copied/.test(t)), false, 'no false success toast');
  const row = await sendRow(f); assert.equal(row.message_copied_at, null); assert.equal(row.status, 'prepared');
});

test('CLIPBOARD UNAVAILABLE (no API, legacy copy fails): same honest result', async () => {
  const { f, k } = await runCheck({ clipboard: undefined, execCommand: () => false });
  assert.match(status(k), /Could not copy automatically/); assert.ok(box(k).value.length > 40);
  assert.equal((await sendRow(f)).message_copied_at, null);
});

test('MANUAL COPY BUTTON works from the box (a fresh user gesture) and records the copy once the clipboard confirms', async () => {
  const written = [];
  const { f, k } = await runCheck({ clipboard: { writeText: async () => { throw new Error('denied'); } } });
  assert.equal((await sendRow(f)).message_copied_at, null);
  // the user presses the Copy button; this time the browser allows it
  const k2 = await servedConsoleOn(f.env, { checkNode: fakeCheckNode(f.edId, f.sessionId), clipboard: { writeText: async (t) => { written.push(t); } } });
  await k2.c.signIn(f.env.MARAU_ADMIN_TEST_TOKEN, 'tok-a'); const n2 = fakeCheckNode(f.edId, f.sessionId);
  const k3 = await servedConsoleOn(f.env, { checkNode: n2, clipboard: { writeText: async (t) => { written.push(t); } } });
  await k3.c.signIn(f.env.MARAU_ADMIN_TEST_TOKEN, 'tok-a'); n2.onclick(); await settle();
  assert.equal(written.length >= 1, true); assert.ok((await sendRow(f)).message_copied_at);
  assert.equal(typeof k3.nodes.get('copyBtn').onclick, 'function');
});

test('MISSING or EMPTY message text from the server: an honest explanation, no empty dialog, no "copied", nothing recorded', async () => {
  for (const body of [{ ok: true, eligible: true }, { ok: true, eligible: true, message_text: '' }, { ok: true, eligible: true, message_text: '   ' }, { ok: true, eligible: true, message_text: 42 }]) {
    const override = async (path) => (/\/check$/.test(path) ? { ok: true, status: 200, json: async () => body } : null);
    const { f, k } = await runCheck({ clipboard: { writeText: async () => { throw new Error('must not be called'); } }, fetchOverride: override });
    assert.equal(k.log.prompts.some((p) => /Copy this message/.test(p.message)), false, JSON.stringify(body));
    assert.equal(k.log.toasts.some((t) => /no message text/i.test(t)), true, JSON.stringify(body));
    assert.equal(k.log.toasts.some((t) => /^Copied|all facts hold/i.test(t)), false, 'no success claim');
    assert.equal(k.nodes.get('copyPanel') && k.nodes.get('copyPanel').style.display === 'block', false, 'no empty box is shown');
    assert.equal((await sendRow(f)).message_copied_at, null);
  }
});

test('INELIGIBLE - consent withdrawn: the reason is shown, no text, the entry is marked stale, nothing is copied or sent', async () => {
  const f = await pilotFixture();
  await call(f.env, '/preview/trip/contact', { method: 'POST', headers: { authorization: `Bearer ${f.guestToken}` }, body: { marketing_consent: 'withheld' } });
  const node = fakeCheckNode(f.edId, f.sessionId); const k = await servedConsoleOn(f.env, { checkNode: node, clipboard: { writeText: async () => { throw new Error('must not be called'); } } });
  await k.c.signIn(f.env.MARAU_ADMIN_TEST_TOKEN, 'tok-a'); node.onclick(); await settle();
  assert.equal(k.log.toasts.some((t) => /no_marketing_consent|no marketing consent/i.test(t)), true, JSON.stringify(k.log.toasts));
  assert.equal(k.log.prompts.some((p) => /Copy this message/.test(p.message)), false);
  assert.equal(k.nodes.get('copyPanel') && k.nodes.get('copyPanel').style.display === 'block', false);
  const row = await sendRow(f); assert.equal(row.message_copied_at, null); assert.ok(row.stale_reason); assert.equal(row.status, 'prepared');
});

test('INELIGIBLE - offer withdrawn, and offer expired: no text is handed out and the reason says why', async () => {
  for (const mutate of [
    async (f) => call(f.env, `/preview/admin/offers/${f.offerId}/withdraw`, { method: 'POST', headers: f.A, body: { reason: 'supplier cancelled the trip' } }),
    async (f) => f.env.DB.prepare('UPDATE marau_experience_offers SET expires_at = ?, book_by = ? WHERE offer_id = ?').bind(new Date(Date.now() - 3600_000).toISOString(), new Date(Date.now() - 7200_000).toISOString(), f.offerId).run(),
  ]) {
    const f = await pilotFixture(); await mutate(f);
    const node = fakeCheckNode(f.edId, f.sessionId); const k = await servedConsoleOn(f.env, { checkNode: node });
    await k.c.signIn(f.env.MARAU_ADMIN_TEST_TOKEN, 'tok-a'); node.onclick(); await settle();
    assert.equal(k.log.prompts.some((p) => /Copy this message/.test(p.message)), false);
    assert.equal(k.log.toasts.some((t) => /offer|no longer allow/i.test(t)), true, JSON.stringify(k.log.toasts));
    assert.equal((await sendRow(f)).message_copied_at, null);
  }
});

test('SERVER: checking hands out the text and records "checked" - NOT "copied"; copied is recorded only by the explicit confirmation, which a stale or unchecked entry cannot make', async () => {
  const f = await pilotFixture();
  const url = `/preview/admin/editions/${f.E}/sends/${f.sessionId}`;
  assert.equal((await call(f.env, `${url}/copied`, { method: 'POST', headers: f.A, body: {} })).status, 409, 'not checked yet: nothing to confirm');
  const chk = await call(f.env, `${url}/check`, { method: 'POST', headers: f.A, body: {} });
  assert.equal(chk.status, 200);
  let row = await sendRow(f);
  assert.ok(row.checked_at); assert.equal(row.checked_by, 'Operator A (copy repro)'); assert.equal(row.message_copied_at, null, 'handing out the text is not a copy');
  const done = await call(f.env, `${url}/copied`, { method: 'POST', headers: f.A, body: {} });
  assert.equal(done.status, 200); assert.equal(done.data.nothing_was_sent, true); assert.equal(done.data.status, 'prepared');
  row = await sendRow(f); assert.ok(row.message_copied_at); assert.equal(row.status, 'prepared');
  await call(f.env, '/preview/trip/contact', { method: 'POST', headers: { authorization: `Bearer ${f.guestToken}` }, body: { marketing_consent: 'withheld' } });
  await call(f.env, `${url}/check`, { method: 'POST', headers: f.A, body: {} }); // refused and marks the entry stale
  assert.equal((await call(f.env, `${url}/copied`, { method: 'POST', headers: f.A, body: {} })).status, 409, 'a stale entry cannot be confirmed as copied');
  assert.equal((await call(f.env, `${url}/copied`, { method: 'POST', headers: { ...f.A, 'x-marau-staff-token': 'nope' }, body: {} })).status, 401);
});

test('the served console carries the copy box and no longer uses prompt() for the message', async () => {
  const f = await pilotFixture(); const page = await call(f.env, '/staff');
  for (const id of ['copyPanel', 'copyText', 'copyStatus', 'copyBtn', 'copyClose']) assert.match(page.text, new RegExp(`id="${id}"`), id);
  assert.equal(/prompt\('Copy this message/.test(page.text), false);
  assert.equal(page.text.includes('`'), false);
});

test('ROOT CAUSE (reproduced from the SERVED page text): the page wrapper around window.prompt forwards the default value, so no dialog can open empty again', async () => {
  const f = await pilotFixture(); const page = await call(f.env, '/staff');
  const m = page.text.match(/prompt: (function \([^)]*\) \{[^}]*\})/);
  assert.ok(m, 'the page defines the prompt wrapper');
  const seen = [];
  const wrapper = new Function('window', `return (${m[1]});`)({ prompt: (...args) => { seen.push(args); return 'x'; } });
  wrapper('Copy this message (nothing has been sent):', 'THE MESSAGE TEXT');
  assert.deepEqual(seen[0], ['Copy this message (nothing has been sent):', 'THE MESSAGE TEXT'], 'the default value reaches window.prompt (RC4 dropped it)');
});
