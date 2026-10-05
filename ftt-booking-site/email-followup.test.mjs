// Email follow-up fallback ("No WhatsApp? Request confirmation by email") - page module behaviour. The REAL src/email-followup.js runs in a vm sandbox with a minimal DOM stub and a
// stubbed fetch: nothing touches the network, no email or message is sent, all data is synthetic. The same file (identical module) is tested on both sites.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = [path.join(here, '..', 'src'), path.join(here, 'src')].find((d) => existsSync(path.join(d, 'email-followup.js')));
const moduleSrc = readFileSync(path.join(SRC, 'email-followup.js'), 'utf8').replace(/\r/g, '');
const html = readFileSync(path.join(SRC, 'index.html'), 'utf8').replace(/\r/g, '');

function el(over = {}) { const e = { textContent: '', hidden: false, value: '', readOnly: false, disabled: false, attrs: {}, listeners: {}, children: [], focus() {}, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, addEventListener(t, f) { this.listeners[t] = f; }, appendChild(c) { this.children.push(c); return c; }, ...over }; return e; }
function makeBox() {
  const parts = { '.ef-toggle': el(), '.ef-panel': el({ hidden: true }), '.ef-email': el(), '.ef-send': el({ textContent: 'Request email confirmation' }), '.ef-status': el({ hidden: true }), '.ef-inbox': el({ hidden: true }) };
  const box = el({ hidden: true, querySelector: (s) => parts[s] || null, parts }); return box;
}
const card = (box) => ({ querySelector: (s) => (s === '[data-ef]' ? box : null) });
function sandbox(fetchImpl) {
  const sb = { console, setTimeout, clearTimeout, AbortController, Promise, JSON, String, Error, encodeURIComponent, fetch: fetchImpl, document: { createElement: () => el(), createTextNode: (t) => ({ text: t }) } };
  sb.window = sb; vm.createContext(sb); vm.runInContext(moduleSrc, sb); return sb;
}
const resp = (status, data) => ({ status, json: async () => data });
const OK = (over = {}) => ({ ok: true, received: true, email_masked: 'z******@example.invalid', team_inbox: 'tourfijitours@gmail.com', token: 't'.repeat(64), ...over });
const ctxFor = (over = {}) => ({ site: 'nat', apiBase: 'https://api.test', ref: 'FTT-TEST01', token: 'tok', mode: 'saved', getEmail: () => 'zed.real@example.invalid', getGuest: () => ({ name: 'Zed Test', phone: '+61400000000' }), getEnquiry: () => ({ from: 'A', to: 'B' }), ...over });
const status = (box) => box.parts['.ef-status'].textContent;
const click = async (box) => { box.parts['.ef-send'].listeners.click(); await new Promise((r) => setTimeout(r, 5)); };

test('markup: the option text is exact, sits on the result card, and a mailto link is never the only fallback (no static mailto anywhere in the page)', () => {
  assert.ok(html.includes('No WhatsApp? Request confirmation by email'));
  assert.ok(html.includes('class="ef-box" data-ef hidden'));
  const boxes = html.match(/<div class="ef-box"[\s\S]*?<p class="ef-note">[^<]*<\/p>/g) || []; assert.ok(boxes.length >= 1);
  assert.ok(boxes.every((b) => !/mailto:/.test(b)), 'the fallback box has no static mailto link; the module only offers an OPTIONAL one after the request is durably recorded');
  assert.ok(html.includes('It is not a confirmation of your transfer, and no email is sent automatically.'));
  assert.ok(html.includes('<script src="email-followup.js?v=20261005-email-followup"></script>'));
});

