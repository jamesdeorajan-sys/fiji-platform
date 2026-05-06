/* ═══════════════════════════════════════════════
   VAKAVITI — Phonetics Practice Mode
   See a Fijian word → type its phonetic spelling
   using the B→mb, C→th, D→nd, G→ng, Q→ngg rules.
   ═══════════════════════════════════════════════ */

// ── Phonetic conversion rules (applied in order) ─
// Order matters: Q (ngg) before G (ng), D (nd) before simple d
const PHON_RULES = [
  { pattern: /q/gi,  replacement: (m) => m === m.toUpperCase() ? 'NGG' : 'ngg' },
  { pattern: /b/gi,  replacement: (m) => m === m.toUpperCase() ? 'MB'  : 'mb'  },
  { pattern: /d/gi,  replacement: (m) => m === m.toUpperCase() ? 'ND'  : 'nd'  },
  { pattern: /g/gi,  replacement: (m) => m === m.toUpperCase() ? 'NG'  : 'ng'  },
  { pattern: /c/gi,  replacement: (m) => m === m.toUpperCase() ? 'TH'  : 'th'  },
];

// ── Convert a Fijian word to its phonetic spelling ─
function _toPhonetic(word) {
  let result = word;
  for (const rule of PHON_RULES) {
    result = result.replace(rule.pattern, rule.replacement);
  }
  return result;
}

