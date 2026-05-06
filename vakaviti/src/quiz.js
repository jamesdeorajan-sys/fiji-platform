/* ═══════════════════════════════════════════════
   VAKAVITI — Quiz Mode (forward + reverse)
   ═══════════════════════════════════════════════ */

const quiz = {
  // Settings
  totalQuestions: 10,
  categoryFilter: 'all',
  mode: 'forward',      // 'forward' = English→Fijian | 'reverse' = Fijian→English

  // Runtime state
  questions: [],
  currentIndex: 0,
  score: 0,
  answered: false,
  missed: [],
};

// ── DOM shortcuts ──────────────────────────────
const qz = id => document.getElementById(id);

// ── Populate category dropdown (once) ─────────
let _catPopulated = false;
function quizPopulateCategories() {
  if (_catPopulated) return;
  _catPopulated = true;
  const sel = qz('quizCatSelect');
  CATEGORIES.filter(c => c.id !== 'all').forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = cat.label;
    sel.appendChild(opt);
  });
}

// ── Fisher-Yates shuffle ───────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Build question pool ────────────────────────
function buildQuestions() {
  let pool = quiz.categoryFilter === 'all'
    ? [...FIJIAN_WORDS]
    : FIJIAN_WORDS.filter(w => w.category === quiz.categoryFilter);
  if (pool.length < 4) pool = [...FIJIAN_WORDS];
  const shuffled = shuffle(pool);
  const count = Math.min(quiz.totalQuestions, shuffled.length);
  return shuffled.slice(0, count);
}

// ── 4 options (always from full word list for variety) ─
function getOptions(correctWord) {
  const others = FIJIAN_WORDS.filter(w => w.id !== correctWord.id);
  const distractors = shuffle(others).slice(0, 3);
  return shuffle([correctWord, ...distractors]);
}

// ── Truncate English to one clean sentence ─────
function shortEnglish(word) {
  return word.englishDef.split(/\.|;/)[0].trim();
}

// ── Open / close ───────────────────────────────
function openQuiz() {
  quizPopulateCategories();
  qz('quizOverlay').hidden = false;
  showScreen('quizStartScreen');
  document.body.style.overflow = 'hidden';
}

function closeQuiz() {
  qz('quizOverlay').hidden = true;
  document.body.style.overflow = '';
  if (window.speechSynthesis) window.speechSynthesis.cancel();
}

function showScreen(id) {
  ['quizStartScreen', 'quizQuestionScreen', 'quizResultScreen'].forEach(s => {
    qz(s).hidden = s !== id;
  });
}

// ── Start ──────────────────────────────────────
function startQuiz() {
  quiz.totalQuestions = parseInt(qz('quizLengthSelect').value, 10);
  quiz.categoryFilter = qz('quizCatSelect').value;
  quiz.questions = buildQuestions();
  quiz.currentIndex = 0;
  quiz.score = 0;
  quiz.missed = [];
  showScreen('quizQuestionScreen');
  renderQuestion();
}

// ── Render question ────────────────────────────
function renderQuestion() {
  const total  = quiz.questions.length;
  const idx    = quiz.currentIndex;
  const word   = quiz.questions[idx];
  const isRev  = quiz.mode === 'reverse';
  quiz.answered = false;

  // Progress bar
  qz('quizProgressFill').style.width = (idx / total * 100) + '%';
  qz('quizProgressLabel').textContent = `Question ${idx + 1} of ${total}`;
  qz('quizScoreBadge').textContent = idx === 0 ? `0 correct` : `${quiz.score} / ${idx}`;

  // ── Prompt card ──
  // Forward: show English → guess Fijian
  // Reverse: show Fijian word → guess English
  const promptEl = qz('quizEnglish');   // repurposed as main card text
  const hintEl   = qz('quizHint');
  const promptEl2 = qz('quizQPrompt'); // the "which word means…" line

  if (isRev) {
    // Big Fijian word in the card
    promptEl.innerHTML =
      `<span class="quiz-card-fijian">${word.word}</span>` +
      `<span class="quiz-card-phonetic">/${word.phonetic}/</span>`;
    hintEl.textContent = `${word.partOfSpeech} · ${word.category}`;
    if (promptEl2) promptEl2.textContent = 'What does this Fijian word mean?';
  } else {
    promptEl.textContent = shortEnglish(word);
    hintEl.textContent = `${word.partOfSpeech} · ${word.category}`;
    if (promptEl2) promptEl2.textContent = 'Which Fijian word means…';
  }

  // ── Options ──
  const options   = getOptions(word);
  const letters   = ['A', 'B', 'C', 'D'];
  const container = qz('quizOptions');
  container.innerHTML = '';

  options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'quiz-option' + (isRev ? ' reverse-opt' : '');
    btn.setAttribute('role', 'listitem');
    btn.dataset.id = opt.id;
    btn.dataset.correct = opt.id === word.id ? '1' : '0';

    if (isRev) {
      // Show English meanings as options
      const eng = shortEnglish(opt);
      btn.innerHTML = `
        <span class="quiz-opt-letter">${letters[i]}</span>
        <span class="quiz-opt-text">
          <span class="quiz-opt-word">${eng}</span>
        </span>
      `;
    } else {
      // Show Fijian words as options
      btn.innerHTML = `
        <span class="quiz-opt-letter">${letters[i]}</span>
        <span class="quiz-opt-text">
          <span class="quiz-opt-word">${opt.word}</span>
          <span class="quiz-opt-phonetic">/${opt.phonetic}/</span>
        </span>
      `;
    }

    btn.addEventListener('click', () => handleAnswer(btn, word, options));
    container.appendChild(btn);
  });

  // Reset feedback + next button
  const fb = qz('quizFeedback');
  fb.hidden = true;
  fb.className = 'quiz-feedback';
  fb.textContent = '';

  const nextBtn = qz('quizNextBtn');
  nextBtn.hidden = true;
  nextBtn.textContent = idx + 1 < total ? 'Next question →' : 'See results →';
}