test('SAVED: one POST with the reference, the token and the originating site; success is shown only after the server answers received; wording never says confirmed / sent / delivered; the optional mailto appears only now', async () => {
  const calls = []; const sb = sandbox(async (u, o) => { calls.push({ u, body: JSON.parse(o.body) }); return resp(201, OK()); });
  const box = makeBox(); sb.EmailFollowup.mount(card(box), ctxFor()); assert.equal(box.hidden, false); assert.equal(box.parts['.ef-email'].value, 'zed.real@example.invalid', 'the guest\'s email is shown prefilled');
  assert.equal(box.parts['.ef-inbox'].hidden, true); await click(box);
  assert.equal(calls.length, 1); assert.equal(calls[0].u, 'https://api.test/email-followup'); assert.deepEqual([calls[0].body.client_ref, calls[0].body.token, calls[0].body.origin_site, calls[0].body.email, calls[0].body.guest_phone], ['FTT-TEST01', 'tok', 'nat', 'zed.real@example.invalid', '+61400000000']); assert.equal('enquiry' in calls[0].body, false);
  const text = status(box); assert.match(text, /^Request received\. Our Fiji team will follow up by email at z\*{6}@example\.invalid\. Reference FTT-TEST01\./); assert.match(text, /not a confirmation of your transfer, and no email has been sent yet/); assert.doesNotMatch(text, /confirmed\b(?! of)|delivered|has been sent to you|booked/i);
  assert.equal(box.parts['.ef-inbox'].hidden, false); const link = box.parts['.ef-inbox'].children.find((c) => c.href); assert.match(link.href, /^mailto:tourfijitours@gmail\.com\?subject=Reservation%20FTT-TEST01&body=/); assert.match(decodeURIComponent(link.href), /Reference: FTT-TEST01\nWebsite: nadiairporttransfers\.com\nReply to: zed\.real@example\.invalid/);
  assert.equal(box.parts['.ef-send'].textContent, 'Update email address');
});

test('DUPLICATE CLICKS: repeated taps while a request is running send exactly one request; after success an unchanged address sends nothing; a changed address sends one correction', async () => {
  let release; const calls = []; const gate = new Promise((r) => { release = r; });
  const sb = sandbox(async (u, o) => { calls.push(JSON.parse(o.body)); await gate; return resp(201, OK()); });
  const box = makeBox(); sb.EmailFollowup.mount(card(box), ctxFor());
  box.parts['.ef-send'].listeners.click(); box.parts['.ef-send'].listeners.click(); box.parts['.ef-email'].listeners.keydown({ key: 'Enter', preventDefault() {} }); await new Promise((r) => setTimeout(r, 5));
  assert.equal(calls.length, 1, 'three taps/Enter while in flight = one request'); assert.equal(box.parts['.ef-send'].disabled, true); release(); await new Promise((r) => setTimeout(r, 10));
  assert.match(status(box), /^Request received/); await click(box); assert.equal(calls.length, 1, 'same address again: nothing sent'); assert.match(status(box), /already have/);
  box.parts['.ef-email'].value = 'zed.new@example.invalid'; await click(box); assert.equal(calls.length, 2); assert.equal(calls[1].email, 'zed.new@example.invalid');
});

test('VALIDATION: an invalid address is stopped before any request; the server\'s own rejection is shown and nothing is claimed', async () => {
  const calls = []; const sb = sandbox(async (u, o) => { calls.push(1); return resp(400, { ok: false, code: 'INVALID_EMAIL', errors: ['The domain after @ is not valid.'] }); });
  const box = makeBox(); sb.EmailFollowup.mount(card(box), ctxFor()); box.parts['.ef-email'].value = 'not an email'; await click(box); assert.equal(calls.length, 0); assert.match(status(box), /valid email address.*Nothing has been requested yet/);
  box.parts['.ef-email'].value = 'a@b.invalid'; await click(box); assert.equal(calls.length, 1); assert.match(status(box), /domain after @ is not valid.*Nothing has been requested yet/); assert.doesNotMatch(status(box), /received/i);
});

test('FAILURE then RETRY: a lost / failed request never claims receipt; details are kept; the retry sends the SAME reference (safe: the server treats it as the same follow-up) and then succeeds', async () => {
  let n = 0; const calls = []; const sb = sandbox(async (u, o) => { calls.push(JSON.parse(o.body)); n++; if (n === 1) throw new Error('network'); if (n === 2) return resp(500, { ok: false }); return resp(201, OK()); });
  const box = makeBox(); sb.EmailFollowup.mount(card(box), ctxFor()); box.parts['.ef-email'].value = 'zed.real@example.invalid';
  await click(box); assert.match(status(box), /could not confirm that your request was recorded.*do not assume it was.*repeating it is safe/); assert.doesNotMatch(status(box), /^Request received/); assert.equal(box.parts['.ef-email'].value, 'zed.real@example.invalid'); assert.equal(box.parts['.ef-send'].disabled, false);
  await click(box); assert.match(status(box), /could not record your request, so nothing has been received/); await click(box); assert.match(status(box), /^Request received/);
  assert.equal(new Set(calls.map((c) => c.client_ref)).size, 1); assert.equal(calls.length, 3);
  const sb2 = sandbox(async () => resp(503, { ok: false, code: 'NOT_CONFIGURED' })); const b2 = makeBox(); sb2.EmailFollowup.mount(card(b2), ctxFor()); await click(b2); assert.match(status(b2), /not available right now, so nothing was requested/);
  const sb3 = sandbox(async () => resp(429, { ok: false })); const b3 = makeBox(); sb3.EmailFollowup.mount(card(b3), ctxFor()); await click(b3); assert.match(status(b3), /nothing was requested/);
});

