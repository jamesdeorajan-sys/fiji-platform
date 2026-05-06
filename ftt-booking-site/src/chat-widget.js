/**
 * Fiji Tour Transfers — Customer Chat Widget
 *
 * A floating chat widget that lives on every page of nadiairporttransfers.com.
 *
 * Integration: a single <script src="/chat-widget.js"></script> tag in index.html.
 * The widget self-injects its DOM, styles, and event handlers when the script loads.
 *
 * AI disclosure approach (legal + brand):
 *   - First AI message warmly identifies as AI ("Bula! I'm an AI assistant…")
 *   - Every AI message bubble has a small robot icon + distinct background tint
 *   - Customers asking "are you a bot?" get an honest immediate answer
 *
 * Cost protection:
 *   - Worker enforces $50/day cap (returns 'capacity' message when hit)
 *   - Conversation limit of 30 messages enforced server-side
 *   - Widget gracefully shows the capacity message + WhatsApp link when triggered
 *
 * Privacy:
 *   - No cross-session memory (closes tab → conversation gone)
 *   - No analytics tracking inside the widget
 *   - Worker doesn't log conversation contents
 */

(function() {
  'use strict';

  // ─── Config ─────────────────────────────────────────────────────────
  const WORKER_URL = 'https://fiji-chat-widget.helpronline.workers.dev/';
  const WHATSAPP_URL = 'https://wa.me/61478886145';
  const WHATSAPP_NUMBER = '+61 478 886 145';
  const BRAND_NAME = 'Fiji Tour Transfers';

  // The conversation history sent to the Worker. We keep this in memory
  // only — refresh the page and it's gone. This is intentional; cross-
  // session memory adds privacy/storage complexity we don't need for v1.
  const conversation = [];

  // Whether the widget UI is currently expanded
  let isOpen = false;
  let isLoading = false;

  // Track whether we've sent the first AI greeting yet
  let hasGreeted = false;

  // ─── Inject styles ──────────────────────────────────────────────────
  // All styles scoped under #ftt-chat-widget to avoid colliding with
  // the existing booking widget styles. Variables match your palette.
  const styles = `
    #ftt-chat-widget {
      --ftt-ocean: #0d4d6e;
      --ftt-ocean-deep: #08334a;
      --ftt-sunset: #d97540;
      --ftt-coral: #c83e3e;
      --ftt-paper: #faf6f0;
      --ftt-paper-card: #fffdf8;
      --ftt-paper-warm: #f5ede0;
      --ftt-ai-tint: #eef4f7;
      --ftt-ink: #1a1a1a;
      --ftt-ink-soft: #4a4a4a;
      --ftt-ink-quiet: #8a8580;
      --ftt-line: #d8d0c2;
      --ftt-line-soft: #ebe5d6;
      --ftt-shadow: 0 8px 32px rgba(8, 51, 74, 0.18), 0 2px 8px rgba(8, 51, 74, 0.08);
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: var(--ftt-ink);
    }
    #ftt-chat-widget * { box-sizing: border-box; margin: 0; padding: 0; }

    /* ─── Floating launcher button ─── */
    #ftt-chat-launcher {
      width: 60px; height: 60px;
      border-radius: 50%;
      background: var(--ftt-ocean);
      color: var(--ftt-paper);
      border: none;
      cursor: pointer;
      box-shadow: var(--ftt-shadow);
      display: flex; align-items: center; justify-content: center;
      transition: transform 0.2s, background 0.2s;
      position: relative;
    }
    #ftt-chat-launcher:hover { background: var(--ftt-ocean-deep); transform: scale(1.05); }
    #ftt-chat-launcher.open { background: var(--ftt-ink); }
    #ftt-chat-launcher svg { width: 28px; height: 28px; transition: transform 0.2s; }

    /* small "Ask us" tooltip that fades in on first load */
    #ftt-chat-tooltip {
      position: absolute;
      right: 70px; top: 50%;
      transform: translateY(-50%);
      background: var(--ftt-ink);
      color: var(--ftt-paper);
      padding: 8px 14px;
      border-radius: 18px 18px 4px 18px;
      font-size: 13px;
      white-space: nowrap;
      box-shadow: var(--ftt-shadow);
      opacity: 0;
      animation: ftt-tooltip-in 0.4s 1.5s forwards, ftt-tooltip-out 0.4s 8s forwards;
      pointer-events: none;
    }
    @keyframes ftt-tooltip-in { to { opacity: 1; transform: translateY(-50%) translateX(0); } }
    @keyframes ftt-tooltip-out { to { opacity: 0; transform: translateY(-50%) translateX(8px); } }

    /* ─── Chat panel ─── */
    #ftt-chat-panel {
      position: absolute;
      bottom: 76px; right: 0;
      width: 380px;
      max-width: calc(100vw - 32px);
      height: 560px;
      max-height: calc(100vh - 120px);
      background: var(--ftt-paper);
      border-radius: 16px;
      box-shadow: var(--ftt-shadow);
      display: none;
      flex-direction: column;
      overflow: hidden;
      transform: translateY(20px) scale(0.96);
      opacity: 0;
      transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s;
    }
    #ftt-chat-panel.open { display: flex; transform: translateY(0) scale(1); opacity: 1; }

    /* Header */
    #ftt-chat-header {
      padding: 16px 20px;
      background: var(--ftt-ocean);
      color: var(--ftt-paper);
      display: flex; align-items: center; gap: 12px;
      border-bottom: 1px solid var(--ftt-ocean-deep);
    }
    #ftt-chat-header-title { font-weight: 600; font-size: 15px; flex: 1; line-height: 1.2; }
    #ftt-chat-header-subtitle { font-size: 11px; opacity: 0.85; font-weight: 400; margin-top: 2px; }
    #ftt-chat-close {
      background: none; border: none; color: var(--ftt-paper);
      cursor: pointer; padding: 4px; opacity: 0.8;
      display: flex; align-items: center; justify-content: center;
    }
    #ftt-chat-close:hover { opacity: 1; }
    #ftt-chat-close svg { width: 18px; height: 18px; }

    /* Messages area */
    #ftt-chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex; flex-direction: column; gap: 10px;
      background: var(--ftt-paper);
      scroll-behavior: smooth;
    }
    .ftt-msg {
      max-width: 85%;
      padding: 10px 14px;
      border-radius: 16px;
      font-size: 14px;
      line-height: 1.45;
      word-wrap: break-word;
      white-space: pre-wrap;
    }
    .ftt-msg-user {
      align-self: flex-end;
      background: var(--ftt-ocean);
      color: var(--ftt-paper);
      border-bottom-right-radius: 4px;
    }
    .ftt-msg-ai {
      align-self: flex-start;
      background: var(--ftt-ai-tint);
      color: var(--ftt-ink);
      border-bottom-left-radius: 4px;
      border-left: 3px solid var(--ftt-ocean);
      padding-left: 12px;
      position: relative;
    }
    .ftt-msg-ai::before {
      content: '';
      display: inline-block;
      width: 14px; height: 14px;
      background-image: url("data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%230d4d6e'%3E%3Cpath d='M12 2a2 2 0 0 1 2 2v1h3a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3h3V4a2 2 0 0 1 2-2zm-3 8a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm6 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm-6 5h6v1H9v-1z'/%3E%3C/svg%3E");
      background-size: contain; background-repeat: no-repeat;
      vertical-align: -2px;
      margin-right: 5px;
    }
    .ftt-msg-ai a {
      color: var(--ftt-ocean);
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .ftt-msg-error {
      align-self: center;
      background: rgba(200, 62, 62, 0.08);
      border: 1px solid rgba(200, 62, 62, 0.25);
      color: var(--ftt-coral);
      font-size: 13px;
      max-width: 90%;
      text-align: center;
    }

    /* Loading dots */
    .ftt-loading {
      align-self: flex-start;
      background: var(--ftt-ai-tint);
      border-bottom-left-radius: 4px;
      border-left: 3px solid var(--ftt-ocean);
      padding: 12px 16px;
      display: flex; gap: 4px;
    }
    .ftt-loading span {
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--ftt-ocean);
      opacity: 0.4;
      animation: ftt-pulse 1.2s infinite;
    }
    .ftt-loading span:nth-child(2) { animation-delay: 0.2s; }
    .ftt-loading span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes ftt-pulse { 0%, 80%, 100% { opacity: 0.3; transform: scale(0.85); } 40% { opacity: 1; transform: scale(1); } }

    /* Input area */
    #ftt-chat-input-area {
      border-top: 1px solid var(--ftt-line-soft);
      padding: 12px 14px;
      background: var(--ftt-paper-card);
      display: flex; flex-direction: column; gap: 8px;
    }
    #ftt-chat-input-row {
      display: flex; gap: 8px; align-items: flex-end;
    }
    #ftt-chat-input {
      flex: 1;
      border: 1px solid var(--ftt-line);
      border-radius: 18px;
      padding: 9px 14px;
      font-family: inherit;
      font-size: 14px;
      line-height: 1.4;
      resize: none;
      max-height: 100px;
      min-height: 38px;
      background: var(--ftt-paper);
      color: var(--ftt-ink);
      outline: none;
      transition: border-color 0.15s;
    }
    #ftt-chat-input:focus { border-color: var(--ftt-ocean); }
    #ftt-chat-send {
      background: var(--ftt-ocean);
      color: var(--ftt-paper);
      border: none;
      border-radius: 50%;
      width: 38px; height: 38px;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
      transition: background 0.15s, opacity 0.15s;
    }
    #ftt-chat-send:hover:not(:disabled) { background: var(--ftt-ocean-deep); }
    #ftt-chat-send:disabled { opacity: 0.4; cursor: not-allowed; }
    #ftt-chat-send svg { width: 16px; height: 16px; }

    /* WhatsApp escape hatch */
    #ftt-chat-whatsapp {
      display: flex; align-items: center; justify-content: center; gap: 6px;
      padding: 7px 12px;
      background: transparent;
      border: 1px solid var(--ftt-line);
      border-radius: 16px;
      color: var(--ftt-ink-soft);
      text-decoration: none;
      font-size: 12px;
      font-weight: 500;
      transition: all 0.15s;
    }
    #ftt-chat-whatsapp:hover {
      background: #25d366;
      border-color: #25d366;
      color: white;
    }
    #ftt-chat-whatsapp svg { width: 14px; height: 14px; flex-shrink: 0; }

    /* Mobile adjustments */
    @media (max-width: 480px) {
      #ftt-chat-widget { bottom: 16px; right: 16px; }
      #ftt-chat-panel {
        width: calc(100vw - 32px);
        height: calc(100vh - 100px);
        bottom: 76px;
      }
      #ftt-chat-launcher { width: 54px; height: 54px; }
      #ftt-chat-launcher svg { width: 24px; height: 24px; }
      #ftt-chat-tooltip { display: none; }
    }
  `;

  // ─── Build DOM ──────────────────────────────────────────────────────
  function injectWidget() {
    const styleEl = document.createElement('style');
    styleEl.id = 'ftt-chat-widget-styles';
    styleEl.textContent = styles;
    document.head.appendChild(styleEl);

    const widget = document.createElement('div');
    widget.id = 'ftt-chat-widget';
    widget.innerHTML = `
      <button id="ftt-chat-launcher" aria-label="Open chat">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 6h-2v9H6v2c0 .55.45 1 1 1h11l4 4V7c0-.55-.45-1-1-1zm-4 6V3c0-.55-.45-1-1-1H3c-.55 0-1 .45-1 1v14l4-4h10c.55 0 1-.45 1-1z"/></svg>
        <span id="ftt-chat-tooltip">Ask us anything!</span>
      </button>

      <div id="ftt-chat-panel" role="dialog" aria-label="Chat with Fiji Tour Transfers">
        <div id="ftt-chat-header">
          <div style="flex:1">
            <div id="ftt-chat-header-title">${BRAND_NAME}</div>
            <div id="ftt-chat-header-subtitle">Quick answers · pricing, tours, anything</div>
          </div>
          <button id="ftt-chat-close" aria-label="Close chat">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>

        <div id="ftt-chat-messages" aria-live="polite"></div>

        <div id="ftt-chat-input-area">
          <div id="ftt-chat-input-row">
            <textarea id="ftt-chat-input" placeholder="Type your question..." rows="1" aria-label="Type your message"></textarea>
            <button id="ftt-chat-send" aria-label="Send message">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
            </button>
          </div>
          <a href="${WHATSAPP_URL}" id="ftt-chat-whatsapp" target="_blank" rel="noopener">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z"/></svg>
            Continue on WhatsApp
          </a>
        </div>
      </div>
    `;
    document.body.appendChild(widget);
  }

  // ─── Helpers ────────────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // Convert plain text to HTML, turning bare URLs (esp. wa.me links) into clickable links
  function linkifyText(text) {
    const escaped = escapeHtml(text);
    // Match http(s) URLs including wa.me links
    return escaped.replace(/(https?:\/\/[^\s<]+)/g, (url) => {
      return `<a href="${url}" target="_blank" rel="noopener">${url}</a>`;
    });
  }

  function renderMessage(role, text, opts = {}) {
    const messages = document.getElementById('ftt-chat-messages');
    const div = document.createElement('div');
    div.className = `ftt-msg ftt-msg-${role}`;
    if (opts.isError) div.classList.add('ftt-msg-error');
    if (role === 'ai') {
      div.innerHTML = linkifyText(text);
    } else {
      div.textContent = text;
    }
    messages.appendChild(div);
    requestAnimationFrame(() => { messages.scrollTop = messages.scrollHeight; });
  }

  function showLoading() {
    const messages = document.getElementById('ftt-chat-messages');
    const div = document.createElement('div');
    div.className = 'ftt-loading';
    div.id = 'ftt-loading-indicator';
    div.innerHTML = '<span></span><span></span><span></span>';
    messages.appendChild(div);
    requestAnimationFrame(() => { messages.scrollTop = messages.scrollHeight; });
  }

  function hideLoading() {
    const indicator = document.getElementById('ftt-loading-indicator');
    if (indicator) indicator.remove();
  }

  function setSendDisabled(disabled) {
    document.getElementById('ftt-chat-send').disabled = disabled;
    document.getElementById('ftt-chat-input').disabled = disabled;
  }

  // ─── Open / close panel ─────────────────────────────────────────────
  function openPanel() {
    isOpen = true;
    document.getElementById('ftt-chat-panel').classList.add('open');
    document.getElementById('ftt-chat-launcher').classList.add('open');

    // Send the AI greeting on first open
    if (!hasGreeted) {
      hasGreeted = true;
      const greeting = `Bula! I'm an AI assistant for ${BRAND_NAME}. I can answer pricing, tour, and vehicle questions instantly. For bookings, our easy form is right above. For anything urgent or specific, I'll connect you to our team on WhatsApp.

What can I help with?`;
      renderMessage('ai', greeting);
    }

    // Focus the input after the panel slides up
    setTimeout(() => {
      document.getElementById('ftt-chat-input').focus();
    }, 250);
  }

  function closePanel() {
    isOpen = false;
    document.getElementById('ftt-chat-panel').classList.remove('open');
    document.getElementById('ftt-chat-launcher').classList.remove('open');
  }

  // ─── Send a message ─────────────────────────────────────────────────
  async function sendMessage() {
    if (isLoading) return;
    const input = document.getElementById('ftt-chat-input');
    const text = input.value.trim();
    if (!text) return;

    // Render user message immediately
    renderMessage('user', text);
    input.value = '';
    input.style.height = 'auto';

    // Append to conversation history
    conversation.push({ role: 'user', content: text });

    // Show loading + lock input
    isLoading = true;
    setSendDisabled(true);
    showLoading();

    try {
      const response = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: conversation }),
      });

      const data = await response.json().catch(() => null);

      hideLoading();

      if (!response.ok || !data) {
        renderMessage('ai',
          `Sorry, I'm having trouble right now. Please WhatsApp us at ${WHATSAPP_URL} and we'll help straight away.`,
          { isError: true });
        return;
      }

      // Worker returns { type: 'reply' | 'capacity' | 'error', message: string, whatsappUrl? }
      const replyText = data.message || "Sorry, I didn't catch that.";
      renderMessage('ai', replyText);

      // Only push to history if it was a real reply (not a capacity/error message)
      if (data.type === 'reply') {
        conversation.push({ role: 'assistant', content: replyText });
      }
    } catch (err) {
      hideLoading();
      renderMessage('ai',
        `Connection issue — please try again, or WhatsApp us at ${WHATSAPP_URL}.`,
        { isError: true });
    } finally {
      isLoading = false;
      setSendDisabled(false);
      document.getElementById('ftt-chat-input').focus();
    }
  }

  // ─── Auto-resize the textarea as user types ─────────────────────────
  function autoResizeInput() {
    const input = document.getElementById('ftt-chat-input');
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
  }

  // ─── Wire events ────────────────────────────────────────────────────
  function wireEvents() {
    document.getElementById('ftt-chat-launcher').addEventListener('click', () => {
      isOpen ? closePanel() : openPanel();
    });
    document.getElementById('ftt-chat-close').addEventListener('click', closePanel);
    document.getElementById('ftt-chat-send').addEventListener('click', sendMessage);
    document.getElementById('ftt-chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    document.getElementById('ftt-chat-input').addEventListener('input', autoResizeInput);
  }

  // ─── Initialise ─────────────────────────────────────────────────────
  function init() {
    if (document.getElementById('ftt-chat-widget')) return; // prevent double-injection
    injectWidget();
    wireEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
