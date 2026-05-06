/* ═══════════════════════════════════════════════
   VAKAVITI — Sponsors, Prizes & Winner Popup
   ═══════════════════════════════════════════════
   · Monthly sponsor banner on homepage
   · Winner contact popup when player hits Matai/Turaga
   · Slow Rules breakdown in Speed Board
   ═══════════════════════════════════════════════ */

// ── Sponsor / Prize Data ─────────────────────────
// One entry per month. activeMonth: "YYYY-MM" or use index rotation.
// To update each month: add a new entry at the top of SPONSORS array.
const SPONSORS = [
  {
    month:       '2026-04',
    brand:       'Fiji Tour Transfers',
    logo:        '🚐',
    url:         'https://www.fijitourtransfers.com',
    prize:       'Free Airport Transfer for Two',
    detail:      'Return airport transfer from Nadi International Airport to any Coral Coast resort, for 2 people. Valid 12 months.',
    minTier:     'Matai',         // Matai or Turaga eligible
    minTierIdx:  3,               // LEVELS index (0=Vulagi … 4=Turaga)
    color:       '#0a6e7c',
    accentColor: '#c47b2b',
  },
  {
    month:       '2026-05',
    brand:       'Taki Mai Resort',
    logo:        '🏝️',
    url:         'https://www.fijitourtransfers.com',
    prize:       'One Night Overwater Bure Stay',
    detail:      'A romantic one-night stay in an overwater bure with breakfast included. Proudly sponsored by Taki Mai Resort.',
    minTier:     'Matai',
    minTierIdx:  3,
    color:       '#1a6b8a',
    accentColor: '#e08b2a',
  },
  {
    month:       '2026-06',
    brand:       'Bula Coffee Co.',
    logo:        '☕',
    url:         'https://www.fijitourtransfers.com',
    prize:       'Premium Fijian Coffee Hamper',
    detail:      'A curated hamper of 100% Fijian-grown arabica coffee, teas, and local treats — delivered to your door anywhere in Fiji.',
    minTier:     'Cauravou',
    minTierIdx:  2,
    color:       '#5c3d2e',
    accentColor: '#e0a060',
  },
];

// ── localStorage key used by admin page ─────────
const SPONSORS_ADMIN_KEY = 'vakaviti_sponsors_admin';

// ── Merge: admin overrides take priority over hardcoded defaults ─
function _getMergedSponsors() {
  try {
    const raw = localStorage.getItem(SPONSORS_ADMIN_KEY);
    if (raw) {
      const adminList = JSON.parse(raw);
      if (Array.isArray(adminList) && adminList.length) return adminList;
    }
  } catch {}
  return SPONSORS;
}

// ── Active sponsor: match by current month, fallback to first ─
function _getActiveSponsor() {
  const now      = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const list     = _getMergedSponsors();
  return list.find(s => s.month === monthKey) || list[0];
}

// ── Render sponsor banner ────────────────────────
function _renderSponsorBanner() {
  const sp = _getActiveSponsor();
  if (!sp) return;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const setHTML = (id, val) => { const el = document.getElementById(id); if (el) el.innerHTML = val; };
  const setAttr = (id, attr, val) => { const el = document.getElementById(id); if (el) el.setAttribute(attr, val); };

  set('sponsorPrizeName',   sp.prize);
  set('sponsorPrizeDetail', sp.detail);
  set('sponsorLogoEmoji',   sp.logo);
  set('sponsorBrandName',   sp.brand);
  set('sponsorTierLabel',   sp.minTier + ' or above');
  set('sponsorCtaTier',     sp.minTier);
  setAttr('sponsorBrandLink', 'href', sp.url);

  // Apply brand colour to banner
  const banner = document.getElementById('sponsorBanner');
  if (banner) {
    banner.style.setProperty('--sp-color', sp.color);
    banner.style.setProperty('--sp-accent', sp.accentColor);
  }
}

// ── Winner popup: show when player crosses minTierIdx ─
const WINNER_SEEN_KEY = 'vakaviti_winner_seen';

function _getWinnerSeenTiers() {
  try { return JSON.parse(localStorage.getItem(WINNER_SEEN_KEY) || '[]'); } catch { return []; }
}
function _markWinnerTierSeen(tierTitle) {
  const seen = _getWinnerSeenTiers();
  if (!seen.includes(tierTitle)) { seen.push(tierTitle); }
  try { localStorage.setItem(WINNER_SEEN_KEY, JSON.stringify(seen)); } catch {}
}

