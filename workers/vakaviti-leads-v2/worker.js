// ============================================================
// Vakaviti.ai — Leads Worker (v2)
// Deploy as: vakaviti-leads-v2.helpronline.workers.dev
//
// Changes in v2:
//  - NEW: generateReviewToken() — cryptographically secure token via Web Crypto API
//  - NEW: seedPendingReview() — auto-inserts pending review record for transfer/tour leads
//  - NEW: review_token returned in /lead response for downstream comms
//  - NEW: review follow-up URL included in partner notification email
//  - NEW: /meta-bridge — Meta ad traffic → D1 intent tracking
//  - INTENTS that trigger review seeding: transfer, activity (day tour)
//
// Bindings required:
//   DB               → D1: vakaviti-kb
//   SENDGRID_API_KEY → Secret
//   REVIEW_BASE_URL  → Variable: https://vakaviti-reviews-submit.pages.dev
// ============================================================

const REVIEW_INTENTS = ['transfer', 'activity'];

const ALLOWED_ORIGINS = [
  'https://vakaviti.ai',
  'https://www.vakaviti.ai',
  'https://join.vakaviti.ai',
  'https://dashboard.vakaviti.ai',
  'https://vakaviti-bluelagoon.pages.dev',
  'https://vakaviti-palms-denarau.pages.dev',
  'https://vakaviti-join-page.pages.dev',
  'https://vakaviti-dashboard.pages.dev',
  'https://fiji-chat-widget.helpronline.workers.dev',
  'https://lagi.vakaviti.ai',
  'https://fijitourtransfers.com',
  'https://www.fijitourtransfers.com',
  'https://nadiairporttransfers.com',
  'https://www.nadiairporttransfers.com',
  'https://guidefiji.com',
  'https://www.guidefiji.com',
  'https://fijithingstodo.com',
  'https://www.fijithingstodo.com',
  'https://bestfijitours.com',
  'https://www.bestfijitours.com',
  'https://vosavakaviti.com',
  'https://www.vosavakaviti.com',
  'https://tourfijitours.com',
  'https://www.tourfijitours.com',
];

