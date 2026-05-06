/* ═══════════════════════════════════════════════
   VAKAVITI — Missed Words Drill (Spaced Repetition)
   ═══════════════════════════════════════════════

   Storage key: 'vakaviti_sr'
   Shape:
   {
     "forward": {
       "<wordId>": {
         interval: number,   // days until next review (0 = due now)
         ease:     number,   // SM-2 ease factor (floor 1.3, default 2.5)
         due:      string,   // ISO date "YYYY-MM-DD"
         streak:   number,   // consecutive correct answers
         lapses:   number,   // total times answered wrong
       },
       ...
     },
     "reverse": { ... }
   }

   Algorithm (simplified SM-2):
   ─ Correct:
       newInterval = max(1, round(prevInterval === 0 ? 1
                                  : prevInterval === 1 ? 4
                                  : prevInterval * ease))
       ease += 0.1
       streak++
       due = today + newInterval days

   ─ Wrong:
       interval = 0  (back to "learning")
       ease     = max(1.3, ease - 0.2)
       streak   = 0
       lapses++
       due = today (show again this session)

   Cards are graduated out of the bank when:
       interval >= GRADUATION_INTERVAL (21 days) AND streak >= 3
   ═══════════════════════════════════════════════ */

const DRILL_KEY_LEGACY    = 'vakaviti_drill'; // old flat-array bank
const SR_KEY              = 'vakaviti_sr';
const GRADUATION_INTERVAL = 21; // days
const EASE_DEFAULT        = 2.5;
const EASE_MIN            = 1.3;
const EASE_MAX            = 3.5;

let _memorySR = null;

// ── todayISO() reused from streak.js ──────────

