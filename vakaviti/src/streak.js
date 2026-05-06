/* ═══════════════════════════════════════════════
   VAKAVITI — Streak Tracker
   Persists across sessions via localStorage with
   graceful in-memory fallback for sandboxed iframes.
   ═══════════════════════════════════════════════

   Data shape stored in localStorage key 'vakaviti_streak':
   {
     "count":    number,   // current consecutive day streak
     "lastDate": string,   // ISO date string "YYYY-MM-DD" of last completion
     "best":     number,   // all-time best streak
   }
*/

const STREAK_KEY = 'vakaviti_streak';

// ── In-memory fallback (for sandboxed preview) ─
let _memoryStreak = null;

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(isoA, isoB) {
  const msA = new Date(isoA).getTime();
  const msB = new Date(isoB).getTime();
  return Math.round(Math.abs(msA - msB) / 86400000);
}

// ── Storage helpers ────────────────────────────
function readStreak() {
  // 1. Try localStorage
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) { /* blocked in iframe */ }

  // 2. Fall back to in-memory state
  if (_memoryStreak) return { ..._memoryStreak };

  // 3. Fresh start
  return { count: 0, lastDate: null, best: 0 };
}

function writeStreak(data) {
  _memoryStreak = { ...data }; // always update memory
  try {
    localStorage.setItem(STREAK_KEY, JSON.stringify(data));
  } catch (_) { /* blocked in iframe — memory-only */ }
}

// ── Core logic ─────────────────────────────────

/**
 * Call once when the page loads.
 * If the last completion was >1 day ago the streak has broken —
 * reset count to 0 but preserve best.
 * Returns the current streak data.
 */
function streakInit() {
  const data = readStreak();
  const today = todayISO();

  if (data.lastDate && data.lastDate !== today) {
    const gap = daysBetween(data.lastDate, today);
    if (gap > 1) {
      // Streak broken — reset count, preserve best
      data.count = 0;
    }
    // If gap === 1 the streak is still active (they played yesterday)
  }

  writeStreak(data);
  renderStreakChip(data);
  return data;
}

/**
 * Call when the player completes a quiz round.
 * Increments count only if today hasn't already been counted.
 * Returns the updated streak data.
 */
function streakRecordCompletion() {
  const data = readStreak();
  const today = todayISO();

  const alreadyDoneToday = data.lastDate === today;

  if (!alreadyDoneToday) {
    data.count += 1;
    data.lastDate = today;
    if (data.count > (data.best || 0)) data.best = data.count;
    writeStreak(data);
    // Award XP for streak increment
    if (window.xpAward) xpAward('streak_increment');
  }

  renderStreakChip(data, !alreadyDoneToday);
  return { data, isNew: !alreadyDoneToday };
}

// ── Render helpers ─────────────────────────────
function renderStreakChip(data, animate) {
  const chip  = document.getElementById('streakChip');
  const count = document.getElementById('streakCount');
  if (!chip || !count) return;

  count.textContent = data.count;

  // Hide chip entirely if streak is 0
  chip.style.display = data.count === 0 ? 'none' : '';

  if (animate && data.count > 0) {
    chip.classList.remove('just-updated');
    // Force reflow so the animation replays
    void chip.offsetWidth;
    chip.classList.add('just-updated');
    chip.addEventListener('animationend', () => chip.classList.remove('just-updated'), { once: true });
  }
}

function renderStreakResult(data, isNew) {
  const el   = document.getElementById('quizStreakResult');
  const text = document.getElementById('quizStreakResultText');
  if (!el || !text) return;

  if (data.count === 0) {
    el.hidden = true;
    return;
  }

  el.hidden = false;

  if (isNew) {
    if (data.count === 1) {
      text.textContent = 'Streak started — come back tomorrow to keep it going!';
    } else if (data.count === data.best && data.count > 1) {
      text.textContent = `🔥 New best! ${data.count}-day streak — Vinaka vakalevu!`;
    } else {
      const labels = [
        `${data.count}-day streak — keep it up!`,
        `${data.count} days in a row — Bula vinaka!`,
        `${data.count}-day streak — you're on fire!`,
      ];
      text.textContent = labels[data.count % labels.length];
    }
  } else {
    // Already played today — affirm the existing streak
    text.textContent = `${data.count}-day streak — already completed today. Vinaka!`;
  }
}
