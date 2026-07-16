/**
 * Nadi Airport Transfers — Driver Marketplace Backend
 * nadi-dispatch-api
 *
 * Phase 1, staging milestone only.
 * No dispatch/broadcast/onboarding logic yet — see Phase 1 spec sections 3-9.
 * This Worker is fully isolated: separate script, separate D1 database
 * (nadi-marketplace-db), zero shared bindings with fiji-chat-widget or
 * vakaviti-kb. Not connected to any production route or domain.
 */

const JSON_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: JSON_CORS });
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return handleHealth(env);
    }

    return json({ error: 'Not found.' }, 404);
  },
};

async function handleHealth(env) {
  const status = {
    service: 'nadi-dispatch-api',
    phase: 1,
    milestone: 'staging-skeleton',
    db_connected: false,
    tables: [],
  };

  if (!env.DB) {
    return json(status, 503);
  }

  try {
    const result = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    ).all();
    status.db_connected = true;
    status.tables = (result.results || []).map((r) => r.name);
    return json(status, 200);
  } catch (err) {
    status.error = err.message;
    return json(status, 500);
  }
}

function json(obj, status) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { ...JSON_CORS, 'Content-Type': 'application/json' },
  });
}
