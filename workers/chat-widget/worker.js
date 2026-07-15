/**
 * Vakaviti — Lagi v2 Chat Worker (v57)
 *
 * Changes in v57:
 *  - FIX P1: Remove break-on-success in notifyPartner — all channels now fire
 *  - Email fires for score >= 40. WhatsApp fires additionally for score >= 70.
 *  - channel_used now records all channels fired e.g. "email+whatsapp"
 *  - Changes in v56:
 *
 * Changes in v56:
 *  - FIX P1: D1-driven partner routing replaces hardcoded if/else (all 29 partners)
 *  - FIX P1: WhatsApp notify live for score >= 70 via Meta Cloud API
 *  - FIX P2: Heat scoring expanded with 25 Fiji-specific signals
 *  - FIX P2: Contact ask rotates 4 natural phrases (never feels scripted)
 *  - FIX P3: Notify thresholds — email >= 40, WhatsApp >= 70, silence < 40
 *  - FIX P3: Cross-referral duplicate guard added
 *  - Changes in v54:
 *
 * Changes in v54:
 *  - NEW: getPartnerReviewStats() — queries partner_review_stats D1 view
 *  - NEW: formatReviewStats() — formats live metrics for system prompt injection
 *  - NEW: Review stats fetched in parallel with RAG via Promise.all (zero latency cost)
 *  - NEW: Live avg_rating, total_reviews, vakavanua_certified injected into:
 *         → buildPhase2SystemPrompt (partner sites)
 *         → buildPublicSystemPrompt (lagi_public — public site routing)
 *  - Lagi can now quote real-time verified traveller proof mid-conversation
 *  - Fails gracefully: null stats = prompt unchanged, never blocks chat
 *
 * Changes in v53b:
 *  - FIX: ANTHROPIC_ERROR logging added for HTTP 500 diagnosis
 *
 * Changes in v52:
 *  - FIX: RETRIEVED KNOWLEDGE section now marked as AUTHORITATIVE
 *  - FIX: Fallback changed from "general Fiji expertise" to clarifying question
 */

const WIDGET_V2_JS = `
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
                detail += 'Q: ' + question + '\\nA: ' + answer.replace(/<[^>]+>/g,' ').trim() + '\\n\\n';
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
              const txt = (sib.textContent || '').trim().replace(/\\s+/g, ' ');
              if (txt) { detail += txt.slice(0, 400) + '\\n\\n'; grabbed++; }
              sib = sib.nextElementSibling;
            }
          }
        }
      }
      const metaDesc = document.querySelector('meta[name="description"]')?.content ||
                        document.querySelector('meta[property="og:description"]')?.content || '';
      if (metaDesc && detail.length < 1500) detail = metaDesc.trim().slice(0,300) + '\\n\\n' + detail;
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
      const res = await fetch(\`\${PHASE2_WORKER_URL}config?site_id=\${encodeURIComponent(siteId)}\`, { method: 'GET', headers: { 'Accept': 'application/json' } });
      if (!res.ok) return null;
      const data = await res.json();
      return { siteId, partnerId: data.partner_id || null, brandName: data.brand_name || 'Vakaviti', workerUrl: PHASE2_WORKER_URL, whatsappUrl: data.whatsapp_url || LEGACY_DEFAULTS.whatsappUrl, whatsappNumber: data.whatsapp_number || '', themeColor: data.theme_color || '#0d4d6e', greetingText: data.greeting_text || null, allowedIntents: data.allowed_intents || null, primaryIntent: data.primary_intent || null, contactEmail: data.contact_email || null, isLegacy: false };
    } catch { return null; }
  }
  function injectStyles() {
    if (document.getElementById('vk-chat-widget-styles')) return;
    const tc = config.themeColor;
    const tcDeep = darken(tc, 0.15);
    const styles = \`
      #vk-chat-widget { --vk-ocean: \${tc}; --vk-ocean-deep: \${tcDeep}; --vk-sunset: #d97540; --vk-coral: #c83e3e; --vk-paper: #faf6f0; --vk-paper-card: #fffdf8; --vk-paper-warm: #f5ede0; --vk-ai-tint: #eef4f7; --vk-ink: #1a1a1a; --vk-ink-soft: #4a4a4a; --vk-ink-quiet: #8a8580; --vk-line: #d8d0c2; --vk-line-soft: #ebe5d6; --vk-shadow: 0 8px 32px rgba(8,51,74,0.18), 0 2px 8px rgba(8,51,74,0.08); position: fixed; bottom: 20px; right: 20px; z-index: 999999; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 14px; line-height: 1.5; color: var(--vk-ink); }
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
    \`;
    const el = document.createElement('style');
    el.id = 'vk-chat-widget-styles';
    el.textContent = styles;
    document.head.appendChild(el);
  }
  function injectWidget() {
    if (document.getElementById('vk-chat-widget')) return;
    const widget = document.createElement('div');
    widget.id = 'vk-chat-widget';
    widget.innerHTML = \`
      <button id="vk-chat-launcher" aria-label="Open chat">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 6h-2v9H6v2c0 .55.45 1 1 1h11l4 4V7c0-.55-.45-1-1-1zm-4 6V3c0-.55-.45-1-1-1H3c-.55 0-1 .45-1 1v14l4-4h10c.55 0 1-.45 1-1z"/></svg>
        <span id="vk-chat-tooltip">Ask us anything!</span>
      </button>
      <div id="vk-chat-panel" role="dialog">
        <div id="vk-chat-header">
          <div style="flex:1">
            <div id="vk-chat-header-title">\${escHtml(config.brandName)}</div>
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
          <a href="\${escHtml(config.whatsappUrl)}" id="vk-chat-whatsapp" target="_blank" rel="noopener">
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z"/></svg>
            Continue on WhatsApp
          </a>
          <div id="vk-powered-by"><a href="https://vakaviti.ai" target="_blank" rel="noopener">powered by vakaviti.ai</a></div>
        </div>
      </div>
    \`;
    document.body.appendChild(widget);
  }
  function escHtml(s) { return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function renderMarkdown(text) {
    let html = escHtml(text);
    html = html.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
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
    html = html.replace(/\\n\\n/g, '</p><p>').replace(/\\n/g, '<br>');
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
    form.innerHTML = '<p style="font-size:13px;color:#4a4a4a;margin-bottom:6px;">Want us to follow up? Leave your name and we\\'ll reach out.</p><div style="display:flex;gap:6px;margin-bottom:6px;"><input style="flex:1;border:1px solid #d8d0c2;border-radius:8px;padding:7px 10px;font-size:13px;" id="vk-lead-name" placeholder="Your name" /><input style="flex:1;border:1px solid #d8d0c2;border-radius:8px;padding:7px 10px;font-size:13px;" id="vk-lead-email" placeholder="Email or WhatsApp" /></div><div style="display:flex;gap:6px;"><button onclick="window._vkSubmitLead()" style="background:#0d4d6e;color:#fff;border:none;border-radius:8px;padding:7px 14px;font-size:13px;cursor:pointer;">Send to team</button><button onclick="document.getElementById(\\'vk-chat-lead-form\\').remove()" style="background:none;border:none;color:#8a8580;font-size:12px;cursor:pointer;text-decoration:underline;">Skip</button></div>';
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
        'Bula! I\\'m Lagi \uD83C\uDF3A \u2014 your Fiji insider.\\n\\n' +
        'I live and breathe Fiji. Every resort deal, island transfer, hidden beach and current special \u2014 I know it all, right now.\\n\\n' +
        'Tell me where you\\'re headed and when, and I\\'ll give you the honest local\\'s plan most travel agents won\\'t.';
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
      divider.textContent = '\u2014 or type your question below \u2014';
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
      if (!response.ok || !data) { renderMessage('ai', 'Sorry, I\\'m having trouble right now. Please WhatsApp us at ' + config.whatsappUrl); return; }
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
`;

const DAILY_TOKEN_BUDGET = 16_000_000;

const OPEN_PATHS = [
  '/knowledge-gaps',
  '/knowledge-add',
  '/knowledge-list',
  '/leads-query',
  '/deals-query',
  '/knowledge-extract',
  '/knowledge-extract/answer-gap',
];

const ALLOWED_ORIGINS = [
  'https://nadiairporttransfers.com',
  'https://www.nadiairporttransfers.com',
  'https://nadiairporttransfers.pages.dev',
  'https://vakavitifijiandictionary.pages.dev',
  'https://vosavakaviti.com',
  'https://www.vosavakaviti.com',
  'https://tourfiji.tours',
  'https://www.tourfiji.tours',
  'https://vakaviti.ai',
  'https://www.vakaviti.ai',
  'https://widget.vakaviti.ai',
  'https://lagi.vakaviti.ai',
  'https://dashboard.vakaviti.ai',
  'https://join.vakaviti.ai',
  'http://localhost:8000',
  'https://vakaviti-dashboard.pages.dev',
  'https://vakaviti-dashboard-v2.pages.dev',
  'https://vakaviti-join-page.pages.dev',
  'https://vakaviti-lagi-public.pages.dev',
  'https://vakaviti-bluelagoon.pages.dev',
  'https://vakaviti-palms-denarau.pages.dev',
  'https://vakaviti-tourfiji.pages.dev',
  'https://vakaviti-nadi-transfers.pages.dev',
  'https://vakaviti-sofitel.pages.dev',
  'https://fijitourtransfers.com',
  'https://www.fijitourtransfers.com',
  'https://tourfijitours.com',
  'https://www.tourfijitours.com',
  'https://natadolabayhorseriding.com',
  'https://www.natadolabayhorseriding.com',
  'https://coralcoasthorseriding.com',
  'https://www.coralcoasthorseriding.com',
  'https://bulaadventure.com',
  'https://www.bulaadventure.com',
  'https://fijitourpackages.com',
  'https://www.fijitourpackages.com',
  'https://bulahappiness.com',
  'https://www.bulahappiness.com',
  'https://fijibula.com',
  'https://www.fijibula.com',
  'https://namosiadventuretoursfiji.com',
  'https://www.namosiadventuretoursfiji.com',
  'https://wananavudeals.com',
  'https://www.wananavudeals.com',
  'https://guidefiji.com',
  'https://www.guidefiji.com',
  'https://fijithingstodo.com',
  'https://www.fijithingstodo.com',
  'https://bestfijitours.com',
  'https://www.bestfijitours.com',
  'https://nadiculturealnighttour.com',
  'https://www.nadiculturealnighttour.com',
  'https://claude.ai',
  'https://lagi-capability-test.pages.dev',
  'https://lagi-test-v2.pages.dev',
];

const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5';

