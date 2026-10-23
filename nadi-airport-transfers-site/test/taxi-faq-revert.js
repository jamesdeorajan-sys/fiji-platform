// Taxi FAQ candidate (ceo/nat-route-taxi-faq): every route page gains ONE question, inserted directly after the page's
// "How much does a Nadi Airport to … transfer cost?" question, in the visible FAQ and in the FAQPage JSON-LD.
// The answer uses only facts the page already states (whole vehicle, published fare, total shown at Review, no payment
// to request, human confirmation on WhatsApp). No taxi fare, distance, journey time or new claim.
// undoTaxiFaq(html) removes exactly the inserted question, so scope pins can compare against the previous production page.

export const TAXI_Q = (name) => `Should I take a taxi or a private transfer from Nadi Airport to ${name}?`;
export const TAXI_A_HTML = 'We don’t publish taxi fares, so we can’t compare the two on price. A private transfer with us is the whole vehicle at the published fare on this page, not per person. Your total is shown at the Review step before you send your request, there’s no payment to request, and our Fiji team confirms the arrangements with you on WhatsApp.';
export const TAXI_A_JSON = TAXI_A_HTML;

const HTML_ITEM = /\n[ \t]*<div class="rp-faq-item"><h3>Should I take a taxi or a private transfer from Nadi Airport to [^<]*\?<\/h3><p>[^<]*<\/p><\/div>/g;
const JSON_ITEM = /\n[ \t]*\{"@type":"Question","name":"Should I take a taxi or a private transfer from Nadi Airport to [^"]*\?","acceptedAnswer":\{"@type":"Answer","text":"[^"]*"\}\},/g;

export function undoTaxiFaq(html) {
  return html.replace(HTML_ITEM, '').replace(JSON_ITEM, '');
}
