// Audit of advertised prices on route pages / titles / llms.txt against (a) the site's OWN booking tool and (b) the FijiDash candidate and the Worker.
// It lists disagreements and marks them UNRESOLVED. It invents no replacement figure and changes no page.
//   NAT_SITE=<nadi-airport-transfers-site/src> node reconciliation/advertised_audit.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { SOURCES, routesOf, newEnv, runCase, root } from './lib.mjs';

const outDir = path.resolve(process.argv[2] || 'out');
const env = await newEnv();
const FD_SITE = path.join(root, 'src'); const NAT_SITE = process.env.NAT_SITE || path.join(root, 'test-fixtures', 'nat-site-c5ee3b1');
const fdSrc = SOURCES['fd-cand'](); const natSrc = SOURCES.nat();
const fdRoutes = routesOf(fdSrc); const natRoutes = routesOf(natSrc);
const VEH = { Sedan: 'sedan', Minivan: 'minivan', Minibus: 'minibus' };
const amounts = (s) => [...s.matchAll(/FJ\$\s?([0-9]+(?:\.[0-9]+)?)/g)].map((m) => Number(m[1]));
const strip = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&rarr;/g, '->').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

async function toolFigures(site, destValue) {
  const routes = site === 'FijiDash' ? fdRoutes : natRoutes; const src = site === 'FijiDash' ? fdSrc : natSrc; const variant = site === 'FijiDash' ? 'fd-cand' : 'nat';
  const row = routes.find((r) => r.destValue === destValue); if (!row) return null;
  const out = {};
  for (const v of ['sedan', 'minivan', 'minibus']) for (const trip of ['one-way', 'return']) {
    const r = await runCase(env, { variant, src, row, vehicle: v, trip, time: '10:00', seat: false, optIn: true });
    out[`${v}|${trip}`] = { before: r.calc.selection.subtotal, after: r.selection, worker: r.worker, cls: r.cls };
  }
  return out;
}

const findings = [];
async function auditSite(site, dir) {
  for (const file of fs.readdirSync(path.join(dir, 'transfer')).filter((f) => f.endsWith('.html')).sort()) {
    const html = fs.readFileSync(path.join(dir, 'transfer', file), 'utf8');
    const dest = (html.match(/[?&]dest=([A-Z0-9_]+)/) || [])[1];
    const rec = { site, page: `transfer/${file}`, dest: dest || '(none found)' };
    const tool = dest ? await toolFigures(site, dest) : null;
    if (!tool) { findings.push({ ...rec, item: 'page', status: dest ? 'ROUTE_NOT_IN_BOOKING_TOOL' : 'NO_BOOKING_LINK_TO_COMPARE', note: 'cannot reconcile; UNRESOLVED' }); continue; }
    // table rows
    for (const m of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
      const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => strip(c[1]));
      const veh = VEH[(cells[0] || '').replace(/\*/g, '').trim()]; if (!veh || cells.length < 3) continue;
      for (const [idx, trip] of [[1, 'one-way'], [2, 'return']]) {
        const a = amounts(cells[idx]); if (!a.length) continue;
        const t = tool[`${veh}|${trip}`];
        const stated = { before: a[0], after: a[1] };
        const bookingBefore = t.before, bookingAfter = t.after;
        const ownMismatch = Math.abs(stated.before - bookingBefore) > 0.005 || (stated.after !== undefined && Math.abs(stated.after - bookingAfter) > 0.005);
        findings.push({ ...rec, item: `${veh} ${trip} table`, stated: a.join(' -> '), booking_tool_before_discount: bookingBefore, booking_tool_after_discount: bookingAfter, worker_after_discount: t.worker, tool_vs_worker: t.cls,
          status: ownMismatch ? 'UNRESOLVED: page disagrees with this site\'s booking tool' : (t.cls === 'MATCH' ? 'agrees' : `agrees with tool; tool vs Worker: ${t.cls}`) });
      }
    }
    // title / meta "From FJ$X" (sedan one-way, before discount)
    const from = (html.match(/<title>[^<]*From FJ\$([0-9.]+)/) || [])[1];
    if (from) { const t = tool['sedan|one-way']; findings.push({ ...rec, item: 'title "From FJ$"', stated: from, booking_tool_before_discount: t.before, booking_tool_after_discount: t.after, worker_after_discount: t.worker, tool_vs_worker: t.cls, status: Math.abs(Number(from) - t.before) > 0.005 ? 'UNRESOLVED: "from" price disagrees with this site\'s booking tool (sedan one-way, before discount)' : 'agrees' }); }
  }
}
await auditSite('FijiDash', FD_SITE);
if (NAT_SITE) await auditSite('NAT', NAT_SITE);

