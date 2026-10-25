// verify-served.js - run in a browser tab on https://nadiairporttransfers.com (console or javascript tool) AFTER a deployment.
// Result is left in window.__verify (JSON string); the IIFE returns 'started'.
//
// HOW CLOUDFLARE-INJECTED HTML IS HANDLED (exact, not a size allowance):
//  * Pages appends one fixed 214-character analytics snippet (SNIP) immediately before </body> of every served HTML page.
//  * A page that already carries SNIP in its source (OWN lists them: today only index.html, once) therefore arrives with OWN+1 copies.
//  * For HTML: the served text must contain exactly OWN[page]+1 copies of SNIP, and SNIP+'</body>' must be present.
//    Exactly ONE copy, the one directly before </body>, is removed. Then sha256 of the remaining bytes must equal the MANIFEST hash.
//  * Any other difference (different snippet, extra/missing copy, any changed byte anywhere) changes the count or the hash -> FAIL.
//  * Non-HTML files are compared raw. No size tolerance is used anywhere.
//  * Not fetchable: _redirects (consumed by Pages) and 404.html (served only for unknown paths). Check both in the deployment's file list.
window.__verify = 'running';
(async () => {
  const MANIFEST = __MANIFEST__;
  const OWN = __OWN__;
  const SNIP = __SNIP__;
  const SKIP = ['_redirects', '404.html'];
  const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
  const sha = async (u8) => hex(await crypto.subtle.digest('SHA-256', u8));
  const url = (p) => p === 'index.html' ? '/' : p.endsWith('/index.html') ? '/' + p.slice(0, -10) : p.startsWith('transfer/') && p.endsWith('.html') ? '/' + p.slice(0, -5) : '/' + p;
  const out = { checked: 0, ok: 0, fail: [], stripped: 0, skipped: SKIP };
  try {
    for (const [p, want] of Object.entries(MANIFEST)) {
      if (SKIP.includes(p)) continue;
      out.checked++;
      const r = await fetch(url(p) + '?verify=' + Date.now(), { cache: 'no-store' });
      let u8 = new Uint8Array(await r.arrayBuffer());
      let note = '';
      if (p.endsWith('.html')) {
        const s = new TextDecoder('utf-8').decode(u8);
        const n = s.split(SNIP).length - 1;
        if (n === (OWN[p] || 0) + 1 && s.includes(SNIP + '</body>')) { u8 = new TextEncoder().encode(s.replace(SNIP + '</body>', '</body>')); out.stripped++; }
        else note = ' injected copies ' + n + ' expected ' + ((OWN[p] || 0) + 1);
      }
      const got = await sha(u8);
      if (r.status === 200 && got === want && !note) out.ok++; else out.fail.push(p + ' status ' + r.status + ' hash ' + got.slice(0, 12) + ' want ' + want.slice(0, 12) + note);
    }
  } catch (e) { out.error = String(e); }
  out.pass = out.ok === out.checked && !out.error;
  window.__verify = JSON.stringify(out).replace(/[?&=]/g, ' ');
})();
'started'