function getCors(request) {
  const origin  = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ||
    origin.endsWith('.pages.dev') ||
    origin.endsWith('.helpronline.workers.dev')
    ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(data, status = 200, cors = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}

async function generateReviewToken(partnerId, leadId) {
  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  const hexRandom   = Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  const encoder = new TextEncoder();
  const keyData = encoder.encode(partnerId + leadId + Date.now());
  const hashBuffer = await crypto.subtle.digest('SHA-256', keyData);
  const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `tok_${hexRandom.slice(0, 24)}_${hashHex.slice(0, 8)}_${Date.now().toString(36)}`;
}

async function seedPendingReview(env, { leadId, partnerId, travellerId, travelllerName, token }) {
  if (!env.DB) return null;
  const now      = Math.floor(Date.now() / 1000);
  const deadline = now + (48 * 60 * 60);
  const reviewId = `rev_${now}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    await env.DB.prepare(`
      INSERT INTO reviews (
        id, partner_id, traveller_token, traveller_name,
        review_text, rating, cultural_respect_score,
        status, source, webhook_fired,
        conciliation_deadline, created_at
      ) VALUES (?, ?, ?, ?, null, null, null, 'pending', 'lead_auto', 0, ?, ?)
    `).bind(reviewId, partnerId, token, travelllerName || null, deadline, now).run();
    return reviewId;
  } catch (e) {
    console.error('Review seed error (non-fatal):', e.message);
    return null;
  }
}

function buildReviewUrl(baseUrl, partnerId, token) {
  const base = baseUrl || 'https://vakaviti-reviews-submit.pages.dev';
  return `${base}/submit.html?partner_id=${encodeURIComponent(partnerId)}&token=${encodeURIComponent(token)}`;
}

function scoreLead(snapshot, name, contact) {
  let score = 0;
  if (name)    score += 20;
  if (contact) score += 30;
  if (/book|reserv|availab/i.test(snapshot))    score += 20;
  if (/budget|price|cost|rate/i.test(snapshot)) score += 10;
  if (/date|when|arrival|depart/i.test(snapshot)) score += 10;
  if (/group|family|couple|guest/i.test(snapshot)) score += 10;
  return Math.min(score, 100);
}

function explainScore(score, snapshot, name, contact) {
  const reasons = [];
  if (name)    reasons.push('name provided');
  if (contact) reasons.push('contact provided');
  if (/book|reserv/i.test(snapshot))  reasons.push('booking intent');
  if (/budget|price/i.test(snapshot)) reasons.push('price inquiry');
  if (/date|arrival/i.test(snapshot)) reasons.push('travel dates mentioned');
  return reasons.join(', ') || 'general inquiry';
}

function detectIntent(snapshot) {
  const text = snapshot.toLowerCase();
  if (/transfer|airport|pickup|taxi/i.test(text))     return 'transfer';
  if (/accommodat|room|suite|villa|stay/i.test(text)) return 'accommodation';
  if (/tour|activ|excursion|cruise|day tour/i.test(text)) return 'activity';
  if (/wedding|event|function/i.test(text))           return 'event';
  if (/dine|restaur|food|meal/i.test(text))           return 'dining';
  return 'general';
}

function detectAllIntents(snapshot) {
  const intents = [];
  const text = snapshot.toLowerCase();
  if (/transfer|airport|pickup|taxi/i.test(text))     intents.push('transfer');
  if (/accommodat|room|suite|villa|stay/i.test(text)) intents.push('accommodation');
  if (/tour|activ|excursion|cruise/i.test(text))      intents.push('activity');
  if (/wedding|event|function/i.test(text))           intents.push('event');
  if (/dine|restaur|food|meal/i.test(text))           intents.push('dining');
  return intents;
}

function extractDates(snapshot) {
  const m = snapshot.match(/\b(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{4}-\d{2}-\d{2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec[a-z]*\s+\d{1,2})/gi);
  return m ? m.join(', ') : null;
}

function extractGroupSize(snapshot) {
  const m = snapshot.match(/\b(\d+)\s*(guest|person|people|adult|child|pax)/i);
  return m ? parseInt(m[1]) : null;
}

function extractBudgetSignal(snapshot) {
  const m = snapshot.match(/\$[\d,]+|\bfj\$[\d,]+|\bbudget\b.{0,30}/i);
  return m ? m[0] : null;
}

async function sendEmailNotification(env, to, message, leadName) {
  if (!env.SENDGRID_API_KEY) { console.log(`[Email → ${to}]\n${message}`); return true; }
  try {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: 'leads@vakaviti.ai', name: 'Vakaviti Leads' },
        subject: `New lead: ${leadName || 'Visitor'} — vakaviti.ai`,
        content: [{ type: 'text/plain', value: message }],
      }),
    });
    return res.ok;
  } catch { return false; }
}

async function sendWebhookNotification(url, payload) {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return res.ok;
  } catch { return false; }
}

function buildLeadNotification({ leadId, name, contact, intent, allIntents, travelDates, groupSize, budget, score, scoreReason, site_id, reviewUrl }) {
  const lines = [
    `🏝️ New Vakaviti Lead`,
    `Lead ID:  ${leadId}`,
    `Name:     ${name || 'Unknown'}`,
    `Contact:  ${contact || 'Not provided'}`,
    `Intent:   ${intent}${allIntents.length > 1 ? ' (also: ' + allIntents.join(', ') + ')' : ''}`,
    `Score:    ${score}/100 (${scoreReason})`,
    travelDates ? `Dates:    ${travelDates}` : null,
    groupSize   ? `Group:    ${groupSize} guests` : null,
    budget      ? `Budget:   ${budget}` : null,
    `Site:     ${site_id}`,
    ``,
    `Dashboard: https://dashboard.vakaviti.ai`,
  ];
  if (reviewUrl) {
    lines.push(``);
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`REVIEW FOLLOW-UP`);
    lines.push(`After the service, send this link to the traveller:`);
    lines.push(reviewUrl);
  }
  return lines.filter(l => l !== null).join('\n');
}