// llms.txt "from FJ$X" per route (FijiDash)
const llms = fs.readFileSync(path.join(FD_SITE, 'llms.txt'), 'utf8');
for (const line of llms.split('\n')) {
  const m = line.match(/^- (.+?) — (\d+)km — from FJ\$([0-9.]+)/); if (!m) continue;
  const row = fdRoutes.find((r) => r.dest === m[1] || r.dest.includes(m[1]) || m[1].includes(r.dest)); if (!row) { findings.push({ site: 'FijiDash', page: 'llms.txt', dest: m[1], item: 'llms from-price', stated: m[3], status: 'UNRESOLVED: route name not matched to the booking catalogue' }); continue; }
  const t = (await toolFigures('FijiDash', row.destValue))['sedan|one-way'];
  findings.push({ site: 'FijiDash', page: 'llms.txt', dest: row.destValue, item: 'llms from-price', stated: m[3], booking_tool_before_discount: t.before, booking_tool_after_discount: t.after, worker_after_discount: t.worker, tool_vs_worker: t.cls, status: Math.abs(Number(m[3]) - t.before) > 0.005 ? 'UNRESOLVED: "from" price disagrees with the candidate booking tool (sedan one-way, before discount)' : 'agrees' });
}
// FAQ / marketing strings in app.js that quote prices (listed for review, not parsed)
const faqLines = fdSrc.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /FJ\$\d/.test(l) && /(from|sedan|minivan|minibus|FAQ|q:)/i.test(l) && !/\$\{/.test(l)).slice(0, 25).map(([n, l]) => `app.js:${n}: ${l.trim().slice(0, 240)}`);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'advertised_audit.json'), JSON.stringify(findings, null, 1));
const unresolved = findings.filter((f) => String(f.status).startsWith('UNRESOLVED') || /NOT_IN|NO_BOOKING/.test(f.status));
const f2 = (n) => (n === undefined || n === null ? '-' : Number.isInteger(n) ? String(n) : Number(n).toFixed(2));
let md = `# Advertised-price audit (UNRESOLVED items only; nothing was changed or invented)\n\nCompared against the site's own booking tool (NAT: static published table; FijiDash candidate: live fare, with the approved Momi return convention), day 10:00, no extras, before and after the existing 10% discount, and against the Worker figure (after discount).\n\n`;
md += `Pages/items checked: ${findings.length}. Agreeing with the site's own booking tool: ${findings.filter((f) => f.status === 'agrees' || String(f.status).startsWith('agrees')).length}. **UNRESOLVED: ${unresolved.length}.**\n\n`;
md += '| Site | Page | Route | Item | Stated | Booking tool (before -> after discount) | Worker (after) | Status |\n|---|---|---|---|---|---|---|---|\n';
for (const f of unresolved) md += `| ${f.site} | ${f.page} | ${f.dest} | ${f.item} | ${f.stated ?? '-'} | ${f2(f.booking_tool_before_discount)} -> ${f2(f.booking_tool_after_discount)} | ${f2(f.worker_after_discount)} | ${f.status} |\n`;
md += `\n## Price-bearing strings in FijiDash app.js (FAQ / marketing) for manual review\n\n${faqLines.map((l) => '- `' + l.replace(/`/g, "'") + '`').join('\n')}\n`;
fs.writeFileSync(path.join(outDir, 'ADVERTISED-PRICES-AUDIT.md'), md);
console.log(md.slice(0, 6000)); console.log('total findings', findings.length, 'unresolved', unresolved.length);