// ── Normalise for comparison (lowercase, trim, collapse spaces) ─
function _normalise(s) {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

// ── Check answer: exact or accept common near-misses ─
function _checkAnswer(userInput, correctPhonetic) {
  const u = _normalise(userInput);
  const c = _normalise(correctPhonetic);
  if (u === c) return 'correct';
  // Accept if only trailing/leading spaces differ (already handled by normalise)
  // Accept swapped mb↔b, ng↔g, th↔c, nd↔d (partial knowledge)
  return 'wrong';
}

// ── Timing store key ─────────────────────────────
const PH_TIMES_KEY = 'vakaviti_ph_times';
// Format: { [word]: { best: ms, attempts: n, lastImproved: ISO } }

function _phLoadTimes() {
  try { return JSON.parse(localStorage.getItem(PH_TIMES_KEY) || '{}'); } catch { return {}; }
}
function _phSaveTimes(data) {
  try { localStorage.setItem(PH_TIMES_KEY, JSON.stringify(data)); } catch {}
}

// Record a new time for a word; returns true if it's a new personal best
function _phRecordTime(wordStr, ms) {
  const store = _phLoadTimes();
  const prev  = store[wordStr];
  const isNew = !prev || ms < prev.best;
  store[wordStr] = {
    best:         isNew ? ms : prev.best,
    attempts:     (prev ? prev.attempts : 0) + 1,
    lastImproved: isNew ? new Date().toISOString() : (prev ? prev.lastImproved : null),
  };
  _phSaveTimes(store);
  return isNew;
}

// ── State ─────────────────────────────────────────
let _phWords      = [];   // shuffled pool for this session
let _phIndex      = 0;
let _phTotal      = 10;
let _phCorrect    = 0;
let _phStreak     = 0;    // consecutive correct answers this session
let _phMaxStreak  = 0;
let _phRevealed   = false;
let _phResults    = [];   // { word, phonetic, userInput, correct, ms }

// ── Timer state ────────────────────────────────────
let _phTimerStart  = 0;   // performance.now() when word loaded
let _phTimerRAF    = null; // requestAnimationFrame handle

function _phStartTimer() {
  _phTimerStart = performance.now();
  _phTickTimer();
}

function _phStopTimer() {
  if (_phTimerRAF) { cancelAnimationFrame(_phTimerRAF); _phTimerRAF = null; }
}

function _phTickTimer() {
  const el = _phEl('phTimerDisplay');
  if (el) {
    const elapsed = ((performance.now() - _phTimerStart) / 1000).toFixed(1);
    el.textContent = elapsed + 's';
  }
  _phTimerRAF = requestAnimationFrame(_phTickTimer);
}

function _phElapsedMs() {
  return Math.round(performance.now() - _phTimerStart);
}

// ── DOM helpers ───────────────────────────────────
function _phEl(id) { return document.getElementById(id); }

function _phShowScreen(name) {
  ['phStartScreen', 'phQuestionScreen', 'phResultScreen'].forEach(id => {
    const el = _phEl(id);
    if (el) el.hidden = (id !== name);
  });
}

// ── Build word pool ────────────────────────────────
function _phBuildPool(count, catFilter) {
  let pool = (typeof FIJIAN_WORDS !== 'undefined') ? [...FIJIAN_WORDS] : [];
  if (catFilter && catFilter !== 'all') {
    pool = pool.filter(w => w.category === catFilter);
  }
  // Prefer words that actually have a phonetic transformation (contain b/c/d/g/q)
  const interesting = pool.filter(w => /[bcdgq]/i.test(w.word));
  const rest        = pool.filter(w => !/[bcdgq]/i.test(w.word));
  // Shuffle each group
  const shuffle = arr => arr.sort(() => Math.random() - 0.5);
  const combined = [...shuffle(interesting), ...shuffle(rest)];
  return combined.slice(0, Math.min(count, combined.length));
}

// ── Load question ──────────────────────────────────
function _phLoadQuestion() {
  const word = _phWords[_phIndex];
  if (!word) return;

  // Derive correct phonetic: prefer stored field, fallback to generated
  const correctPhonetic = word.phonetic || _toPhonetic(word.word);

  _phRevealed = false;

  // Progress
  const fill  = _phEl('phProgressFill');
  const label = _phEl('phProgressLabel');
  if (fill)  fill.style.width = `${((_phIndex) / _phTotal) * 100}%`;
  if (label) label.textContent = `${_phIndex + 1} / ${_phTotal}`;

  // Score badge
  const badge = _phEl('phScoreBadge');
  if (badge) badge.textContent = `${_phCorrect} correct`;

  // Word display
  const wordEl = _phEl('phWord');
  if (wordEl) wordEl.textContent = word.word;

  // Part of speech hint
  const posEl = _phEl('phPos');
  if (posEl) posEl.textContent = word.partOfSpeech || '';

  // English hint (hidden until revealed or checked)
  const hintEl = _phEl('phHintText');
  if (hintEl) hintEl.textContent = `"${word.englishDef ? word.englishDef.split('.')[0] + '.' : ''}"`;

  // Clear input & feedback
  const input = _phEl('phInput');
  if (input) { input.value = ''; input.disabled = false; input.focus(); }

  const fb = _phEl('phFeedback');
  if (fb) { fb.hidden = true; fb.className = 'ph-feedback'; fb.textContent = ''; }

  const checkBtn  = _phEl('phCheckBtn');
  const nextBtn   = _phEl('phNextBtn');
  const revealBtn = _phEl('phRevealBtn');
  if (checkBtn)  { checkBtn.hidden = false; checkBtn.disabled = false; }
  if (nextBtn)   nextBtn.hidden = true;
  if (revealBtn) { revealBtn.hidden = false; revealBtn.disabled = false; }

  // Hide hint line until needed
  const hintRow = _phEl('phHintRow');
  if (hintRow) hintRow.hidden = true;

  // Rule reminder strip — highlight rules relevant to this word
  _phUpdateRuleStrip(word.word);

  // Start per-word timer
  _phStopTimer();
  _phStartTimer();

  // Show best time for this word if known
  const times = _phLoadTimes();
  const prev  = times[word.word];
  const bestEl = _phEl('phWordBestTime');
  if (bestEl) {
    if (prev) {
      bestEl.textContent = `PB: ${(prev.best / 1000).toFixed(1)}s`;
      bestEl.hidden = false;
    } else {
      bestEl.hidden = true;
    }
  }
}

// ── Highlight relevant rules ───────────────────────
function _phUpdateRuleStrip(word) {
  document.querySelectorAll('.ph-rule-chip').forEach(chip => {
    const letter = chip.dataset.letter;
    const relevant = letter && new RegExp(letter, 'i').test(word);
    chip.classList.toggle('active', relevant);
  });
}

// ── Check answer ───────────────────────────────────
function _phCheck() {
  const word = _phWords[_phIndex];
  if (!word || _phRevealed) return;

  const input = _phEl('phInput');
  const userVal = input ? input.value.trim() : '';
  if (!userVal) { input && input.focus(); return; }

  const correctPhonetic = word.phonetic || _toPhonetic(word.word);
  const result = _checkAnswer(userVal, correctPhonetic);
  const isCorrect = result === 'correct';

  // Stop timer and record
  _phStopTimer();
  const elapsedMs = _phElapsedMs();
  let isNewPB = false;
  if (isCorrect) {
    isNewPB = _phRecordTime(word.word, elapsedMs);
  }

  _phResults.push({ word: word.word, phonetic: correctPhonetic, userInput: userVal, correct: isCorrect, ms: isCorrect ? elapsedMs : null });

  const fb = _phEl('phFeedback');
  if (fb) {
    fb.hidden = false;
    fb.className = 'ph-feedback ' + (isCorrect ? 'ph-feedback-correct' : 'ph-feedback-wrong');

    if (isCorrect) {
      _phCorrect++;
      _phStreak++;
      if (_phStreak > _phMaxStreak) _phMaxStreak = _phStreak;
      const timeStr  = (elapsedMs / 1000).toFixed(1) + 's';
      const pbBadge  = isNewPB ? ' <span class="ph-pb-badge">🔥 PB</span>' : '';
      fb.innerHTML = `<span class="ph-fb-icon">✅</span> <strong>Correct!</strong> <em>${correctPhonetic}</em> <span class="ph-time-inline">${timeStr}</span>${pbBadge}`;
    } else {
      _phStreak = 0;
      // Show character-level diff
      fb.innerHTML = `<span class="ph-fb-icon">❌</span> <strong>Not quite.</strong> The phonetic spelling is <em class="ph-answer">${correctPhonetic}</em>`;
    }
  }

  // Show English hint after checking
  const hintRow = _phEl('phHintRow');
  if (hintRow) hintRow.hidden = false;

  // Update score badge
  const badge = _phEl('phScoreBadge');
  if (badge) badge.textContent = `${_phCorrect} correct`;

  // Transition buttons
  if (input) input.disabled = true;
  const checkBtn  = _phEl('phCheckBtn');
  const nextBtn   = _phEl('phNextBtn');
  const revealBtn = _phEl('phRevealBtn');
  if (checkBtn)  checkBtn.hidden = true;
  if (revealBtn) revealBtn.hidden = true;

  const isLast = _phIndex >= _phTotal - 1;
  if (nextBtn) {
    nextBtn.hidden = false;
    nextBtn.textContent = isLast ? 'See results →' : 'Next word →';
  }

  // Award XP for correct answers
  if (isCorrect && typeof xpAddEvent === 'function') {
    xpAddEvent('phonetic_correct');
  }

  // Hide live timer display after checking
  const timerEl = _phEl('phTimerDisplay');
  if (timerEl) timerEl.classList.add('ph-timer-frozen');
}

// ── Reveal answer without penalty ─────────────────
function _phReveal() {
  const word = _phWords[_phIndex];
  if (!word || _phRevealed) return;
  _phRevealed = true;
  _phStopTimer();

  // Freeze timer display
  const timerEl = _phEl('phTimerDisplay');
  if (timerEl) timerEl.classList.add('ph-timer-frozen');

  const correctPhonetic = word.phonetic || _toPhonetic(word.word);
  _phResults.push({ word: word.word, phonetic: correctPhonetic, userInput: '(revealed)', correct: false, ms: null });
  _phStreak = 0;

  const fb = _phEl('phFeedback');
  if (fb) {
    fb.hidden = false;
    fb.className = 'ph-feedback ph-feedback-reveal';
    fb.innerHTML = `<span class="ph-fb-icon">💡</span> The phonetic spelling is <em class="ph-answer">${correctPhonetic}</em>`;
  }

  const hintRow = _phEl('phHintRow');
  if (hintRow) hintRow.hidden = false;

  const input = _phEl('phInput');
  if (input) input.disabled = true;

  const checkBtn  = _phEl('phCheckBtn');
  const nextBtn   = _phEl('phNextBtn');
  const revealBtn = _phEl('phRevealBtn');
  if (checkBtn)  checkBtn.hidden = true;
  if (revealBtn) revealBtn.hidden = true;

  const isLast = _phIndex >= _phTotal - 1;
  if (nextBtn) {
    nextBtn.hidden = false;
    nextBtn.textContent = isLast ? 'See results →' : 'Next word →';
  }
}

// ── Next question / finish ─────────────────────────
function _phNext() {
  _phIndex++;
  if (_phIndex >= _phTotal) {
    _phStopTimer();
    _phShowResults();
  } else {
    // Un-freeze timer display for next word
    const timerEl = _phEl('phTimerDisplay');
    if (timerEl) { timerEl.classList.remove('ph-timer-frozen'); timerEl.textContent = '0.0s'; }
    _phLoadQuestion();
  }
}

// ── Results screen ─────────────────────────────────
function _phShowResults() {
  _phShowScreen('phResultScreen');

  const pct   = Math.round((_phCorrect / _phTotal) * 100);
  const grade = pct === 100 ? '🏆 Perfect!' :
                pct >= 80   ? '⭐ Excellent!' :
                pct >= 60   ? '👍 Good work' :
                pct >= 40   ? '📚 Keep practising' : '💪 Keep going!';

  const scoreEl = _phEl('phResultScore');
  if (scoreEl) scoreEl.textContent = `${_phCorrect} / ${_phTotal}`;

  const pctEl = _phEl('phResultPct');
  if (pctEl) pctEl.textContent = `${pct}%`;

  const gradeEl = _phEl('phResultGrade');
  if (gradeEl) gradeEl.textContent = grade;

  const streakEl = _phEl('phResultStreak');
  if (streakEl) streakEl.textContent = `Best run: ${_phMaxStreak} in a row`;

  // Build word-by-word breakdown with timing
  const times  = _phLoadTimes();
  const listEl = _phEl('phResultList');
  if (listEl) {
    listEl.innerHTML = _phResults.map(r => {
      const pb    = times[r.word];
      const isNew = r.correct && r.ms && pb && pb.best === r.ms;
      const timeTag = r.correct && r.ms
        ? `<span class="ph-result-time ${isNew ? 'ph-result-time-pb' : ''}">${(r.ms/1000).toFixed(1)}s${isNew ? ' 🔥' : ''}</span>`
        : '';
      return `
        <div class="ph-result-row ${r.correct ? 'ph-result-correct' : (r.userInput === '(revealed)' ? 'ph-result-reveal' : 'ph-result-wrong')}">
          <span class="ph-result-word">${r.word}</span>
          <span class="ph-result-arrow">→</span>
          <span class="ph-result-phonetic">${r.phonetic}</span>
          ${timeTag}
          ${!r.correct && r.userInput !== '(revealed)' ? `<span class="ph-result-yours">(you: <em>${r.userInput || '—'}</em>)</span>` : ''}
          ${r.userInput === '(revealed)' ? `<span class="ph-result-yours">(revealed)</span>` : ''}
        </div>`;
    }).join('');
  }

  // XP bonus
  if (pct === 100 && typeof xpAddEvent === 'function') {
    xpAddEvent('phonetic_perfect');
  }
  if (typeof xpAddEvent === 'function') {
    xpAddEvent('phonetic_complete');
  }
}

// ── Open / close phonetics overlay ────────────────
function openPhonetics() {
  const overlay = _phEl('phoneticsOverlay');
  if (!overlay) return;
  overlay.classList.add('ph-visible');
  document.body.style.overflow = 'hidden';
  _phShowScreen('phStartScreen');
  // Populate category select
  _phPopulateCats();
}

function closePhonetics() {
  const overlay = _phEl('phoneticsOverlay');
  if (!overlay) return;
  overlay.classList.remove('ph-visible');
  document.body.style.overflow = '';
}

function _phPopulateCats() {
  const sel = _phEl('phCatSelect');
  if (!sel || sel.dataset.populated) return;
  if (typeof CATEGORIES !== 'undefined') {
    CATEGORIES.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat.id;
      opt.textContent = cat.label;
      sel.appendChild(opt);
    });
  }
  sel.dataset.populated = '1';
}