const JSON_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env, ctx) {
    try {
    const origin = request.headers.get('Origin') || '';
    const url    = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: JSON_CORS });
    }

    if (OPEN_PATHS.includes(url.pathname)) {
      if (request.method === 'GET'  && url.pathname === '/knowledge-gaps')              return handleKnowledgeGaps(request, env, JSON_CORS);
      if (request.method === 'POST' && url.pathname === '/knowledge-add')               return handleKnowledgeAdd(request, env, JSON_CORS);
      if (request.method === 'GET'  && url.pathname === '/knowledge-list')              return handleKnowledgeList(request, env, JSON_CORS);
      if (request.method === 'GET'  && url.pathname === '/leads-query')                 return handleLeadsQuery(request, env, JSON_CORS);
      if (request.method === 'GET'  && url.pathname === '/deals-query')                 return handleDealsQuery(request, env, JSON_CORS);
      if (request.method === 'GET'  && url.pathname === '/knowledge-extract')           return handleKnowledgeExtract(request, env, JSON_CORS);
      if (request.method === 'POST' && url.pathname === '/knowledge-extract')           return handleKnowledgeIngest(request, env, JSON_CORS);
      if (request.method === 'POST' && url.pathname === '/knowledge-extract/answer-gap') return handleAnswerGap(request, env, JSON_CORS);
    }

    const isAllowedOrigin =
      ALLOWED_ORIGINS.some(o => origin === o) ||
      origin.endsWith('.nadiairporttransfers.pages.dev') ||
      origin === 'https://nadiculturealnighttour.com' ||
      origin === 'https://www.nadiculturealnighttour.com' ||
      origin.endsWith('.vakavitifijiandictionary.pages.dev') ||
      origin.endsWith('.pages.dev') ||
      origin.endsWith('.vakaviti.ai');

    const cors = {
      'Access-Control-Allow-Origin':  isAllowedOrigin ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age':       '86400',
      'Vary':                         'Origin',
    };

    if (request.method === 'GET' && url.pathname === '/v2.js') {
      return new Response(WIDGET_V2_JS, {
        headers: {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    if (request.method === 'GET'  && url.pathname === '/config')             return handleConfig(request, env, cors);
    if (request.method === 'POST' && url.pathname === '/lead')               return handleLead(request, env, cors);
    if (request.method === 'POST' && url.pathname === '/event')              return handleEvent(request, env, cors);
    if (request.method === 'POST' && url.pathname === '/onboard')            return handleOnboard(request, env, cors);
    if (request.method === 'POST' && url.pathname === '/dashboard/login')    return handleDashboardLogin(request, env, cors);
    if (request.method === 'POST' && url.pathname === '/dashboard/verify')   return handleDashboardVerify(request, env, cors);
    if (request.method === 'GET'  && url.pathname === '/dashboard/leads')    return handleDashboardLeads(request, env, cors);
    if (request.method === 'GET'  && url.pathname === '/dashboard/stats')    return handleDashboardStats(request, env, cors);
    if (request.method === 'POST' && url.pathname === '/dashboard/settings') return handleDashboardSettings(request, env, cors);

    if (request.method === 'POST' && (url.pathname === '/' || url.pathname === '')) {
      return handleChat(request, env, cors, isAllowedOrigin, origin, ctx);
    }

    return json({ error: 'Not found.' }, 404, cors);
    } catch(globalErr) {
      console.error('GLOBAL ERROR:', globalErr.message, globalErr.stack?.slice(0,300));
      return new Response(JSON.stringify({ error: 'Internal error', detail: globalErr.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
  },
};

// ═══════════════════════════════════════════════════════════════
// ▼▼▼ v54 NEW: REVIEW METRICS ENGINE ▼▼▼
// ═══════════════════════════════════════════════════════════════

/**
 * Queries the partner_review_stats D1 view for a given partner.
 * Runs in parallel with RAG via Promise.all — zero added latency.
 * Returns null gracefully on any failure — never blocks chat.
 */
async function getPartnerReviewStats(env, partnerId) {
  if (!env.DB || !partnerId) return null;
  try {
    // Run both queries in parallel
    const [statsRow, certRow] = await Promise.all([
      env.DB.prepare(`
        SELECT partner_id, total_reviews, avg_rating, avg_cultural_score,
               five_star_count, positive_count
        FROM partner_review_stats
        WHERE partner_id = ?
        LIMIT 1
      `).bind(partnerId).first(),
      env.DB.prepare(`
        SELECT COUNT(*) as count FROM reviews
        WHERE partner_id = ? AND status = 'published' AND cultural_respect_score = 5
      `).bind(partnerId).first(),
    ]);

    if (!statsRow || !statsRow.total_reviews) return null;

    return {
      total_reviews:       statsRow.total_reviews,
      avg_rating:          statsRow.avg_rating,
      avg_cultural:        statsRow.avg_cultural_score,
      five_star_count:     statsRow.five_star_count,
      positive_count:      statsRow.positive_count,
      vakavanua_certified: certRow?.count || 0,
    };
  } catch (e) {
    console.error('Review stats (non-fatal):', e.message);
    return null;
  }
}

/**
 * Formats review stats for injection into the system prompt.
 * Returns empty string if no stats available.
 */
function formatReviewStats(stats, partnerName) {
  if (!stats || !stats.total_reviews) return '';
  const name    = partnerName || 'this operator';
  const stars   = '★'.repeat(Math.round(stats.avg_rating)) + '☆'.repeat(5 - Math.round(stats.avg_rating));
  const pct5    = Math.round((stats.five_star_count / stats.total_reviews) * 100);
  const certLine = stats.vakavanua_certified > 0
    ? `\n- Vakavanua Certified reviews: ${stats.vakavanua_certified} of ${stats.total_reviews} travellers awarded perfect 5/5 cultural respect`
    : '';

  return `
// LIVE VAKAVITI REVIEW METRICS — verified traveller data
Total published reviews: ${stats.total_reviews}
Average rating: ${stats.avg_rating}/5 ${stars}
5-star reviews: ${stats.five_star_count} (${pct5}% of total)
Positive reviews (4★+): ${stats.positive_count}${certLine}

INSTRUCTION: When the visitor asks about quality, other travellers' experiences, or why they should choose ${name} — quote these real numbers naturally as social proof. Never fabricate. Example: "${name} holds a ${stats.avg_rating}-star average across ${stats.total_reviews} verified Vakaviti reviews${stats.vakavanua_certified > 0 ? ', with ' + stats.vakavanua_certified + ' travellers awarding them Vakavanua Certified status for cultural excellence' : ''}."`;
}

// ▲▲▲ END v54 REVIEW METRICS ENGINE ▲▲▲

// ═══════════════════════════════════════════════════════════════
// SEARCH KNOWLEDGE — UNIFIED RAG
// ═══════════════════════════════════════════════════════════════

async function searchKnowledge(env, userText, intent, partnerId) {
  if (!env.AI || !env.VECTORIZE) return { dictWords: [], kbChunks: [], partnerKb: [] };
  try {
    const embedResult = await env.AI.run(EMBED_MODEL, { text: userText });
    const queryVector = embedResult?.data?.[0];
    if (!queryVector) return { dictWords: [], kbChunks: [], partnerKb: [] };

    const topK = !partnerId ? 12 : 16;
    const results = await env.VECTORIZE.query(queryVector, { topK, returnMetadata: 'all' });
    if (!results?.matches?.length) return { dictWords: [], kbChunks: [], partnerKb: [] };

    const dictWords = []; const kbChunks = []; const partnerKb = [];

    for (const match of results.matches) {
      const meta   = match.metadata || {};
      const source = meta.source || '';
      const score  = match.score  || 0;
      if (score < 0.65) continue;

      if (source === 'vakaviti_dictionary') {
        dictWords.push({ word: meta.word||'', phonetic: meta.phonetic||'', category: meta.category||'', englishDef: meta.englishDef||'', tags: meta.tags||'', score });
      } else if (source === 'partner_kb' && (!partnerId || meta.partner_id === partnerId)) {
        partnerKb.push({ title: meta.question||meta.title||meta.word||'Partner info', content: meta.answer||meta.content||meta.englishDef||'', score });
      } else if (source === 'general_kb') {
        kbChunks.push({ title: meta.title||'Fiji info', content: meta.content||'', score });
      } else {
        if (env.DB) {
          try {
            const row = await env.DB.prepare(`SELECT title, content_preview FROM kb_chunks WHERE chunk_id = ? AND verified = 1`).bind(match.id).first();
            if (row) { kbChunks.push({ title: row.title, content: row.content_preview||'', score }); continue; }
          } catch {}
        }
        if (meta.englishDef || meta.content) {
          kbChunks.push({ title: meta.title||meta.word||'Fiji info', content: meta.englishDef||meta.content||'', score });
        }
      }
    }
    return { dictWords, kbChunks, partnerKb };
  } catch (err) {
    console.error('Vectorize search error:', err);
    return { dictWords: [], kbChunks: [], partnerKb: [] };
  }
}

// ═══════════════════════════════════════════════════════════════
// SECURITY LAYER
// ═══════════════════════════════════════════════════════════════

async function checkRateLimit(env, ip) {
  if (!env.CHAT_USAGE) return { allowed: true };
  try {
    const key = `rl:${ip}:${new Date().toISOString().slice(0, 13)}`;
    const current = await env.CHAT_USAGE.get(key);
    const count = current ? parseInt(current, 10) : 0;
    if (count >= 200) return { allowed: false, count };
    await env.CHAT_USAGE.put(key, String(count + 1), { expirationTtl: 3600 });
    return { allowed: true, count: count + 1 };
  } catch (e) {
    console.error('Rate limit check error:', e);
    return { allowed: true };
  }
}

function detectPromptInjection(text) {
  if (!text || text.length === 0) return false;
  const lower = text.toLowerCase();
  const patterns = [
    'ignore previous instructions','ignore all instructions','disregard your',
    'forget your instructions','you are now','act as if you','pretend you are',
    'your new instructions','system prompt','reveal your prompt','show me your prompt',
    'what are your instructions','override your','jailbreak','dan mode','developer mode',
  ];
  return patterns.some(p => lower.includes(p));
}

function sanitiseInput(text, maxLength = 2000) {
  if (!text) return '';
  let clean = String(text).slice(0, maxLength);
  clean = clean.split('').filter(c => c.charCodeAt(0) !== 0).join('');
  clean = clean.replace(/[ \t]{10,}/g, ' ');
  return clean;
}

// ═══════════════════════════════════════════════════════════════
// POWER LEAD ENGINE
// ═══════════════════════════════════════════════════════════════

function scoreConversationHeat(messages) {
  if (!messages || messages.length === 0) return { score: 0, tier: 1, signals: [] };
  const fullText = messages.map(m => (m.content || '')).join(' ').toLowerCase();
  let score = 0; let tier = 1; const signals = [];

  // Tier 4 — Urgent / ready now
  if (/leaving in|arriving (next|this)|next week|need to book today|last minute|urgent|asap|flying (in|out) (next|this)|arriving soon|flight [a-z]{2}\d{2,4}|arrives? at \d|\d{1,2}(am|pm)|landing (tomorrow|tonight|this week)/.test(fullText)) { score += 40; tier = 4; signals.push('urgent_timing'); }
  // Tier 3 — Explicit booking intent
  if (/sounds perfect|keen to book|let'?s do it|sign us up|how do (we|i) book|we want this|we'?ve decided|ready to book|we'?ll take it|book (it|that|this)|confirm (it|that|the booking)|where do i pay|how do i pay|send me (a |the )?booking|lock (it|that|this) in/.test(fullText)) { score += 30; tier = Math.max(tier, 3); signals.push('booking_intent'); }
  // Tier 2 — Planning stage
  if (/we'?re planning|looking at|considering|what would you recommend|we'?re thinking|planning (a|our|the)|would it be better|which is better|what do you suggest|help me choose/.test(fullText)) { score += 15; tier = Math.max(tier, 2); signals.push('planning'); }
  // Dates mentioned
  if (/january|february|march|april|may|june|july|august|september|october|november|december|\d+ nights?|\d+ days?|next month|school holidays|easter|christmas|new year/.test(fullText)) { score += 15; signals.push('dates_mentioned'); }
  // Group defined
  if (/family|couple|group|honeymoon|\d+ (people|pax|person|adults?|kids?|children|passengers?)|just the two|solo travell|travelling alone/.test(fullText)) { score += 10; signals.push('group_defined'); }
  // Budget signal
  if (/budget|spend|afford|how much|cost|\$[\d,]+|au\$|nzd|fj\$|price range|what.?s the rate/.test(fullText)) { score += 10; signals.push('budget_signal'); }
  // Product interest — Fiji specific
  if (/snorkel|dive|atv|village tour|sunset cruise|airport transfer|room|apartment|package|deal|horse riding|waterfall|cave tour|zip line|cultural night|island hopping|reef cruise|fishing charter|mud pool|hot spring|whale|mamanuca|yasawa|coral coast|natadola|denarau|port denarau|blue lagoon|savusavu|taveuni|nadi|suva|sigatoka|pacific harbour|naviti|shangri.la|sheraton|westin|hilton|sofitel|marriott|outrigger|intercontinental|warwick|pearl|volivoli/.test(fullText)) { score += 10; signals.push('product_interest'); }
  // Fiji destination named — high intent signal
  if (/\byasawa\b|\bmamanuca\b|\bdenarau\b|\bnacula\b|\bwaya\b|\bnaviti\b|\btavewa\b|\bbeachcomber\b|\bsouth sea island\b|\bcloudbreak\b|\bnatadola\b|\bkorolevu\b|\bpacific harbour\b|\bsavusavu\b|\btaveuni\b|\blevuka\b/.test(fullText)) { score += 10; signals.push('fiji_destination'); }
  // Contact shared
  if (/\+\d{7,}|\d{4}\s\d{3}\s\d{3}|@gmail|@yahoo|@hotmail|@outlook|@icloud|@me\.com/.test(fullText)) { score += 20; tier = Math.max(tier, 3); signals.push('contact_shared'); }

  return { score: Math.min(score, 100), tier, signals };
}

function getTop3Offers(deals, intent, heatData) {
  if (!deals || deals.length === 0) return [];
  const scored = deals.map(d => {
    let relevance = 0;
    if (d.category === intent) relevance += 3;
    if (heatData.signals.includes('product_interest') && d.category === intent) relevance += 2;
    if ((intent === 'dive' || intent === 'accommodation') && d.partner_name.includes('Blue Lagoon')) relevance += 3;
    if (d.category === 'transfers') relevance += 1;
    return { ...d, relevance };
  });
  return scored.sort((a, b) => b.relevance - a.relevance).slice(0, 3);
}

function formatTop3ForPrompt(top3) {
  if (!top3 || top3.length === 0) return '';
  return '\nTOP 3 POWER OFFERS FOR THIS VISITOR:\n' +
    top3.map((d, i) => `${i+1}. ${d.partner_name}: **${d.title}** — ${d.price_from} ${d.currency}. ${d.description.slice(0, 120)}...`).join('\n') +
    '\n\nINSTRUCTION: Present these 3 offers naturally before asking for contact. Ask which appeals most. Then capture WhatsApp OR email.';
}

// ═══════════════════════════════════════════════════════════════
// DEALS ENGINE
// ═══════════════════════════════════════════════════════════════

async function getLiveDeals(env, intent, partnerId, isPublic) {
  if (!env.DB) return [];
  try {
    let query, params;
    if (isPublic) {
      query = `SELECT partner_name, title, description, price_from, currency, contact_phone, category FROM deals WHERE active = 1 ORDER BY created_at DESC LIMIT 6`;
      params = [];
    } else {
      query = `SELECT partner_name, title, description, price_from, currency, contact_phone, category FROM deals WHERE active = 1 AND (partner_id = ? OR partner_id IS NULL) ORDER BY CASE WHEN partner_id = ? THEN 0 ELSE 1 END, created_at DESC LIMIT 3`;
      params = [partnerId || 'none', partnerId || 'none'];
    }
    const result = params.length > 0
      ? await env.DB.prepare(query).bind(...params).all()
      : await env.DB.prepare(query).all();
    return result.results || [];
  } catch (e) {
    console.error('Deals query error:', e);
    return [];
  }
}

function formatDealsForPrompt(deals, isPublic) {
  if (!deals || deals.length === 0) return '';
  return '\nLIVE DEALS — PROMOTE NATURALLY WHEN RELEVANT:\n' +
    deals.map(d => {
      const contactNote = isPublic
        ? ' (WhatsApp contact button provided automatically)'
        : (d.contact_phone ? ' Contact: ' + d.contact_phone : '');
      return `• ${d.partner_name}: ${d.title} — ${d.price_from} ${d.currency}. ${d.description}${contactNote}`;
    }).join('\n');
}

// ═══════════════════════════════════════════════════════════════
// CHAT HANDLER — v54: review stats fetched in parallel with RAG
// ═══════════════════════════════════════════════════════════════

async function handleChat(request, env, cors, isAllowedOrigin, origin, ctx) {
  if (!isAllowedOrigin) return json({ error: 'Unauthorised.' }, 403, cors);
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'Chat temporarily unavailable.' }, 503, cors);

  const clientIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  const rateCheck = await checkRateLimit(env, clientIP);
  if (!rateCheck.allowed) {
    return json({ type: 'capacity', message: "Bula! You've been very busy with questions today. Please WhatsApp us directly to continue planning your Fiji trip.", whatsappUrl: 'https://wa.me/61478886145' }, 429, cors);
  }

  const today = new Date().toISOString().slice(0, 10);
  const usageKey = `usage:${today}`;
  let usedToday = 0;
  if (env.CHAT_USAGE) {
    try { const stored = await env.CHAT_USAGE.get(usageKey); usedToday = stored ? parseInt(stored, 10) : 0; } catch (e) { console.error('KV read failed:', e); }
  }
  if (usedToday >= DAILY_TOKEN_BUDGET) {
    return json({ type: 'capacity', message: "Bula! We're getting lots of questions right now. Please WhatsApp us. Vinaka!", whatsappUrl: 'https://wa.me/61478886145' }, 200, cors);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request format.' }, 400, cors); }
  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) return json({ error: 'Missing messages.' }, 400, cors);
  if (body.messages.length > 30) return json({ type: 'capacity', message: "Our team can help directly on WhatsApp. Vinaka!", whatsappUrl: 'https://wa.me/61478886145' }, 200, cors);

  const siteId    = body.site_id    || null;
  const partnerId = body.partner_id || null;
  const sessionId = body.session_id || null;
  const isPublic  = !siteId || siteId === 'lagi_public';

  // ── P1 fix: page/tour awareness — ground answers to the exact page the visitor is on ──
  const pageTitle   = typeof body.page_title   === 'string' ? sanitiseInput(body.page_title, 200)   : null;
  const pageHeading = typeof body.page_heading === 'string' ? sanitiseInput(body.page_heading, 200) : null;
  const pageUrl     = typeof body.page_url     === 'string' ? body.page_url.slice(0, 300)            : null;
  const pageDetail  = typeof body.page_detail  === 'string' ? sanitiseInput(body.page_detail, 2000)  : null;
  const pageContextBlock = buildPageContextBlock(pageTitle, pageHeading, pageUrl, pageDetail);

  const latestUserMsg = [...body.messages].reverse().find(m => m.role === 'user');
  const rawUserText   = latestUserMsg?.content || '';
  const userText      = sanitiseInput(rawUserText, 2000);

  if (detectPromptInjection(userText)) {
    console.warn('Prompt injection attempt from IP:', clientIP, 'Text:', userText.slice(0, 100));
    if (env.DB) {
      try {
        await env.DB.prepare(`INSERT INTO conversation_events (id,site_id,session_id,event_type,intent_detected,created_at) VALUES (?,?,?,'security_flag','injection',unixepoch())`)
          .bind(`sec_${Date.now()}_${Math.random().toString(36).slice(2,5)}`, siteId || 'lagi_public', sessionId || 'unknown').run();
      } catch(e) {}
    }
    return json({ type: 'reply', message: "Bula! I'm here to help you plan your Fiji holiday. What would you like to know about Fiji?", intent: 'general', referral_btn: null }, 200, cors);
  }

  const fullConvForIntent = (body.messages || []).filter(m => m.role === 'user').map(m => m.content || '').join(' ');
  const intent   = detectIntent(fullConvForIntent);
  const currency = detectCurrency(fullConvForIntent);
  const groupSz  = extractGroupSize(fullConvForIntent);

  // ── v54: Resolve effective partnerId for review stats lookup ─────────────
  // For public site, try to detect which partner the user is asking about
  let reviewStatsPartnerId = partnerId;
  if (isPublic && !reviewStatsPartnerId) {
    const convLower = fullConvForIntent.toLowerCase();
    if (/blue lagoon|yasawa|nacula/.test(convLower))       reviewStatsPartnerId = 'op_bluelagoon_001';
    else if (/palms|denarau/.test(convLower))              reviewStatsPartnerId = 'op_palms_001';
    else if (/nadi airport|airport transfer/.test(convLower)) reviewStatsPartnerId = 'op_nadi_001';
    else if (/tour fiji|atv|village tour/.test(convLower)) reviewStatsPartnerId = 'op_tourfiji_001';
    else if (/smugglers|sunset cruise/.test(convLower))    reviewStatsPartnerId = 'op_smugglers_001';
  }

  // ── v54: Parallel fetch — RAG + partner info + review stats ─────────────
  // All three run simultaneously. Total latency = slowest of the three.
  // Review stats D1 query: ~10ms edge. RAG Vectorize: ~50-150ms. Net cost: ~0ms.
  let ragResults  = { dictWords: [], kbChunks: [], partnerKb: [] };
  let partnerInfo = null;
  let liveDeals   = [];
  let reviewStats = null;

  const parallelTasks = [];

  if (!isPublic && siteId && env.DB) {
    parallelTasks.push(
      lookupPartner(env, partnerId, intent, siteId)
        .then(p => { partnerInfo = p; })
        .catch(err => console.error('Partner lookup error:', err))
    );
  }

  if (env.VECTORIZE && env.AI) {
    parallelTasks.push(
      searchKnowledge(env, userText, intent, isPublic ? null : partnerId)
        .then(r => { ragResults = r; })
        .catch(err => console.error('RAG search error:', err))
    );
  }

  if (env.DB) {
    parallelTasks.push(
      getLiveDeals(env, intent, partnerId, isPublic)
        .then(d => { liveDeals = d; })
        .catch(e => console.error('Deals fetch error:', e))
    );
  }

  // v54: Review stats — fetch in parallel, never blocks
  if (reviewStatsPartnerId) {
    parallelTasks.push(
      getPartnerReviewStats(env, reviewStatsPartnerId)
        .then(s => { reviewStats = s; })
        .catch(e => console.error('Review stats error (non-fatal):', e))
    );
  }

  // Wait for all parallel tasks to complete
  await Promise.all(parallelTasks);

  const heatData = scoreConversationHeat(body.messages);
  const isHot    = heatData.score >= 60;
  const top3     = isHot ? getTop3Offers(liveDeals, intent, heatData) : [];

  let referralPartner = null;
  if (env.DB && siteId && !isPublic && intent) {
    try {
      referralPartner = await env.DB.prepare(`
        SELECT r.referred_partner_id, p.name, p.whatsapp_number, p.category
        FROM partner_referrals r
        JOIN partners p ON p.id = r.referred_partner_id
        WHERE r.site_id = ? AND r.intent_category = ? AND r.active = 1
        LIMIT 1
      `).bind(siteId, intent).first();
    } catch (e) { console.error('Referral lookup error:', e); }
  }

  // ── v54: Build system prompt with review stats injected ─────────────────
  let systemPrompt;
  if (isPublic) {
    systemPrompt = buildPublicSystemPrompt(ragResults, intent, liveDeals, heatData, top3, currency, groupSz, reviewStats, reviewStatsPartnerId, pageContextBlock);
  } else if (siteId && partnerInfo) {
    systemPrompt = buildPhase2SystemPrompt(partnerInfo, ragResults, intent, referralPartner, liveDeals, heatData, reviewStats, pageContextBlock);
  } else {
    systemPrompt = SYSTEM_PROMPT_LEGACY;
  }

  let anthropicResponse;
  try {
    const anthropicController = new AbortController();
    const anthropicTimeout = setTimeout(() => anthropicController.abort(), 25000);
    anthropicResponse = await fetch('https://gateway.ai.cloudflare.com/v1/595101df2c562b3c65595420d43f9fe1/vakaviti-ai-gateway/anthropic/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 800, system: systemPrompt, messages: body.messages }),
      signal: anthropicController.signal,
    });
    clearTimeout(anthropicTimeout);
  } catch (err) {
    return json({ type: 'error', message: "Sorry, I'm having trouble connecting. Please try again or WhatsApp us.", whatsappUrl: 'https://wa.me/61478886145' }, 502, cors);
  }

  const anthropicData = await anthropicResponse.json();
  if (!anthropicResponse.ok) {
    console.error('ANTHROPIC_ERROR status=' + anthropicResponse.status + ' body=' + JSON.stringify(anthropicData).slice(0, 400));
    return json({ type: 'error', message: "Sorry, I hit a snag. Please try again.", whatsappUrl: 'https://wa.me/61478886145', debug_status: anthropicResponse.status }, 500, cors);
  }

  const tokensUsed = (anthropicData.usage?.input_tokens || 0) + (anthropicData.usage?.output_tokens || 0);
  if (env.CHAT_USAGE && tokensUsed > 0) {
    try { await env.CHAT_USAGE.put(usageKey, String(usedToday + tokensUsed), { expirationTtl: 60 * 60 * 48 }); } catch (e) { console.error('KV write failed:', e); }
  }

  const textBlock = (anthropicData.content || []).find(b => b.type === 'text');
  const rawText   = textBlock?.text || "Sorry, I didn't catch that. Can you try rephrasing?";
  const replyText = siteId ? rawText : stripMarkdown(rawText);

  let autoLeadCaptured = false;

  if (env.DB && ctx && ctx.waitUntil) {
    const allScores = [
      ...ragResults.dictWords.map(w => w.score||0),
      ...ragResults.kbChunks.map(c => c.score||0),
      ...ragResults.partnerKb.map(p => p.score||0),
      0
    ];
    const topRagScore = allScores.reduce((a, b) => a > b ? a : b, 0);
    const hadRagMatch = topRagScore >= 0.65 ? 1 : 0;
    const msgCount = (body.messages||[]).filter(m=>m.role==='user').length;
    const evtId = `evt_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
    ctx.waitUntil(
      env.DB.prepare(
        `INSERT INTO conversation_events
         (id,site_id,session_id,event_type,intent_detected,
          question_text,rag_score,had_rag_match,lead_converted,session_message_count,created_at)
         VALUES (?,?,?,'message',?,?,?,?,?,?,unixepoch())`
      ).bind(
        evtId, siteId || 'lagi_public', sessionId||'unknown', intent,
        userText.slice(0, 500),
        Math.round(topRagScore * 100) / 100,
        hadRagMatch,
        autoLeadCaptured ? 1 : 0,
        msgCount
      ).run().catch(e => console.error('Event log failed:', e))
    );
  }

  const allUserText = (body.messages || []).filter(m => m.role === 'user').map(m => m.content || '').join(' ');
  if (allUserText) {
    const phoneMatch = allUserText.match(/((?:\+?\d[\d\s\-()]{6,18}\d))/) && allUserText.match(/((?:\+?\d[\d\s\-()]{6,18}\d))/)[0].replace(/[^\d]/g,'').length >= 8 ? allUserText.match(/((?:\+?\d[\d\s\-()]{6,18}\d))/) : null;
    const emailMatch = allUserText.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);

    if (phoneMatch || emailMatch) {
      const detectedContact = emailMatch ? emailMatch[0] : phoneMatch[1].trim();
      const nameMatch = allUserText.match(/(?:my name is|i am|i'?m|call me|it'?s|name is)\s+([A-Za-z][a-z]{1,20})/i);
      const detectedName = nameMatch ? nameMatch[1].charAt(0).toUpperCase() + nameMatch[1].slice(1) : null;

      // ── v56: D1-driven partner routing — works for all 29+ partners ─────────
      // Looks up partner_referrals table by intent. Falls back to keyword
      // matching only if D1 is unavailable (graceful degradation).
      let notifyPartnerId = partnerId;
      if (isPublic && env.DB) {
        try {
          const convText = (body.messages || []).map(m => m.content || '').join(' ').toLowerCase();
          // Step 1: Try D1 routing by intent category
          const d1Route = await env.DB.prepare(`
            SELECT pr.referred_partner_id, p.name
            FROM partner_referrals pr
            JOIN partners p ON p.id = pr.referred_partner_id
            WHERE pr.site_id = 'lagi_public' AND pr.intent_category = ? AND pr.active = 1
            ORDER BY pr.priority ASC LIMIT 1
          `).bind(intent).first();
          if (d1Route) {
            notifyPartnerId = d1Route.referred_partner_id;
          } else {
            // Step 2: Keyword-based fallback (covers all partners by name/brand)
            const partnerKeywords = await env.DB.prepare(`
              SELECT p.id, p.name, p.category, ec.site_id
              FROM partners p
              JOIN embed_config ec ON ec.partner_id = p.id
              WHERE p.status = 'active'
            `).all();
            if (partnerKeywords.results) {
              for (const p of partnerKeywords.results) {
                const nameLower = (p.name || '').toLowerCase();
                const nameParts = nameLower.split(/[\s\-_]+/).filter(w => w.length > 3);
                if (nameParts.some(part => convText.includes(part))) {
                  notifyPartnerId = p.id;
                  break;
                }
              }
            }
            // Step 3: Intent-based final fallback
            if (!notifyPartnerId) {
              const intentFallback = {
                transfers: 'op_nadi_001', tours: 'op_tourfiji_001',
                dive: 'op_bluelagoon_001', dining: 'op_smugglers_001',
                ferry: 'op_bluelagoon_001', accommodation: 'op_palms_001',
                pricing: 'op_nadi_001',
              };
              notifyPartnerId = intentFallback[intent] || 'op_nadi_001';
            }
          }
        } catch (routeErr) {
          console.error('D1 routing error (using fallback):', routeErr);
          // Hard fallback on DB error
          const hardFallback = { transfers:'op_nadi_001', tours:'op_tourfiji_001', dive:'op_bluelagoon_001' };
          notifyPartnerId = hardFallback[intent] || 'op_nadi_001';
        }
      }

      const effectivePartnerId = notifyPartnerId || partnerId || 'lagi_public';
      if (env.DB) {
        try {
          const leadId = 'lead_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
          const snapshot = (body.messages || []).slice(-8);
          const snapshotText = snapshot.map(m => m.content || '').join(' ').toLowerCase();
          const travelDates  = extractDates(snapshotText);
          const groupSize    = extractGroupSize(snapshotText);
          const budget       = extractBudgetSignal(snapshotText);
          const leadScore    = Math.max(heatData.score, 60);

          await env.DB.prepare(
            `INSERT INTO leads
             (id, site_id, partner_id, session_id, intent_category,
              traveller_name, traveller_email, travel_dates, group_size,
              budget_signal, score, score_reason, heat_score, heat_tier,
              is_cross_referral, notified, created_at, conversation_snapshot)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,unixepoch(),?)`
          ).bind(
            leadId, siteId || 'lagi_public', effectivePartnerId, sessionId || 'unknown', intent,
            detectedName || null, detectedContact, travelDates || null, groupSize || null,
            budget || null, leadScore,
            'Contact shared in conversation. Heat tier: ' + heatData.tier + '. Signals: ' + (heatData.signals || []).join(', '),
            leadScore, heatData.tier,
            JSON.stringify((body.messages || []).slice(-8))
          ).run();

          // v56: Notify threshold — email >= 40, WhatsApp handled inside notifyPartner for >= 70
          if (leadScore >= 40) {
            await notifyPartner(env, {
              leadId, partnerId: notifyPartnerId, site_id: siteId || 'lagi_public',
              name: detectedName, contact: detectedContact, primaryIntent: intent,
              allIntents: [intent], travelDates, groupSize, budget, score: leadScore,
              scoreReason: 'Contact shared conversationally via Lagi. Heat: ' + heatData.tier,
              snapshot, isCrossReferral: false, referredBySiteId: null
            });
          } else {
            // Score < 40: save silently, no notification (reduces partner inbox noise)
            console.log('[Lead saved, no notify] Score:', leadScore, 'Partner:', notifyPartnerId);
          }

          autoLeadCaptured = true;
        } catch (e) { console.error('Auto lead capture error:', e); }

        if (detectedContact && detectedContact.includes('@') && ctx && ctx.waitUntil) {
          ctx.waitUntil(buildAndSendItinerary(env, {
            name: detectedName, contact: detectedContact, intent,
            travelDates: extractDates(allUserText), groupSize: extractGroupSize(allUserText),
            budget: extractBudgetSignal(allUserText), partnerId: notifyPartnerId,
            conversationSnapshot: (body.messages || []).slice(-8), sessionId: sessionId || 'unknown'
          }).catch(e => console.error('Itinerary send failed:', e)));
        }

        // v56: D1 cross-referral with duplicate guard (max 2 partners, deduped by session)
        if (notifyPartnerId && env.DB) {
          try {
            const crossPartners = await env.DB.prepare(`
              SELECT pr.referred_partner_id FROM partner_referrals pr
              WHERE pr.site_id = ? AND pr.intent_category = ? AND pr.referred_partner_id != ? AND pr.active = 1
              ORDER BY pr.priority ASC LIMIT 2
            `).bind(siteId || 'lagi_public', intent, notifyPartnerId).all();
            if (crossPartners.results && crossPartners.results.length > 0) {
              for (const cp of crossPartners.results) {
                const existingCross = await env.DB.prepare('SELECT id FROM leads WHERE session_id = ? AND partner_id = ? LIMIT 1').bind(sessionId || 'unknown', cp.referred_partner_id).first();
                if (existingCross) continue;
                const crossId = 'lead_' + Date.now() + '_x_' + Math.random().toString(36).slice(2,6);
                await env.DB.prepare(`INSERT INTO leads (id,site_id,partner_id,session_id,intent_category,traveller_name,traveller_email,travel_dates,group_size,budget_signal,score,score_reason,heat_score,heat_tier,is_cross_referral,notified,created_at,conversation_snapshot) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0,unixepoch(),?)`
                ).bind(crossId, siteId||'lagi_public', cp.referred_partner_id, sessionId||'unknown', intent, detectedName||null, detectedContact, travelDates||null, groupSize||null, budget||null, leadScore, 'Cross-referral from '+notifyPartnerId, leadScore, heatData.tier, JSON.stringify((body.messages||[]).slice(-4))).run();
                if (leadScore >= 40) {
                  await notifyPartner(env, { leadId: crossId, partnerId: cp.referred_partner_id, site_id: siteId||'lagi_public', name: detectedName, contact: detectedContact, primaryIntent: intent, allIntents: [intent], travelDates, groupSize, budget, score: leadScore, scoreReason: 'Cross-referral via Lagi network', snapshot: (body.messages||[]).slice(-4), isCrossReferral: true, referredBySiteId: siteId||'lagi_public' });
                }
              }
            }
          } catch(crossErr) { console.error('Cross-referral error:', crossErr); }
        }

        const layer4Promise = ingestConversationAsKnowledge(
          env, (body.messages || []).slice(-6), intent,
          notifyPartnerId || partnerId || null, sessionId || 'unknown', replyText || ''
        ).catch(e => console.error('Conv-to-vector failed:', e));
        if (ctx && ctx.waitUntil) ctx.waitUntil(layer4Promise);
      }
    }
  }

  // ─── Lead Capture Superpower v56 ────────────────────────────────────────
  // Heat >= 40 + no contact yet = append one rotating natural ask.
  // 4 phrases prevent it feeling scripted. Session-safe via contact_shared.
  const contactAlreadyShared = heatData.signals && heatData.signals.includes('contact_shared');
  const shouldAskContact = !contactAlreadyShared && !autoLeadCaptured && heatData.score >= 40;
  let replyWithAsk = replyText;
  if (shouldAskContact) {
    const msgCount = (body.messages || []).length;
    const contactAsks = [
      '\n\nTo send you a confirmation and any special offers, what name and best email should I use?',
      '\n\nI can put together a personalised quote - what name and email shall I use?',
      '\n\nWhat name and email should I use so I can send your booking details through?',
      "\n\nSo I can hold this for you - what's your name and best email address?",
    ];
    replyWithAsk = replyText + contactAsks[msgCount % contactAsks.length];
  }

  let finalReply = replyWithAsk
    .replace(/\[([^\]\n]+)\][\s\S]{0,30}\(https?:\/\/wa\.me\/[^)]*\)/g, '')
    .replace(/https?:\/\/wa\.me\/\S+/g, '')
    .replace(/\n--\s*$/g, '')
    .trim();

  let referralBtn = null;
  if (isPublic) {
    const fullConvText = (body.messages || []).map(m => (m.content||'')).join(' ').toLowerCase();
    const isFamily     = /family|kids?|children|child|son|daughter|toddler|baby|babies/.test(fullConvText);
    const isHoneymoon  = /honeymoon|romantic|couple|anniversary|wedding|just married/.test(fullConvText);
    const isDiver      = /div(e|ing)|scuba|padi|underwater|reef|manta/.test(fullConvText);
    const isSnorkeller = /snorkel|marine life|reef|coral|turtles?|tropical fish/.test(fullConvText);
    const isBudget     = /budget|cheap|affordable|saving|value/.test(fullConvText);
    const isLuxury     = /luxury|premium|splurge|high.?end|finest/.test(fullConvText);
    const hasSharedContact = /\+\d{7,}|@gmail|@yahoo|@hotmail|@outlook|\d{4}\s\d{3}/.test(fullConvText);

    const BOOKING_INTENTS = ['transfers','tours','dive','accommodation','dining','ferry','pricing','general'];
    const shouldShowReferral = BOOKING_INTENTS.includes(intent) || hasSharedContact || heatData.score >= 20;

    let routedPartner = null;
    if (shouldShowReferral) {
      if (intent === 'transfers')                                                    routedPartner = { name: 'Nadi Airport Transfers', wa: '61478886145' };
      else if (intent === 'tours')                                                   routedPartner = { name: 'Tour Fiji Tours', wa: '61478886145' };
      else if (intent === 'dive' || isDiver)                                         routedPartner = { name: 'Blue Lagoon Beach Resort', wa: '6797766223' };
      else if (intent === 'dining')                                                  routedPartner = { name: 'Smugglers Cove Resort', wa: '6798902713' };
      else if (intent === 'ferry')                                                   routedPartner = { name: 'Blue Lagoon Beach Resort', wa: '6797766223' };
      else if (intent === 'accommodation') {
        if (isFamily || isBudget)                                                    routedPartner = { name: 'The Palms Denarau', wa: '6796750104' };
        else if (isHoneymoon || isLuxury || isDiver || isSnorkeller)                 routedPartner = { name: 'Blue Lagoon Beach Resort', wa: '6797766223' };
        else                                                                         routedPartner = { name: 'The Palms Denarau', wa: '6796750104' };
      }
      else if (intent === 'pricing')                                                 routedPartner = { name: 'Nadi Airport Transfers', wa: '61478886145' };
      else {
        if (isFamily)                                                                routedPartner = { name: 'The Palms Denarau', wa: '6796750104' };
        else if (isHoneymoon || isDiver)                                             routedPartner = { name: 'Blue Lagoon Beach Resort', wa: '6797766223' };
        else                                                                         routedPartner = { name: 'Nadi Airport Transfers', wa: '61478886145' };
      }
    }

    if (hasSharedContact && (!routedPartner || intent === 'general')) {
      if (/blue lagoon|yasawa|nacula/.test(fullConvText))                            routedPartner = { name: 'Blue Lagoon Beach Resort', wa: '6797766223' };
      else if (/palms|denarau|apartment/.test(fullConvText))                         routedPartner = { name: 'The Palms Denarau', wa: '6796750104' };
      else if (/tour fiji|atv|village tour|waterfall/.test(fullConvText))            routedPartner = { name: 'Tour Fiji Tours', wa: '61478886145' };
      else if (/nadi airport|transfer|pickup|arrival/.test(fullConvText))            routedPartner = { name: 'Nadi Airport Transfers', wa: '61478886145' };
      else if (/smugglers|sunset cruise/.test(fullConvText))                         routedPartner = { name: 'Smugglers Cove Resort', wa: '6798902713' };
    }

    if (routedPartner) {
      const prefilledMsg = 'Bula ' + routedPartner.name + '! I was chatting with Lagi on lagi.vakaviti.ai and would love some help planning my Fiji trip.';
      referralBtn = { url: 'https://wa.me/' + routedPartner.wa + '?text=' + encodeURIComponent(prefilledMsg), label: 'Chat with ' + routedPartner.name + ' on WhatsApp' };
    }
  } else if (referralPartner && referralPartner.whatsapp_number) {
    const refWaNum    = (referralPartner.whatsapp_number||'').replace(/[^0-9]/g, '');
    const refName     = referralPartner.name || 'our partner';
    const sourceName  = (partnerInfo && partnerInfo.name) ? partnerInfo.name : 'Vakaviti.ai';
    const prefilledMsg = 'Hi ' + refName + '! I was referred by ' + sourceName + ' via Vakaviti.ai and need help with ' + intent + '.';
    referralBtn = { url: 'https://wa.me/' + refWaNum + '?text=' + encodeURIComponent(prefilledMsg), label: 'Contact ' + refName + ' on WhatsApp' };
  }

  return json({ type: 'reply', message: finalReply, intent, referral_btn: referralBtn, lead_captured: autoLeadCaptured }, 200, cors);
}

// ═══════════════════════════════════════════════════════════════
// SYSTEM PROMPTS — v54: review stats injected into both prompts
// ═══════════════════════════════════════════════════════════════

function buildPageContextBlock(pageTitle, pageHeading, pageUrl, pageDetail) {
  const label = pageHeading || pageTitle;
  if (!label) return '';
  let block = `
// CURRENT PAGE — CRITICAL GROUNDING RULE (do not skip this)
The visitor is right now looking at a page titled: "${label}"${pageUrl ? ` (${pageUrl})` : ''}
If they say "this tour", "this trip", "this package", "this one", or ask a question without naming a different tour, answer about THIS EXACT page — never substitute a different tour from your knowledge just because it scores higher as a match.
`;
  if (pageDetail) {
    block += `
This page's own published content includes the following — treat it as the authoritative answer whenever it's relevant, and use it directly instead of guessing or saying you lack details:
"""
${pageDetail}
"""
`;
  }
  block += `
If neither the retrieved knowledge below nor the page content above clearly describes a page titled "${label}", say honestly that you don't have the exact details for that specific page yet and offer to check with the team — do NOT guess or borrow details from another tour.
`;
  return block;
}

function buildPhase2SystemPrompt(partner, ragResults, intent, referralPartner, liveDeals, heatData, reviewStats, pageContextBlock = '') {
  const waNumber    = partner.whatsapp_number || '61478886145';
  const waUrl       = `https://wa.me/${waNumber.replace(/[^0-9]/g, '')}`;
  const waPreFilled = `${waUrl}?text=${encodeURIComponent(`Hi ${partner.name} team, I found you via Vakaviti.ai and would like to enquire about your services.`)}`;

  const dictSection = ragResults.dictWords.length > 0
    ? `\nFIJIAN DICTIONARY MATCHES:\n` + ragResults.dictWords.map(w => `• **${w.word}** (say: ${w.phonetic}) — ${w.englishDef}${w.tags ? ` [${w.tags}]` : ''}`).join('\n')
    : '';
  const kbSection = ragResults.kbChunks.length > 0
    ? `\nKNOWLEDGE BASE:\n` + ragResults.kbChunks.map(c => `[${c.title}]\n${c.content}`).join('\n\n')
    : '';
  const partnerKbSection = ragResults.partnerKb.length > 0
    ? `\nPARTNER KNOWLEDGE:\n` + ragResults.partnerKb.map(c => `[${c.title}]\n${c.content}`).join('\n\n')
    : '';
  const ragContext      = [dictSection, kbSection, partnerKbSection].filter(Boolean).join('\n');
  const dealsSection    = formatDealsForPrompt(liveDeals || [], false);
  const referralSection = referralPartner
    ? `NOTE: The visitor may benefit from ${referralPartner.name} for ${intent} services. Mention them by name naturally if relevant. Do NOT output links.`
    : '';

  // v54: inject live review metrics
  const reviewSection = formatReviewStats(reviewStats, partner.name);

  return `
// LAYER 1 — LAGI SOUL
You are Lagi — the warm, knowledgeable AI concierge of the Vakaviti.ai network.
Genuine warmth. Honest. Local intelligence. One question at a time. End every reply with a question or next step.
Voice: personal, specific, anticipatory, naturally Fijian, concise.
Lead capture: natural, never a form. When visitor shares name + contact: output [Contact ${partner.name} on WhatsApp](${waPreFilled}) — NON-NEGOTIABLE.
NEVER output raw phone numbers. NEVER output wa.me links for referrals — system appends buttons automatically.

// LAYER 2 — PARTNER CONTEXT
YOU REPRESENT: ${partner.name}
Category: ${partner.category || 'tourism'} | Region: ${partner.region || 'Fiji'}
${partner.description ? `About: ${partner.description}` : ''}
Contact: [Contact ${partner.name} on WhatsApp](${waPreFilled})
Current intent: ${intent || 'general enquiry'}
${reviewSection}
${pageContextBlock}

// LAYER 3 — NETWORK INTELLIGENCE
${referralSection}

// LAYER 4 — FIJIAN LANGUAGE
Every reply contains 1-2 Fijian words. Bula to open. Vinaka for thanks. Moce at end.
Teach less common words in brackets once. Connect words to visitor experience.

// RETRIEVED KNOWLEDGE - AUTHORITATIVE SOURCE
CRITICAL RULES FOR KNOWLEDGE:
- The facts below come from ${partner.name} verified knowledge base. They are ground truth.
- Use EXACT names, prices, and details from the knowledge below. Do NOT use general Fiji knowledge.
- If no knowledge retrieved, say you will find out and invite them to WhatsApp.
${ragContext || 'No specific knowledge retrieved - invite visitor to contact the team directly.'}
${dealsSection}

RESPONSE STYLE: Plain text only. No markdown. No asterisks for bold. No bullet points with dashes. No ## headers. Under 150 words unless complexity demands. Always end with a question or next step.
`;
}

function buildPublicSystemPrompt(ragResults, intent, liveDeals, heatData, top3, currency='AUD', groupSize=null, reviewStats=null, reviewPartnerId=null, pageContextBlock = '') {
  const dictSection = ragResults.dictWords.length > 0
    ? '\nFIJIAN DICTIONARY MATCHES:\n' + ragResults.dictWords.map(w => `• **${w.word}** (say: ${w.phonetic}) — ${w.englishDef}`).join('\n')
    : '';
  const kbSection = ragResults.kbChunks.length > 0
    ? '\nFIJI KNOWLEDGE BASE:\n' + ragResults.kbChunks.map(c => `[${c.title}]\n${c.content}`).join('\n\n')
    : '';
  const partnerKbSection = ragResults.partnerKb.length > 0
    ? '\nPARTNER KNOWLEDGE:\n' + ragResults.partnerKb.map(c => `[${c.title}]\n${c.content}`).join('\n\n')
    : '';
  const ragContext   = [dictSection, kbSection, partnerKbSection].filter(Boolean).join('\n');
  const dealsSection = formatDealsForPrompt(liveDeals, true);
  const heatSection  = heatData && heatData.score >= 60 ? formatTop3ForPrompt(top3) : '';
  const heatLevel    = heatData ? (heatData.tier === 4 ? 'BURNING HOT' : heatData.tier === 3 ? 'HOT' : heatData.tier === 2 ? 'WARM' : 'BROWSING') : 'BROWSING';

  // v54: inject live review metrics for the detected operator
  const PARTNER_NAMES = {
    'op_bluelagoon_001': 'Blue Lagoon Beach Resort',
    'op_nadi_001':       'Nadi Airport Transfers',
    'op_palms_001':      'The Palms Denarau',
    'op_tourfiji_001':   'Tour Fiji Tours',
    'op_smugglers_001':  'Smugglers Cove Resort',
  };
  const reviewPartnerName = reviewPartnerId ? (PARTNER_NAMES[reviewPartnerId] || reviewPartnerId) : null;
  const reviewSection = formatReviewStats(reviewStats, reviewPartnerName);

  return `
// LAYER 1 — LAGI SOUL
You are Lagi — Fiji's most knowledgeable AI travel guide, powered by the Vakaviti.ai network.
Genuine warmth. Honest. Expert local intelligence. One question at a time.
Language: detect the visitor's language from their messages. Respond in the same language they use. Fluent in English, Japanese, Mandarin Chinese, German, French, Hindi, and Korean.
Voice: personal, specific, anticipatory, naturally Fijian, never corporate.
NEVER output raw phone numbers. NEVER output wa.me links — WhatsApp buttons appear automatically.

// LAYER 2 — PARTNER NETWORK
PARTNER DIRECTORY:
- Nadi Airport Transfers: airport transfers to all Fiji resorts. 24/7. Best for: anyone flying into Nadi.
- The Palms Denarau: self-contained apartments on Denarau. Studio-3BR. Full kitchen, pool, Cafe O. Best for: families, self-catering couples.
- Blue Lagoon Beach Resort: luxury remote island resort, Nacula Island, Yasawa. World-class diving. PADI. Best for: couples, honeymooners, divers.
- Tour Fiji Tours: land-based adventure and culture tours from Nadi. ATV, village, waterfalls, sunset cruise. Best for: active travellers, families.
- Smugglers Cove Resort: Denarau beachfront. Daily Sunset Cruise FJ$65pp at 5:30pm. Best for: evening activity near Denarau.
- Vosa Vakaviti: Fijian language dictionary. Best for: anyone learning Fijian.

ROUTING: Plane arrival -> Nadi Transfers. Denarau -> Palms. Yasawa -> Blue Lagoon. Day activities -> Tour Fiji. Evening Denarau -> Smugglers Cove.
Families -> Palms primary + Blue Lagoon upgrade offer. Honeymoon -> Blue Lagoon primary.
${reviewSection}
${pageContextBlock}

// LAYER 3 — LEAD CONVERSION
HEAT LEVEL: ${heatLevel} | Score: ${heatData ? heatData.score : 0}/100
${heatData && heatData.signals && heatData.signals.length > 0 ? 'Signals: ' + heatData.signals.join(', ') : ''}
${heatSection}

MESSAGE 1: End EVERY first response with qualifying question + seed phrase:
"[qualifying question]? That'll help me put together the perfect plan — and I can have the right team reach out with availability and exact pricing when you're ready. Vinaka!"
MESSAGE 2: Capture contact — "What works better for you, WhatsApp or email?"
MESSAGE 3+: Top 3 offers + capture if not yet done.
NEVER give raw phone numbers. EMAIL enquiries route to leads@vakaviti.ai.

// LAYER 4 — FIJIAN LANGUAGE
Every reply: 1-2 Fijian words. Bula to open. Vinaka for thanks. Teach less common words in brackets.

// RETRIEVED KNOWLEDGE
${ragContext || '(Answer from your deep Fiji expertise)'}
${dealsSection}

VISITOR CONTEXT:
- Preferred currency: ${currency} — use this when quoting prices (convert if needed: FJD÷1.8=AUD approx)
- Group size detected: ${groupSize ? groupSize + ' people' : 'unknown — ask in first response'}

QUALITY: Specific recommendations. Fijian word in every reply. Deal mentioned when relevant. Cross-sell complementary partner when natural. End with question or next step.
NEVER say "there are many options" or "it depends" — be direct and make a recommendation.
NEVER use markdown headers (##) — conversational paragraphs only.
RESPONSE LENGTH: 100-150 words for simple questions. 200-250 for complex itinerary requests. Never longer.
`;
}

// ═══════════════════════════════════════════════════════════════
// INTENT DETECTION
// ═══════════════════════════════════════════════════════════════

function detectIntent(text) {
  const t = text.toLowerCase();
  if (/transfer|airport|pickup|nadi|suva|hotel drop|resort drop|arrival|departure|taxi|ride/.test(t)) return 'transfers';
  if (/\btours?\b|activity|activities|horse|waterfall|cave|sail|cruise|atv|zipline|fishing|village|hiking|excursion|adventure/.test(t)) return 'tours';
  if (/dive|diving|scuba|reef|underwater|manta|shark|snorkel|snorkelling|marine|turtle|coral|fish|ocean life/.test(t)) return 'dive';
  if (/room|accommodation|stay|resort|hostel|lodge|villa|suite|check.?in|check.?out/.test(t)) return 'accommodation';
  if (/family|honeymoon|couple|romantic|\d+\s*nights?|\d+\s*weeks?|planning (a |our |the )?fiji|planning (a |our )?trip to (fiji|blue lagoon|the island|yasawa|denarau)|where (should|to) stay|best (resort|hotel|place to stay)|itinerary|blue lagoon|yasawa island/.test(t)) return 'accommodation';
  if (/restaurant|\beat\b|food|dinner|lunch|cafe|menu|cuisine|breakfast/.test(t)) return 'dining';
  if (/visa|passport|entry|customs|immigration|border/.test(t)) return 'visa';
  if (/weather|rain|season|dry|wet|cyclone|temperature|climate/.test(t)) return 'weather';
  if (/safe|safety|swim|current|warning|danger|jellyfish/.test(t)) return 'safety';
  if (/bula|vinaka|moce|kerekere|yadra|vakaviti|fijian word|how do you say|what does .* mean|phrase|pronounce|language|dictionary|vosa/.test(t)) return 'language';
  if (/price|cost|how much|fee|charge|rate|budget|expensive|cheap/.test(t)) return 'pricing';
  if (/ferry|yasawa flyer|south sea|boat cruise|island hop|port denarau/.test(t)) return 'ferry';
  return 'general';
}

function detectAllIntents(text) {
  const t = (text || '').toLowerCase();
  const intents = [];
  const map = {
    transfers:     ['transfer','airport','pickup','sedan','minivan','ride','taxi'],
    accommodation: ['hotel','room','stay','sleep','resort','accommodation'],
    tours:         ['tour','activity','horse','snorkelling','village','day trip'],
    ferry:         ['ferry','yasawa flyer','south sea','boat','cruise','island hop'],
    dive:          ['dive','diving','scuba','reef','manta'],
    language:      ['bula','vinaka','fijian','language','word','phrase','dictionary'],
    general:       ['fiji','beach','weather','visa','currency','sim'],
  };
  for (const [intent, keywords] of Object.entries(map)) {
    if (keywords.some(kw => t.includes(kw))) intents.push(intent);
  }
  return [...new Set(intents)];
}

// ═══════════════════════════════════════════════════════════════
// LEAD SCORING & EXTRACTION
// ═══════════════════════════════════════════════════════════════

function scoreLead(text, name, contact) {
  let score = 10;
  if (name)    score += 20;
  if (contact) score += 30;
  if (/\b(january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2}\/\d{1,2}|\d{1,2} \w+ 202)/i.test(text)) score += 15;
  if (/\b(\d+) (people|pax|person|passenger|adult|child)/i.test(text)) score += 10;
  if (/book|confirm|ready|want to|would like|going to|need/i.test(text)) score += 15;
  if (/price|cost|how much/i.test(text)) score += 5;
  return Math.min(score, 100);
}

function explainScore(score, text, name, contact) {
  const reasons = [];
  if (name)    reasons.push('name provided');
  if (contact) reasons.push('contact provided');
  if (/\b(january|february|march|april|may|june|july|august|september|october|november|december)/i.test(text)) reasons.push('travel dates mentioned');
  if (/\b\d+ (people|pax|person)/i.test(text)) reasons.push('group size mentioned');
  if (/book|confirm|ready|want to/i.test(text)) reasons.push('booking intent expressed');
  return reasons.join(', ') || 'general enquiry';
}

function extractDates(text) {
  const specific = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/i);
  if (specific) return specific[0];
  const monthOnly = text.match(/\b(?:in|during|for|visiting|arriving|coming)\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)/i);
  if (monthOnly) return monthOnly[1];
  const holidays = text.match(/\b(school holidays?|christmas holidays?|easter holidays?|summer holidays?|winter holidays?|term \d break|july holidays?|october holidays?)/i);
  if (holidays) return holidays[0];
  const relative = text.match(/\b(next month|this (?:july|august|september|october|november|december)|in \d+ (?:weeks?|months?))/i);
  if (relative) return relative[0];
  return null;
}