function _showWinnerPopup(tierTitle, tierIdx) {
  const sp = _getActiveSponsor();
  if (!sp) return;
  // Only show for tiers at or above the sponsor threshold
  if (tierIdx < sp.minTierIdx) return;
  // Don't show again for the same tier
  if (_getWinnerSeenTiers().includes(tierTitle)) return;
  _markWinnerTierSeen(tierTitle);

  const overlay = document.getElementById('winnerOverlay');
  if (!overlay) return;

  // Populate tier badge
  const badge = document.getElementById('winnerBadge');
  if (badge) { badge.textContent = tierTitle; badge.dataset.tier = tierTitle.toLowerCase(); }

  const title = document.getElementById('winnerTitle');
  if (title) title.textContent = `\ud83c\udfc6 You've reached ${tierTitle}!`;

  // Populate prize preview
  const preview = document.getElementById('winnerPrizePreview');
  if (preview) {
    preview.innerHTML = `
      <div class="winner-prize-card">
        <span class="winner-prize-emoji">${sp.logo}</span>
        <div>
          <p class="winner-prize-card-name">${sp.prize}</p>
          <p class="winner-prize-card-brand">Sponsored by <strong>${sp.brand}</strong></p>
          <p class="winner-prize-card-detail">${sp.detail}</p>
        </div>
      </div>
    `;
  }

  overlay.hidden = false;
  overlay.classList.add('winner-visible');
}

function _closeWinnerPopup() {
  const overlay = document.getElementById('winnerOverlay');
  if (!overlay) return;
  overlay.classList.remove('winner-visible');
  setTimeout(() => { overlay.hidden = true; }, 300);
}

function _submitWinnerForm(e) {
  e.preventDefault();
  const name     = (document.getElementById('winnerName')?.value   || '').trim();
  const phone    = (document.getElementById('winnerPhone')?.value  || '').trim();
  const location = (document.getElementById('winnerLocation')?.value || '').trim();
  const sp       = _getActiveSponsor();

  if (!name || !phone) {
    // Shake the empty fields
    ['winnerName', 'winnerPhone'].forEach(id => {
      const el = document.getElementById(id);
      if (el && !el.value.trim()) {
        el.classList.remove('winner-input-shake');
        void el.offsetWidth;
        el.classList.add('winner-input-shake');
      }
    });
    return;
  }

  const tier = document.getElementById('winnerBadge')?.textContent || '';
  const msg  = encodeURIComponent(
    `\ud83c\udfc6 Vakaviti Prize Claim\n\n` +
    `Name: ${name}\n` +
    `Tier: ${tier}\n` +
    `WhatsApp: ${phone}\n` +
    `Location: ${location || 'Not provided'}\n` +
    `Prize: ${sp ? sp.prize : 'This month\u2019s prize'}\n` +
    `Sponsor: ${sp ? sp.brand : ''}\n\n` +
    `Please verify my score and send my prize. Vinaka! \ud83c\udf34`
  );

  const waNumber = '61478886145';
  window.open(`https://wa.me/${waNumber}?text=${msg}`, '_blank');

  // Show confirmation and close after a moment
  const btn = document.getElementById('winnerSubmitBtn');
  if (btn) { btn.textContent = '\u2705 Sent! We\u2019ll be in touch.'; btn.disabled = true; }
  setTimeout(_closeWinnerPopup, 2500);
}

// ── Hook into xp.js level-up events ─────────────
// Called from xp.js after _showLevelUpToast — we piggy-back with a small delay
function _onLevelUp(tierTitle, tierIdx) {
  // Delay so level-up banner shows first, then winner popup appears after
  setTimeout(() => _showWinnerPopup(tierTitle, tierIdx), 6000);
}

// Patch xp.js _showLevelUpToast to also call us
// We do this safely by wrapping at runtime in sponsorsInit()
function _patchLevelUp() {
  const originalFn = window._showLevelUpToast;  // may not be accessible (private)
  // Instead, poll xpGetLevel every 2s and compare — lightweight approach
  let _lastKnownTierIdx = -1;
  setInterval(() => {
    if (typeof xpGetLevel !== 'function' || typeof xpRead !== 'function') return;
    const data  = xpRead();
    const level = xpGetLevel(data.total);
    if (_lastKnownTierIdx === -1) {
      _lastKnownTierIdx = level.index;
      return;
    }
    if (level.index > _lastKnownTierIdx) {
      _lastKnownTierIdx = level.index;
      _onLevelUp(level.title, level.index);
    }
  }, 2000);
}