// ── Handle answer ──────────────────────────────
function handleAnswer(clickedBtn, correctWord, allOptions) {
  if (quiz.answered) return;
  quiz.answered = true;

  const isCorrect = clickedBtn.dataset.correct === '1';
  const isRev     = quiz.mode === 'reverse';

  qz('quizOptions').querySelectorAll('.quiz-option').forEach(btn => {
    btn.setAttribute('disabled', '');
    if (btn.dataset.correct === '1') {
      btn.classList.add('correct');
    } else if (btn === clickedBtn && !isCorrect) {
      btn.classList.add('wrong');
    } else {
      btn.classList.add('dimmed');
    }
  });

  const fb = qz('quizFeedback');
  fb.hidden = false;

  if (isCorrect) {
    quiz.score++;
    if (window.xpAward) xpAward('quiz_correct');
    const praises = [
      'Vinaka! That\'s correct.',
      'Io! Well done.',
      'Correct — you\'re learning fast!',
      'Dina! Right answer.',
      'Vinaka vakalevu! Perfect.',
    ];
    fb.textContent = praises[Math.floor(Math.random() * praises.length)];
    fb.className = 'quiz-feedback correct-fb';
  } else {
    quiz.missed.push(correctWord);
    // Persist to missed bank for drill mode
    drillAddMiss(correctWord.id, quiz.mode);
    if (isRev) {
      // Reveal the English meaning
      fb.textContent = `Not quite. "${correctWord.word}" means: ${shortEnglish(correctWord)}.`;
    } else {
      fb.textContent = `Not quite. The answer is "${correctWord.word}" (/${correctWord.phonetic}/)`;
    }
    fb.className = 'quiz-feedback wrong-fb';
  }

  qz('quizScoreBadge').textContent = `${quiz.score} / ${quiz.currentIndex + 1} correct`;
  qz('quizNextBtn').hidden = false;
}

// ── Advance ────────────────────────────────────
function nextQuestion() {
  quiz.currentIndex++;
  if (quiz.currentIndex >= quiz.questions.length) {
    showResults();
  } else {
    renderQuestion();
  }
}