function extractGroupSize(text) {
  const t = text.toLowerCase();
  const m = text.match(/\b(\d+)\s*(people|pax|person|passenger|adult|guests?|travell?ers?|of us)/i);
  if (m) return parseInt(m[1]);
  if (/just (the two|us two|2 of us)|my partner and i|couple|honeymoon|just me and (my|the)/.test(t)) return 2;
  if (/solo|just me|by myself|travelling alone|on my own/.test(t)) return 1;
  if (/family of (three|3)/.test(t)) return 3;
  if (/family of (four|4)|two adults.*(two|2) kids|2 adults.*(2|two) kids/.test(t)) return 4;
  if (/family of (five|5)|two adults.*(three|3) kids/.test(t)) return 5;
  if (/group of (\w+)/.test(t)) {
    const words = {one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
    const gm = t.match(/group of (\w+)/);
    if (gm) return words[gm[1]] || parseInt(gm[1]) || null;
  }
  return null;
}

function extractBudgetSignal(text) {
  if (/cheap|\bbudget\b|affordable|lowest|value for money|economical|backpacker/i.test(text)) return 'budget';
  if (/\bpremium\b|\bluxury\b|\bsplurge\b|high.?end|\bfinest\b|spare no expense|money no object|5.?star/i.test(text)) return 'premium';
  return 'mid';
}

function detectCurrency(text) {
  const t = text.toLowerCase();
  if (/au\$|aud|australian dollar/.test(t)) return 'AUD';
  if (/nz\$|nzd|new zealand/.test(t)) return 'NZD';
  if (/us\$|usd|american dollar/.test(t)) return 'USD';
  if (/£|gbp|british pound/.test(t)) return 'GBP';
  if (/fj\$|fjd|fijian dollar/.test(t)) return 'FJD';
  if (/australia|sydney|melbourne|brisbane|perth/.test(t)) return 'AUD';
  if (/new zealand|auckland|wellington|christchurch/.test(t)) return 'NZD';
  if (/united states|america|usa/.test(t)) return 'USD';
  if (/united kingdom|england|london/.test(t)) return 'GBP';
  return 'AUD';
}

// ═══════════════════════════════════════════════════════════════
// PARTNER LOOKUP
// ═══════════════════════════════════════════════════════════════

async function lookupPartner(env, partnerId, intent, siteId) {
  if (!env.DB) return null;
  try {
    if (partnerId) {
      return await env.DB.prepare(`
        SELECT p.name, p.category, p.region, p.description, p.whatsapp_number, p.website_url,
               ec.theme_color, ec.greeting_text, ec.primary_intent
        FROM partners p LEFT JOIN embed_config ec ON ec.partner_id = p.id
        WHERE p.id = ? AND p.status = 'active' LIMIT 1
      `).bind(partnerId).first();
    }
    if (siteId) {
      return await env.DB.prepare(`
        SELECT p.name, p.category, p.region, p.description, p.whatsapp_number, p.website_url,
               ec.theme_color, ec.greeting_text, ec.primary_intent
        FROM partners p JOIN embed_config ec ON ec.partner_id = p.id
        WHERE ec.site_id = ? AND p.status = 'active' LIMIT 1
      `).bind(siteId).first();
    }
    return null;
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════
// CONFIG / LEAD / EVENT / ONBOARD
// ═══════════════════════════════════════════════════════════════

async function handleConfig(request, env, cors) {
  const url    = new URL(request.url);
  const siteId = url.searchParams.get('site_id');
  if (!siteId) return json({ error: 'Missing site_id.' }, 400, cors);
  if (!env.DB)  return json({ error: 'Database not available.' }, 503, cors);
  try {
    const row = await env.DB.prepare(`
      SELECT ec.site_id, ec.partner_id, ec.theme_color, ec.greeting_text, ec.allowed_intents, ec.primary_intent, ec.region_lock,
             p.name AS brand_name, p.whatsapp_number, p.website_url, p.category, p.region, p.status
      FROM embed_config ec JOIN partners p ON p.id = ec.partner_id
      WHERE ec.site_id = ? AND p.status = 'active'
    `).bind(siteId).first();
    if (!row) return json({ error: 'Site not found or inactive.' }, 404, cors);
    const waNumber = row.whatsapp_number || '';
    const waUrl    = waNumber ? `https://wa.me/${waNumber.replace(/[^0-9]/g, '')}` : 'https://wa.me/61478886145';
    return json({ site_id: row.site_id, partner_id: row.partner_id, brand_name: row.brand_name, theme_color: row.theme_color||'#0d4d6e', greeting_text: row.greeting_text||null, allowed_intents: row.allowed_intents ? JSON.parse(row.allowed_intents) : null, primary_intent: row.primary_intent||null, region_lock: row.region_lock||null, whatsapp_url: waUrl, whatsapp_number: waNumber, contact_email: row.contact_email||null, category: row.category, region: row.region }, 200, cors);
  } catch (err) { console.error('Config lookup error:', err); return json({ error: 'Config unavailable.' }, 500, cors); }
}

async function handleLead(request, env, cors) {
  if (!env.DB) return json({ ok: false }, 503, cors);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400, cors); }
  const { site_id, partner_id, session_id, name, contact, conversation_snapshot = [] } = body;
  if (!site_id) return json({ error: 'Missing site_id.' }, 400, cors);
  const snapshot      = conversation_snapshot.map(m => m.content||'').join(' ').toLowerCase();
  const score         = scoreLead(snapshot, name, contact);
  const scoreReason   = explainScore(score, snapshot, name, contact);
  const primaryIntent = detectIntent(snapshot);
  const allIntents    = detectAllIntents(snapshot);
  const travelDates   = extractDates(snapshot);
  const groupSize     = extractGroupSize(snapshot);
  const budget        = extractBudgetSignal(snapshot);
  let resolvedPartnerId = partner_id || null;
  if (!resolvedPartnerId) {
    try { const ec = await env.DB.prepare('SELECT partner_id FROM embed_config WHERE site_id = ? LIMIT 1').bind(site_id).first(); if (ec) resolvedPartnerId = ec.partner_id; } catch {}
  }
  const leadId = 'lead_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  try {
    await env.DB.prepare(`INSERT INTO leads (id,site_id,partner_id,session_id,intent_category,traveller_name,traveller_email,travel_dates,group_size,budget_signal,score,score_reason,is_cross_referral,notified,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,0,unixepoch())`)
      .bind(leadId, site_id, resolvedPartnerId||null, session_id||'unknown', primaryIntent, name||null, contact||null, travelDates||null, groupSize||null, budget||null, score, scoreReason).run();
    if (resolvedPartnerId) await notifyPartner(env, { leadId, partnerId: resolvedPartnerId, site_id, name, contact, primaryIntent, allIntents, travelDates, groupSize, budget, score, scoreReason, snapshot: conversation_snapshot.slice(-4), isCrossReferral: false, referredBySiteId: null });
    return json({ ok: true, lead_id: leadId, score }, 200, cors);
  } catch (err) { console.error('Lead storage error:', err); return json({ ok: false }, 500, cors); }
}