test('UNCERTAIN SAVE: the same reference is reconciled FIRST; if the booking system cannot be reached nothing is requested and no enquiry is created; if reconciled the follow-up attaches with the returned token; a reconcile with no token reports the feature unavailable', async () => {
  const calls = []; const sb = sandbox(async (u, o) => { calls.push(JSON.parse(o.body)); return resp(201, OK()); });
  let rec = { ok: false }; let reconciled = 0; let reconcileCalls = 0;
  const box = makeBox(); sb.EmailFollowup.mount(card(box), ctxFor({ token: null, mode: 'uncertain', reconcile: async () => { reconcileCalls++; return rec; }, onReconciled: () => { reconciled++; } }));
  await click(box); assert.equal(reconcileCalls, 1); assert.equal(calls.length, 0, 'nothing is created while the save is still unknown'); assert.match(status(box), /could not reach our booking system, so nothing has been requested yet/);
  rec = { ok: true, bookingId: 77, followupToken: 'f'.repeat(64) }; await click(box); assert.equal(reconciled, 1); assert.equal(calls.length, 1); assert.equal(calls[0].token, 'f'.repeat(64)); assert.equal('enquiry' in calls[0], false); assert.match(status(box), /^Request received/);
  const sb2 = sandbox(async () => resp(201, OK())); const b2 = makeBox(); sb2.EmailFollowup.mount(card(b2), ctxFor({ token: null, mode: 'uncertain', reconcile: async () => ({ ok: true, bookingId: 5, followupToken: null }) })); await click(b2); assert.match(status(b2), /reservation request is saved, but email follow-up is not available right now/);
});

test('UNCERTAIN SAVE where the page switches cards on reconcile: the success is shown on the NEW card (the session follows the reference)', async () => {
  const calls = []; const sb = sandbox(async (u, o) => { calls.push(JSON.parse(o.body)); return resp(201, OK()); });
  const failBox = makeBox(); const savedBox = makeBox(); const ctx = ctxFor({ token: null, mode: 'uncertain', reconcile: async () => ({ ok: true, bookingId: 9, followupToken: 'a'.repeat(64) }), onReconciled: (r) => { sb.EmailFollowup.mount(card(savedBox), ctxFor({ token: r.followupToken, mode: 'saved' })); } });
  sb.EmailFollowup.mount(card(failBox), ctx); failBox.parts['.ef-email'].value = 'typed.on.failure.card@example.invalid'; await click(failBox);
  assert.match(status(savedBox), /^Request received/); assert.equal(savedBox.parts['.ef-email'].value, 'typed.on.failure.card@example.invalid'); assert.equal(calls.length, 1); assert.equal(calls[0].email, 'typed.on.failure.card@example.invalid');
});

test('WHATSAPP-ONLY / unsupported route: an ENQUIRY is requested (journey details + name + phone, no token); it is never presented as a booking or confirmation', async () => {
  const calls = []; const sb = sandbox(async (u, o) => { calls.push(JSON.parse(o.body)); return resp(201, OK({ kind: 'enquiry' })); });
  const box = makeBox(); sb.EmailFollowup.mount(card(box), ctxFor({ token: null, mode: 'enquiry' })); await click(box);
  assert.deepEqual([calls[0].guest_name, calls[0].guest_phone, calls[0].enquiry], ['Zed Test', '+61400000000', { from: 'A', to: 'B' }]); assert.equal('token' in calls[0], false); assert.doesNotMatch(status(box), /booked|confirmed\b(?! of)/i);
});

test('SERVER LOCK: once our team is handling the request the page says the address can no longer be changed here', async () => {
  const sb = sandbox(async () => resp(200, OK({ locked: true }))); const box = makeBox(); sb.EmailFollowup.mount(card(box), ctxFor()); await click(box); assert.match(status(box), /already handling this request.*cannot be changed here/);
});