async function notifyPartner(env, { leadId, partnerId, site_id, name, contact, primaryIntent, allIntents, travelDates, groupSize, budget, score, scoreReason, reviewUrl }) {
  try {
    const channels = await env.DB.prepare(
      'SELECT channel_type, destination, priority FROM contact_channels WHERE partner_id = ? AND active = 1 ORDER BY priority ASC LIMIT 3'
    ).bind(partnerId).all();
    if (!channels.results || channels.results.length === 0) return false;
    const notifyText = buildLeadNotification({ leadId, name, contact, intent: primaryIntent, allIntents, travelDates, groupSize, budget, score, scoreReason, site_id, reviewUrl });
    let notified = false;
    let channelUsed = null;
    for (const channel of channels.results) {
      if (channel.channel_type === 'email') {
        notified = await sendEmailNotification(env, channel.destination, notifyText, name);
      } else if (channel.channel_type === 'webhook') {
        notified = await sendWebhookNotification(channel.destination, { leadId, partnerId, site_id, name, contact, primaryIntent, allIntents, score, reviewUrl });
      }
      if (notified) { channelUsed = channel.channel_type; break; }
    }
    if (notified && channelUsed) {
      await env.DB.prepare('UPDATE leads SET notified = 1, notified_at = ? WHERE id = ?')
        .bind(Math.floor(Date.now() / 1000), leadId).run();
    }
    return notified;
  } catch (err) {
    console.error('notifyPartner error:', err);
    return false;
  }
}

