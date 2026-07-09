// ============================================================
// Vakaviti.ai — Onboard Worker (standalone)
// Deploy as: vakaviti-onboard
// Bindings:
//   DB               (D1 → vakaviti-kb)
//   SENDGRID_API_KEY (Secret)
//   ADMIN_TOKEN      (Secret) — NEW: shared secret for the one-click
//                     partner-activation link. Set this once in Cloudflare
//                     (see BUILD.md for the exact value/steps) before this
//                     version goes live, or /activate will always 403.
// Endpoints:
//   POST /onboard  — self-serve partner registration
//   GET  /activate — NEW: one-click activation link (from the notify email)
//   GET  /health
// ============================================================

const ALLOWED_ORIGINS = [
  'https://vakaviti.ai', 'https://www.vakaviti.ai',
  'https://join.vakaviti.ai',
  'https://vakaviti-join-page.pages.dev',
  'http://localhost:8000',
];

const JAMES_EMAIL = 'helpronline@gmail.com';
const FROM_EMAIL  = 'helpronline@gmail.com';

function getCors(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed =
    ALLOWED_ORIGINS.includes(origin) ||
    origin.endsWith('.pages.dev') ||
    origin.endsWith('.vakaviti.ai')
      ? origin
      : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age':       '86400',
    'Vary': 'Origin',
  };
}

function json(data, status = 200, cors = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

// ── Email ─────────────────────────────────────────────────

async function sendEmail(env, to, subject, message) {
  if (!env.SENDGRID_API_KEY) {
    console.log(`[Email → ${to}] ${subject}\n${message}`);
    return true;
  }
  try {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.SENDGRID_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from:    { email: FROM_EMAIL, name: 'Vakaviti.ai' },
        subject: subject,
        content: [{ type: 'text/plain', value: message }],
      }),
    });
    return res.ok;
  } catch { return false; }
}

// ── Main handler ──────────────────────────────────────────

