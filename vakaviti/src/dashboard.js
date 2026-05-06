/* ═══════════════════════════════════════════════
   VAKAVITI — Progress Dashboard
   Reads SR card state from drill.js / srReadAll()
   and renders a breakdown panel across all 105 words.

   States (per mode):
   ─ Unseen    : word not yet in SR bank (never missed)
   ─ Learning  : card in bank, interval === 0
   ─ Due       : card in bank, interval > 0, due <= today
   ─ Review    : card in bank, interval 1–6 days, due > today
   ─ Strong    : card in bank, interval >= 7 days, due > today
   ─ Graduated : removed from bank after reaching 21d + streak 3
                 (tracked separately in 'vakaviti_graduated')
   ═══════════════════════════════════════════════ */

const GRAD_KEY = 'vakaviti_graduated';
let _memoryGrad = null;

// ── Graduated word tracking ────────────────────
function gradReadAll() {
  try {
    const raw = localStorage.getItem(GRAD_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  if (_memoryGrad) return JSON.parse(JSON.stringify(_memoryGrad));
  return { forward: [], reverse: [] };
}

function gradWriteAll(data) {
  _memoryGrad = JSON.parse(JSON.stringify(data));
  try { localStorage.setItem(GRAD_KEY, JSON.stringify(data)); } catch (_) {}
}

/** Called from drill.js when a card graduates. */
function gradRecord(wordId, mode) {
  const all = gradReadAll();
  if (!all[mode]) all[mode] = [];
  if (!all[mode].includes(wordId)) all[mode].push(wordId);
  gradWriteAll(all);
}

function gradCount(mode) {
  return (gradReadAll()[mode] || []).length;
}

function gradIds(mode) {
  return new Set(gradReadAll()[mode] || []);
}

// ── State computation ──────────────────────────
const STATES = ['unseen', 'learning', 'due', 'review', 'strong', 'graduated'];

const STATE_META = {
  unseen:     { label: 'Unseen',     color: 'var(--dash-unseen)',     desc: 'Not yet encountered in a quiz' },
  learning:   { label: 'Learning',   color: 'var(--dash-learning)',   desc: 'Recently missed — interval reset to 0' },
  due:        { label: 'Due',        color: 'var(--dash-due)',        desc: 'Ready for review today' },
  review:     { label: 'Review',     color: 'var(--dash-review)',     desc: 'Scheduled — interval 1–6 days' },
  strong:     { label: 'Strong',     color: 'var(--dash-strong)',     desc: 'Well-established — interval 7+ days' },
  graduated:  { label: 'Graduated',  color: 'var(--dash-graduated)', desc: 'Mastered — won\'t appear in drills' },
};

function computeBreakdown(mode) {
  const today   = todayISO();
  const cards   = srAllCards(mode);         // from drill.js
  const gradSet = gradIds(mode);
  const total   = FIJIAN_WORDS.length;      // 105

  const counts = { unseen: 0, learning: 0, due: 0, review: 0, strong: 0, graduated: gradSet.size };

  FIJIAN_WORDS.forEach(word => {
    const id   = word.id;
    if (gradSet.has(id)) return; // already counted as graduated

    const card = cards[id];
    if (!card) {
      counts.unseen++;
      return;
    }
    if (card.interval === 0) {
      counts.learning++;
    } else if (card.due <= today) {
      counts.due++;
    } else if (card.interval < 7) {
      counts.review++;
    } else {
      counts.strong++;
    }
  });

  return { counts, total };
}

// ── Dashboard panel open/close ────────────────
let _dashMode = 'forward';

function openDashboard() {
  document.getElementById('dashPanel').hidden        = false;
  document.getElementById('dashBackdrop').hidden     = false;
  document.body.classList.add('panel-open');
  renderDashboard(_dashMode);
}

function closeDashboard() {
  document.getElementById('dashPanel').hidden    = true;
  document.getElementById('dashBackdrop').hidden = true;
  document.body.classList.remove('panel-open');
}

// ── Render ─────────────────────────────────────
function renderDashboard(mode) {
  _dashMode = mode;

  // Update tab active state
  document.querySelectorAll('.dash-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  const { counts, total } = computeBreakdown(mode);

  // KPI: due count
  const dueEl = document.getElementById('dashDueKPI');
  if (dueEl) {
    dueEl.textContent = counts.due + counts.learning;
    dueEl.parentElement.classList.toggle('kpi-has-due', (counts.due + counts.learning) > 0);
  }

  // KPI: mastered (strong + graduated)
  const masteredEl = document.getElementById('dashMasteredKPI');
  if (masteredEl) masteredEl.textContent = counts.strong + counts.graduated;

  // KPI: unseen
  const unseenEl = document.getElementById('dashUnseenKPI');
  if (unseenEl) unseenEl.textContent = counts.unseen;

  // Stacked bar
  const bar = document.getElementById('dashBar');
  if (bar) {
    bar.innerHTML = '';
    STATES.forEach(state => {
      const n   = counts[state];
      const pct = total > 0 ? (n / total * 100) : 0;
      if (pct === 0) return;
      const seg = document.createElement('div');
      seg.className   = `dash-bar-seg dash-seg-${state}`;
      seg.style.width = pct + '%';
      seg.setAttribute('title', `${STATE_META[state].label}: ${n}`);
      seg.setAttribute('aria-label', `${STATE_META[state].label}: ${n} words`);
      bar.appendChild(seg);
    });
  }

  // Breakdown rows
  const list = document.getElementById('dashBreakdownList');
  if (list) {
    list.innerHTML = '';
    STATES.forEach(state => {
      const n   = counts[state];
      const pct = total > 0 ? Math.round(n / total * 100) : 0;
      const meta = STATE_META[state];

      const row = document.createElement('div');
      row.className = `dash-row dash-row-${state}`;
      row.innerHTML = `
        <div class="dash-row-swatch dash-swatch-${state}"></div>
        <div class="dash-row-info">
          <span class="dash-row-label">${meta.label}</span>
          <span class="dash-row-desc">${meta.desc}</span>
        </div>
        <div class="dash-row-nums">
          <span class="dash-row-count">${n}</span>
          <span class="dash-row-pct">${pct}%</span>
        </div>
      `;
      list.appendChild(row);
    });
  }

  // Footer: total words in bank
  const bankCountEl = document.getElementById('dashBankTotal');
  if (bankCountEl) bankCountEl.textContent = srTotalCount(mode);
}

// ── Hook into drill graduation ─────────────────
// Patch srRecordCorrect so graduated cards are also recorded
// We wrap it once after drill.js loads
(function patchGraduation() {
  const _orig = srRecordCorrect;
  window.srRecordCorrect = function(wordId, mode) {
    const graduated = _orig(wordId, mode);
    if (graduated) gradRecord(wordId, mode);
    return graduated;
  };
  // Override global reference used by drill.js event handlers
  // (drill.js calls srRecordCorrect directly; because JS is single-scope
  //  and this runs after drill.js, the global is already in scope.
  //  We reassign on window so the name resolves to our wrapper.)
})();

// ── Init ───────────────────────────────────────
function dashInit() {
  document.getElementById('dashOpenBtn').addEventListener('click', openDashboard);
  document.getElementById('dashCloseBtn').addEventListener('click', closeDashboard);
  document.getElementById('dashBackdrop').addEventListener('click', closeDashboard);

  document.querySelectorAll('.dash-tab').forEach(btn => {
    btn.addEventListener('click', () => renderDashboard(btn.dataset.mode));
  });

  // Also refresh when drill panel closes (scores may have changed)
  document.getElementById('drillCloseBtn').addEventListener('click', () => {
    if (!document.getElementById('dashPanel').hidden) renderDashboard(_dashMode);
  });
}