async function handleEvent(request, env, cors) {
  if (!env.DB) return new Response(null, { status: 204, headers: cors });
  let body;
  try { body = await request.json(); } catch { return new Response(null, { status: 204, headers: cors }); }
  const { site_id, session_id, event_type, intent_detected } = body;
  if (!site_id || !event_type) return new Response(null, { status: 204, headers: cors });
  try {
    await env.DB.prepare(`INSERT INTO conversation_events (id,site_id,session_id,event_type,intent_detected,created_at) VALUES (?,?,?,?,?,unixepoch())`)
      .bind(`evt_${Date.now()}_${Math.random().toString(36).slice(2,6)}`, site_id, session_id||'unknown', event_type, intent_detected||null).run();
  } catch (e) { console.error('Event store error:', e); }
  return new Response(null, { status: 204, headers: cors });
}

async function notifyPartner(env, { leadId, partnerId, site_id, name, contact, primaryIntent, allIntents, travelDates, groupSize, budget, score, scoreReason, snapshot, isCrossReferral, referredBySiteId, referredByPartnerName }) {
  try {
    const channels = await env.DB.prepare(`SELECT channel_type, destination, priority FROM contact_channels WHERE partner_id = ? AND active = 1 AND min_lead_score <= ? ORDER BY priority ASC LIMIT 3`).bind(partnerId, score).all();
    if (!channels.results || channels.results.length === 0) {
      await alertOpsFailure(env, { leadId, partnerId, reason: 'no active contact_channels rows' });
      return false;
    }
    const partnerRow  = await env.DB.prepare('SELECT name, whatsapp_number FROM partners WHERE id = ?').bind(partnerId).first();
    const scoreLabel  = score >= 70 ? 'HOT' : score >= 40 ? 'WARM' : 'COLD';
    const header      = isCrossReferral ? `Vakaviti cross-referral — ${scoreLabel} (${score}/100)` : `Vakaviti lead — ${scoreLabel} (${score}/100)`;
    const lines = [header, `Partner: ${(partnerRow && partnerRow.name)||'your business'}`, isCrossReferral ? `Referred from: ${referredBySiteId||referredByPartnerName||'Vakaviti network'}` : null, ``, `Name:    ${name||'not provided'}`, `Contact: ${contact||'not provided'}`, `Service: ${primaryIntent}`, `Dates:   ${travelDates||'not mentioned'}`, `Group:   ${groupSize||'not mentioned'}`, `Budget:  ${budget||'mid'}`, ``, `Score: ${score}/100 — ${scoreReason}`, `Lead ID: ${leadId}`].filter(l => l !== null);
    (snapshot||[]).slice(-4).forEach(m => { lines.push(`${m.role==='user'?'Visitor':'AI'}: ${(m.content||'').slice(0,120)}`); });
    const notifyText = lines.join('\n');
    // v57: Fire ALL channels that meet score threshold — no break-on-success
    // Email always fires for score >= 40. WhatsApp fires additionally for score >= 70.
    let notified = false;
    const channelsUsed = [];
    for (const channel of channels.results) {
      let channelResult = false;
      if (channel.channel_type === 'email') {
        channelResult = await sendEmailNotification(env, channel.destination, notifyText, name);
        if (channelResult) channelsUsed.push('email');
      } else if (channel.channel_type === 'webhook') {
        channelResult = await sendWebhookNotification(channel.destination, { lead_id: leadId, partner_id: partnerId, score, name, contact, intent: primaryIntent });
        if (channelResult) channelsUsed.push('webhook');
      } else if (channel.channel_type === 'whatsapp') {
        // WhatsApp fires for score >= 70 — alongside email, not instead of it
        if (score >= 70 && env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID) {
          channelResult = await sendWhatsAppNotification(env, channel.destination, name, contact, primaryIntent, score, leadId, travelDates, groupSize);
          if (channelResult) channelsUsed.push('whatsapp');
        } else if (score >= 70) {
          console.log('[WhatsApp HOT LEAD] Partner:', partnerId, '| Score:', score, '| Contact:', contact, '| Intent:', primaryIntent);
          channelsUsed.push('whatsapp_logged');
          channelResult = true;
        }
      }
      if (channelResult) notified = true;
      // NO break — continue to fire all remaining channels
    }
    const channelUsed = channelsUsed.join('+') || null;
    if (notified && channelUsed) {
      await env.DB.prepare('UPDATE leads SET notified=1, notified_at=unixepoch(), channel_used=? WHERE id=?').bind(channelUsed, leadId).run();
    } else {
      await alertOpsFailure(env, { leadId, partnerId, reason: 'all channels attempted, none succeeded' });
    }
    return notified;
  } catch (err) {
    console.error('notifyPartner error:', err);
    await alertOpsFailure(env, { leadId, partnerId, reason: `exception: ${err.message}` });
    return false;
  }
}

