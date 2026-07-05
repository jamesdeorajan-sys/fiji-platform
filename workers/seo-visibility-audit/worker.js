// ============================================================
// seo-visibility-audit — standalone Worker, separate from fiji-chat-widget
// Purpose: find out, across ALL active partners, which tour pages already
// have real FAQ content, which have schema, which are blocked from AI
// crawlers, and which have no llms.txt — without needing a tours table.
// ============================================================

const AI_CRAWLER_PATTERN = /(GPTBot|PerplexityBot|ClaudeBot|anthropic-ai|CCBot|Google-Extended|Applebot-Extended|Bytespider)/i;
const FAQ_HEADING_PATTERN = /<h[1-6][^>]*>[^<]{0,80}\b(faq|frequently asked)\b[^<]{0,80}<\/h[1-6]>/i;
const FAQ_SCHEMA_PATTERN = /"@type"\s*:\s*"FAQPage"/i;
const MAX_PAGES_PER_DOMAIN = 8; // reduced — see batching design below, this keeps each batch well under Worker limits
const MAX_SITEMAP_URLS_TO_SCAN = 400;

// Your own owned properties — these aren't in the partners table, so they're audited separately.
// Update this list if you add/rename a subdomain; everything else (partner sites) comes from D1 automatically.
const OWNED_PROPERTIES = [
  'vakaviti.ai',
  'lagi.vakaviti.ai',
  'discover.vakaviti.ai',
  'vanua.vakaviti.ai',
  'join.vakaviti.ai',
  'yasawa.vakaviti.ai',
  'mamanuca.vakaviti.ai',
  'honeymoon.vakaviti.ai',
  'diving.vakaviti.ai',
  'familyresorts.vakaviti.ai',
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/run-audit') {
        const offset = parseInt(url.searchParams.get('offset') || '0', 10);
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '5', 10), 10); // hard cap per batch
        return await runAuditBatch(env, url, offset, limit);
      }
      if (url.pathname === '/results') return await getResults(env);
      return json({
        message: 'seo-visibility-audit.',
        usage: 'Visit /run-audit to start. It processes 5 domains per batch and gives you a link to continue. Visit /results anytime to see everything collected so far.'
      });
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  }
};

async function runAuditBatch(env, requestUrl, offset, limit) {
  const partners = await getPartners(env);
  // One combined, stable-ordered list: owned properties first, then partners.
  const allTargets = [
    ...OWNED_PROPERTIES.map(domain => ({ partner_id: 'owned_property', domain, owned: true })),
    ...partners.map(p => ({ partner_id: p.partner_id, domain: p.domain, owned: false })),
  ];

  const batch = allTargets.slice(offset, offset + limit);
  const results = [];

  for (const target of batch) {
    const finding = target.owned
      ? await auditOwnedProperty(target.domain)
      : await auditDomain({ partner_id: target.partner_id, domain: target.domain });
    results.push(finding);
    await storeFinding(env, finding).catch(e => { finding.storage_error = e.message; });
  }

  const nextOffset = offset + limit;
  const done = nextOffset >= allTargets.length;

  const response = {
    progress: `${Math.min(nextOffset, allTargets.length)} of ${allTargets.length} domains audited`,
    done,
    batch_results: results,
  };

  if (!done) {
    const nextUrl = new URL(requestUrl);
    nextUrl.searchParams.set('offset', String(nextOffset));
    nextUrl.searchParams.set('limit', String(limit));
    response.next = nextUrl.toString();
    response.instructions = 'Click or visit the "next" URL above to continue the audit. Repeat until done: true.';
  } else {
    response.instructions = 'Audit complete. Visit /results to see the full combined findings.';
  }

  if (!partners.length) {
    response.warning = 'No partner records found in this batch context — check partners table. Owned-properties portion still runs normally.';
  }

  return json(response);
}

async function auditOwnedProperty(domain) {
  const finding = {
    partner_id: 'owned_property',
    domain,
    checked_at: new Date().toISOString(),
    robots_status: null,
    blocks_ai_crawlers: false,
    has_llms_txt: false,
    pages_scanned: 0,
    pages_with_faq_content: 0,
    pages_with_faq_schema: 0,
    pages_needing_schema: [],
  };

  try {
    const res = await fetch(`https://${domain}/robots.txt`, { cf: { cacheTtl: 0 } });
    finding.robots_status = res.status;
    if (res.ok) finding.blocks_ai_crawlers = blocksAiCrawlers(await res.text());
  } catch (e) { finding.robots_status = 'fetch_failed'; }

  try {
    const res = await fetch(`https://${domain}/llms.txt`, { cf: { cacheTtl: 0 } });
    finding.has_llms_txt = res.ok;
  } catch (e) { finding.has_llms_txt = false; }

  try {
    const res = await fetch(`https://${domain}/`, { cf: { cacheTtl: 0 } });
    if (res.ok) {
      const html = await res.text();
      finding.pages_scanned = 1;
      const hasFaq = FAQ_HEADING_PATTERN.test(html);
      const hasSchema = FAQ_SCHEMA_PATTERN.test(html);
      if (hasFaq) finding.pages_with_faq_content = 1;
      if (hasSchema) finding.pages_with_faq_schema = 1;
      if (hasFaq && !hasSchema) finding.pages_needing_schema.push(`https://${domain}/`);
    }
  } catch (e) { /* skip */ }

  return finding;
}

