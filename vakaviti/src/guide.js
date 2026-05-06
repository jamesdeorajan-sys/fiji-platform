/* ═══════════════════════════════════════════════
   VAKAVITI — User Guide
   5-chapter explainer modal with prev/next nav,
   chapter dots, tab nav, and first-visit auto-show.
   ═══════════════════════════════════════════════ */

const GUIDE_KEY      = 'vakaviti_guide_seen';
const GUIDE_CHAPTERS = ['welcome', 'learning', 'xp', 'rewards', 'community'];

// ── Tips of the Day ──────────────────────────────
// 30 tips cycling daily, indexed by day-of-year mod 30.
// Each tip has: text, tag (feature label), icon.
const GUIDE_TIPS = [
  // Spaced Repetition
  { text: "The Missed Words Drill uses spaced repetition — harder cards come back sooner, mastered ones fade away. Work through your drill queue every day and you'll retain words 5× longer than reading them once.", tag: "Spaced Repetition", icon: "🧠" },
  { text: "When a drill flashcard feels too hard, tap 'Again' — the SM-2 algorithm will show it again in just 1 day. Tap 'Easy' and it waits 4 days. The system does the scheduling; you just answer honestly.", tag: "Spaced Repetition", icon: "🧠" },
  { text: "Cards that graduate from the drill (shown 'Easy' twice) earn you +75 XP. Aim to graduate 5 cards a week — that's 375 XP without a single extra quiz.", tag: "Spaced Repetition", icon: "🧠" },
  { text: "Spaced repetition works best in short daily sessions. Even 5 minutes of drill each morning beats one long cramming session. Open the Missed Words Drill from the quiz screen and clear your due cards first.", tag: "Spaced Repetition", icon: "🧠" },
  { text: "After any quiz, words you answered wrong are automatically added to your Missed Words bank. Don't skip the drill — those words are exactly the ones your brain needs to revisit.", tag: "Spaced Repetition", icon: "🧠" },

  // Streak Tracker
  { text: "Your streak counter resets at midnight. Set a daily alarm for 10 PM as a safety net — even one quiz question keeps the chain alive and earns you +25 XP.", tag: "Streak Tracker", icon: "🔥" },
  { text: "A 7-day streak unlocks the Cauravou tier challenge badge. You don't need a perfect score every day — just open the app and answer at least one question.", tag: "Streak Tracker", icon: "🔥" },
  { text: "Streaks compound your XP. The longer your streak, the faster you'll climb tiers. Even a modest 3-question quiz every day adds up to 1,000+ XP in a month.", tag: "Streak Tracker", icon: "🔥" },
  { text: "Lost your streak? Don't quit. Start a new one immediately — your XP total is preserved, and returning learners often beat their personal best within a week.", tag: "Streak Tracker", icon: "🔥" },
  { text: "Pair your Vakaviti session with an existing habit — morning coffee, lunch break, or brushing your teeth. Habit stacking is the easiest way to protect your streak long-term.", tag: "Streak Tracker", icon: "🔥" },

  // Quiz Mode
  { text: "Reverse quiz (English → Fijian) is harder than forward quiz — but it's where real fluency builds. If you're scoring 80 %+ on forward mode, switch to reverse and halve your score to challenge yourself.", tag: "Quiz Mode", icon: "🎯" },
  { text: "A perfect round (100% score) gives you a +100 XP bonus on top of the +10 per correct answer. Slow down, read each option carefully — one careless mistake costs you 100 XP.", tag: "Quiz Mode", icon: "🎯" },
  { text: "Before each quiz round, glance at the Word of the Day. It often appears as a question — knowing it in advance is a legal cheat that boosts your score.", tag: "Quiz Mode", icon: "🎯" },
  { text: "Quiz distractors are chosen from the same category as the correct answer. If the question is about food, all four options will be food words — so knowing the full category helps you eliminate wrong answers fast.", tag: "Quiz Mode", icon: "🎯" },
  { text: "After a quiz round, your Personal Best badge updates automatically. Screenshot it and post in the Facebook group — the community celebrates new PBs every week.", tag: "Quiz Mode", icon: "🎯" },

  // Word of the Day
  { text: "The Word of the Day rotates every 24 hours. Make it a habit to tap 'Listen' each morning — hearing the pronunciation before you quiz on it dramatically improves recall.", tag: "Word of the Day", icon: "⭐" },
  { text: "Tap 'Full entry' on the Word of the Day to read its Fijian definition, not just the English translation. Understanding a word in its own language doubles retention.", tag: "Word of the Day", icon: "⭐" },
  { text: "Heart ❤️ the Word of the Day the moment you see it. Then quiz on it the same day — saving it first primes your brain to look for it in the question list.", tag: "Word of the Day", icon: "⭐" },

  // Favourites & Dictionary
  { text: "Build a personal Favourites list of words you want to master this week. Filter the dictionary by Favourites, then run a quiz — every question will come from your chosen words.", tag: "Favourites", icon: "❤️" },
  { text: "The dictionary search is instant. Type a partial English meaning (e.g. 'eat') to find all related Fijian words at once. Browsing by theme beats random memorisation.", tag: "Dictionary", icon: "📖" },
  { text: "Filter words by the Travel category to focus on Fijian you'll actually use on a tour or holiday. All travel words link back to real Fiji Tour Transfers experiences.", tag: "Dictionary", icon: "📖" },

  // XP & Tiers
  { text: "The fastest route to Tamata (200 XP) is 2 quiz rounds with 80 %+ accuracy. Open quiz, complete two back-to-back rounds — you'll hit Tamata before lunch.", tag: "XP & Tiers", icon: "⚡" },
  { text: "Each tier unlock comes with a reward. Cauravou members get a shout-out in the Facebook group; Turaga earns a free Fiji Tour Transfers transfer. Keep climbing — every tier is worth it.", tag: "XP & Tiers", icon: "⚡" },
  { text: "Your XP is saved locally on your device. To preserve your progress when switching phones, note your XP total and submit it to the Community Top 10 via WhatsApp — the team can restore it manually.", tag: "XP & Tiers", icon: "⚡" },
  { text: "XP earned per correct drill flashcard (+15) is lower than quiz (+10 each + round bonus), but drill XP is the most reliable — there's no time pressure and you know which words you'll face.", tag: "XP & Tiers", icon: "⚡" },

  // Community
  { text: "Share your Rank Card in the Facebook group right after reaching a new tier. Posts within 24 hours of a tier-up get the most engagement — your achievement is fresh news.", tag: "Community", icon: "👑" },
  { text: "The Community Top 10 resets monthly. Even if you're not top-ranked now, a strong final week of the month can push you onto the board. Check the leaderboard panel to see the gap.", tag: "Community", icon: "👑" },
  { text: "Challenge a friend in the Facebook group to match your current streak. Friendly competition is the single biggest predictor of long-term language learning success.", tag: "Community", icon: "👑" },

  // General Learning
  { text: "Say each Fijian word aloud after hearing it — even a whisper counts. Combining audio with speech activates more memory pathways than silent reading alone.", tag: "Study Tip", icon: "💬" },
  { text: "Don't aim for perfection on day one. Research shows that accepting 70–80% accuracy early on keeps you motivated longer than chasing 100% from the start.", tag: "Study Tip", icon: "💬" },
  { text: "Try using your new Fijian words in real sentences — even silly ones. The more personal and vivid the context, the longer the word sticks. 'Kana vinaka' before every meal is a great start.", tag: "Study Tip", icon: "💬" },
];

