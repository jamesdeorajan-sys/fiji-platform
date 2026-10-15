// Undoes EXACTLY the accessibility changes of the NAT P0 accessibility candidate (labels, names, keyboard support, focus ring, footer heading level).
// Scope tests pass a file through a11yRevert() before comparing it with an earlier pinned production hash, so they keep proving that nothing
// else in that file changed; a11y-p0.test.js proves that reverting the current files reproduces production 67d0075 byte for byte.
const APP = [
  ['<td><button class="btn-book" onclick="bookRoute(${i})">Book →</button></td>',
   '<td><button class="btn-book" onclick="bookRoute(${i})" aria-label="Book ${escapeHtml(r.dest)} transfer">Book →</button></td>'],
  ['<button class="tour-cta" onclick="selectTour(${i})">Book this tour →</button>',
   '<button class="tour-cta" onclick="selectTour(${i})" aria-label="Book tour: ${escapeHtml(t.name)}">Book this tour →</button>'],
  ['<div class="faq-q" onclick="toggleFaq(${i},this)">',
   '<div class="faq-q" role="button" tabindex="0" aria-expanded="false" aria-controls="faq-a-${i}" onclick="toggleFaq(${i},this)" onkeydown="faqKey(event,${i},this)">'],
  [`  document.querySelectorAll('.faq-q').forEach(x => x.classList.remove('open'));
  if (!wasOpen) { a.classList.add('open'); el.classList.add('open'); }
}`,
   `  document.querySelectorAll('.faq-q').forEach(x => { x.classList.remove('open'); x.setAttribute('aria-expanded', 'false'); });
  if (!wasOpen) { a.classList.add('open'); el.classList.add('open'); el.setAttribute('aria-expanded', 'true'); }
}
// Enter or Space on a focused FAQ question opens or closes it, like a click.
function faqKey(e, i, el) {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFaq(i, el); }
}`],
  [`    <button type="button" class="typeahead-trigger" id="\${selectId}_ta_trigger" aria-haspopup="listbox" aria-expanded="false">
      <span class="typeahead-trigger-text">\${opts.placeholder || 'Select...'}</span>`,
   `    <button type="button" class="typeahead-trigger" id="\${selectId}_ta_trigger" aria-haspopup="listbox" aria-expanded="false" aria-controls="\${selectId}_ta_panel"\${document.getElementById(selectId + 'Label') ? \` aria-labelledby="\${selectId}Label \${selectId}_ta_text"\` : ''}>
      <span class="typeahead-trigger-text" id="\${selectId}_ta_text">\${opts.placeholder || 'Select...'}</span>`],
  ['<input type="text" class="typeahead-search" id="${selectId}_ta_search" placeholder="${opts.searchPlaceholder || \'Type a hotel or area name...\'}" autocomplete="off" />',
   '<input type="text" class="typeahead-search" id="${selectId}_ta_search" placeholder="${opts.searchPlaceholder || \'Type a hotel or area name...\'}" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="${selectId}_ta_list" aria-label="${opts.searchLabel || opts.searchPlaceholder || \'Search\'}" />'],
  ['<div class="typeahead-list" id="${selectId}_ta_list" role="listbox"></div>',
   '<div class="typeahead-list" id="${selectId}_ta_list" role="listbox" aria-label="${opts.listLabel || \'Matching places\'}"></div>'],
  ['<div class="ta-opt ta-opt-sentinel" data-val="${s.value}">', '<div class="ta-opt ta-opt-sentinel" role="option" aria-selected="false" data-val="${s.value}">'],
  ["  sel.classList.add('typeahead-hidden-select');\n",
   "  sel.classList.add('typeahead-hidden-select');\n  // The visible typeahead is the control; keep the hidden native select out of the Tab order and the accessibility tree.\n  sel.tabIndex = -1;\n  sel.setAttribute('aria-hidden', 'true');\n"],
  ['<div class="ta-group-label">${g.label}</div>', '<div class="ta-group-label" role="presentation">${g.label}</div>'],
  ['<div class="ta-opt" data-val="${o.value}">', '<div class="ta-opt" role="option" aria-selected="false" data-val="${o.value}">'],
  [`    list.innerHTML = html;

    // Wire option clicks
    list.querySelectorAll('.ta-opt').forEach(el => {
      el.addEventListener('click', () => {`,
   `    list.innerHTML = html;
    activeIdx = -1;
    search.removeAttribute('aria-activedescendant');

    // Wire option clicks
    list.querySelectorAll('.ta-opt').forEach((el, n) => {
      el.id = \`\${selectId}_ta_opt_\${n}\`;
      el.addEventListener('click', () => {`],
  [`        closePanel();
      });
    });
  }
`,
   `        closePanel();
        trigger.focus();
      });
    });
  }

  // Arrow keys move a highlighted option (announced through aria-activedescendant); Enter picks it.
  let activeIdx = -1;
  function moveActive(step) {
    const opts = Array.from(list.querySelectorAll('.ta-opt'));
    if (!opts.length) return;
    activeIdx = activeIdx < 0 ? (step > 0 ? 0 : opts.length - 1) : (activeIdx + step + opts.length) % opts.length;
    opts.forEach((o, n) => { o.classList.toggle('ta-active', n === activeIdx); o.setAttribute('aria-selected', n === activeIdx ? 'true' : 'false'); });
    search.setAttribute('aria-activedescendant', opts[activeIdx].id);
    opts[activeIdx].scrollIntoView({ block: 'nearest' });
  }
`],
  [`    if (e.key === 'Escape') closePanel();
    if (e.key === 'Enter') {
      const first = list.querySelector('.ta-opt:not(.ta-opt-sentinel)') || list.querySelector('.ta-opt');`,
   `    if (e.key === 'Escape') { closePanel(); trigger.focus(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); moveActive(e.key === 'ArrowDown' ? 1 : -1); }
    if (e.key === 'Enter') {
      e.preventDefault();
      const active = activeIdx >= 0 ? list.querySelectorAll('.ta-opt')[activeIdx] : null;
      const first = active || list.querySelector('.ta-opt:not(.ta-opt-sentinel)') || list.querySelector('.ta-opt');`],
  [`    searchPlaceholder: 'Search airports, hotels, areas...'
  });`, `    searchPlaceholder: 'Search airports, hotels, areas...',
    searchLabel: 'Search pickup locations', listLabel: 'Pickup locations'
  });`],
  [`    searchPlaceholder: 'Search 110+ Fiji hotels...'
  });`, `    searchPlaceholder: 'Search 110+ Fiji hotels...',
    searchLabel: 'Search destinations', listLabel: 'Destinations'
  });`],
];
const CSS = [
  ['.footer-col h4{', '.footer-col h3,.footer-col h4{'],
  ['.ta-opt:hover{background:#eff6ff;color:var(--ocean)}', '.ta-opt:hover,.ta-opt.ta-active{background:#eff6ff;color:var(--ocean)}'],
  ['.ta-opt-sentinel:hover{background:#fef3c7;color:#78350f}', '.ta-opt-sentinel:hover,.ta-opt-sentinel.ta-active{background:#fef3c7;color:#78350f}'],
  ['select.field-input:focus,.select-wrap select:focus{outline:none;border-color:var(--ocean);box-shadow:0 0 0 3px rgba(0,102,204,.1)}',
   'select.field-input:focus,.select-wrap select:focus{outline:none;border-color:var(--ocean);box-shadow:0 0 0 3px rgba(0,102,204,.35)}'],
  ['.field-input:focus{outline:none;border-color:var(--ocean);box-shadow:0 0 0 3px rgba(0,102,204,.1)}', '.field-input:focus{outline:none;border-color:var(--ocean);box-shadow:0 0 0 3px rgba(0,102,204,.35)}'],
];
function undoPairs(s, pairs, f) {
  // longest replacements first, so a shorter replacement that is a substring of a longer one cannot match inside it
  for (const [before, after] of [...pairs].sort((x, y) => y[1].length - x[1].length)) {
    const n = s.split(after).length - 1;
    if (n < 1) throw new Error(`${f}: expected accessibility change not found: ${after.slice(0, 80)}`);
    s = s.split(after).join(before);
  }
  return s;
}
function undoIndex(s) {
  return s
    .replace(/ autocomplete="(?:given-name|family-name|email|tel)"/g, '') // RC1 E: contact-field autocomplete
    .replace('        <a href="/transfer/radisson-blu-resort-fiji-denarau">Nadi Airport → Radisson Blu Denarau</a>\n        <a href="/transfer/sofitel-fiji-resort-spa">Nadi Airport → Sofitel Denarau</a>\n        <a href="/transfer/westin-denarau-island-resort">Nadi Airport → Westin Denarau</a>\n        <a href="/transfer/crowne-plaza-fiji-nadi-bay">Nadi Airport → Crowne Plaza Nadi Bay</a>\n        <a href="/transfer/first-landing-beach-resort">Nadi Airport → First Landing, Vuda Point</a>\n        <a href="/transfer/fiji-marriott-resort-momi-bay">Nadi Airport → Marriott Momi Bay</a>\n        <a href="/transfer/warwick-fiji">Nadi Airport → The Warwick Fiji</a>\n        <a href="/transfer/tanoa-international-hotel">Nadi Airport → Tanoa International</a>\n        <a href="/transfer/tokatoka-resort-hotel">Nadi Airport → Tokatoka Resort</a>\n', '') // RC1 D: footer links to every live destination page
    .replace("            it's the same team that is arranging your transfer.", "            we're the #1 team to reach out to during your Fiji stay.") // candidate C: unsupported '#1 team' claim replaced (wording needs James's approval)
    .split('Nadi Airport Transfers | Fixed-Price Fiji Airport Transfers').join('Nadi Airport Transfers — Fixed-Price Private Transfers | Fiji Tour Transfers').replace('Private Nadi Airport transfers to Denarau, the Coral Coast, Pacific Harbour, Sigatoka and 50+ hotels. Fixed whole-vehicle prices online; no payment to request.', 'Request a private transfer from Nadi International Airport to Denarau, the Coral Coast, Pacific Harbour, Sigatoka and 50+ hotels. Fixed whole-vehicle prices shown online; no payment now. Your transfer is confirmed by our Fiji team.') // SEO candidate B: homepage title/description
    .replace('<a href="/transfer/coral-coast-outrigger">Nadi Airport → Outrigger Fiji</a>', '<a href="/transfer/outrigger-fiji-beach-resort">Nadi Airport → Outrigger Fiji</a>') // SEO fix A (ceo/nat-seo-verified-fixes): footer link no longer points at a redirect
    .replace(/<label class="field-label" id="(?:pickup|destination)Label">/g, '<label class="field-label">')
    .replace(/<label class="field-label" for="[A-Za-z]+">/g, '<label class="field-label">')
    .replace(/<label class="field-label" id="(?:paxLabel|luggageLabel)">/g, '<label class="field-label">')
    .replace(/<div class="pax-counter" role="group" aria-labelledby="(?:paxLabel|luggageLabel)">/g, '<div class="pax-counter">')
    .replace(/<button type="button" class="pax-btn" onclick="(changePax|changeLuggage)\((-?1)\)" aria-label="(?:Fewer|More) (?:passengers|bags)">/g, '<button class="pax-btn" onclick="$1($2)">')
    .replace(/<span class="pax-num" id="(paxNum|luggageNum)" aria-live="polite">/g, '<span class="pax-num" id="$1">')
    .replace('<button type="button" class="swap-btn" onclick="swapLocations()" title="Swap pickup and destination" aria-label="Swap pickup and destination">', '<button class="swap-btn" onclick="swapLocations()" title="Swap">')
    .replace('id="flightNum" class="field-input" aria-describedby="flightError"', 'id="flightNum" class="field-input"')
    .replace(/(onclick="bookRoute\(\d+\)") aria-label="Book [^"]* transfer"/g, '$1')
    .replace(/(onclick="selectTour\(\d+\)") aria-label="Book tour: [^"]*"/g, '$1')
    .replace(/<div class="faq-q" role="button" tabindex="0" aria-expanded="false" aria-controls="faq-a-(\d+)" onclick="toggleFaq\(\1,this\)" onkeydown="faqKey\(event,\1,this\)">/g, '<div class="faq-q" onclick="toggleFaq($1,this)">')
    .replace(/(<div class="footer-col">\s*)<h3>(.*?)<\/h3>/g, '$1<h4>$2</h4>');
}
export function a11yRevert(file, text) {
  if (file === 'app.js') return undoPairs(text, APP, file);
  if (file === 'styles.css') return undoPairs(text, CSS, file);
  if (file === 'index.html') return undoIndex(text);
  return text;
}
