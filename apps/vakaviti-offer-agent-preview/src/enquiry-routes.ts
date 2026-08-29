// Phase 7B (CEO directive 2026-08-29): the internal Vakaviti enquiry journey for a discovered
// third-party offer. Follows the exact, already-proven pattern from Stage 1's PR #29 fix (GET
// renders review, zero writes; POST with CSRF creates exactly one row; a separate deliberate GET
// transitions to WHATSAPP_OPENED and redirects) - reused as a pattern, not as shared code, since
// this app's enquiry table (`vakaviti_enquiries`) and offer shape are its own.
import { Hono } from 'hono';
import type { Env } from './env';
import { derivePublicPresentation, SOURCE_CHECKED_LABEL, PRICE_ON_CONFIRMATION_LABEL } from './public-presentation';
import type { EvidenceResolutionResult, MaterialField, ResolvedField } from './deal-exchange-model';
import { ALL_MATERIAL_FIELDS } from './deal-exchange-model';

// James's own published Vakaviti WhatsApp contact - the single, centrally-configured destination
// for every discovered-offer enquiry, regardless of which provider the offer is about. Never a
// per-provider number - Vakaviti is the enquiry handler, not the provider, for this action type.
const CENTRAL_VAKAVITI_WHATSAPP_NUMBER = '61478886145';
const ENQUIRY_CSRF_COOKIE = 'vakaviti_offer_enquiry_csrf';