async function alertOpsFailure(env, { leadId, partnerId, reason }) {
  try {
    if (!env.SENDGRID_API_KEY) { console.error(`[OPS ALERT - no SendGrid key] Lead ${leadId} (${partnerId}) failed: ${reason}`); return; }
    await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: 'helpronline@gmail.com' }] }],
        from: { email: 'helpronline@gmail.com', name: 'Vakaviti Alerts' },
        subject: `⚠️ Lead notification failed — ${partnerId}`,
        content: [{ type: 'text/plain', value: `Lead ID: ${leadId}\nPartner: ${partnerId}\nReason: ${reason}\n\nThis lead was saved to the leads table but NOT delivered.` }]
      })
    });
  } catch (err) { console.error('alertOpsFailure itself failed:', err); }
}

async function sendEmailNotification(env, to, message, leadName) {
  if (!env.SENDGRID_API_KEY) { console.error(`[Email Lead FAILED - no SENDGRID_API_KEY] -> ${to}\n${message}`); return false; }
  try {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', { method: 'POST', headers: { 'Authorization': `Bearer ${env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ personalizations: [{ to: [{ email: to }] }], from: { email: 'helpronline@gmail.com', name: 'Vakaviti Leads' }, subject: `New lead: ${leadName||'Visitor'} — vakaviti.ai`, content: [{ type: 'text/plain', value: message }] }) });
    return res.ok;
  } catch { return false; }
}