// ── Slow Rules Breakdown (in Speed Board) ────────
// Rule definitions with friendly labels
const SLOW_RULES_META = [
  { letter: 'b', label: 'B → mb', color: '#0a6e7c' },
  { letter: 'c', label: 'C → th', color: '#3d9e6e' },
  { letter: 'd', label: 'D → nd', color: '#e08b2a' },
  { letter: 'g', label: 'G → ng', color: '#c47b2b' },
  { letter: 'q', label: 'Q → ngg', color: '#7c5cbf' },
];

function renderSlowRules() {
  const container = document.getElementById('phSbRuleBars');
  const section   = document.getElementById('phSbSlowRules');
  if (!container || !section) return;

  // Load times from phonetics store
  let store = {};
  try { store = JSON.parse(localStorage.getItem('vakaviti_ph_times') || '{}'); } catch {}

  const entries = Object.entries(store);
  if (!entries.length) { section.hidden = true; return; }

  // For each rule, collect all entries whose word contains that letter
  const ruleData = SLOW_RULES_META.map(rule => {
    const matching = entries.filter(([word]) => new RegExp(rule.letter, 'i').test(word));
    if (!matching.length) return { ...rule, avg: null, count: 0 };
    const avg = matching.reduce((sum, [, d]) => sum + d.best, 0) / matching.length;
    return { ...rule, avg: Math.round(avg), count: matching.length };
  }).filter(r => r.avg !== null);

  if (!ruleData.length) { section.hidden = true; return; }

  section.hidden = false;

  const maxAvg = Math.max(...ruleData.map(r => r.avg));

  container.innerHTML = ruleData
    .sort((a, b) => b.avg - a.avg) // slowest first
    .map(r => {
      const barPct = Math.round((r.avg / maxAvg) * 100);
      const hue    = Math.round(120 - (barPct / 100) * 120);
      const avgSec = (r.avg / 1000).toFixed(1) + 's avg';
      return `
        <div class="ph-sb-rule-row">
          <div class="ph-sb-rule-header">
            <span class="ph-sb-rule-name">${r.label}</span>
            <span class="ph-sb-rule-count">${r.count} word${r.count !== 1 ? 's' : ''}</span>
            <span class="ph-sb-rule-avg">${avgSec}</span>
          </div>
          <div class="ph-sb-bar-wrap">
            <div class="ph-sb-bar" style="width:${barPct}%;background:hsl(${hue},65%,48%)"></div>
          </div>
        </div>
      `;
    }).join('');
}

// ── Sponsor Landing Section ─────────────────────
function _renderSponsorLanding() {
  const grid = document.getElementById('slPrizeGrid');
  if (!grid) return;

  const now        = new Date();
  const activeKey  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const list       = _getMergedSponsors();

  // Build month labels
  const monthLabel = ym => {
    if (!ym) return '';
    const [y, m] = ym.split('-');
    return new Date(+y, +m - 1, 1).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
  };

  const isPast   = sp => sp.month < activeKey;
  const isActive = sp => sp.month === activeKey;

  grid.innerHTML = list.map(sp => {
    const active = isActive(sp);
    const past   = isPast(sp);
    const tierClass = `sl-tier-${sp.minTier}`;

    // Colour bar uses brand colour
    const barColor = sp.color || '#0a6e7c';

    return `
      <div class="sl-prize-card${active ? ' sl-card-active' : ''}${past ? ' sl-card-past' : ''}">
        <div class="sl-card-bar" style="background:${barColor}"></div>
        ${active ? '<div class="sl-active-badge">\u2605 Active Now</div>' : ''}
        <div class="sl-card-body">
          <div class="sl-card-month">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            ${monthLabel(sp.month)}${past ? ' <em style="font-weight:400;opacity:0.7">(ended)</em>' : ''}
          </div>
          <div class="sl-card-brand-row">
            <div class="sl-card-emoji" aria-hidden="true">${sp.logo || '\uD83C\uDF34'}</div>
            <div class="sl-card-brand-info">
              <div class="sl-card-brand-name">${_esc(sp.brand)}</div>
              ${sp.url ? `<a class="sl-card-brand-link" href="${_esc(sp.url)}" target="_blank" rel="noopener">${_esc(sp.url.replace(/^https?:\/\/(www\.)?/, ''))}</a>` : ''}
            </div>
          </div>
          <div class="sl-card-prize">${_esc(sp.prize)}</div>
          <div class="sl-card-detail">${_esc(sp.detail || '')}</div>
          <span class="sl-card-tier ${tierClass}">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
            ${_esc(sp.minTier)}+ tier required
          </span>
        </div>
      </div>
    `;
  }).join('');
}