// ── Get today's tip (day-of-year mod TIPS length) ─
function _getTodaysTip() {
  const now  = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff  = now - start;
  const oneDay = 1000 * 60 * 60 * 24;
  const dayOfYear = Math.floor(diff / oneDay);         // 1–365
  return GUIDE_TIPS[dayOfYear % GUIDE_TIPS.length];
}

// ── Render the Tip of the Day block ──────────────
function _renderTotd() {
  const tip = _getTodaysTip();
  if (!tip) return;

  const textEl    = document.getElementById('guideTotdText');
  const tagEl     = document.getElementById('guideTotdTag');
  const dateEl    = document.getElementById('guideTotdDate');
  const counterEl = document.getElementById('guideTotdCounter');

  if (textEl)    textEl.textContent    = tip.text;
  if (tagEl)     tagEl.textContent     = tip.icon + ' ' + tip.tag;
  if (dateEl) {
    const d = new Date();
    dateEl.textContent = d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  if (counterEl) {
    const now   = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    const diff  = now - start;
    const oneDay = 1000 * 60 * 60 * 24;
    const dayIdx = Math.floor(diff / oneDay) % GUIDE_TIPS.length;
    counterEl.textContent = `Tip ${dayIdx + 1} of ${GUIDE_TIPS.length}`;
  }
}

let _guideCurrentIdx = 0;

// ── Capitalise first letter helper ───────────────
function _cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ── Open / close ─────────────────────────────────
function openGuide(startChapter) {
  const modal = document.getElementById('guideModal');
  if (!modal) return;
  modal.classList.add('guide-modal-visible');
  document.body.style.overflow = 'hidden';
  _guideGoTo(startChapter ? GUIDE_CHAPTERS.indexOf(startChapter) : 0);
  // Mark as seen
  try { localStorage.setItem(GUIDE_KEY, '1'); } catch (_) {}
}

function closeGuide() {
  const modal = document.getElementById('guideModal');
  if (!modal) return;
  modal.classList.remove('guide-modal-visible');
  document.body.style.overflow = '';
}

// ── Navigate to chapter by index ─────────────────
function _guideGoTo(idx) {
  if (idx < 0 || idx >= GUIDE_CHAPTERS.length) return;
  _guideCurrentIdx = idx;

  const chapter = GUIDE_CHAPTERS[idx];

  // Show/hide chapter panels
  GUIDE_CHAPTERS.forEach(c => {
    const el = document.getElementById('guideChapter' + _cap(c));
    if (el) el.hidden = (c !== chapter);
  });

  // Update chapter nav tabs
  document.querySelectorAll('.guide-nav-btn').forEach(btn => {
    const active = btn.dataset.chapter === chapter;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active);
  });

  // Update prev/next buttons
  const prevBtn = document.getElementById('guidePrevBtn');
  const nextBtn = document.getElementById('guideNextBtn');
  if (prevBtn) prevBtn.disabled = idx === 0;
  if (nextBtn) {
    if (idx === GUIDE_CHAPTERS.length - 1) {
      nextBtn.innerHTML = 'Get started <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m9 18 6-6-6-6"/></svg>';
    } else {
      nextBtn.innerHTML = 'Next <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m9 18 6-6-6-6"/></svg>';
    }
  }

  // Update dots
  _guideUpdateDots(idx);
}

