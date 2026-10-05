// WhatsApp reservation handoff (2026-10-05). Operating process confirmed by James: guest opens WhatsApp -> presses Send with the reservation details -> the Fiji ground team replies
// "Bula, vinaka" -> checks the details -> confirms the transfer. Wording is pinned here; opening WhatsApp must never be treated as sent or confirmed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8').replace(/\r/g, '');
const js = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8').replace(/\r/g, '');
const card = html.slice(html.indexOf('id="bulaSuccess"'), html.indexOf('<div class="bula-divider">'));

test('the result card uses the required heading, button label and instruction, in every state', () => {
  assert.match(card, /<h2 class="bula-title" id="bulaTitle">Finish your reservation on WhatsApp<\/h2>/);
  assert.match(card, /<span>Open WhatsApp — send reservation<\/span>/);
  assert.ok(card.includes('Tap the green button, then press Send in WhatsApp to send your reservation details. Our Fiji team will reply Bula, vinaka, check your details and confirm your transfer with you.'));
  assert.ok(card.includes('Opening WhatsApp alone does not send your request.'));
  assert.ok(card.includes('Your transfer is confirmed only after our Fiji team confirms it with you.'));
  assert.ok(js.includes("const bulaWaBtn = document.getElementById('bulaWaBtn');") && !/lastChild\.textContent\s*=/.test(js), 'the label is static markup, never rewritten per state');
});
test('no contradictory wording remains: nothing calls WhatsApp optional or says the request is merely "saved - awaiting confirmation", and the old button label is gone', () => {
  for (const bad of ['Request saved — awaiting confirmation', 'awaiting confirmation', 'Submit request via WhatsApp', 'Send booking via WhatsApp', 'WhatsApp is optional', 'Send your request,', 'contacted within 15 minutes', 'We contact you within 15 minutes']) {
    assert.ok(!html.includes(bad), 'index.html: ' + bad); assert.ok(!js.includes(bad), 'app.js: ' + bad);
  }
  assert.ok(!/bulaTitleSaved|bulaTitleWhatsappOnly/.test(html + js), 'the per-state headings are gone: one static heading');
});
test('the three truthful states: saved (not yet confirmed), could-not-confirm (reference retained), WhatsApp-only (no online-save claim)', () => {
  assert.ok(js.includes('Your request is saved online, but your transfer is not confirmed yet. Send your reservation details on WhatsApp to finish.'));
  assert.ok(js.includes('We could not confirm that your request was saved online. Keep your reference (${ref}) and send your reservation details on WhatsApp now, or review and try again.'));
  assert.ok(js.includes('This request has not been saved online. Your reservation details are ready to send on WhatsApp.'));
  assert.ok(html.includes('This request has not been saved online.'), 'the static default is the safest (no-save) wording');
  assert.ok(!/saved online/.test(card.slice(card.indexOf('id="bulaLeadText"'), card.indexOf('</p>', card.indexOf('id="bulaLeadText"'))).replace('has not been saved online', '')), 'the static default never claims a save');
});
test('a click on the WhatsApp button never marks anything sent or confirmed: it is a plain link with the prefilled reservation; no click handler, no state change', () => {
  const tag = card.match(/<a id="bulaWaBtn"[^>]*>/)[0];
  assert.match(tag, /href="https:\/\/wa\.me\/61478886145"/); assert.ok(!/onclick/i.test(tag));
  assert.ok(!/bulaWaBtn[^\n]*addEventListener|bulaWaBtn\.onclick/.test(js));
  assert.ok(js.includes('bulaWaBtn.href = waUrl;'), 'the prefilled details + reference link is set from buildWhatsAppURL(ref)');
});
test('the booking step no longer promises contact "within 15 minutes" - it describes the WhatsApp handoff', () => {
  assert.ok(html.includes('After you submit, open WhatsApp and press Send; our Fiji team will reply Bula, vinaka and confirm availability and payment options with you.'));
  assert.ok(html.includes('Send your reservation on WhatsApp and our Fiji team confirms your transfer with you.'));
});
test('SCOPE: phone number, retry logic, saved-fare display and pricing code are untouched', () => {
  for (const c of ['https://wa.me/61478886145?text=', "id = 'bulaFare'", 'Fare saved:', 'retryBooking()', 'require_quote_match: true', 'ftt_booking_attempt']) assert.ok(js.includes(c) || html.includes(c), c);
});