async function sendWebhookNotification(url, payload) {
  try { const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); return res.ok; } catch { return false; }
}

async function sendWhatsAppNotification(env, toNumber, name, contact, intent, score, leadId, travelDates, groupSize) {
  // v56: Meta Cloud API WhatsApp notify for HOT leads (score >= 70)
  // Requires env.WHATSAPP_TOKEN and env.WHATSAPP_PHONE_ID Worker secrets
  try {
    const cleanNumber = (toNumber || '').replace(/[^0-9]/g, '');
    if (!cleanNumber || cleanNumber.length < 8) return false;
    const scoreLabel = score >= 80 ? 'BURNING HOT' : 'HOT';
    const msgBody = [
      '🔥 Vakaviti ' + scoreLabel + ' Lead (' + score + '/100)',
      '',
      'Name: ' + (name || 'not provided'),
      'Contact: ' + (contact || 'not provided'),
      'Service: ' + intent,
      'Dates: ' + (travelDates || 'not mentioned'),
      'Group: ' + (groupSize || 'not mentioned'),
      '',
      'Lead ID: ' + leadId,
      'Dashboard: https://dashboard.vakaviti.ai',
    ].join('\n');
    const res = await fetch('https://graph.facebook.com/v19.0/' + env.WHATSAPP_PHONE_ID + '/messages', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.WHATSAPP_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: cleanNumber,
        type: 'text',
        text: { body: msgBody },
      }),
    });
    if (!res.ok) { console.error('WhatsApp send failed:', res.status); return false; }
    return true;
  } catch (e) { console.error('WhatsApp notification error:', e); return false; }
}

