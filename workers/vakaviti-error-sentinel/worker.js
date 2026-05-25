const SENTINEL_SECRET  = 'vk-sentinel-2026';
const ALERT_EMAIL_TO   = 'helpronline@gmail.com';
const ALERT_EMAIL_FROM = 'helpronline@gmail.com';
const CRITICAL_STRINGS = [
  'moment is not defined',
  'cannot read properties of null',
  'unexpected end of input',
  'booking',
  'checkout',
  'payment',
  'stripe',
  'uncaught syntaxerror',
];
const PARTNER_MAP = {
  'op_fijitourtransfers_001': 'Fiji Tour Transfers',
  'op_nadi_001':              'Nadi Airport Transfers',
  'op_bluelagoon_001':        'Blue Lagoon Beach Resort',
  'op_palms_001':             'The Palms Denarau',
  'op_vosavakaviti_001':      'Vosa Vakaviti',
  'op_tourfiji_001':          'Tour Fiji Tours',
  'op_smugglers_001':         'Smugglers Cove',
  'op_guidefiji_001':         'Guide Fiji',
  'op_fijithingstodo_001':    'Fiji Things To Do',
  'op_bestfijitours_001':     'Best Fiji Tours',
};

export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const method = request.method;
    if (method === 'OPTIONS') return corsResponse();
    if (method === 'POST' && url.pathname === '/ingest') return handleIngest(request, env);
    if (method === 'GET'  && url.pathname === '/status') return handleStatus(request, env);
    if (method === 'GET'  && url.pathname === '/errors') return handleErrors(request, env);
    if (method === 'GET'  && url.pathname === '/health') return json({ ok: true, service: 'vakaviti-error-sentinel', ts: Date.now() });
    return json({ error: 'Not found' }, 404);
  },
};

async function handleIngest(request, env) {
  const sig = request.headers.get('x-sentinel-key');
  if (sig !== SENTINEL_SECRET) return json({ error: 'Unauthorized' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const { site_id, error_type, page_url } = body;
  if (!site_id || !error_type || !page_url) return json({ error: 'Missing required fields' }, 400);
  const record = buildRecord(body, request);
  const isDupe = await checkDuplicate(env, record);
  if (isDupe) return json({ ok: true, status: 'deduplicated' });
  await writeToD1(env, record);
  if (record.severity === 'critical') await sendEmailAlert(env, record);
  return json({ ok: true, status: 'ingested', severity: record.severity, error_id: record.error_id });
}

async function handleStatus(request, env) {
  const key = request.headers.get('x-sentinel-key');
  if (key !== SENTINEL_SECRET) return json({ error: 'Unauthorized' }, 401);
  const { results } = await env.DB.prepare(`
    SELECT site_id, COUNT(*) as total_errors,
      SUM(CASE WHEN severity='critical' THEN 1 ELSE 0 END) as critical_count,
      SUM(CASE WHEN severity='warning'  THEN 1 ELSE 0 END) as warning_count,
      MAX(created_at) as last_error_at
    FROM sentinel_errors
    WHERE created_at > datetime('now','-24 hours')
    GROUP BY site_id ORDER BY critical_count DESC
  `).all();
  const summary = (results||[]).map(r => ({
    site_id: r.site_id,
    partner_name: PARTNER_MAP[r.site_id] || r.site_id,
    total_errors: r.total_errors,
    critical: r.critical_count,
    warnings: r.warning_count,
    last_error_at: r.last_error_at,
    health: r.critical_count > 0 ? '🔴 CRITICAL' : r.warning_count > 3 ? '🟡 DEGRADED' : '🟢 OK',
  }));
  return json({ ok: true, window: '24h', partners: summary });
}

async function handleErrors(request, env) {
  const key = request.headers.get('x-sentinel-key');
  if (key !== SENTINEL_SECRET) return json({ error: 'Unauthorized' }, 401);
  const url      = new URL(request.url);
  const site_id  = url.searchParams.get('site_id');
  const severity = url.searchParams.get('severity');
  const limit    = Math.min(parseInt(url.searchParams.get('limit')||'50'), 200);
  let query = `SELECT * FROM sentinel_errors WHERE created_at > datetime('now','-7 days')`;
  const params = [];
  if (site_id)  { query += ` AND site_id = ?`;  params.push(site_id); }
  if (severity) { query += ` AND severity = ?`; params.push(severity); }
  query += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);
  const { results } = await env.DB.prepare(query).bind(...params).all();
  return json({ ok: true, count: results?.length||0, errors: results||[] });
}

function buildRecord(body, request) {
  const { site_id='unknown', error_type='unknown', error_string='', page_url='',
          rage_clicks=0, stack_trace='', session_id='',
          user_agent=request.headers.get('user-agent')||'' } = body;
  const error_id     = `err_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  const partner_name = PARTNER_MAP[site_id] || site_id;
  const device_type  = detectDevice(request.headers.get('user-agent')||'');
  const severity     = classifySeverity({ error_type, error_string, rage_clicks, page_url });
  return { error_id, site_id, partner_name, error_type,
    error_string: sanitize(error_string), page_url: sanitize(page_url),
    device_type, severity, rage_clicks: parseInt(rage_clicks)||0,
    stack_trace: sanitize(stack_trace).slice(0,2000),
    session_id: sanitize(session_id).slice(0,64),
    user_agent: user_agent.slice(0,200),
    cf_country: request.cf?.country||'unknown',
    created_at: new Date().toISOString() };
}

function classifySeverity({ error_type, error_string, rage_clicks, page_url }) {
  const str = (error_string+' '+page_url).toLowerCase();
  if (CRITICAL_STRINGS.some(s => str.includes(s))) return 'critical';
  if (error_type==='rage_click' && parseInt(rage_clicks)>=5 &&
      (str.includes('book')||str.includes('cart')||str.includes('checkout'))) return 'critical';
  if (error_type==='rage_click' && parseInt(rage_clicks)>=5) return 'warning';
  if (error_type==='uncaught_error'||error_type==='syntax_error') return 'warning';
  return 'info';
}

async function checkDuplicate(env, record) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT error_id FROM sentinel_errors WHERE site_id=? AND error_string=? AND created_at > datetime('now','-1 minute') LIMIT 1`
    ).bind(record.site_id, record.error_string).all();
    return results && results.length > 0;
  } catch { return false; }
}

