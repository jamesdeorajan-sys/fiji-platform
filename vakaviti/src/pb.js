/* ═══════════════════════════════════════════════
   VAKAVITI — Personal Best Tracker
   Tracks the highest % score per quiz configuration:
     key = "<mode>:<category>:<total>"  e.g. "forward:greetings:10"
   ═══════════════════════════════════════════════

   Data shape stored in localStorage key 'vakaviti_pb':
   {
     "<key>": { score: number, total: number, pct: number, date: "YYYY-MM-DD" },
     ...
   }
*/

const PB_KEY = 'vakaviti_pb';

// ── In-memory fallback ─────────────────────────
let _memoryPB = null;

// ── Storage helpers ────────────────────────────
function pbRead() {
  try {
    const raw = localStorage.getItem(PB_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) { /* blocked in iframe */ }
  if (_memoryPB) return { ..._memoryPB };
  return {};
}

function pbWrite(data) {
  _memoryPB = { ...data };
  try {
    localStorage.setItem(PB_KEY, JSON.stringify(data));
  } catch (_) { /* memory-only fallback */ }
}

// ── Build the record key ───────────────────────
function pbKey(mode, category, total) {
  return `${mode}:${category}:${total}`;
}

// ── Core: check + record ───────────────────────
/**
 * Compare current score against personal best for this quiz config.
 * Records the new score if it beats or ties the existing best.
 * Returns:
 *   { isNewPB: boolean, isFirstAttempt: boolean, prev, curr, data }
 */
function pbCheckAndRecord(score, total, category, mode) {
  const pct  = total > 0 ? Math.round((score / total) * 100) : 0;
  const key  = pbKey(mode, category, total);
  const all  = pbRead();
  const prev = all[key] || null;

  const isFirstAttempt = !prev;
  const isNewPB        = isFirstAttempt || pct > prev.pct || (pct === prev.pct && score > prev.score);

  if (isNewPB) {
    all[key] = {
      score,
      total,
      pct,
      date: todayISO(), // reuse todayISO from streak.js (loaded before pb.js)
    };
    pbWrite(all);
  }

  return {
    isNewPB,
    isFirstAttempt,
    prev,
    curr: all[key],
    data: all,
  };
}

// ── Render ─────────────────────────────────────
/**
 * Show or hide the PB badge on the results screen.
 * @param {Object} result — return value of pbCheckAndRecord()
 */
function renderPBBadge(result) {
  const badge = document.getElementById('quizPBBadge');
  const text  = document.getElementById('quizPBText');
  if (!badge || !text) return;

  if (!result.isNewPB) {
    // Show "current best" if this isn't a new PB — subtle, not hidden
    if (result.prev) {
      badge.className  = 'quiz-pb-badge pb-current';
      badge.hidden     = false;
      text.textContent = `Your best for this quiz: ${result.prev.score}/${result.prev.total} (${result.prev.pct}%)`;
    } else {
      badge.hidden = true;
    }
    return;
  }

  badge.hidden = false;

  if (result.isFirstAttempt) {
    badge.className  = 'quiz-pb-badge pb-first';
    text.textContent = `First attempt recorded — beat it next time!`;
  } else {
    // Genuine new PB
    const prev = result.prev;
    badge.className  = 'quiz-pb-badge pb-new';
    text.textContent =
      `New personal best! ${result.curr.score}/${result.curr.total} (${result.curr.pct}%) — up from ${prev.pct}%`;

    // Trigger shimmer animation
    badge.classList.remove('pb-shine');
    void badge.offsetWidth;
    badge.classList.add('pb-shine');
    badge.addEventListener('animationend', () => badge.classList.remove('pb-shine'), { once: true });
  }
}