async function handleOnboard(request, env, cors) { return json({ error: 'Use vakaviti-onboard Worker.' }, 301, cors); }

// ═══════════════════════════════════════════════════════════════
// DASHBOARD API
// ═══════════════════════════════════════════════════════════════

async function handleLeadsQuery(request, env, cors) {
  const url = new URL(request.url);
  const partnerIdParam = url.searchParams.get('partner_id') || '';
  const isAdmin = url.searchParams.get('admin') === '1';
  if (!env.DB) return json({ leads: [] }, 200, cors);
  try {
    let result;
    const ALL_PARTNERS = ['op_bluelagoon_001','op_nadi_001','op_palms_001','op_smugglers_001','op_tourfiji_001','op_vosavakaviti_001'];
    if (isAdmin || partnerIdParam === 'lagi_public') {
      const placeholders = ALL_PARTNERS.map(() => '?').join(',');
      result = await env.DB.prepare(`SELECT id, site_id, partner_id, session_id, intent_category, traveller_name, traveller_email, travel_dates, group_size, budget_signal, score, score_reason, heat_score, heat_tier, notified, created_at, conversation_snapshot FROM leads WHERE partner_id IN (${placeholders}) ORDER BY created_at DESC LIMIT 100`).bind(...ALL_PARTNERS).all();
    } else {
      const partnerIds = partnerIdParam.split(',').filter(Boolean);
      if (partnerIds.length === 0) return json({ leads: [] }, 200, cors);
      const placeholders = partnerIds.map(() => '?').join(',');
      result = await env.DB.prepare(`SELECT id, site_id, partner_id, session_id, intent_category, traveller_name, traveller_email, travel_dates, group_size, budget_signal, score, score_reason, heat_score, heat_tier, notified, created_at, conversation_snapshot FROM leads WHERE partner_id IN (${placeholders}) ORDER BY created_at DESC LIMIT 100`).bind(...partnerIds).all();
    }
    return json({ leads: result.results || [] }, 200, cors);
  } catch(e) { console.error('Leads query error:', e); return json({ leads: [], error: e.message }, 200, cors); }
}

async function handleDealsQuery(request, env, cors) {
  const url = new URL(request.url);
  const partnerId = url.searchParams.get('partner_id');
  if (!env.DB) return json({ deals: [] }, 200, cors);
  try {
    let result;
    if (partnerId) {
      result = await env.DB.prepare(`SELECT id, partner_name, title, description, price_from, currency, category, active FROM deals WHERE active = 1 AND (partner_id = ? OR partner_id IS NULL) ORDER BY CASE WHEN partner_id = ? THEN 0 ELSE 1 END, created_at DESC LIMIT 10`).bind(partnerId, partnerId).all();
    } else {
      result = await env.DB.prepare(`SELECT id, partner_name, title, description, price_from, currency, category, active FROM deals WHERE active = 1 ORDER BY created_at DESC LIMIT 10`).all();
    }
    return json({ deals: result.results || [] }, 200, cors);
  } catch(e) { console.error('Deals query error:', e); return json({ deals: [], error: e.message }, 200, cors); }
}

async function handleDashboardLogin(request, env, cors)   { return json({ error: 'Use vakaviti-dashboard-api Worker.' }, 301, cors); }
async function handleDashboardVerify(request, env, cors)  { return json({ error: 'Use vakaviti-dashboard-api Worker.' }, 301, cors); }
async function handleDashboardLeads(request, env, cors)   { return json({ error: 'Use vakaviti-dashboard-api Worker.' }, 301, cors); }
async function handleDashboardStats(request, env, cors)   { return json({ error: 'Use vakaviti-dashboard-api Worker.' }, 301, cors); }
async function handleDashboardSettings(request, env, cors){ return json({ error: 'Use vakaviti-dashboard-api Worker.' }, 301, cors); }

// ═══════════════════════════════════════════════════════════════
// LEGACY SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════

const SYSTEM_PROMPT_LEGACY = `You are the AI booking assistant for FIJI TOUR TRANSFERS, embedded as a chat widget on nadiairporttransfers.com or vosavakaviti.com. You are talking DIRECTLY to a website visitor.

WHO YOU ARE: You are an AI assistant. Jump straight into answering their question.
If asked whether you're human: "I'm an AI assistant for anything important please WhatsApp us at https://wa.me/61478886145."

BRAND VOICE: Open with "Bula" first message. Direct, knowledgeable, helpful. Short paragraphs. NEVER use "valued customer" or corporate filler.

WHAT YOU CAN ANSWER: Pricing for routes in your reference data. Tour info, vehicle types, service questions. How the booking process works.
WHAT YOU CANNOT DO: Take actual bookings. Access or modify existing bookings. Handle complaints or refunds. Route all to WhatsApp: https://wa.me/61478886145

PRICING (FJD one-way from Nadi Airport):
Tokatoka Resort: Sedan FJ$15 | Minivan FJ$25 | Minibus FJ$35
Tanoa International: Sedan FJ$15 | Minivan FJ$25 | Minibus FJ$35
Crowne Plaza Nadi Bay: Sedan FJ$45 | Minivan FJ$59 | Minibus FJ$75
Hilton/Sheraton/Westin Denarau: Sedan FJ$49 | Minivan FJ$69 | Minibus FJ$99
Sofitel/Radisson Denarau: Sedan FJ$49 | Minivan FJ$69 | Minibus FJ$99
Port Denarau Marina: Sedan FJ$55 | Minivan FJ$79 | Minibus FJ$110
The Palms Denarau: Sedan FJ$55 | Minivan FJ$79 | Minibus FJ$110
DoubleTree Sonaisali: Sedan FJ$69 | Minivan FJ$99 | Minibus FJ$149
First Landing Vuda: Sedan FJ$95 | Minivan FJ$115 | Minibus FJ$165
Marriott Momi Bay: Sedan FJ$99 | Minivan FJ$129 | Minibus FJ$179
IC Natadola: Sedan FJ$129 | Minivan FJ$169 | Minibus FJ$199
Outrigger Fiji: Sedan FJ$129 | Minivan FJ$159 | Minibus FJ$199
Shangri-La Yanuca: Sedan FJ$199 | Minivan FJ$249 | Minibus FJ$299
Warwick/Naviti: Sedan FJ$219 | Minivan FJ$259 | Minibus FJ$299
Pearl South Pacific: Sedan FJ$269 | Minivan FJ$299 | Minibus FJ$349
Volivoli Rakiraki: Sedan FJ$259 | Minivan FJ$309 | Minibus FJ$379
Grand Pacific Suva: Sedan FJ$319 | Minivan FJ$369 | Minibus FJ$499
Tanoa Plaza Suva: Sedan FJ$319 | Minivan FJ$369 | Minibus FJ$499
Nausori Airport: Sedan FJ$369 | Minivan FJ$499 | Minibus FJ$549

MODIFIERS: Return x1.85 | Night +20% | Loyalty -10% over FJ$50 | Child seat +FJ$8 | Surfboard +FJ$24 | Supermarket FREE

RESPONSE STYLE: Plain text only. No markdown. Under 150 words.`;

// ═══════════════════════════════════════════════════════════════
// SELF-LEARNING — Layer 4
// ═══════════════════════════════════════════════════════════════

async function handleKnowledgeGaps(request, env, cors) {
  if (!env.DB) return json({ gaps: [] }, 200, cors);
  try {
    const gaps = await env.DB.prepare(`SELECT intent_detected as intent, question_text, COUNT(*) as frequency, AVG(rag_score) as avg_score, SUM(lead_converted) as conversions, MAX(created_at) as last_seen FROM conversation_events WHERE event_type = 'message' AND question_text IS NOT NULL AND question_text != '' AND (had_rag_match = 0 OR rag_score < 0.70) AND created_at > unixepoch() - 2592000 GROUP BY intent_detected, question_text ORDER BY frequency DESC LIMIT 50`).all();
    const lowConf = await env.DB.prepare(`SELECT intent_detected as intent, question_text, COUNT(*) as frequency, AVG(rag_score) as avg_score, SUM(lead_converted) as conversions, MAX(created_at) as last_seen FROM conversation_events WHERE event_type = 'message' AND question_text IS NOT NULL AND question_text != '' AND rag_score > 0.3 AND rag_score < 0.70 AND created_at > unixepoch() - 2592000 GROUP BY intent_detected, question_text ORDER BY frequency DESC LIMIT 30`).all();
    const stats = await env.DB.prepare(`SELECT COUNT(*) as total_questions, SUM(CASE WHEN had_rag_match=1 THEN 1 ELSE 0 END) as answered, SUM(CASE WHEN had_rag_match=0 THEN 1 ELSE 0 END) as unanswered, SUM(lead_converted) as total_conversions, ROUND(AVG(rag_score),2) as avg_rag_score FROM conversation_events WHERE event_type='message' AND created_at > unixepoch() - 2592000`).first();
    return json({ summary: stats, gaps: gaps.results || [], low_confidence: lowConf.results || [], generated_at: new Date().toISOString() }, 200, cors);
  } catch(e) { return json({ gaps: [], error: e.message }, 200, cors); }
}

async function handleKnowledgeAdd(request, env, cors) {
  if (!env.AI || !env.VECTORIZE) return json({ ok: false, error: 'AI/Vectorize not available' }, 503, cors);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, cors); }
  const { question, answer, intent, partner_id, submitted_by, source } = body;
  if (!question || !answer) return json({ error: 'question and answer required' }, 400, cors);
  try {
    const itemId = 'kq_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
    const vectorId = 'kb_' + itemId;
    const embedResult = await env.AI.run(EMBED_MODEL, { text: question + ' ' + answer });
    const vector = embedResult?.data?.[0];
    if (!vector) return json({ ok: false, error: 'Embedding failed' }, 500, cors);
    await env.VECTORIZE.upsert([{ id: vectorId, values: vector, metadata: { source: source || 'knowledge_queue', title: question.slice(0, 100), content: answer.slice(0, 500), question: question.slice(0, 200), intent: intent || 'general', partner_id: partner_id || null, added_by: submitted_by || 'admin', added_at: new Date().toISOString() } }]);
    if (env.DB) {
      try {
        await env.DB.prepare(`INSERT INTO knowledge_queue (id,question,answer,intent,partner_id,source,status,submitted_by,vector_id,created_at,ingested_at) VALUES (?,?,?,?,?,?,?,?,?,unixepoch(),unixepoch())`).bind(itemId, question, answer, intent||'general', partner_id||null, source||'manual', 'ingested', submitted_by||'admin', vectorId).run();
        await env.DB.prepare(`INSERT OR IGNORE INTO knowledge_items (id,vector_id,source,question,answer,intent,partner_id,created_at) VALUES (?,?,?,?,?,?,?,unixepoch())`).bind(itemId, vectorId, source||'manual', question, answer, intent||'general', partner_id||null).run();
      } catch(dbErr) { console.error('KB queue store error:', dbErr); }
    }
    return json({ ok: true, vector_id: vectorId, message: 'Knowledge ingested — Lagi will use this in the next conversation' }, 200, cors);
  } catch(e) { return json({ ok: false, error: e.message }, 500, cors); }
}