const getCookie = (c: any, name: string): string | undefined => {
  const header = c.req.header('cookie') || '';
  const match = header.split(';').map((s: string) => s.trim()).find((s: string) => s.startsWith(name + '='));
  return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : undefined;
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function shell(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><meta name="robots" content="noindex,follow"></head><body>${body}</body></html>`;
}

function derivePriceCopy(resolution: EvidenceResolutionResult): { presentationClass: string; priceCopy: string | null } {
  const presentation = derivePublicPresentation({ publicationDecision: 'ELIGIBLE' }, resolution);
  return { presentationClass: presentation.presentationClass, priceCopy: presentation.priceCopy };
}

export function registerEnquiryRoutes(app: Hono<{ Bindings: Env }>) {
  // GET: renders the review page. Reads the offer row (a read, not a write) and renders - no
  // INSERT/UPDATE anywhere on this path, verified by dedicated tests.
  app.get('/enquire/:offerId', async (c) => {
    const offerId = c.req.param('offerId');
    const offer = await c.env.DB.prepare(`SELECT * FROM deal_exchange_offers WHERE id=?`).bind(offerId).first<any>();
    if (!offer || offer.publication_decision !== 'ELIGIBLE') return c.text('Not found', 404);

    const priceCopy = offer.price_amount && offer.currency && offer.price_basis
      ? `${offer.currency} ${offer.price_amount} (${offer.price_basis})`
      : PRICE_ON_CONFIRMATION_LABEL;

    const csrfToken = crypto.randomUUID();
    c.header('Set-Cookie', `${ENQUIRY_CSRF_COOKIE}=${csrfToken}; Path=/enquire; Max-Age=600; SameSite=Lax; HttpOnly`);

    const body = `
      <main>
        <h1>Ask Vakaviti about this offer</h1>
        <p>Vakaviti helps you review this publicly advertised offer. Price and availability must be confirmed with the listed provider or seller.</p>
        <dl>
          <dt>Provider</dt><dd>${escapeHtml(offer.provider_name || 'Unknown provider')}</dd>
          ${offer.seller_name ? `<dt>Seller</dt><dd>${escapeHtml(offer.seller_name)}</dd>` : ''}
          <dt>Price</dt><dd>${escapeHtml(priceCopy)}</dd>
          <dt>${SOURCE_CHECKED_LABEL}</dt><dd>${escapeHtml((offer.checked_at || '').slice(0, 10))}</dd>
        </dl>
        <p><a href="${escapeHtml(offer.canonical_source_url)}" rel="nofollow noopener">View original offer</a></p>
        <form method="POST" action="/enquire/${escapeHtml(offerId)}">
          <input type="hidden" name="csrf_token" value="${csrfToken}">
          <label>Name <input type="text" name="visitor_name"></label>
          <label>Contact (phone or email) <input type="text" name="visitor_contact"></label>
          <label><input type="checkbox" name="consent" value="yes" required> I consent to Vakaviti contacting me about this enquiry.</label>
          <button type="submit">Ask Vakaviti about this offer</button>
        </form>
      </main>`;
    return c.html(shell(`Ask Vakaviti about ${offer.provider_name || 'this offer'}`, body));
  });

  // POST: CSRF-checked, creates exactly one CREATED row (time-windowed dedup on resubmission),
  // never claims SENT/DELIVERED/BOOKED - only ever records that a visitor asked.
  app.post('/enquire/:offerId', async (c) => {
    const offerId = c.req.param('offerId');
    const offer = await c.env.DB.prepare(`SELECT * FROM deal_exchange_offers WHERE id=?`).bind(offerId).first<any>();
    if (!offer || offer.publication_decision !== 'ELIGIBLE') return c.text('Not found', 404);

    const body = await c.req.parseBody();
    const cookieToken = getCookie(c, ENQUIRY_CSRF_COOKIE);
    if (!cookieToken || body.csrf_token !== cookieToken) {
      return c.html(shell('Request could not be verified', '<main><p>Your request could not be verified. Please go back and try again.</p></main>'), 400);
    }
    if (body.consent !== 'yes') {
      return c.html(shell('Consent required', '<main><p>Consent is required to continue.</p></main>'), 400);
    }

    const existing = await c.env.DB.prepare(
      `SELECT id FROM vakaviti_enquiries WHERE offer_id=? AND status IN ('CREATED','WHATSAPP_OPENED') AND created_at > datetime('now','-1 hour') ORDER BY created_at DESC LIMIT 1`
    ).bind(offerId).first<any>();

    let enquiryId: string;
    if (existing) {
      enquiryId = existing.id; // resubmission within the window reuses the same row - never a duplicate
    } else {
      enquiryId = crypto.randomUUID();
      const priceCopy = offer.price_amount && offer.currency && offer.price_basis
        ? `${offer.currency} ${offer.price_amount} (${offer.price_basis})` : PRICE_ON_CONFIRMATION_LABEL;
      await c.env.DB.prepare(
        `INSERT INTO vakaviti_enquiries (id, offer_id, provider_name, seller_name, price_copy, source_url, visitor_name, visitor_contact, consent_given_at, status, idempotency_key) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,'CREATED',?)`
      ).bind(
        enquiryId, offerId, offer.provider_name, offer.seller_name ?? null, priceCopy, offer.canonical_source_url,
        String(body.visitor_name || '').slice(0, 200) || null, String(body.visitor_contact || '').slice(0, 200) || null,
        `enquiry:${offerId}:${enquiryId}`
      ).run();
    }

    const body_html = `
      <main>
        <h1>Ready to message Vakaviti</h1>
        <p><b>Reference:</b> ${escapeHtml(enquiryId)}</p>
        <p>Tap below to open WhatsApp with your enquiry. Vakaviti only records that you opened the link - not what you send or receive.</p>
        <a href="/enquire/${escapeHtml(offerId)}/whatsapp/${escapeHtml(enquiryId)}" target="_blank" rel="noopener noreferrer">Continue to WhatsApp</a>
      </main>`;
    return c.html(shell('Continue to WhatsApp', body_html));
  });

  // GET, deliberate click only (real anchor, no auto-redirect): transitions CREATED->WHATSAPP_OPENED
  // (idempotent - a repeat visit to an already-opened link changes nothing) and redirects to the
  // one central Vakaviti WhatsApp number, never any provider's own contact.
  app.get('/enquire/:offerId/whatsapp/:enquiryId', async (c) => {
    const offerId = c.req.param('offerId');
    const enquiryId = c.req.param('enquiryId');
    const enquiry = await c.env.DB.prepare(`SELECT * FROM vakaviti_enquiries WHERE id=? AND offer_id=?`).bind(enquiryId, offerId).first<any>();
    if (!enquiry) return c.text('Not found', 404);

    if (enquiry.status === 'CREATED') {
      await c.env.DB.prepare(`UPDATE vakaviti_enquiries SET status='WHATSAPP_OPENED', updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='CREATED'`).bind(enquiryId).run();
    }

    const message = `Hi Vakaviti, I'd like to ask about this offer: ${enquiry.provider_name} - ${enquiry.price_copy}. Reference ${enquiry.id}. Source: ${enquiry.source_url}`;
    const waUrl = `https://wa.me/${CENTRAL_VAKAVITI_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
    return c.redirect(waUrl, 302);
  });
}

export { CENTRAL_VAKAVITI_WHATSAPP_NUMBER, ENQUIRY_CSRF_COOKIE };
