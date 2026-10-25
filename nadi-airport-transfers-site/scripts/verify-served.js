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
  const MANIFEST = {"404.html":"69ed052c491633f8d3138ba68f90aeda1dbb0c37a76120ab2836358ef53e21c5","_redirects":"578cd6f94e366cbeeba342ec4a34d912dc309e33f000953b8a3a8c3c38189de3","app.js":"38b65ab72ab7d9d3b19c9e8fbd284f68013a08dcc3bee72ec2fcba991297a285","apple-touch-icon.png":"780145070380ed48ffcc66e5c34cc67041949de6b07556f364486f2a91169ace","booking-extras.css":"5da6759b2dc795ade7d5bd67dd98bb689fba7300d04be3749ee1fc657c162e76","booking-extras.js":"e8aef0ce78f8cb1f7eb9ad925d52ad190aa1a4a1ae5329f48493add334276739","chat-widget.js":"e8a3891fe69c51664d6c2ef6dd2a2d11a9e7b3d6a024f257ce262809503c4836","favicon-16x16.png":"92def666e261ca856a5f1d5db80ad5a4daae9e8f4ff5a93f671c526e64b2c676","favicon-32x32.png":"523682e3a30054edbf039aca4476e74a1357ca5a506fe4df21ddf6f9d7f2e238","favicon.ico":"7cfcab8fe31cb23a26dfe685132bf093ec111ae293041a907095f651a38168ac","fiji-pickup.js":"9ac0ea0e887dbfdd1e9032e465faab27c51f407a5202d013090a3456cbbfafdb","funnel-nat.js":"33884363eff3376b4da950376069818fbca7705308d34663e7f7910a88ded7ca","icon-192.png":"402dfd7303095c39b676b0aa4fca30567aefca01630881b7677d516660de460a","icon-512.png":"8b15f5b4402c7f2962606a7bd70a5f630de11c9c44b4a012116c4f772d5580e8","index.html":"ffa16d375a7559e5857dd4a32ed9049ad6d78992e85cada70ddb8719d5f0b4b2","nadi-airport-car-rentals/index.html":"0577b96cd284b27efcd47f8eb514041402ebc79af7dc5842997d4acf86ffff44","nadi-airport-transfers-with-child-seats/index.html":"fb244400237eccc93d2338affbc720f98ec6f9560862b4777ed2ba4653cb50a6","rental-assets/rental-core.js":"33fde3f58467fcac13052f8015701e4b6b0a3bffb4310a6c9c76b2e76df8f698","rental-assets/rental.js":"92a59db500e22881fa23c71491a75c39cf30d8842ac044dc3a11efdc088ebde3","robots.txt":"2b6dbb0871547ca5e283f9679be2eac10d0a81ce56d86daffa2a6fcb4f9c10de","route-handoff.js":"8d7f90cc9682aaa1baf91bb4384f6ea12025b5728de8242c7f5e4c9d856147ee","route-source.js":"c9e4cf56cbf95c15382b1e842db8ce0ab8af3d54159f32636efac4b0b39745c4","sitemap.xml":"00bdb9aa344d21faa9ec934d3ef241f58c84d8fa79319c7e315f6d7f31b005d5","styles.css":"2df99123e96d9a2d71112d306db816ad3bcc069b26eab832ff9c85c93b363bba","transfer/coral-coast-outrigger.html":"ccbbb93e2ead502ac6b8d49eb71bb22a2839336fd66f57c0c8cde566c8375b51","transfer/crowne-plaza-fiji-nadi-bay.html":"b2523b97584f71713d77a7cedeba5b8f8c88d9691aa321f714937e1050246490","transfer/doubletree-sonaisali-island.html":"08d82204bd716518d92ae318456d611f6ebd01fb89e6782d95769da8f4fa2cff","transfer/fiji-marriott-resort-momi-bay.html":"f9ede855a2e3d84c96b236557d8b3f74488e7078894d0a1476095912f6940f07","transfer/first-landing-beach-resort.html":"81ff92931f5c44527b4602ef3c492419092fa8e497852c0eeef71fb43978aa45","transfer/grand-pacific-hotel-suva.html":"6936ce753b564481523c88299a095c7b29338074ff44345226ce57dc9223f850","transfer/hilton-fiji-beach-resort.html":"5fa17272ac04653ad4d4b0bdad07d0b9e0decfcb27c232ef87011279a245f706","transfer/intercontinental-fiji-natadola.html":"52f8627eaaa33222e1539cd1e5d3b26d1124f8f3a0b80e9bddb9d7e1d7f31e6b","transfer/natadola-intercontinental.html":"ebf0fa6fee623958d14ea95a80a7427fecc1f6fdab318d642ebefe6686c101fc","transfer/naviti-resort.html":"cd59dd85de49ad2ddfd45849a1643c2729984ddb14c8c27aa147b6c3bb157850","transfer/pacific-harbour.html":"578457d56e28f753aa7ebdf9a082095ae8f411396997f2eba6dd39b3ac8b3c6c","transfer/pearl-south-pacific-resort.html":"032f710ba07863937025d5a0fd7225ead0482853661e947c32177e9919811a69","transfer/port-denarau-marina.html":"435a4c80bbc65819c5d1e3d7994529e92d881bddf6c0c997f3b80f52032e3f19","transfer/port-denarau.html":"d8db31a6d80ab869566eb169a225dee2bf888d0d4724a0b81f8e03bf5a7249c2","transfer/radisson-blu-resort-fiji-denarau.html":"308e33cf985052de2e66d154b192b21d2d3199d942ea83e21bd691c9360346c9","transfer/shangri-la-yanuca-island.html":"a1d746f336359dfb8c24cce7909dd4dffd6bcbe1704e85d4e314548e55ab216d","transfer/sheraton-fiji-golf-beach-resort.html":"76067b9fb4c382f51309d6c5a08c835e0e97d73e38786a327fc4803b502d2635","transfer/sofitel-fiji-resort-spa.html":"d55ccf21c3580e8a45b9de88f3585d3d6133bfd5f23a3caf4031343c0e346e5f","transfer/suva.html":"963a390d1b8da869943dc73644a40eaeead924e142f21a4e00faf0ea86305c5b","transfer/tanoa-international-hotel.html":"abed49cc05d19caf62a8c1082dfaf8210764ae99efd0887cbf7c8a650072a68b","transfer/tokatoka-resort-hotel.html":"3169b2f51a0b980b05b9e076c71e95ee3fd4cf4985d4b6bb7e923f63b6919006","transfer/warwick-fiji.html":"6f60046bdd5e3e25bdcbb991f4faabb36126a37995d03b4977dfd62f0a7cc732","transfer/westin-denarau-island-resort.html":"158349b5de5645d6f806dcc220caf85e5990c8ae0493c335608e9cbf1b129b82"};
  const OWN = {"index.html": 1};
  const SNIP = "<!-- Cloudflare Pages Analytics --><script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{\"token\": \"40d766fdaddc4cb68ce32a56801f1639\"}'></script><!-- Cloudflare Pages Analytics -->";
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