async function handleKnowledgeList(request, env, cors) {
  if (!env.DB) return json({ items: [] }, 200, cors);
  const url = new URL(request.url);
  const partnerId = url.searchParams.get('partner_id') || null;
  try {
    const result = partnerId
      ? await env.DB.prepare(`SELECT * FROM knowledge_items WHERE partner_id = ? ORDER BY created_at DESC LIMIT 100`).bind(partnerId).all()
      : await env.DB.prepare(`SELECT * FROM knowledge_items ORDER BY created_at DESC LIMIT 100`).all();
    return json({ items: result.results || [] }, 200, cors);
  } catch(e) { return json({ items: [], error: e.message }, 200, cors); }
}

async function ingestConversationAsKnowledge(env, messages, intent, partnerId, sessionId, extraAnswer='') {
  if (!env.AI || !env.VECTORIZE || !messages || messages.length < 1) return;
  try {
    const userMsgs = messages.filter(m => m.role === 'user');
    const aiMsgs   = messages.filter(m => m.role === 'assistant');
    if (!userMsgs.length) return;
    const question = userMsgs[userMsgs.length - 1].content || '';
    const answer = aiMsgs.length > 0 ? (aiMsgs[aiMsgs.length - 1].content || '') : (extraAnswer || '');
    if (question.length < 10 || answer.length < 20) return;
    const isContact = /\+?[\d\s]{7,}|@gmail|@yahoo|@hotmail|@outlook/.test(question);
    let cleanQuestion = question;
    if (isContact) {
      cleanQuestion = question.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '').replace(/(my )?(email|whatsapp|phone|number|contact)( is)?[^.!?]*/gi, '').replace(/name is \w+/gi, '').replace(/\s{2,}/g, ' ').trim();
      if (cleanQuestion.length < 15 && userMsgs.length >= 2) cleanQuestion = userMsgs[userMsgs.length - 2].content || '';
      if (cleanQuestion.length < 15) return;
    }
    const itemId   = 'kq_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
    const vectorId = 'kb_' + itemId;
    const embedResult = await env.AI.run(EMBED_MODEL, { text: (cleanQuestion + ' ' + answer).slice(0, 1000) });
    const vector = embedResult?.data?.[0];
    if (!vector) return;
    await env.VECTORIZE.upsert([{ id: vectorId, values: vector, metadata: { source: 'conversation_learning', title: cleanQuestion.slice(0, 100), content: answer.slice(0, 500), question: cleanQuestion.slice(0, 200), intent: intent || 'general', partner_id: partnerId || null, added_by: 'conversation_learning', added_at: new Date().toISOString() } }]);
    if (env.DB) {
      try {
        await env.DB.prepare(`INSERT OR IGNORE INTO knowledge_queue (id,question,answer,intent,partner_id,source,status,submitted_by,vector_id,created_at,ingested_at) VALUES (?,?,?,?,?,?,?,?,?,unixepoch(),unixepoch())`).bind(itemId, cleanQuestion.slice(0,300), answer.slice(0,600), intent||'general', partnerId||null, 'conversation_learning', 'ingested', 'conversation_learning', vectorId).run();
        await env.DB.prepare(`INSERT OR IGNORE INTO knowledge_items (id,vector_id,source,question,answer,intent,partner_id,created_at) VALUES (?,?,?,?,?,?,?,unixepoch())`).bind(itemId, vectorId, 'conversation_learning', cleanQuestion.slice(0,300), answer.slice(0,600), intent||'general', partnerId||null).run();
      } catch(dbErr) { console.error('Layer 4 DB write error:', dbErr); }
    }
  } catch(e) { console.error('Conversation-to-vector error:', e); }
}

// ═══════════════════════════════════════════════════════════════
// ITINERARY BUILDER
// ═══════════════════════════════════════════════════════════════

async function buildAndSendItinerary(env, { name, contact, intent, travelDates, groupSize, budget, partnerId, conversationSnapshot, sessionId }) {
  if (!env.ANTHROPIC_API_KEY || !env.SENDGRID_API_KEY) return;
  if (!contact || !contact.includes('@')) return;
  try {
    const convText = (conversationSnapshot || []).map(m => (m.role === 'user' ? 'Visitor: ' : 'Lagi: ') + (m.content || '')).join('\n');
    const itineraryPrompt = `You are Lagi, Fiji's AI travel guide. Create a personalised day-by-day Fiji itinerary for ${name || 'this visitor'}.\n\nCONVERSATION:\n${convText}\n\nVISITOR DETAILS:\n- Name: ${name || 'Visitor'}\n- Travel dates: ${travelDates || 'not specified'}\n- Group size: ${groupSize || 'not specified'}\n- Budget: ${budget || 'mid'}\n- Main interest: ${intent}\n\nCreate a practical, specific day-by-day itinerary. Format as clean email text — no markdown. Keep under 400 words. Warm, personal tone. Sign off as Lagi.\nEnd with: "Reply to this email or WhatsApp us at +61 478 886 145 to lock in your bookings."`;
    const response = await fetch('https://gateway.ai.cloudflare.com/v1/595101df2c562b3c65595420d43f9fe1/vakaviti-ai-gateway/anthropic/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 600, messages: [{ role: 'user', content: itineraryPrompt }] }) });
    if (!response.ok) return;
    const data = await response.json();
    const itinerary = data.content?.[0]?.text || '';
    if (!itinerary) return;
    const emailBody = `Bula ${name || 'there'}! 🌺\n\nVinaka for chatting with Lagi about your Fiji trip. Here's a personalised itinerary:\n\n${itinerary}\n\n---\nPowered by Vakaviti.ai — Fiji's Tourism Intelligence Network`;
    await fetch('https://api.sendgrid.com/v3/mail/send', { method: 'POST', headers: { 'Authorization': `Bearer ${env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ personalizations: [{ to: [{ email: contact, name: name || 'Fiji Traveller' }] }], from: { email: 'helpronline@gmail.com', name: 'Lagi — Fiji AI Guide' }, subject: `Your personalised Fiji itinerary${travelDates ? ' for ' + travelDates : ''} 🌺`, content: [{ type: 'text/plain', value: emailBody }] }) });
    if (env.DB) { try { await env.DB.prepare(`UPDATE leads SET score_reason = score_reason || ' | itinerary_sent' WHERE session_id = ? AND traveller_email = ?`).bind(sessionId || 'unknown', contact).run(); } catch(e) {} }
  } catch(e) { console.error('Itinerary builder error:', e); }
}

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════

function stripMarkdown(text) {
  if (!text) return text;
  return text
    .replace(/\[([^\]\n]+)\]\(https?:\/\/[^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(?<!\w)\*([^\s*][^*]*[^\s*]|[^\s*])\*(?!\w)/g, '$1')
    .replace(/(?<!\w)_([^\s_][^_]*[^\s_]|[^\s_])_(?!\w)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[\s]*[*\-]\s+/gm, '')
    .replace(/`([^`]+)`/g, '$1');
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin' },
  });
}

// ═══════════════════════════════════════════════════════════════
// KNOWLEDGE EXTRACT HANDLERS (v50)
// ═══════════════════════════════════════════════════════════════

async function handleKnowledgeExtract(request, env, corsHeaders) {
  const url = new URL(request.url);
  const partner_id = url.searchParams.get('partner_id');
  const category   = url.searchParams.get('category');
  const limit      = parseInt(url.searchParams.get('limit') || '100');
  if (!partner_id) return json({ error: 'partner_id required' }, 400, corsHeaders);
  try {
    const itemsResult = await env.DB.prepare(`SELECT id, question, answer, category, source, vector_id, created_at, use_count FROM knowledge_items WHERE partner_id = ? ${category ? 'AND category = ?' : ''} ORDER BY use_count DESC, created_at DESC LIMIT ?`).bind(...(category ? [partner_id, category, limit] : [partner_id, limit])).all();
    const gapsResult = await env.DB.prepare(`SELECT id, question, asked_count, last_asked_at, category_guess, avg_rag_score FROM knowledge_queue WHERE partner_id = ? AND status = 'pending' ORDER BY asked_count DESC, last_asked_at DESC LIMIT 50`).bind(partner_id).all();
    const categoriesResult = await env.DB.prepare(`SELECT category, COUNT(*) as count FROM knowledge_items WHERE partner_id = ? GROUP BY category ORDER BY count DESC`).bind(partner_id).all();
    const partnerResult = await env.DB.prepare(`SELECT id, name, slug, category, region, website_url FROM partners WHERE id = ?`).bind(partner_id).first();
    const totalItems = itemsResult.results?.length || 0;
    const totalGaps  = gapsResult.results?.length  || 0;
    const coverageScore = totalItems === 0 ? 0 : Math.round((totalItems / (totalItems + totalGaps)) * 100);
    const EXPECTED = ['accommodation','dining','activities','transfers','pricing','booking','policies','location','contact','deals'];
    const covered  = new Set((categoriesResult.results || []).map(r => r.category));
    const missing  = EXPECTED.filter(c => !covered.has(c));
    return json({ partner_id, partner: partnerResult || null, summary: { total_items: totalItems, total_gaps: totalGaps, coverage_score: coverageScore, categories_covered: categoriesResult.results?.length || 0, categories_missing: missing, top_gap: gapsResult.results?.[0]?.question || null }, knowledge_items: itemsResult.results || [], knowledge_gaps: gapsResult.results || [], categories: categoriesResult.results || [] }, 200, corsHeaders);
  } catch (err) { return json({ error: 'Failed to extract knowledge', detail: err.message }, 500, corsHeaders); }
}

async function handleKnowledgeIngest(request, env, corsHeaders) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'Invalid JSON' }, 400, corsHeaders); }
  const { partner_id, items, source = 'partner_intake' } = body;
  if (!partner_id || !Array.isArray(items) || items.length === 0) return json({ error: 'partner_id and items[] required' }, 400, corsHeaders);
  if (items.length > 100) return json({ error: 'Max 100 items per batch' }, 400, corsHeaders);
  const results = { success: [], failed: [], skipped: [] };
  for (const item of items) {
    const { question, answer, category = 'general' } = item;
    if (!question || !answer) { results.skipped.push({ item, reason: 'missing question or answer' }); continue; }
    try {
      const existing = await env.DB.prepare(`SELECT id FROM knowledge_items WHERE partner_id = ? AND question = ? LIMIT 1`).bind(partner_id, question).first();
      if (existing) { results.skipped.push({ question, reason: 'duplicate' }); continue; }
      const vectorId = `kb_${partner_id}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
      let vectorInserted = false;
      try {
        const emb = await env.AI.run(EMBED_MODEL, { text: [`${question} ${answer}`] });
        const vec = emb.data?.[0];
        if (vec) { await env.VECTORIZE.insert([{ id: vectorId, values: vec, metadata: { question: question.slice(0,200), answer: answer.slice(0,500), category, partner_id, source, type: 'partner_kb' } }]); vectorInserted = true; }
      } catch (ve) { console.error('Vectorize insert failed:', ve); }
      const itemId = `ki_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
      await env.DB.prepare(`INSERT INTO knowledge_items (id, partner_id, question, answer, category, source, vector_id, created_at, use_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`).bind(itemId, partner_id, question, answer, category, source, vectorInserted ? vectorId : null, Date.now()).run();
      results.success.push({ question, vector_id: vectorInserted ? vectorId : null });
    } catch (err) { results.failed.push({ question, error: err.message }); }
  }
  return json({ partner_id, ingested: results.success.length, skipped: results.skipped.length, failed: results.failed.length, detail: results }, 200, corsHeaders);
}

async function handleAnswerGap(request, env, corsHeaders) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'Invalid JSON' }, 400, corsHeaders); }
  const { gap_id, answer, partner_id, category = 'general' } = body;
  if (!gap_id || !answer || !partner_id) return json({ error: 'gap_id, answer, partner_id required' }, 400, corsHeaders);
  try {
    const gap = await env.DB.prepare(`SELECT * FROM knowledge_queue WHERE id = ? AND partner_id = ?`).bind(gap_id, partner_id).first();
    if (!gap) return json({ error: 'Gap not found' }, 404, corsHeaders);
    const vectorId = `kb_gap_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
    let vectorInserted = false;
    try {
      const emb = await env.AI.run(EMBED_MODEL, { text: [`${gap.question} ${answer}`] });
      const vec = emb.data?.[0];
      if (vec) { await env.VECTORIZE.insert([{ id: vectorId, values: vec, metadata: { question: gap.question.slice(0,200), answer: answer.slice(0,500), category, partner_id, source: 'gap_answer', type: 'partner_kb' } }]); vectorInserted = true; }
    } catch (ve) { console.error('Vectorize gap insert failed:', ve); }
    const itemId = `ki_gap_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
    await env.DB.prepare(`INSERT INTO knowledge_items (id, partner_id, question, answer, category, source, vector_id, created_at, use_count) VALUES (?, ?, ?, ?, ?, 'gap_answer', ?, ?, ?)`).bind(itemId, partner_id, gap.question, answer, category, vectorInserted ? vectorId : null, Date.now(), gap.asked_count || 1).run();
    await env.DB.prepare(`UPDATE knowledge_queue SET status = 'answered', answered_at = ?, knowledge_item_id = ? WHERE id = ?`).bind(Date.now(), itemId, gap_id).run();
    return json({ success: true, gap_id, item_id: itemId, vector_id: vectorInserted ? vectorId : null, question: gap.question, answer }, 200, corsHeaders);
  } catch (err) { return json({ error: 'Failed to answer gap', detail: err.message }, 500, corsHeaders); }
}