async function handleOnboard(request, env, cors) {
  let body;
  try { body = await request.json(); } catch {
    return json({ error: 'Invalid JSON.' }, 400, cors);
  }

  const {
    biz_name, contact_name, contact_role, contact_email,
    whatsapp, category, region, website, description,
  } = body;

  if (!biz_name || !contact_name || !contact_email || !whatsapp || !category || !region) {
    return json({ error: 'Missing required fields.' }, 400, cors);
  }

  if (!env.DB) return json({ error: 'Database unavailable.' }, 503, cors);

  const slug      = biz_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  const partnerId = 'op_' + slug.replace(/-/g, '_') + '_' + Date.now().toString(36);
  const siteId    = partnerId;
  const createdAt = Math.floor(Date.now() / 1000);

  try {
    // 1. Insert into partners table
    await env.DB.prepare(`
      INSERT INTO partners (id, name, slug, category, region, description, website_url, whatsapp_number, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).bind(partnerId, biz_name, slug, category, region, description || null, website || null, whatsapp, createdAt).run();

    // 2. Insert into embed_config table
    await env.DB.prepare(`
      INSERT INTO embed_config (site_id, partner_id, theme_color, greeting_text, created_at, updated_at)
      VALUES (?, ?, '#0d4d6e', null, ?, ?)
    `).bind(siteId, partnerId, createdAt, createdAt).run();

    // 3. NEW — Insert contact_channels, so lead notifications actually reach
    // this partner once activated. Same gap Session 52 found and fixed for
    // cometofiji.com; this Worker never had the fix. Wrapped separately so a
    // schema surprise here can't take down the already-working steps above.
    try {
      await env.DB.prepare(`
        INSERT INTO contact_channels (partner_id, channel_type, destination, priority, active, min_lead_score, created_at)
        VALUES (?, 'whatsapp', ?, 1, 1, 0, ?)
      `).bind(partnerId, whatsapp, createdAt).run();

      if (contact_email) {
        await env.DB.prepare(`
          INSERT INTO contact_channels (partner_id, channel_type, destination, priority, active, min_lead_score, created_at)
          VALUES (?, 'email', ?, 2, 1, 0, ?)
        `).bind(partnerId, contact_email, createdAt).run();
      }
    } catch (chErr) {
      console.error('contact_channels insert failed (non-fatal):', chErr);
    }

    // 4. Notify James via email — NEW: one-click activation link, no SQL needed
    const activateUrl = `https://vakaviti-onboard.helpronline.workers.dev/activate?partner_id=${encodeURIComponent(partnerId)}&token=${encodeURIComponent(env.ADMIN_TOKEN || '')}`;
    const notifySubject = '🌺 New Vakaviti.ai partner application — ' + biz_name;
    const notifyBody = [
      'NEW PARTNER APPLICATION',
      '========================',
      '',
      'Business:   ' + biz_name,
      'Contact:    ' + contact_name + (contact_role ? ' (' + contact_role + ')' : ''),
      'Email:      ' + contact_email,
      'WhatsApp:   ' + whatsapp,
      'Category:   ' + category,
      'Region:     ' + region,
      website ? 'Website:    ' + website : null,
      description ? 'Description: ' + description : null,
      '',
      'Partner ID: ' + partnerId,
      'Status:     pending',
      '',
      '✅ Click to activate (one click, no code):',
      activateUrl,
      '',
      '(If that link doesn\'t work, you can still activate manually in D1:',
      'https://dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/d1/databases/e697a253-e5fc-4201-939c-9aaeca6c5278 )',
    ].filter(Boolean).join('\n');

    await sendEmail(env, JAMES_EMAIL, notifySubject, notifyBody);

    // 5. Welcome email to partner
    const embedCode = `<script src="https://widget.vakaviti.ai/widget.js" data-site-id="${siteId}" defer></script>`;
    const welcomeBody = [
      'Bula ' + contact_name + '!',
      '',
      'Your application to join Vakaviti.ai has been received.',
      'We will have your AI concierge live within 48 hours.',
      '',
      'Your details:',
      '  Business:   ' + biz_name,
      '  Partner ID: ' + partnerId,
      '',
      'Your embed code (add this before </body> on your website):',
      '',
      embedCode,
      '',
      'We will be in touch shortly to confirm your setup.',
      '',
      'Vinaka!',
      'James Richardson — Vakaviti.ai',
      'WhatsApp: +61 478 886 145',
      'Web: https://vakaviti.ai',
    ].join('\n');

    await sendEmail(env, contact_email, 'Welcome to Vakaviti.ai — ' + biz_name, welcomeBody);

    return json({ ok: true, partner_id: partnerId, site_id: siteId }, 200, cors);

  } catch (err) {
    console.error('Onboard error:', err);
    return json({ error: 'Failed to create partner. Please try again.' }, 500, cors);
  }
}

// ── NEW — one-click activation ──────────────────────────────

async function handleActivate(request, env) {
  const url       = new URL(request.url);
  const partnerId = url.searchParams.get('partner_id');
  const token     = url.searchParams.get('token');

  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
    return html('<h2>❌ Invalid or missing activation token.</h2><p>This link is not valid. Ask Claude/check BUILD.md for the ADMIN_TOKEN setup step.</p>', 403);
  }
  if (!partnerId) {
    return html('<h2>❌ Missing partner_id.</h2>', 400);
  }
  if (!env.DB) return html('<h2>❌ Database unavailable.</h2>', 503);

  try {
    const partner = await env.DB.prepare('SELECT id, name, status FROM partners WHERE id = ?').bind(partnerId).first();
    if (!partner) return html(`<h2>❌ No partner found with ID ${partnerId}.</h2>`, 404);

    if (partner.status === 'active') {
      return html(`<h2>✅ ${partner.name} is already active — nothing to do.</h2>`);
    }

    await env.DB.prepare(`UPDATE partners SET status = 'active' WHERE id = ?`).bind(partnerId).run();

    return html(`
      <div style="font-family:sans-serif;max-width:480px;margin:60px auto;text-align:center">
        <h1 style="color:#0d6e8a">🌺 ${partner.name} is now live!</h1>
        <p>Lagi can now recommend this partner, and their embed widget is active.</p>
        <p style="color:#888;font-size:13px">Partner ID: ${partnerId}</p>
      </div>
    `);
  } catch (err) {
    console.error('Activation error:', err);
    return html('<h2>❌ Activation failed — check Worker logs.</h2>', 500);
  }
}

export default {
  async fetch(request, env) {
    const cors = getCors(request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/onboard') {
      return handleOnboard(request, env, cors);
    }

    if (request.method === 'GET' && url.pathname === '/activate') {
      return handleActivate(request, env);
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, worker: 'vakaviti-onboard', version: 3 }, 200, cors);
    }

    return json({ error: 'Not found.' }, 404, cors);
  },
};