// ── Storage helpers ────────────────────────────
function srReadAll() {
  try {
    const raw = localStorage.getItem(SR_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  if (_memorySR) return JSON.parse(JSON.stringify(_memorySR));
  return { forward: {}, reverse: {} };
}

function srWriteAll(data) {
  _memorySR = JSON.parse(JSON.stringify(data));
  try { localStorage.setItem(SR_KEY, JSON.stringify(data)); } catch (_) {}
}

// ── Card access ────────────────────────────────
function srGetCard(wordId, mode) {
  const all = srReadAll();
  return (all[mode] && all[mode][wordId]) || null;
}

function srSetCard(wordId, mode, card) {
  const all = srReadAll();
  if (!all[mode]) all[mode] = {};
  all[mode][wordId] = card;
  srWriteAll(all);
}

function srDeleteCard(wordId, mode) {
  const all = srReadAll();
  if (all[mode]) delete all[mode][wordId];
  srWriteAll(all);
}

function srAllCards(mode) {
  const all = srReadAll();
  return all[mode] || {};
}

// ── Card count helpers ─────────────────────────
function srTotalCount(mode) {
  return Object.keys(srAllCards(mode)).length;
}

function srDueCount(mode) {
  const today = todayISO();
  return Object.values(srAllCards(mode))
    .filter(c => c.due <= today).length;
}

// ── Add a missed word to SR bank ───────────────
/**
 * Called whenever a quiz answer is wrong.
 * Creates a new card if one doesn't exist yet;
 * records a lapse if it does.
 */
function srAddOrLapse(wordId, mode) {
  const today    = todayISO();
  const existing = srGetCard(wordId, mode);
  if (existing) {
    // Already in bank — register another lapse
    existing.ease    = Math.max(EASE_MIN, existing.ease - 0.2);
    existing.interval = 0;
    existing.streak  = 0;
    existing.lapses  = (existing.lapses || 0) + 1;
    existing.due     = today;
    srSetCard(wordId, mode, existing);
  } else {
    // Brand new card
    srSetCard(wordId, mode, {
      interval: 0,
      ease:     EASE_DEFAULT,
      due:      today,
      streak:   0,
      lapses:   0,
    });
  }
}

// ── Record correct answer ─────────────────────
/**
 * Advances the card's interval using SM-2.
 * Returns true if the card has graduated (remove from bank).
 */
function srRecordCorrect(wordId, mode) {
  const today = todayISO();
  const card  = srGetCard(wordId, mode);
  if (!card) return false;

  const prev = card.interval;
  let newInterval;
  if (prev === 0)      newInterval = 1;
  else if (prev === 1) newInterval = 4;
  else                 newInterval = Math.round(prev * card.ease);

  card.interval = newInterval;
  card.ease     = Math.min(EASE_MAX, card.ease + 0.1);
  card.streak   = (card.streak || 0) + 1;
  card.due      = addDays(today, newInterval);

  const graduated = newInterval >= GRADUATION_INTERVAL && card.streak >= 3;
  if (graduated) {
    srDeleteCard(wordId, mode);
  } else {
    srSetCard(wordId, mode, card);
  }
  return graduated;
}

// ── ISO date arithmetic ────────────────────────
function addDays(isoDate, n) {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function daysDiff(isoA, isoB) {
  // isoB - isoA in days (positive = isoB is later)
  return Math.round((new Date(isoB) - new Date(isoA)) / 86400000);
}

// ── Difficulty label for UI ────────────────────
function srDifficultyLabel(wordId, mode) {
  const card = srGetCard(wordId, mode);
  if (!card) return null;
  const today  = todayISO();
  const overdue = daysDiff(card.due, today); // how many days past due (+ = overdue)
  if (card.interval === 0)  return { label: 'Learning',  level: 'learning' };
  if (overdue >= 0)         return { label: 'Due',       level: 'due'      };
  if (card.interval >= 7)   return { label: 'Strong',    level: 'strong'   };
  return                           { label: 'Review',    level: 'review'   };
}

// ═══════════════════════════════════════════════
//   DRILL SESSION
// ═══════════════════════════════════════════════

/*
  Session queue strategy:
  1. Collect all cards in the SR bank for this mode
  2. Sort: overdue (oldest first) → due today → future (soonest first)
  3. Build a weighted in-session queue:
     - Overdue/due-today cards: included every pass
     - Future cards: included at end as bonus review
  4. During the session:
     - Wrong answer → re-insert card 2 positions ahead in queue
       (not at the very back, so struggling cards resurface faster)
     - Right answer → graduated if interval >= 21 & streak >= 3;
       otherwise removed from session queue (it'll show at its due date)
*/

const drill = {
  mode:         'forward',
  queue:        [],   // { word, sessionWrong } objects for current session
  current:      null,
  totalAtStart: 0,
  cleared:      0,    // graduated this session
  reviewed:     0,    // correctly answered this session (any card)
};

// Build the sorted session queue
function srBuildQueue(mode) {
  const today   = todayISO();
  const cards   = srAllCards(mode);
  const wordIds = Object.keys(cards);

  if (wordIds.length === 0) return [];

  // Attach word objects and sort data
  const entries = wordIds
    .map(id => {
      const word = FIJIAN_WORDS.find(w => w.id === id);
      if (!word) return null;
      const card    = cards[id];
      const overdue = daysDiff(card.due, today); // positive = overdue
      return { word, card, overdue };
    })
    .filter(Boolean);

  // Sort: most overdue first, then by interval ascending (harder cards first)
  entries.sort((a, b) => {
    if (b.overdue !== a.overdue) return b.overdue - a.overdue; // most overdue first
    return a.card.interval - b.card.interval;                   // lowest interval first
  });

  return entries.map(e => ({ word: e.word, sessionWrong: 0 }));
}

// ── Show / hide drill screen ───────────────────
function showDrillScreen() {
  ['quizStartScreen', 'quizQuestionScreen', 'quizResultScreen'].forEach(s => {
    document.getElementById(s).hidden = true;
  });
  document.getElementById('drillScreen').hidden = false;
}

function hideDrillScreen() {
  document.getElementById('drillScreen').hidden = true;
}

// ── Launch drill ───────────────────────────────
function openDrill() {
  drill.mode        = quiz.mode;
  drill.queue       = srBuildQueue(drill.mode);
  drill.totalAtStart = drill.queue.length;
  drill.cleared     = 0;
  drill.reviewed    = 0;

  if (drill.queue.length === 0) {
    alert('No words in your drill bank for this mode!');
    return;
  }

  document.getElementById('drillCardArea').hidden     = false;
  document.getElementById('drillCompleteArea').hidden = true;

  document.getElementById('quizOverlay').hidden = false;
  document.body.style.overflow = 'hidden';
  showDrillScreen();
  drillUpdateCounter();
  drillNext();
}

function closeDrill() {
  hideDrillScreen();
  document.getElementById('quizOverlay').hidden = true;
  document.body.style.overflow = '';
  if (window.speechSynthesis) window.speechSynthesis.cancel();
}

// ── Counter ────────────────────────────────────
function drillUpdateCounter() {
  const remaining = document.getElementById('drillRemaining');
  const total     = document.getElementById('drillTotal');
  if (remaining) remaining.textContent = drill.queue.length;
  if (total)     total.textContent     = drill.totalAtStart;

  const fill = document.getElementById('drillProgressFill');
  if (fill) {
    const done = drill.totalAtStart - drill.queue.length;
    fill.style.width = (drill.totalAtStart > 0 ? (done / drill.totalAtStart * 100) : 0) + '%';
  }
}

// ── Difficulty pill ────────────────────────────
function renderDifficultyPill(wordId, mode) {
  const pill = document.getElementById('drillDifficultyPill');
  if (!pill) return;
  const info = srDifficultyLabel(wordId, mode);
  if (!info) { pill.hidden = true; return; }
  pill.hidden    = false;
  pill.textContent = info.label;
  pill.className = `drill-difficulty-pill pill-${info.level}`;
}

// ── Advance to next card ───────────────────────
function drillNext() {
  if (drill.queue.length === 0) {
    drillShowComplete();
    return;
  }

  const entry   = drill.queue[0];
  drill.current = entry.word;
  const isRev   = drill.mode === 'reverse';

  drillUpdateCounter();
  renderDifficultyPill(drill.current.id, drill.mode);

  // Populate prompt
  const promptEl = document.getElementById('drillPrompt');
  const hintEl   = document.getElementById('drillHint');
  const labelEl  = document.getElementById('drillLabel');

  if (isRev) {
    promptEl.innerHTML =
      `<span class="drill-card-fijian">${drill.current.word}</span>` +
      `<span class="drill-card-phonetic">/${drill.current.phonetic}/</span>`;
    hintEl.textContent  = `${drill.current.partOfSpeech} · ${drill.current.category}`;
    labelEl.textContent = 'What does this Fijian word mean?';
  } else {
    promptEl.textContent = shortEnglish(drill.current);
    hintEl.textContent   = `${drill.current.partOfSpeech} · ${drill.current.category}`;
    labelEl.textContent  = 'Which Fijian word means…';
  }

  // Build options
  const options   = getOptions(drill.current);
  const letters   = ['A', 'B', 'C', 'D'];
  const container = document.getElementById('drillOptions');
  container.innerHTML = '';

  options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'quiz-option drill-option' + (isRev ? ' reverse-opt' : '');
    btn.setAttribute('role', 'listitem');
    btn.dataset.id      = opt.id;
    btn.dataset.correct = opt.id === drill.current.id ? '1' : '0';

    if (isRev) {
      btn.innerHTML = `
        <span class="quiz-opt-letter">${letters[i]}</span>
        <span class="quiz-opt-text">
          <span class="quiz-opt-word">${shortEnglish(opt)}</span>
        </span>
      `;
    } else {
      btn.innerHTML = `
        <span class="quiz-opt-letter">${letters[i]}</span>
        <span class="quiz-opt-text">
          <span class="quiz-opt-word">${opt.word}</span>
          <span class="quiz-opt-phonetic">/${opt.phonetic}/</span>
        </span>
      `;
    }

    btn.addEventListener('click', () => drillHandleAnswer(btn));
    container.appendChild(btn);
  });

  // Reset feedback
  const fb = document.getElementById('drillFeedback');
  fb.hidden    = true;
  fb.className = 'quiz-feedback';
  fb.textContent = '';

  document.getElementById('drillNextBtn').hidden = true;
}

// ── Handle drill answer ────────────────────────
function drillHandleAnswer(clickedBtn) {
  const isCorrect = clickedBtn.dataset.correct === '1';
  const isRev     = drill.mode === 'reverse';
  const entry     = drill.queue[0];
  const word      = drill.current;

  // Lock buttons
  document.getElementById('drillOptions').querySelectorAll('.quiz-option').forEach(btn => {
    btn.setAttribute('disabled', '');
    if (btn.dataset.correct === '1')          btn.classList.add('correct');
    else if (btn === clickedBtn && !isCorrect) btn.classList.add('wrong');
    else                                       btn.classList.add('dimmed');
  });

  const fb = document.getElementById('drillFeedback');
  fb.hidden = false;

  if (isCorrect) {
    drill.reviewed++;
    if (window.xpAward) xpAward('drill_cleared');
    const graduated = srRecordCorrect(word.id, drill.mode);
    drill.queue.shift(); // remove from front

    if (graduated) {
      drill.cleared++;
      if (window.xpAward) xpAward('drill_graduated');
      fb.textContent = drill.queue.length === 0
        ? 'Vinaka vakalevu! Card graduated — you\'ve mastered it!'
        : '⭐ Graduated! This word won\'t appear in drills anymore.';
    } else {
      const card = srGetCard(word.id, drill.mode);
      const nextIn = card ? card.interval : 1;
      fb.textContent = drill.queue.length === 0
        ? 'Vinaka vakalevu! Last card done — see you next session.'
        : `Vinaka! Next review in ${nextIn} day${nextIn === 1 ? '' : 's'}.`;
    }
    fb.className = 'quiz-feedback correct-fb';

    // Update difficulty pill to reflect new interval
    renderDifficultyPill(word.id, drill.mode);

  } else {
    // Record lapse in SR system
    srAddOrLapse(word.id, drill.mode);
    entry.sessionWrong++;

    // Re-insert 2 positions ahead (not at the very back)
    // so struggling cards resurface soon, not after all others
    drill.queue.shift();
    const insertAt = Math.min(2, drill.queue.length);
    drill.queue.splice(insertAt, 0, entry);

    if (isRev) {
      fb.textContent = `Not quite. "${word.word}" means: ${shortEnglish(word)}.`;
    } else {
      fb.textContent = `Not quite. The answer is "${word.word}" (/${word.phonetic}/)`;
    }
    fb.className = 'quiz-feedback wrong-fb';

    // Update pill to show "Learning" now
    renderDifficultyPill(word.id, drill.mode);
  }

  const nextBtn = document.getElementById('drillNextBtn');
  nextBtn.hidden    = false;
  nextBtn.textContent = drill.queue.length === 0 ? 'See results →' : 'Next card →';

  drillUpdateCounter();
}

// ── Complete screen ────────────────────────────
function drillShowComplete() {
  document.getElementById('drillCardArea').hidden     = true;
  document.getElementById('drillCompleteArea').hidden = false;

  document.getElementById('drillClearedCount').textContent  = drill.cleared;
  document.getElementById('drillReviewedCount').textContent = drill.reviewed;
  document.getElementById('drillBankCount').textContent     = srTotalCount(drill.mode);

  drillUpdateLaunchBtn();
}

// ── Update launch button ───────────────────────
function drillUpdateLaunchBtn() {
  const btn = document.getElementById('drillLaunchBtn');
  if (!btn) return;
  const total = srTotalCount(quiz.mode);
  const due   = srDueCount(quiz.mode);
  if (total === 0) {
    btn.hidden = true;
  } else {
    btn.hidden = false;
    const countSpan = btn.querySelector('.drill-btn-count');
    if (countSpan) countSpan.textContent = due > 0 ? `${due} due` : `${total}`;
    // Badge colour: red if due cards exist, muted otherwise
    btn.classList.toggle('has-due', due > 0);
  }
}

// ── Legacy compatibility shim ──────────────────
// quiz.js calls drillAddMiss(); map it to the SR version
function drillAddMiss(wordId, mode) {
  srAddOrLapse(wordId, mode);
}

// drillCount() still needed by older callers
function drillCount(mode) {
  return srTotalCount(mode);
}

// ── One-time migration from old flat-array bank ─
(function migrateLegacyDrillBank() {
  try {
    const raw = localStorage.getItem(DRILL_KEY_LEGACY);
    if (!raw) return;
    const legacy = JSON.parse(raw);
    const today  = todayISO();
    // Only migrate if new SR bank is empty
    const existing = srReadAll();
    ['forward', 'reverse'].forEach(mode => {
      const ids = legacy[mode] || [];
      if (ids.length === 0) return;
      if (!existing[mode]) existing[mode] = {};
      ids.forEach(id => {
        if (!existing[mode][id]) {
          existing[mode][id] = {
            interval: 0,
            ease:     EASE_DEFAULT,
            due:      today,
            streak:   0,
            lapses:   1, // was already missed at least once
          };
        }
      });
    });
    srWriteAll(existing);
    localStorage.removeItem(DRILL_KEY_LEGACY);
  } catch (_) {}
})();

// ── Keyboard shortcuts ────────────────────────
document.addEventListener('keydown', e => {
  const drillScreen = document.getElementById('drillScreen');
  if (!drillScreen || drillScreen.hidden) return;
  if (e.key === 'Escape') { closeDrill(); return; }

  const cardArea = document.getElementById('drillCardArea');
  if (!cardArea.hidden) {
    const keyMap = { 'a': 0, 'b': 1, 'c': 2, 'd': 3 };
    const idx = keyMap[e.key.toLowerCase()];
    if (idx !== undefined) {
      const opts = document.getElementById('drillOptions').querySelectorAll('.quiz-option');
      if (opts[idx] && !opts[idx].disabled) opts[idx].click();
      return;
    }
    const nextBtn = document.getElementById('drillNextBtn');
    if ((e.key === 'Enter' || e.key === ' ') && !nextBtn.hidden) {
      e.preventDefault();
      drill.queue.length === 0 ? drillShowComplete() : drillNext();
    }
  }
});
