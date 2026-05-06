/**
 * Fiji Tour Transfers — Drafting Console Worker
 *
 * Cloudflare Worker that proxies requests from the drafting console UI
 * to the Anthropic API. The Anthropic API key is held as a Cloudflare
 * secret (set via `wrangler secret put ANTHROPIC_API_KEY` or the dashboard
 * Settings → Variables → Secret), never visible in this code.
 *
 * Request flow:
 *   browser  →  Worker (this code)  →  Anthropic API
 *   browser  ←  Worker (this code)  ←  Anthropic API
 *
 * Why a Worker instead of calling the API directly from the browser:
 *   1. Browsers block direct calls to api.anthropic.com (CORS policy)
 *   2. Anything in browser code is visible to anyone — the API key
 *      would be readable by every visitor and burn through credits fast
 *   3. The Worker lets us add rate limits, log usage, and rotate keys
 *      without touching the front-end
 */

export default {
  async fetch(request, env) {
    // ─── CORS: allow the drafting console to call this Worker ────────
    // For now, allow any origin. If you ever lock the console to a single
    // domain (e.g. console.nadiairporttransfers.com), tighten this to that
    // exact domain instead of '*' for slightly better security.
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };

    // Browsers send a "preflight" OPTIONS request before the real POST.
    // Respond to it with the CORS headers and no body.
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // We only accept POST. Anything else gets a 405.
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed. Use POST.' }, 405, corsHeaders);
    }

    // ─── Verify the API key secret is configured ──────────────────────
    if (!env.ANTHROPIC_API_KEY) {
      return jsonResponse({
        error: 'Worker is missing ANTHROPIC_API_KEY. Add it as a secret in Cloudflare dashboard.'
      }, 500, corsHeaders);
    }

    // ─── Parse incoming body ──────────────────────────────────────────
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return jsonResponse({ error: 'Request body must be valid JSON.' }, 400, corsHeaders);
    }

    // Validate required fields
    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      return jsonResponse({ error: 'Missing or invalid "messages" field.' }, 400, corsHeaders);
    }

    // ─── Forward to Anthropic ─────────────────────────────────────────
    // We pass through whatever the browser sent (model, system prompt,
    // messages, max_tokens) plus the secret API key. This means future
    // changes to the system prompt only require updating the front-end,
    // not redeploying the Worker.
    let anthropicResponse;
    try {
      anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: body.model || 'claude-sonnet-4-20250514',
          max_tokens: body.max_tokens || 1000,
          system: body.system || '',
          messages: body.messages,
        }),
      });
    } catch (err) {
      // Network error reaching Anthropic — usually transient
      return jsonResponse({
        error: 'Could not reach Anthropic API. Try again in a moment.',
        detail: String(err)
      }, 502, corsHeaders);
    }

    // ─── Return Anthropic's response to the browser ───────────────────
    // We pass through the body and status code as-is, so the browser sees
    // the same response shape it would if calling Anthropic directly.
    const responseBody = await anthropicResponse.text();
    return new Response(responseBody, {
      status: anthropicResponse.status,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });
  },
};

// Tiny helper to make JSON responses with CORS headers
function jsonResponse(obj, status, corsHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}