async function getPartners(env) {
  // Confirmed against the live schema: partners(id TEXT PRIMARY KEY, ..., website_url TEXT, status TEXT ...)
  const res = await env.DB.prepare(
    `SELECT id AS partner_id, website_url AS domain FROM partners WHERE status = 'active' AND website_url IS NOT NULL AND website_url != ''`
  ).all();
  return res.results || [];
}

async function auditDomain(partner) {
  const domain = String(partner.domain || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const finding = {
    partner_id: partner.partner_id,
    domain,
    checked_at: new Date().toISOString(),
    robots_status: null,
    blocks_ai_crawlers: false,
    has_llms_txt: false,
    pages_scanned: 0,
    pages_with_faq_content: 0,
    pages_with_faq_schema: 0,
    pages_needing_schema: [],
  };
  if (!domain) { finding.robots_status = 'no_domain_on_record'; return finding; }

  // robots.txt check
  try {
    const res = await fetch(`https://${domain}/robots.txt`, { cf: { cacheTtl: 0 } });
    finding.robots_status = res.status;
    if (res.ok) {
      const text = await res.text();
      finding.blocks_ai_crawlers = blocksAiCrawlers(text);
    }
  } catch (e) {
    finding.robots_status = 'fetch_failed';
  }

  // llms.txt check
  try {
    const res = await fetch(`https://${domain}/llms.txt`, { cf: { cacheTtl: 0 } });
    finding.has_llms_txt = res.ok;
  } catch (e) {
    finding.has_llms_txt = false;
  }

  // Discover pages via sitemap (no tours table dependency)
  const pageUrls = await discoverPagesFromSitemap(domain);
  const toScan = pageUrls.slice(0, MAX_PAGES_PER_DOMAIN);

  for (const pageUrl of toScan) {
    try {
      const res = await fetch(pageUrl, { cf: { cacheTtl: 0 } });
      if (!res.ok) continue;
      const html = await res.text();
      finding.pages_scanned++;
      const hasFaq = FAQ_HEADING_PATTERN.test(html);
      const hasSchema = FAQ_SCHEMA_PATTERN.test(html);
      if (hasFaq) finding.pages_with_faq_content++;
      if (hasSchema) finding.pages_with_faq_schema++;
      if (hasFaq && !hasSchema) finding.pages_needing_schema.push(pageUrl);
    } catch (e) { /* skip unreachable page, don't fail the whole domain */ }
  }

  return finding;
}

function blocksAiCrawlers(robotsText) {
  const blocks = robotsText.split(/\n\s*\n/);
  for (const block of blocks) {
    if (AI_CRAWLER_PATTERN.test(block) && /Disallow:\s*\/\s*$/im.test(block)) return true;
  }
  return false;
}

async function discoverPagesFromSitemap(domain) {
  const candidates = [`https://${domain}/sitemap.xml`, `https://${domain}/sitemap_index.xml`];
  let urls = [];
  for (const sitemapUrl of candidates) {
    try {
      const res = await fetch(sitemapUrl, { cf: { cacheTtl: 0 } });
      if (!res.ok) continue;
      const xml = await res.text();
      const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());
      if (!locs.length) continue;

      // If this is a sitemap index (points to other sitemaps), follow up to 3 of them
      const looksLikeIndex = /<sitemapindex/i.test(xml);
      if (looksLikeIndex) {
        for (const sub of locs.slice(0, 3)) {
          try {
            const subRes = await fetch(sub, { cf: { cacheTtl: 0 } });
            if (!subRes.ok) continue;
            const subXml = await subRes.text();
            const subLocs = [...subXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());
            urls.push(...subLocs);
            if (urls.length >= MAX_SITEMAP_URLS_TO_SCAN) break;
          } catch (e) { /* skip sub-sitemap */ }
        }
      } else {
        urls.push(...locs);
      }
      if (urls.length) break;
    } catch (e) { /* try next candidate */ }
  }

  // Prefer URLs that look like tour/product pages, but don't hard-fail if the pattern doesn't match —
  // fall back to scanning whatever the sitemap has, since the FAQ check is cheap and harmless on any page.
  const likelyTourPages = urls.filter(u => /\/(st_tour|tour|product|activities?|excursion)s?\//i.test(u));
  return (likelyTourPages.length ? likelyTourPages : urls).slice(0, MAX_SITEMAP_URLS_TO_SCAN);
}

async function storeFinding(env, f) {
  await env.DB.prepare(`
    INSERT INTO seo_audit_findings
      (partner_id, domain, robots_status, blocks_ai_crawlers, has_llms_txt,
       pages_scanned, pages_with_faq_content, pages_with_faq_schema, pages_needing_schema, checked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    String(f.partner_id ?? ''),
    f.domain,
    String(f.robots_status),
    f.blocks_ai_crawlers ? 1 : 0,
    f.has_llms_txt ? 1 : 0,
    f.pages_scanned,
    f.pages_with_faq_content,
    f.pages_with_faq_schema,
    JSON.stringify(f.pages_needing_schema),
    f.checked_at
  ).run();
}

async function getResults(env) {
  const rows = await env.DB.prepare(`SELECT * FROM seo_audit_findings ORDER BY checked_at DESC LIMIT 200`).all();
  return json(rows.results);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