// ── Results ────────────────────────────────────
function showResults() {
  showScreen('quizResultScreen');

  const total = quiz.questions.length;
  const score = quiz.score;
  const pct   = total > 0 ? Math.round((score / total) * 100) : 0;

  const circumference = 264;
  const offset = circumference - (circumference * pct / 100);
  const ring = qz('quizRingCircle');
  ring.style.strokeDashoffset = circumference;
  setTimeout(() => {
    ring.style.transition = 'stroke-dashoffset 1s cubic-bezier(0.16, 1, 0.3, 1)';
    ring.style.strokeDashoffset = offset;
  }, 80);
  ring.style.stroke = pct >= 80
    ? 'var(--color-success)'
    : pct >= 50
    ? 'var(--color-primary)'
    : 'var(--color-error)';

  qz('quizResultBig').textContent  = score;
  qz('quizResultDenom').textContent = `out of ${total}`;

  let title, sub;
  if (pct === 100) {
    title = 'Vinaka vakalevu!';
    sub = 'Perfect score — you know your Fijian. Truly impressive!';
  } else if (pct >= 80) {
    title = 'Vinaka! Great work.';
    sub = `${pct}% correct. Strong grasp — keep going!`;
  } else if (pct >= 60) {
    title = 'Good effort!';
    sub = `${pct}% correct. Real progress. Review the words you missed below.`;
  } else if (pct >= 40) {
    title = 'Keep practicing!';
    sub = `${pct}% correct. Each session gets you closer.`;
  } else {
    title = 'Just getting started!';
    sub = `${pct}% correct. Browse the dictionary and try again.`;
  }
  qz('quizResultTitle').textContent = title;
  qz('quizResultSub').textContent   = sub;

  // XP for round completion
  if (window.xpAward) {
    xpAward('quiz_complete', { score, total });
    if (pct === 100) xpAward('quiz_perfect');
  }

  // Record streak completion
  const { data: streakData, isNew: streakIsNew } = streakRecordCompletion();
  renderStreakResult(streakData, streakIsNew);

  // Personal best
  const pbResult = pbCheckAndRecord(score, total, quiz.categoryFilter, quiz.mode);
  renderPBBadge(pbResult);

  // Show drill button if bank has words for this mode
  drillUpdateLaunchBtn();

  // Missed words
  const missedWrap = qz('quizMissedWrap');
  const missedList = qz('quizMissedList');
  missedList.innerHTML = '';

  if (quiz.missed.length > 0) {
    missedWrap.hidden = false;
    const seen = new Set();
    quiz.missed
      .filter(w => { if (seen.has(w.id)) return false; seen.add(w.id); return true; })
      .forEach(word => {
        const item = document.createElement('div');
        item.className = 'quiz-missed-item';
        const shortEng = word.englishDef.length > 48
          ? word.englishDef.slice(0, 48).trimEnd() + '…'
          : word.englishDef;
        item.innerHTML = `
          <span class="quiz-missed-word">${word.word}</span>
          <span class="quiz-missed-eng">${shortEng}</span>
        `;
        item.addEventListener('click', () => {
          closeQuiz();
          setTimeout(() => openModal(word.id), 150);
        });
        missedList.appendChild(item);
      });
  } else {
    missedWrap.hidden = true;
  }
}

// ── Mode toggle ────────────────────────────────
document.querySelectorAll('.quiz-mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    quiz.mode = btn.dataset.mode;
    document.querySelectorAll('.quiz-mode-btn').forEach(b => {
      b.classList.toggle('active', b === btn);
      b.setAttribute('aria-pressed', b === btn);
    });
    // Update subtitle
    const sub = qz('quizStartSub');
    if (sub) {
      sub.textContent = quiz.mode === 'reverse'
        ? 'You\'ll see a Fijian word — pick the correct English meaning from 4 options.'
        : 'You\'ll see an English meaning — pick the correct Fijian word from 4 options.';
    }
  });
});

// ── Event bindings ─────────────────────────────
qz('quizLaunchBtn').addEventListener('click', openQuiz);
qz('quizCloseStart').addEventListener('click', closeQuiz);
qz('quizStartBtn').addEventListener('click', startQuiz);
qz('quizQuitBtn').addEventListener('click', closeQuiz);
qz('quizNextBtn').addEventListener('click', nextQuestion);
qz('quizPlayAgainBtn').addEventListener('click', () => showScreen('quizStartScreen'));
qz('quizReturnBtn').addEventListener('click', closeQuiz);

// Drill mode bindings (elements added by drill screen in HTML)
document.getElementById('drillLaunchBtn').addEventListener('click', openDrill);
document.getElementById('drillCloseBtn').addEventListener('click', closeDrill);
document.getElementById('drillNextBtn').addEventListener('click', () => {
  if (drill.queue.length === 0) {
    drillShowComplete();
  } else {
    drillNext();
  }
});
document.getElementById('drillPlayAgainBtn').addEventListener('click', () => {
  closeDrill();
  openQuiz();
});
document.getElementById('drillReturnBtn').addEventListener('click', closeDrill);

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (qz('quizOverlay').hidden) return;
  // If drill screen is active, its own handler takes over
  const drillActive = !document.getElementById('drillScreen').hidden;
  if (drillActive) return;
  if (e.key === 'Escape') { closeQuiz(); return; }

  if (!qz('quizQuestionScreen').hidden && !quiz.answered) {
    const keyMap = { 'a': 0, 'b': 1, 'c': 2, 'd': 3 };
    const idx = keyMap[e.key.toLowerCase()];
    if (idx !== undefined) {
      const opts = qz('quizOptions').querySelectorAll('.quiz-option');
      if (opts[idx]) opts[idx].click();
      return;
    }
  }

  if ((e.key === 'Enter' || e.key === ' ') && !qz('quizNextBtn').hidden) {
    e.preventDefault();
    nextQuestion();
  }
});