// ── Init ─────────────────────────────────────────
function phoneticsInit() {
  // Launch button in header
  const launchBtn = _phEl('phoneticsLaunchBtn');
  if (launchBtn) launchBtn.addEventListener('click', openPhonetics);

  // Close button
  const closeBtn = _phEl('phCloseBtn');
  if (closeBtn) closeBtn.addEventListener('click', closePhonetics);

  // Backdrop click closes
  const overlay = _phEl('phoneticsOverlay');
  if (overlay) {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) closePhonetics();
    });
  }

  // Keyboard: Escape closes
  document.addEventListener('keydown', e => {
    const ov = _phEl('phoneticsOverlay');
    if (e.key === 'Escape' && ov && ov.classList.contains('ph-visible')) closePhonetics();
    // Enter submits answer when on question screen
    if (e.key === 'Enter') {
      const checkBtn = _phEl('phCheckBtn');
      const nextBtn  = _phEl('phNextBtn');
      if (checkBtn && !checkBtn.hidden && !checkBtn.disabled) _phCheck();
      else if (nextBtn && !nextBtn.hidden) _phNext();
    }
  });

  // Start button
  const startBtn = _phEl('phStartBtn');
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      const countSel = _phEl('phCountSelect');
      const catSel   = _phEl('phCatSelect');
      _phTotal   = countSel ? parseInt(countSel.value, 10) : 10;
      _phIndex   = 0;
      _phCorrect = 0;
      _phStreak  = 0;
      _phMaxStreak = 0;
      _phResults = [];
      _phWords   = _phBuildPool(_phTotal, catSel ? catSel.value : 'all');
      _phTotal   = _phWords.length; // in case pool is smaller
      _phShowScreen('phQuestionScreen');
      _phLoadQuestion();
    });
  }

  // Check / Next / Reveal buttons
  const checkBtn  = _phEl('phCheckBtn');
  const nextBtn   = _phEl('phNextBtn');
  const revealBtn = _phEl('phRevealBtn');
  if (checkBtn)  checkBtn.addEventListener('click', _phCheck);
  if (nextBtn)   nextBtn.addEventListener('click', _phNext);
  if (revealBtn) revealBtn.addEventListener('click', _phReveal);

  // Play again / return
  const playAgainBtn = _phEl('phPlayAgainBtn');
  const returnBtn    = _phEl('phReturnBtn');
  if (playAgainBtn) playAgainBtn.addEventListener('click', () => _phShowScreen('phStartScreen'));
  if (returnBtn)    returnBtn.addEventListener('click', closePhonetics);

  // Speed Board button on result screen
  const speedBoardBtn = _phEl('phSpeedBoardBtn');
  if (speedBoardBtn) speedBoardBtn.addEventListener('click', openSpeedBoard);

  // Speed Board close
  const sbClose = _phEl('phSbClose');
  if (sbClose) sbClose.addEventListener('click', closeSpeedBoard);

  // Speed Board sort buttons
  document.querySelectorAll('.ph-sb-sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ph-sb-sort-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _renderSpeedBoard(btn.dataset.sort);
    });
  });

  // Speed Board reset
  const sbResetBtn = _phEl('phSbResetBtn');
  if (sbResetBtn) {
    sbResetBtn.addEventListener('click', () => {
      if (confirm('Clear all your personal best times? This cannot be undone.')) {
        localStorage.removeItem(PH_TIMES_KEY);
        _renderSpeedBoard('slowest');
      }
    });
  }
}