// ── Dot indicators ────────────────────────────────
function _guideUpdateDots(activeIdx) {
  const wrap = document.getElementById('guideDots');
  if (!wrap) return;
  wrap.innerHTML = '';
  GUIDE_CHAPTERS.forEach((_, i) => {
    const dot = document.createElement('button');
    dot.className = 'guide-dot' + (i === activeIdx ? ' active' : '');
    dot.setAttribute('aria-label', `Go to chapter ${i + 1}`);
    dot.addEventListener('click', () => _guideGoTo(i));
    wrap.appendChild(dot);
  });
}

// ── Init ─────────────────────────────────────────
function guideInit() {
  const openBtn  = document.getElementById('guideOpenBtn');
  const closeBtn = document.getElementById('guideCloseBtn');
  const prevBtn  = document.getElementById('guidePrevBtn');
  const nextBtn  = document.getElementById('guideNextBtn');
  const modal    = document.getElementById('guideModal');

  if (openBtn)  openBtn.addEventListener('click', () => openGuide());
  if (closeBtn) closeBtn.addEventListener('click', closeGuide);

  // Close on backdrop click
  if (modal) {
    modal.addEventListener('click', e => {
      if (e.target === modal) closeGuide();
    });
  }

  // Keyboard: Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeGuide();
  });

  // Prev / Next
  if (prevBtn) prevBtn.addEventListener('click', () => _guideGoTo(_guideCurrentIdx - 1));
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (_guideCurrentIdx === GUIDE_CHAPTERS.length - 1) {
        closeGuide();
      } else {
        _guideGoTo(_guideCurrentIdx + 1);
      }
    });
  }

  // Chapter nav tabs
  document.querySelectorAll('.guide-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = GUIDE_CHAPTERS.indexOf(btn.dataset.chapter);
      if (idx >= 0) _guideGoTo(idx);
    });
  });

  // First-visit: show only after name modal has been dismissed
  try {
    const seen = localStorage.getItem(GUIDE_KEY);
    if (!seen) {
      // Poll every 300ms until the name modal is gone, then show guide after 1.5s
      const _waitForNameModal = () => {
        const nm = document.getElementById('xpNameModal');
        const nameVisible = nm && nm.classList.contains('xp-name-modal-visible');
        if (nameVisible) {
          setTimeout(_waitForNameModal, 300);
        } else {
          // Name modal dismissed (or never appeared) — wait a beat then show guide
          setTimeout(() => openGuide(), 1500);
        }
      };
      // Start polling after 1.5s (name modal appears at ~1.2s)
      setTimeout(_waitForNameModal, 1500);
    }
  } catch (_) {}

  // Build initial dots
  _guideUpdateDots(0);

  // Render Tip of the Day
  _renderTotd();
}
