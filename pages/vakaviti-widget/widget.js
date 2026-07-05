
(function () {
  'use strict';
  const LEGACY_DEFAULTS = {
    brandName: 'Fiji Tour Transfers',
    workerUrl: 'https://fiji-chat-widget.helpronline.workers.dev/',
    whatsappUrl: 'https://wa.me/61478886145',
    themeColor: '#0d4d6e',
    greetingText: null,
    allowedIntents: null,
    primaryIntent: null,
  };
  const PHASE2_WORKER_URL = 'https://fiji-chat-widget.helpronline.workers.dev/';
  let config = null;
  let conversation = [];
  let isOpen = false;
  let isLoading = false;
  let hasGreeted = false;
  let sessionId = generateSessionId();
  let cachedPageCtx = null;
  async function boot() {
    const siteId = getSiteId();
    if (siteId) { config = await fetchConfig(siteId); }
    if (!config) {
      config = { siteId: null, partnerId: null, brandName: LEGACY_DEFAULTS.brandName, workerUrl: LEGACY_DEFAULTS.workerUrl, whatsappUrl: LEGACY_DEFAULTS.whatsappUrl, whatsappNumber: '+61 478 886 145', themeColor: LEGACY_DEFAULTS.themeColor, greetingText: LEGACY_DEFAULTS.greetingText, allowedIntents: LEGACY_DEFAULTS.allowedIntents, primaryIntent: LEGACY_DEFAULTS.primaryIntent, isLegacy: true };
    }
    injectStyles(); injectWidget(); wireEvents(); trackEvent('widget_loaded');
  }
  function getSiteId() {
    if (window.VAKAVITI_SITE_ID) return window.VAKAVITI_SITE_ID;
    const script = document.getElementById('vk-widget-script') ||
      document.currentScript ||
      document.querySelector('script[data-site-id]');
    return script ? (script.getAttribute('data-site-id') || null) : null;
  }
  function extractPageDetail() {
    try {
      let detail = '';
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (let i = 0; i < scripts.length && i < 6; i++) {
        let data;
        try { data = JSON.parse(scripts[i].textContent); } catch (e) { continue; }
        const nodes = Array.isArray(data) ? data : (data['@graph'] || [data]);
        for (const node of nodes) {
          if (!node) continue;
          const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
          if (types.includes('FAQPage')) {
            const entities = node.mainEntity || [];
            for (const q of entities) {
              const question = q.name || '';
              const answer = (q.acceptedAnswer && q.acceptedAnswer.text) || '';
              if (question && answer) {
                detail += 'Q: ' + question + '\nA: ' + answer.replace(/<[^>]+>/g,' ').trim() + '\n\n';
              }
            }
          }
        }
        if (detail) break;
      }
      if (!detail) {
        const headingRe = /faq|frequently asked|highlight|includ|exclud|itinerary/i;
        const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
        for (let i = 0; i < headings.length && i < 30 && detail.length < 1600; i++) {
          const h = headings[i];
          if (headingRe.test(h.innerText || '')) {
            const anchorLevel = parseInt((h.tagName||'H6').replace(/[^0-9]/g,''),10) || 6;
            let sib = h.nextElementSibling;
            let grabbed = 0;
            while (sib && grabbed < 12 && detail.length < 1600) {
              const tag = (sib.tagName || '').toUpperCase();
              const hLevel = /^H[1-6]$/.test(tag) ? parseInt(tag.slice(1),10) : null;
              if (hLevel !== null && hLevel <= anchorLevel) break;
              const txt = (sib.textContent || '').trim().replace(/\s+/g, ' ');
              if (txt) { detail += txt.slice(0, 400) + '\n\n'; grabbed++; }
              sib = sib.nextElementSibling;
            }
          }
        }
      }
      const metaDesc = document.querySelector('meta[name="description"]')?.content ||
                        document.querySelector('meta[property="og:description"]')?.content || '';
      if (metaDesc && detail.length < 1500) detail = metaDesc.trim().slice(0,300) + '\n\n' + detail;
      return detail.trim().slice(0, 2000) || null;
    } catch (e) { return null; }
  }
  function getPageContext() {
    try {
      const h1 = document.querySelector('h1');
      return {
        page_url: (window.location.href || '').split('?')[0].split('#')[0].slice(0, 300),
        page_title: (document.title || '').trim().slice(0, 200) || null,
        page_heading: h1 && h1.innerText ? h1.innerText.trim().slice(0, 200) : null,
        page_detail: extractPageDetail()
      };
    } catch (e) { return { page_url: null, page_title: null, page_heading: null, page_detail: null }; }
  }
  async function fetchConfig(siteId) {
    try {
      const res = await fetch(`${PHASE2_WORKER_URL}config?site_id=${encodeURIComponent(siteId)}`, { method: 'GET', headers: { 'Accept': 'application/json' } });
      if (!res.ok) return null;
      const data = await res.json();
      return { siteId, partnerId: data.partner_id || null, brandName: data.brand_name || 'Vakaviti', workerUrl: PHASE2_WORKER_URL, whatsappUrl: data.whatsapp_url || LEGACY_DEFAULTS.whatsappUrl, whatsappNumber: data.whatsapp_number || '', themeColor: data.theme_color || '#0d4d6e', greetingText: data.greeting_text || null, allowedIntents: data.allowed_intents || null, primaryIntent: data.primary_intent || null, contactEmail: data.contact_email || null, isLegacy: false };
    } catch { return null; }
  }
  function injectStyles() {
    if (document.getElementById('vk-chat-widget-styles')) return;
    const tc = config.themeColor;
    const tcDeep = darken(tc, 0.15);
    const styles = `
      #vk-chat-widget { --vk-ocean: ${tc}; --vk-ocean-deep: ${tcDeep}; --vk-sunset: #d97540; --vk-coral: #c83e3e; --vk-paper: #faf6f0; --vk-paper-card: #fffdf8; --vk-paper-warm: #f5ede0; --vk-ai-tint: #eef4f7; --vk-ink: #1a1a1a; --vk-ink-soft: #4a4a4a; --vk-ink-quiet: #8a8580; --vk-line: #d8d0c2; --vk-line-soft: #ebe5d6; --vk-shadow: 0 8px 32px rgba(8,51,74,0.18), 0 2px 8px rgba(8,51,74,0.08); position: fixed; bottom: 20px; right: 20px; z-index: 999999; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 14px; line-height: 1.5; color: var(--vk-ink); }
      #vk-chat-widget * { box-sizing: border-box; margin: 0; padding: 0; }
      #vk-chat-launcher { width: 60px; height: 60px; border-radius: 50%; background: var(--vk-ocean); color: var(--vk-paper); border: none; cursor: pointer; box-shadow: var(--vk-shadow); display: flex; align-items: center; justify-content: center; transition: transform 0.2s, background 0.2s; position: relative; }
      #vk-chat-launcher:hover { background: var(--vk-ocean-deep); transform: scale(1.05); }
      #vk-chat-launcher.open { background: var(--vk-ink); }
      #vk-chat-launcher svg { width: 28px; height: 28px; }
      #vk-chat-tooltip { position: absolute; right: 70px; top: 50%; transform: translateY(-50%); background: var(--vk-ink); color: var(--vk-paper); padding: 8px 14px; border-radius: 18px 18px 4px 18px; font-size: 13px; white-space: nowrap; box-shadow: var(--vk-shadow); opacity: 0; pointer-events: none; animation: vk-tip-in 0.4s 1.5s forwards, vk-tip-out 0.4s 8s forwards; }
      @keyframes vk-tip-in { to { opacity: 1; } } @keyframes vk-tip-out { to { opacity: 0; } }
      #vk-chat-panel { position: absolute; bottom: 76px; right: 0; width: 380px; max-width: calc(100vw - 32px); height: 580px; max-height: calc(100vh - 120px); background: var(--vk-paper); border-radius: 16px; box-shadow: var(--vk-shadow); display: none; flex-direction: column; overflow: hidden; transform: translateY(20px) scale(0.96); opacity: 0; transition: transform 0.25s cubic-bezier(0.16,1,0.3,1), opacity 0.2s; }
      #vk-chat-panel.open { display: flex; transform: translateY(0) scale(1); opacity: 1; }
      #vk-chat-header { padding: 16px 20px; background: var(--vk-ocean); color: var(--vk-paper); display: flex; align-items: center; gap: 12px; }
      #vk-chat-header-title { font-weight: 600; font-size: 15px; flex: 1; }
      #vk-chat-header-subtitle { font-size: 11px; opacity: 0.85; margin-top: 2px; }
      #vk-chat-close { background: none; border: none; color: var(--vk-paper); cursor: pointer; padding: 4px; opacity: 0.8; display: flex; align-items: center; }
      #vk-chat-close:hover { opacity: 1; }
      #vk-chat-messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; background: var(--vk-paper); }
      .vk-msg { max-width: 85%; padding: 10px 14px; border-radius: 16px; font-size: 14px; line-height: 1.45; word-wrap: break-word; }
      .vk-msg-user { align-self: flex-end; background: var(--vk-ocean); color: var(--vk-paper); border-bottom-right-radius: 4px; }
      .vk-msg-ai { align-self: flex-start; background: var(--vk-ai-tint); color: var(--vk-ink); border-bottom-left-radius: 4px; border-left: 3px solid var(--vk-ocean); padding-left: 12px; }
      .vk-msg-ai a { color: var(--vk-ocean); text-decoration: underline; }
      .vk-msg-ai a.wa-btn { display: inline-flex; align-items: center; gap: 8px; margin-top: 8px; padding: 10px 18px; background: #25D366; color: #fff !important; border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: 500; }
      .vk-msg-ai a.wa-btn:hover { background: #1ebe5d; }
      .vk-loading { align-self: flex-start; background: var(--vk-ai-tint); border-left: 3px solid var(--vk-ocean); padding: 12px 16px; display: flex; gap: 4px; border-radius: 16px; border-bottom-left-radius: 4px; }
      .vk-loading span { width: 6px; height: 6px; border-radius: 50%; background: var(--vk-ocean); opacity: 0.4; animation: vk-pulse 1.2s infinite; }
      .vk-loading span:nth-child(2) { animation-delay: 0.2s; } .vk-loading span:nth-child(3) { animation-delay: 0.4s; }
      @keyframes vk-pulse { 0%,80%,100%{opacity:0.3;transform:scale(0.85)} 40%{opacity:1;transform:scale(1)} }
      #vk-chat-input-area { border-top: 1px solid var(--vk-line-soft); padding: 12px 14px; background: var(--vk-paper-card); display: flex; flex-direction: column; gap: 8px; }
      #vk-chat-input-row { display: flex; gap: 8px; align-items: flex-end; }
      #vk-chat-input { flex: 1; border: 1px solid var(--vk-line); border-radius: 18px; padding: 9px 14px; font-family: inherit; font-size: 14px; resize: none; max-height: 100px; min-height: 38px; background: var(--vk-paper); color: var(--vk-ink); outline: none; }
      #vk-chat-input:focus { border-color: var(--vk-ocean); }
      #vk-chat-send { background: var(--vk-ocean); color: var(--vk-paper); border: none; border-radius: 50%; width: 38px; height: 38px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
      #vk-chat-send:disabled { opacity: 0.4; cursor: not-allowed; }
      #vk-chat-whatsapp { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 7px 12px; background: transparent; border: 1px solid var(--vk-line); border-radius: 16px; color: var(--vk-ink-soft); text-decoration: none; font-size: 12px; font-weight: 500; }
      #vk-chat-whatsapp:hover { background: #25d366; border-color: #25d366; color: white; }
      #vk-powered-by { text-align: center; font-size: 10px; color: var(--vk-ink-quiet); padding: 4px 0 2px; }
      #vk-powered-by a { color: inherit; text-decoration: none; }
    `;
    const el = document.createElement('style');
    el.id = 'vk-chat-widget-styles';
    el.textContent = styles;
    document.head.appendChild(el);
  }
  function injectWidget() {
    if (document.getElementById('vk-chat-widget')) return;
    const widget = document.createElement('div');
    widget.id = 'vk-chat-widget';
    widget.innerHTML = `
      <button id="vk-chat-launcher" aria-label="Open chat">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 6h-2v9H6v2c0 .55.45 1 1 1h11l4 4V7c0-.55-.45-1-1-1zm-4 6V3c0-.55-.45-1-1-1H3c-.55 0-1 .45-1 1v14l4-4h10c.55 0 1-.45 1-1z"/></svg>
        <span id="vk-chat-tooltip">Ask us anything!</span>
      </button>
      <div id="vk-chat-panel" role="dialog">
        <div id="vk-chat-header">
          <div style="flex:1">
            <div id="vk-chat-header-title">${escHtml(config.brandName)}</div>
            <div id="vk-chat-header-subtitle">Quick answers · tours, transfers, anything Fiji</div>
          </div>
          <button id="vk-chat-close" aria-label="Close chat">
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
        <div id="vk-chat-messages" aria-live="polite"></div>
        <div id="vk-chat-input-area">
          <div id="vk-chat-input-row">
            <textarea id="vk-chat-input" placeholder="Type your question..." rows="1"></textarea>
            <button id="vk-chat-send">
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
            </button>
          </div>
          <a href="${escHtml(config.whatsappUrl)}" id="vk-chat-whatsapp" target="_blank" rel="noopener">
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z"/></svg>
            Continue on WhatsApp
          </a>
          <div id="vk-powered-by"><a href="https://vakaviti.ai" target="_blank" rel="noopener">powered by vakaviti.ai</a></div>
        </div>
      </div>
    `;
    document.body.appendChild(widget);
  }
  function escHtml(s) { return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function renderMarkdown(text) {
    let html = escHtml(text);
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    let result = '';
    let remaining = html;
    while (remaining.length > 0) {
      const lb = remaining.indexOf('[');
      if (lb === -1) { result += remaining; break; }
      const rb = remaining.indexOf('](', lb);
      if (rb === -1) { result += remaining; break; }
      const rp = remaining.indexOf(')', rb + 2);
      if (rp === -1) { result += remaining; break; }
      const linkText = remaining.slice(lb + 1, rb);
      const linkUrl  = remaining.slice(rb + 2, rp).trim();
      result += remaining.slice(0, lb);
      if (linkUrl.startsWith('http')) {
        if (linkUrl.includes('wa.me') || linkUrl.includes('whatsapp.com')) {
          result += '<br><a href="' + linkUrl + '" class="wa-btn" target="_blank" rel="noopener">' + linkText + '</a>';
        } else {
          result += '<a href="' + linkUrl + '" target="_blank" rel="noopener">' + linkText + '</a>';
        }
      } else {
        result += remaining.slice(lb, rp + 1);
      }
      remaining = remaining.slice(rp + 1);
    }
    html = result || html;
    html = html.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>');
    if (!html.startsWith('<')) html = '<p>' + html + '</p>';
    return html;
  }
  function darken(hex, amount) {
    const n = parseInt(hex.replace('#',''),16);
    const r = Math.max(0,(n>>16)-Math.round(255*amount));
    const g = Math.max(0,((n>>8)&0xFF)-Math.round(255*amount));
    const b = Math.max(0,(n&0xFF)-Math.round(255*amount));
    return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
  }
  function generateSessionId() { return 'sess_'+Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
  function renderMessage(role, text) {
    const messages = document.getElementById('vk-chat-messages');
    const div = document.createElement('div');
    div.className = 'vk-msg vk-msg-' + role;
    div.innerHTML = role === 'ai' ? renderMarkdown(text) : escHtml(text);
    messages.appendChild(div);
    requestAnimationFrame(() => { messages.scrollTop = messages.scrollHeight; });
    return div;
  }
  function showLoading() {
    const messages = document.getElementById('vk-chat-messages');
    const div = document.createElement('div'); div.className = 'vk-loading'; div.id = 'vk-loading-indicator';
    div.innerHTML = '<span></span><span></span><span></span>';
    messages.appendChild(div);
    requestAnimationFrame(() => { messages.scrollTop = messages.scrollHeight; });
  }
  function hideLoading() { const el = document.getElementById('vk-loading-indicator'); if(el) el.remove(); }
  function setSendDisabled(d) { document.getElementById('vk-chat-send').disabled = d; document.getElementById('vk-chat-input').disabled = d; }
  let leadCaptured = false; let messageCount = 0; let leadFormShown = false;
  function maybeShowLeadForm() {
    if (leadCaptured || leadFormShown || messageCount < 3) return;
    leadFormShown = true;
    const messages = document.getElementById('vk-chat-messages');
    const form = document.createElement('div'); form.id = 'vk-chat-lead-form';
    form.style.cssText = 'margin-top:8px;padding:10px 12px;background:#f5ede0;border-radius:10px;border:1px solid #d8d0c2;';
    form.innerHTML = '<p style="font-size:13px;color:#4a4a4a;margin-bottom:6px;">Want us to follow up? Leave your name and we\'ll reach out.</p><div style="display:flex;gap:6px;margin-bottom:6px;"><input style="flex:1;border:1px solid #d8d0c2;border-radius:8px;padding:7px 10px;font-size:13px;" id="vk-lead-name" placeholder="Your name" /><input style="flex:1;border:1px solid #d8d0c2;border-radius:8px;padding:7px 10px;font-size:13px;" id="vk-lead-email" placeholder="Email or WhatsApp" /></div><div style="display:flex;gap:6px;"><button onclick="window._vkSubmitLead()" style="background:#0d4d6e;color:#fff;border:none;border-radius:8px;padding:7px 14px;font-size:13px;cursor:pointer;">Send to team</button><button onclick="document.getElementById(\'vk-chat-lead-form\').remove()" style="background:none;border:none;color:#8a8580;font-size:12px;cursor:pointer;text-decoration:underline;">Skip</button></div>';
    messages.appendChild(form);
    requestAnimationFrame(() => { messages.scrollTop = messages.scrollHeight; });
  }
  window._vkSubmitLead = function() {
    const name = (document.getElementById('vk-lead-name')?.value||'').trim();
    const email = (document.getElementById('vk-lead-email')?.value||'').trim();
    if (!name && !email) return;
    leadCaptured = true;
    document.getElementById('vk-chat-lead-form')?.remove();
    submitLead({name, contact: email});
    renderMessage('ai', 'Vinaka ' + (name||'there') + '! The ' + config.brandName + ' team will be in touch shortly.');
  };
  async function submitLead(data) {
    try {
      await fetch(config.workerUrl + 'lead', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ site_id: config.siteId, partner_id: config.partnerId, session_id: sessionId, name: data.name, contact: data.contact, conversation_snapshot: conversation.slice(-6) }) });
    } catch {}
  }
  function trackEvent(eventType, extra={}) {
    if (!config.siteId) return;
    try { navigator.sendBeacon(config.workerUrl+'event', JSON.stringify({ site_id: config.siteId, session_id: sessionId, event_type: eventType, intent_detected: extra.intent||null, ts: Date.now() })); } catch {}
  }
  function openPanel() {
    isOpen = true;
    document.getElementById('vk-chat-panel').classList.add('open');
    document.getElementById('vk-chat-launcher').classList.add('open');
    trackEvent('open');
    if (!hasGreeted) {
      hasGreeted = true;
      const greetingText = config.greetingText ||
        'Bula! I\'m Lagi 🌺 — your Fiji insider.\n\n' +
        'I live and breathe Fiji. Every resort deal, island transfer, hidden beach and current special — I know it all, right now.\n\n' +
        'Tell me where you\'re headed and when, and I\'ll give you the honest local\'s plan most travel agents won\'t.';
      renderMessage('ai', greetingText);
      const messages = document.getElementById('vk-chat-messages');
      const btnWrap = document.createElement('div');
      btnWrap.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-top:8px;padding:0 4px;';
      const waBtn = document.createElement('a');
      waBtn.href = config.whatsappUrl + '?text=' + encodeURIComponent('Bula ' + config.brandName + '! I found you on Vakaviti.ai and would love some help planning my Fiji trip.');
      waBtn.target = '_blank';
      waBtn.rel = 'noopener';
      waBtn.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 16px;background:#25D366;color:#fff;border-radius:10px;text-decoration:none;font-size:13px;font-weight:600;';
      waBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z"/></svg> WhatsApp ' + config.brandName;
      btnWrap.appendChild(waBtn);
      const partnerEmail = config.contactEmail || null;
      if (partnerEmail) {
        const emailBtn = document.createElement('a');
        emailBtn.href = 'mailto:' + partnerEmail + '?subject=' + encodeURIComponent('Fiji Trip Enquiry via Vakaviti.ai') + '&body=' + encodeURIComponent('Bula! I found you through Lagi on Vakaviti.ai and would love some information about your services.');
        emailBtn.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 16px;background:#f5ede0;color:#1a1a1a;border:1px solid #d8d0c2;border-radius:10px;text-decoration:none;font-size:13px;font-weight:600;';
        emailBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg> Email ' + config.brandName;
        btnWrap.appendChild(emailBtn);
      }
      const divider = document.createElement('div');
      divider.style.cssText = 'text-align:center;font-size:11px;color:#8a8580;padding:4px 0;';
      divider.textContent = '— or type your question below —';
      btnWrap.appendChild(divider);
      messages.appendChild(btnWrap);
      requestAnimationFrame(() => { messages.scrollTop = messages.scrollHeight; });
    }
    setTimeout(() => document.getElementById('vk-chat-input')?.focus(), 250);
  }
  function closePanel() { isOpen = false; document.getElementById('vk-chat-panel').classList.remove('open'); document.getElementById('vk-chat-launcher').classList.remove('open'); }
  async function sendMessage() {
    if (isLoading) return;
    const input = document.getElementById('vk-chat-input');
    const text = input.value.trim();
    if (!text) return;
    renderMessage('user', text); input.value = ''; input.style.height = 'auto';
    conversation.push({role:'user',content:text}); messageCount++;
    isLoading = true; setSendDisabled(true); showLoading();
    try {
      if (!cachedPageCtx) { cachedPageCtx = getPageContext(); }
      const pageCtx = cachedPageCtx;
      const response = await fetch(config.workerUrl, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ messages: conversation, site_id: config.siteId, partner_id: config.partnerId, session_id: sessionId, page_url: pageCtx.page_url, page_title: pageCtx.page_title, page_heading: pageCtx.page_heading, page_detail: pageCtx.page_detail }) });
      const data = await response.json().catch(()=>null);
      hideLoading();
      if (!response.ok || !data) { renderMessage('ai', 'Sorry, I\'m having trouble right now. Please WhatsApp us at ' + config.whatsappUrl); return; }
      const replyText = data.message || "Sorry, I didn't catch that.";
      renderMessage('ai', replyText);
      if (data.type==='reply') { conversation.push({role:'assistant',content:replyText}); trackEvent('message',{intent:data.intent}); }
      if (data.referral_btn && data.referral_btn.url) {
        const messages = document.getElementById('vk-chat-messages');
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'margin-top:4px;padding-left:15px;';
        const a = document.createElement('a');
        a.href = data.referral_btn.url;
        a.target = '_blank'; a.rel = 'noopener';
        a.className = 'vk-msg-ai';
        a.style.cssText = 'display:inline-flex;align-items:center;gap:8px;margin-top:4px;padding:10px 18px;background:#25D366;color:#fff;border-radius:8px;text-decoration:none;font-size:13px;font-weight:500;border:none;';
        a.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z"/></svg> ' + (data.referral_btn.label || 'Contact on WhatsApp');
        wrapper.appendChild(a);
        messages.appendChild(wrapper);
        requestAnimationFrame(() => { messages.scrollTop = messages.scrollHeight; });
      }
      maybeShowLeadForm();
    } catch {
      hideLoading(); renderMessage('ai', 'Connection issue please try again, or WhatsApp us at ' + config.whatsappUrl);
    } finally { isLoading = false; setSendDisabled(false); document.getElementById('vk-chat-input')?.focus(); }
  }
  function autoResize() { const el = document.getElementById('vk-chat-input'); el.style.height='auto'; el.style.height=Math.min(el.scrollHeight,100)+'px'; }
  function wireEvents() {
    document.getElementById('vk-chat-launcher').addEventListener('click', ()=>{ isOpen ? closePanel() : openPanel(); });
    document.getElementById('vk-chat-close').addEventListener('click', closePanel);
    document.getElementById('vk-chat-send').addEventListener('click', sendMessage);
    document.getElementById('vk-chat-input').addEventListener('keydown', e=>{ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();} });
    document.getElementById('vk-chat-input').addEventListener('input', autoResize);
  }
  function init() { if(document.getElementById('vk-chat-widget')) return; boot(); }
  if (document.readyState==='loading') { document.addEventListener('DOMContentLoaded',init); } else { init(); }
})();