// ── Speed Board ────────────────────────────────────────
function openSpeedBoard() {
  const panel = _phEl('phSpeedBoard');
  if (!panel) return;
  panel.hidden = false;
  panel.classList.add('ph-sb-open');
  // Default sort: slowest first (most needs practice)
  const activeBtn = panel.querySelector('.ph-sb-sort-btn.active');
  _renderSpeedBoard(activeBtn ? activeBtn.dataset.sort : 'slowest');
}

function closeSpeedBoard() {
  const panel = _phEl('phSpeedBoard');
  if (!panel) return;
  panel.classList.remove('ph-sb-open');
  setTimeout(() => { if (!panel.classList.contains('ph-sb-open')) panel.hidden = true; }, 300);
}

// Which letters a word exercises
function _phWordRules(word) {
  const tags = [];
  if (/b/i.test(word)) tags.push('B→mb');
  if (/c/i.test(word)) tags.push('C→th');
  if (/d/i.test(word)) tags.push('D→nd');
  if (/g/i.test(word)) tags.push('G→ng');
  if (/q/i.test(word)) tags.push('Q→ngg');
  return tags;
}

function _renderSpeedBoard(sortMode = 'slowest') {
  const store = _phLoadTimes();
  const entries = Object.entries(store).map(([word, data]) => ({
    word,
    best:     data.best,
    attempts: data.attempts,
    rules:    _phWordRules(word),
  }));

  // Sort
  if (sortMode === 'slowest') {
    entries.sort((a, b) => b.best - a.best);
  } else if (sortMode === 'fastest') {
    entries.sort((a, b) => a.best - b.best);
  } else if (sortMode === 'attempts') {
    entries.sort((a, b) => b.attempts - a.attempts);
  }

  const listEl = _phEl('phSbList');
  const emptyEl = _phEl('phSbEmpty');
  const statsEl  = _phEl('phSbStats');

  if (!entries.length) {
    if (listEl)  listEl.innerHTML = '';
    if (emptyEl) emptyEl.hidden = false;
    if (statsEl) statsEl.hidden = true;
    return;
  }
  if (emptyEl) emptyEl.hidden = true;

  // Stats bar
  if (statsEl) {
    const avg    = entries.reduce((s, e) => s + e.best, 0) / entries.length;
    const fastest = entries.slice().sort((a,b) => a.best - b.best)[0];
    const slowest = entries.slice().sort((a,b) => b.best - a.best)[0];
    statsEl.hidden = false;
    statsEl.innerHTML = `
      <div class="ph-sb-stat"><span class="ph-sb-stat-label">Words timed</span><span class="ph-sb-stat-val">${entries.length}</span></div>
      <div class="ph-sb-stat"><span class="ph-sb-stat-label">Avg best</span><span class="ph-sb-stat-val">${(avg/1000).toFixed(1)}s</span></div>
      <div class="ph-sb-stat"><span class="ph-sb-stat-label">⚡ Fastest</span><span class="ph-sb-stat-val ph-sb-fast">${fastest.word} <em>${(fastest.best/1000).toFixed(1)}s</em></span></div>
      <div class="ph-sb-stat"><span class="ph-sb-stat-label">🐢 Slowest</span><span class="ph-sb-stat-val ph-sb-slow">${slowest.word} <em>${(slowest.best/1000).toFixed(1)}s</em></span></div>
    `;
  }

  // Speed bar max for visual scaling (cap at 20s for readability)
  const maxMs = Math.min(Math.max(...entries.map(e => e.best)), 20000);

  if (listEl) {
    listEl.innerHTML = entries.map((e, i) => {
      const barPct  = Math.round((Math.min(e.best, maxMs) / maxMs) * 100);
      // Colour: fast=green, slow=red, via hue interpolation
      const hue     = Math.round(120 - (barPct / 100) * 120); // 120=green, 0=red
      const ruleTags = e.rules.map(r =>
        `<span class="ph-sb-rule-tag">${r}</span>`
      ).join('');
      const bestMs  = e.best < 1000 ? e.best + 'ms' : (e.best/1000).toFixed(1) + 's';
      // Get phonetic from FIJIAN_WORDS
      const wordObj = typeof FIJIAN_WORDS !== 'undefined'
        ? FIJIAN_WORDS.find(w => w.word === e.word)
        : null;
      const phonetic = wordObj ? (wordObj.phonetic || _toPhonetic(e.word)) : _toPhonetic(e.word);
      return `
        <div class="ph-sb-row">
          <div class="ph-sb-rank">${i + 1}</div>
          <div class="ph-sb-body">
            <div class="ph-sb-top">
              <span class="ph-sb-word">${e.word}</span>
              <span class="ph-sb-phonetic">→ ${phonetic}</span>
              ${ruleTags}
              <span class="ph-sb-time">${bestMs}</span>
            </div>
            <div class="ph-sb-bar-wrap">
              <div class="ph-sb-bar" style="width:${barPct}%;background:hsl(${hue},65%,48%)"></div>
            </div>
            <div class="ph-sb-meta">${e.attempts} attempt${e.attempts !== 1 ? 's' : ''}</div>
          </div>
        </div>`;
    }).join('');
  }
}