async function handleLead(request, env, cors) {
  if (!env.DB) return json({ ok: false, error: 'Database unavailable.' }, 503, cors);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400, cors); }
  const { site_id, partner_id, session_id, name, contact, conversation_snapshot = [] } = body;
  if (!site_id) return json({ error: 'Missing site_id.' }, 400, cors);
  const snapshot      = conversation_snapshot.map(m => m.content || '').join(' ').toLowerCase();
  const score         = scoreLead(snapshot, name, contact);
  const scoreReason   = explainScore(score, snapshot, name, contact);
  const primaryIntent = detectIntent(snapshot);
  const allIntents    = detectAllIntents(snapshot);
  const travelDates   = extractDates(snapshot);
  const groupSize     = extractGroupSize(snapshot);
  const budget        = extractBudgetSignal(snapshot);
  let resolvedPartnerId = partner_id || null;
  if (!resolvedPartnerId) {
    try {
      const ec = await env.DB.prepare('SELECT partner_id FROM embed_config WHERE site_id = ? LIMIT 1').bind(site_id).first();
      if (ec) resolvedPartnerId = ec.partner_id;
    } catch {}
  }
  const leadId = 'lead_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const shouldSeedReview = REVIEW_INTENTS.includes(primaryIntent) && resolvedPartnerId;
  let reviewToken = null;
  let reviewId    = null;
  let reviewUrl   = null;
  if (shouldSeedReview) {
    reviewToken = await generateReviewToken(resolvedPartnerId, leadId);
  }
  try {
    await env.DB.prepare(`
      INSERT INTO leads (
        id, site_id, partner_id, session_id,
        intent_category, traveller_name, traveller_email,
        travel_dates, group_size, budget_signal,
        score, score_reason, is_cross_referral, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).bind(
      leadId, site_id, resolvedPartnerId || null, session_id || 'unknown',
      primaryIntent, name || null, contact || null,
      travelDates || null, groupSize || null, budget || null,
      score, scoreReason, Math.floor(Date.now() / 1000)
    ).run();
    if (shouldSeedReview && reviewToken) {
      reviewId = await seedPendingReview(env, { leadId, partnerId: resolvedPartnerId, travellerId: contact || null, travelllerName: name || null, token: reviewToken });
      if (reviewId) reviewUrl = buildReviewUrl(env.REVIEW_BASE_URL, resolvedPartnerId, reviewToken);
    }
    if (resolvedPartnerId) {
      await notifyPartner(env, { leadId, partnerId: resolvedPartnerId, site_id, name, contact, primaryIntent, allIntents, travelDates, groupSize, budget, score, scoreReason, reviewUrl });
    }
    if (allIntents.length > 0) {
      try {
        const placeholders = allIntents.map(() => '?').join(',');
        const referrals = await env.DB.prepare(`
          SELECT pr.referred_partner_id, pr.intent_category, p.name AS partner_name
          FROM partner_referrals pr
          JOIN partners p ON p.id = pr.referred_partner_id
          WHERE pr.site_id = ? AND pr.intent_category IN (${placeholders}) AND pr.referred_partner_id != ?
        `).bind(site_id, ...allIntents, resolvedPartnerId || '').all();
        if (referrals.results && referrals.results.length > 0) {
          await Promise.allSettled(referrals.results.map(async ref => {
            const crossLeadId = 'lead_' + Date.now() + '_x_' + Math.random().toString(36).slice(2, 6);
            await env.DB.prepare(`
              INSERT INTO leads (
                id, site_id, partner_id, session_id,
                intent_category, traveller_name, traveller_email,
                travel_dates, group_size, budget_signal,
                score, score_reason, is_cross_referral, referred_by_site_id, referred_by_partner_id, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
            `).bind(
              crossLeadId, site_id, ref.referred_partner_id, session_id || 'unknown',
              ref.intent_category, name || null, contact || null,
              travelDates || null, groupSize || null, budget || null,
              score, scoreReason, site_id, resolvedPartnerId || null, Math.floor(Date.now() / 1000)
            ).run();
            await notifyPartner(env, { leadId: crossLeadId, partnerId: ref.referred_partner_id, site_id, name, contact, primaryIntent, allIntents, travelDates, groupSize, budget, score, scoreReason, reviewUrl: null });
          }));
        }
      } catch (refErr) { console.error('Cross-referral error:', refErr); }
    }
    return json({ ok: true, lead_id: leadId, score, review_token: reviewToken, review_id: reviewId, review_url: reviewUrl, review_seeded: !!reviewId }, 200, cors);
  } catch (err) {
    console.error('Lead storage error:', err);
    return json({ ok: false, error: err.message }, 500, cors);
  }
}

// ── Meta Bridge ───────────────────────────────────────────────

async function handleMetaBridge(request, env, cors) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, cors); }
  const { site_id, landing_url } = body;
  if (!site_id || !landing_url) return json({ error: 'site_id and landing_url required' }, 400, cors);
  const record = buildIntentRecord(body, request);
  const isDupe = await checkIntentDupe(env, record);
  if (isDupe) return json({ ok: true, status: 'deduplicated' }, 200, cors);
  await writeIntent(env, record);
  if (record.intent_type === 'checkout' || record.intent_type === 'booking_start') {
    await writeLeadFromIntent(env, record);
  }
  return json({ ok: true, status: 'recorded', intent_id: record.intent_id, intent_type: record.intent_type }, 200, cors);
}

async function handleMetaReport(request, env, cors) {
  const url = new URL(request.url);
  const campaign = url.searchParams.get('campaign');
  const site_id  = url.searchParams.get('site_id');
  let query = `SELECT site_id, utm_campaign, utm_source, intent_type, device_type, COUNT(*) as count, COUNT(DISTINCT session_id) as unique_sessions FROM meta_traffic_intents WHERE created_at > datetime('now','-7 days')`;
  const params = [];
  if (campaign) { query += ` AND utm_campaign = ?`; params.push(campaign); }
  if (site_id)  { query += ` AND site_id = ?`;      params.push(site_id); }
  query += ` GROUP BY site_id, utm_campaign, utm_source, intent_type, device_type ORDER BY count DESC`;
  const { results: funnel } = await env.DB.prepare(query).bind(...params).all();
  const { results: topCampaigns } = await env.DB.prepare(`SELECT utm_campaign, utm_source, COUNT(*) as checkout_intents, COUNT(DISTINCT session_id) as unique_sessions FROM meta_traffic_intents WHERE intent_type IN ('checkout','booking_start') AND created_at > datetime('now','-7 days') GROUP BY utm_campaign, utm_source ORDER BY checkout_intents DESC LIMIT 10`).all();
  return json({ ok: true, window: '7 days', funnel: funnel||[], top_campaigns: topCampaigns||[] }, 200, cors);
}

function buildIntentRecord(body, request) {
  const { site_id='unknown', session_id='unknown', landing_url='', fbclid='', utm_source='', utm_medium='', utm_campaign='', utm_content='', utm_term='', ref='', device_type=detectIntentDevice(request.headers.get('user-agent')||'') } = body;
  const intent_type = classifyIntent(landing_url);
  return {
    intent_id: `int_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
    site_id: site_id.slice(0,50), session_id: session_id.slice(0,64),
    fbclid: fbclid.slice(0,200), utm_source: utm_source.slice(0,100),
    utm_medium: utm_medium.slice(0,100), utm_campaign: utm_campaign.slice(0,100),
    utm_content: utm_content.slice(0,100), utm_term: utm_term.slice(0,100),
    ref: ref.slice(0,100), landing_url: landing_url.slice(0,500),
    intent_type, device_type, cf_country: request.cf?.country||'unknown',
    created_at: new Date().toISOString(),
  };
}

function classifyIntent(url) {
  const p = url.toLowerCase();
  if (p.includes('checkout')||p.includes('cart'))    return 'checkout';
  if (p.includes('booking')||p.includes('book-now')) return 'booking_start';
  if (p.includes('st_tour'))  return 'tour_view';
  if (p.includes('transfer')) return 'transfer_view';
  return 'page_view';
}

async function checkIntentDupe(env, record) {
  try {
    const { results } = await env.DB.prepare(`SELECT intent_id FROM meta_traffic_intents WHERE session_id=? AND intent_type=? AND created_at > datetime('now','-1 minute') LIMIT 1`).bind(record.session_id, record.intent_type).all();
    return results && results.length > 0;
  } catch { return false; }
}

async function writeIntent(env, record) {
  await env.DB.prepare(`INSERT INTO meta_traffic_intents (intent_id,site_id,session_id,fbclid,utm_source,utm_medium,utm_campaign,utm_content,utm_term,ref,landing_url,intent_type,device_type,cf_country,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(record.intent_id,record.site_id,record.session_id,record.fbclid,record.utm_source,record.utm_medium,record.utm_campaign,record.utm_content,record.utm_term,record.ref,record.landing_url,record.intent_type,record.device_type,record.cf_country,record.created_at).run();
}

async function writeLeadFromIntent(env, record) {
  try {
    await env.DB.prepare(`INSERT OR IGNORE INTO leads (id,partner_id,source,message,status,created_at) VALUES (?,?,?,?,?,?)`).bind('lead_'+record.intent_id,record.site_id,record.utm_source||record.ref||'meta_ad',`${record.intent_type} from ${record.utm_campaign||'ad'} — ${record.landing_url.slice(0,100)}`,'new',record.created_at).run();
  } catch(_) {}
}

function detectIntentDevice(ua) {
  return /mobile|android|iphone|ipad|tablet/i.test(ua) ? 'mobile' : 'desktop';
}

// ── Main Router ───────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const cors = getCors(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/lead')              return handleLead(request, env, cors);
    if (request.method === 'POST' && url.pathname === '/meta-bridge')       return handleMetaBridge(request, env, cors);
    if (request.method === 'GET'  && url.pathname === '/meta-bridge/report') return handleMetaReport(request, env, cors);
    if (request.method === 'GET'  && url.pathname === '/health')            return json({ ok: true, worker: 'vakaviti-leads', version: 2, review_intents: REVIEW_INTENTS }, 200, cors);
    return json({ error: 'Not found.' }, 404, cors);
  },
};