function _esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Init ─────────────────────────────────────────
function sponsorsInit() {
  // Render sponsor banner + landing section + leaderboard
  _renderSponsorBanner();
  _renderSponsorLanding();
  _initSlLeaderboardTabs();

  // Winner popup: skip / submit
  const skipBtn = document.getElementById('winnerSkipBtn');
  if (skipBtn) skipBtn.addEventListener('click', _closeWinnerPopup);

  const form = document.getElementById('winnerForm');
  if (form) form.addEventListener('submit', _submitWinnerForm);

  // Backdrop close
  const overlay = document.getElementById('winnerOverlay');
  if (overlay) {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) _closeWinnerPopup();
    });
  }

  // Input shake class auto-removal
  document.querySelectorAll('.winner-input').forEach(input => {
    input.addEventListener('animationend', () => input.classList.remove('winner-input-shake'));
  });

  // Patch level-up detection
  _patchLevelUp();

  // Expose renderSlowRules globally so Speed Board can call it
  window.renderSlowRules = renderSlowRules;

  // Hook Speed Board open to render slow rules
  const sbBtn = document.getElementById('phSpeedBoardBtn');
  if (sbBtn) {
    sbBtn.addEventListener('click', () => {
      // Small delay so Speed Board renders first
      setTimeout(renderSlowRules, 100);
    });
  }
}

// ── Sponsor Landing Leaderboard ───────────────────
// Reads PUBLIC_TOP10 from xp.js and renders into #slLbRows
// with tier filter tabs

let _slLbActiveFilter = 'All';

function _renderSlLeaderboard(filter) {
  const container = document.getElementById('slLbRows');
  if (!container) return;

  // PUBLIC_TOP10 is defined in xp.js — use it directly
  if (typeof PUBLIC_TOP10 === 'undefined' || !PUBLIC_TOP10.length) {
    container.innerHTML = '<div class="sl-lb-empty">No scores yet — be the first to claim a spot!</div>';
    return;
  }

  const filtered = filter && filter !== 'All'
    ? PUBLIC_TOP10.filter(e => e.tier === filter)
    : PUBLIC_TOP10;

  if (!filtered.length) {
    container.innerHTML = '<div class="sl-lb-empty">No players in this tier yet. Start learning to be first!</div>';
    return;
  }

  const maxXP = filtered[0].xp || 1;
  const medals = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'];

  container.innerHTML = filtered.map((entry, i) => {
    const displayRank = filter && filter !== 'All' ? i + 1 : entry.rank;
    const medal = medals[displayRank - 1] || displayRank;
    const barPct = Math.round((entry.xp / maxXP) * 100);
    const isTop3 = displayRank <= 3;

    return `
      <div class="sl-lb-row${isTop3 ? ' sl-lb-top3' : ''}">
        <div class="sl-lb-rank">${medal}</div>
        <div class="sl-lb-name-cell">
          <div class="sl-lb-name">
            <span class="sl-lb-flag">${entry.flag || ''}</span>
            ${_esc(entry.name)}
          </div>
          ${entry.note ? `<div class="sl-lb-note">${_esc(entry.note)}</div>` : ''}
        </div>
        <div>
          <span class="sl-lb-tier sl-lb-tier-${entry.tier}">${_esc(entry.tier)}</span>
        </div>
        <div class="sl-lb-xp-cell">
          <div class="sl-lb-xp-num">${entry.xp.toLocaleString()}</div>
          <div class="sl-lb-xp-bar-wrap">
            <div class="sl-lb-xp-bar" style="width:${barPct}%"></div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function _initSlLeaderboardTabs() {
  const tabs = document.getElementById('slLbTabs');
  if (!tabs) return;

  // Initial render
  _renderSlLeaderboard('All');

  tabs.addEventListener('click', e => {
    const btn = e.target.closest('.sl-lb-tab');
    if (!btn) return;
    tabs.querySelectorAll('.sl-lb-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    _slLbActiveFilter = btn.dataset.tier || 'All';
    _renderSlLeaderboard(_slLbActiveFilter);
  });
}