async function writeToD1(env, record) {
  await env.DB.prepare(`
    INSERT INTO sentinel_errors
      (error_id,site_id,partner_name,error_type,error_string,page_url,device_type,severity,rage_clicks,stack_trace,session_id,user_agent,cf_country,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(record.error_id,record.site_id,record.partner_name,record.error_type,
    record.error_string,record.page_url,record.device_type,record.severity,
    record.rage_clicks,record.stack_trace,record.session_id,record.user_agent,
    record.cf_country,record.created_at).run();
}

async function sendEmailAlert(env, record) {
  const page = record.page_url.replace(/https?:\/\/[^/]+/,'');
  const subject = `🚨 CRITICAL — ${record.partner_name} | ${record.error_string.slice(0,60)}`;
  const body = [
    `VAKAVITI SENTINEL — CRITICAL ERROR DETECTED`,
    ``,
    `Partner:    ${record.partner_name}`,
    `Site ID:    ${record.site_id}`,
    `Error:      ${record.error_string}`,
    `Page:       ${page || '/'}`,
    `Device:     ${record.device_type}`,
    `Country:    ${record.cf_country}`,
    `Type:       ${record.error_type}`,
    `Error ID:   ${record.error_id}`,
    `Time:       ${record.created_at}`,
    ``,
    `View all critical errors:`,
    `https://vakaviti-error-sentinel.helpronline.workers.dev/errors?site_id=${record.site_id}&severity=critical`,
    ``,
    `Network status (all partners):`,
    `https://vakaviti-error-sentinel.helpronline.workers.dev/status`,
  ].join('\n');

  try {
    await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.SENDGRID_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: ALERT_EMAIL_TO }] }],
        from:    { email: ALERT_EMAIL_FROM, name: 'Vakaviti Sentinel' },
        subject: subject,
        content: [{ type: 'text/plain', value: body }],
      }),
    });
  } catch(e) { console.error('Email alert failed:', e.message); }
}

function detectDevice(ua) {
  if (!ua) return 'unknown';
  return /mobile|android|iphone|ipad|tablet/i.test(ua) ? 'mobile' : 'desktop';
}

function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g,'').trim().slice(0,1000);
}

function json(data, status=200) {
  return new Response(JSON.stringify(data), {
    status, headers:{ 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' }
  });
}

function corsResponse() {
  return new Response(null, { status:204, headers:{
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Methods':'POST,GET,OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type,x-sentinel-key',
  }});
}
