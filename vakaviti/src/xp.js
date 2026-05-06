/* ═══════════════════════════════════════════════
   VAKAVITI — XP, Levels, Achievements & Leaderboard
   ═══════════════════════════════════════════════

   Storage keys:
     vakaviti_xp       — { total, weeklyXp, weekStart, events: [] }
     vakaviti_profile  — { name, joinDate }
     vakaviti_badges   — { "<achievementId>": "YYYY-MM-DD", ... }

   XP values:
     quiz_correct    +10
     quiz_complete   +50  (any round finish)
     quiz_perfect    +100 (100% score bonus, on top of complete)
     streak_increment +25
     drill_cleared   +15  (correct drill answer)
     drill_graduated +75  (card graduated out of bank)

   Levels (Fijian titles):
     0–199     Vulagi    (Visitor)
     200–499   Tamata    (Person)
     500–999   Cauravou  (Young learner)
     1000–1999 Matai     (Scholar)
     2000+     Turaga    (Chief)
   ═══════════════════════════════════════════════ */

const XP_KEY      = 'vakaviti_xp';
const PROFILE_KEY = 'vakaviti_profile';
const BADGES_KEY  = 'vakaviti_badges';

// XP amounts
const XP_VALUES = {
  quiz_correct:       10,
  quiz_complete:      50,
  quiz_perfect:       100,
  streak_increment:   25,
  drill_cleared:      15,
  drill_graduated:    75,
  phonetic_correct:   12,   // slightly more than quiz — harder skill
  phonetic_complete:  40,   // round completion
  phonetic_perfect:   80,   // 100% round bonus
};

// Levels
const LEVELS = [
  { min: 0,    max: 199,  title: 'Vulagi',    subtitle: 'Visitor' },
  { min: 200,  max: 499,  title: 'Tamata',    subtitle: 'Learner' },
  { min: 500,  max: 999,  title: 'Cauravou',  subtitle: 'Student' },
  { min: 1000, max: 1999, title: 'Matai',     subtitle: 'Scholar' },
  { min: 2000, max: Infinity, title: 'Turaga', subtitle: 'Chief' },
];

// Achievements
const ACHIEVEMENTS = [
  {
    id: 'first_bula',
    title: 'First Bula!',
    desc: 'Completed your very first quiz round.',
    icon: '🌺',
    check: (xpData, badges) => (xpData.quizRounds || 0) >= 1,
  },
  {
    id: 'dua_tale',
    title: 'Dua Tale',
    desc: 'Visited Vakaviti on a second day.',
    icon: '🔄',
    check: (xpData, badges) => (xpData.visitDays || 0) >= 2,
  },
  {
    id: 'seven_day_streak',
    title: '7-Day Streak',
    desc: 'Maintained a 7-day consecutive quiz streak.',
    icon: '🔥',
    check: (xpData, badges) => (xpData.maxStreak || 0) >= 7,
  },
  {
    id: 'perfect_round',
    title: 'Perfect Round',
    desc: 'Scored 100% in a quiz round.',
    icon: '⭐',
    check: (xpData, badges) => (xpData.perfectRounds || 0) >= 1,
  },
  {
    id: 'words_10',
    title: '10 Words Drilled',
    desc: 'Correctly answered 10 drill cards.',
    icon: '📚',
    check: (xpData, badges) => (xpData.drillCorrect || 0) >= 10,
  },
  {
    id: 'words_50',
    title: '50 Words Drilled',
    desc: 'Correctly answered 50 drill cards — impressive dedication.',
    icon: '📖',
    check: (xpData, badges) => (xpData.drillCorrect || 0) >= 50,
  },
  {
    id: 'words_100',
    title: '100 Words Learned',
    desc: 'Correctly answered 100 drill cards in total.',
    icon: '🏆',
    check: (xpData, badges) => (xpData.drillCorrect || 0) >= 100,
  },
  {
    id: 'graduated_5',
    title: 'Graduating Class',
    desc: 'Graduated 5 flashcards from your drill bank.',
    icon: '🎓',
    check: (xpData, badges) => (xpData.drillGraduated || 0) >= 5,
  },
  {
    id: 'quiz_100',
    title: 'Century Quizzer',
    desc: 'Completed 100 quiz rounds total.',
    icon: '💯',
    check: (xpData, badges) => (xpData.quizRounds || 0) >= 100,
  },
  {
    id: 'reach_tamata',
    title: 'Tamata!',
    desc: 'Reached 200 XP — you are now a Learner.',
    icon: '🌟',
    check: (xpData, badges) => (xpData.total || 0) >= 200,
  },
  {
    id: 'reach_cauravou',
    title: 'Cauravou!',
    desc: 'Reached 500 XP — you are now a Student.',
    icon: '✨',
    check: (xpData, badges) => (xpData.total || 0) >= 500,
  },
  {
    id: 'reach_matai',
    title: 'Matai!',
    desc: 'Reached 1000 XP — you are now a Scholar.',
    icon: '🥇',
    check: (xpData, badges) => (xpData.total || 0) >= 1000,
  },
  {
    id: 'reach_turaga',
    title: 'Turaga!',
    desc: 'Reached 2000 XP — you are the Chief of Vakaviti!',
    icon: '👑',
    check: (xpData, badges) => (xpData.total || 0) >= 2000,
  },
];

// ── In-memory fallback ────────────────────────
let _memXP      = null;
let _memProfile = null;
let _memBadges  = null;

// ── Storage helpers ───────────────────────────
function xpRead() {
  try {
    const r = localStorage.getItem(XP_KEY);
    if (r) return JSON.parse(r);
  } catch (_) {}
  return _memXP ? { ..._memXP } : {
    total: 0, weeklyXp: 0, weekStart: _thisWeekStart(),
    quizRounds: 0, perfectRounds: 0, drillCorrect: 0, drillGraduated: 0,
    visitDays: 0, lastVisitDate: null, maxStreak: 0, events: [],
  };
}

function xpWrite(data) {
  _memXP = { ...data };
  try { localStorage.setItem(XP_KEY, JSON.stringify(data)); } catch (_) {}
}

function profileRead() {
  try {
    const r = localStorage.getItem(PROFILE_KEY);
    if (r) return JSON.parse(r);
  } catch (_) {}
  return _memProfile ? { ..._memProfile } : null;
}

function profileWrite(data) {
  _memProfile = { ...data };
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(data)); } catch (_) {}
}

function badgesRead() {
  try {
    const r = localStorage.getItem(BADGES_KEY);
    if (r) return JSON.parse(r);
  } catch (_) {}
  return _memBadges ? { ..._memBadges } : {};
}

function badgesWrite(data) {
  _memBadges = { ...data };
  try { localStorage.setItem(BADGES_KEY, JSON.stringify(data)); } catch (_) {}
}

// ── Week helpers ──────────────────────────────
function _thisWeekStart() {
  const d = new Date();
  const day = d.getDay(); // 0=Sun
  d.setDate(d.getDate() - day);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function _checkWeekReset(data) {
  const ws = _thisWeekStart();
  if (data.weekStart !== ws) {
    data.weekStart = ws;
    data.weeklyXp  = 0;
  }
  return data;
}

// ── Level lookup ──────────────────────────────
function xpGetLevel(total) {
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (total >= LEVELS[i].min) return { ...LEVELS[i], index: i };
  }
  return { ...LEVELS[0], index: 0 };
}

function xpProgressInLevel(total) {
  const lvl = xpGetLevel(total);
  if (lvl.max === Infinity) return { pct: 100, current: total - lvl.min, needed: null };
  const current = total - lvl.min;
  const needed  = lvl.max - lvl.min + 1;
  return { pct: Math.round((current / needed) * 100), current, needed };
}

// ── Award XP (main public API) ────────────────
/**
 * xpAward(event, opts)
 *   event: string key from XP_VALUES
 *   opts:  { score, total } for quiz_complete (to check perfect)
 */
function xpAward(event, opts) {
  const amount = XP_VALUES[event];
  if (!amount) return;

  let data = xpRead();
  data = _checkWeekReset(data);

  // Track event counters
  if (event === 'quiz_complete') {
    data.quizRounds = (data.quizRounds || 0) + 1;
  }
  if (event === 'quiz_perfect') {
    data.perfectRounds = (data.perfectRounds || 0) + 1;
  }
  if (event === 'drill_cleared') {
    data.drillCorrect = (data.drillCorrect || 0) + 1;
  }
  if (event === 'drill_graduated') {
    data.drillGraduated = (data.drillGraduated || 0) + 1;
  }
  if (event === 'streak_increment') {
    // Pull current streak from streak.js state
    const streakData = readStreak ? readStreak() : null;
    if (streakData && streakData.count > (data.maxStreak || 0)) {
      data.maxStreak = streakData.count;
    }
  }

  // Track visit days
  const today = todayISO();
  if (data.lastVisitDate !== today) {
    data.visitDays  = (data.visitDays || 0) + 1;
    data.lastVisitDate = today;
  }

  const prevTotal = data.total || 0;
  data.total    = prevTotal + amount;
  data.weeklyXp = (data.weeklyXp || 0) + amount;

  // Keep a rolling log of last 20 events
  if (!data.events) data.events = [];
  data.events.unshift({ event, amount, date: today });
  if (data.events.length > 20) data.events = data.events.slice(0, 20);

  xpWrite(data);

  // Check for new level
  const prevLevel = xpGetLevel(prevTotal);
  const newLevel  = xpGetLevel(data.total);
  if (newLevel.index > prevLevel.index) {
    _showLevelUpToast(newLevel);
  }

  // Check achievements
  _checkAchievements(data);

  // Refresh XP chip
  renderXPChip(data);
}

// ── Achievement checking ──────────────────────
function _checkAchievements(xpData) {
  const badges = badgesRead();
  const today  = todayISO();
  const newly  = [];

  ACHIEVEMENTS.forEach(ach => {
    if (badges[ach.id]) return; // already earned
    if (ach.check(xpData, badges)) {
      badges[ach.id] = today;
      newly.push(ach);
    }
  });

  if (newly.length > 0) {
    badgesWrite(badges);
    // Show toasts one by one (staggered)
    newly.forEach((ach, i) => {
      setTimeout(() => _showAchievementToast(ach), i * 800);
    });
  }
}

// ── Toast: Achievement ────────────────────────
let _toastQueue = [];
let _toastActive = false;

function _showAchievementToast(ach) {
  _toastQueue.push(ach);
  if (!_toastActive) _drainToastQueue();
}

function _drainToastQueue() {
  if (_toastQueue.length === 0) { _toastActive = false; return; }
  _toastActive = true;
  const ach   = _toastQueue.shift();
  const toast = document.getElementById('xpToast');
  if (!toast) { _toastActive = false; return; }

  document.getElementById('xpToastIcon').textContent  = ach.icon;
  document.getElementById('xpToastTitle').textContent = ach.title;
  document.getElementById('xpToastDesc').textContent  = ach.desc;

  toast.classList.remove('toast-enter', 'toast-exit');
  void toast.offsetWidth;
  toast.hidden = false;
  toast.classList.add('toast-enter');

  setTimeout(() => {
    toast.classList.remove('toast-enter');
    toast.classList.add('toast-exit');
    toast.addEventListener('animationend', () => {
      toast.hidden = true;
      toast.classList.remove('toast-exit');
      setTimeout(_drainToastQueue, 200);
    }, { once: true });
  }, 3500);
}

// ── Level-up banner (header-anchored) ────────
let _levelupTimer = null;

function _showLevelUpToast(level) {
  const banner  = document.getElementById('levelupBanner');
  const titleEl = document.getElementById('levelupTitle');
  const subEl   = document.getElementById('levelupSub');
  const dismiss = document.getElementById('levelupDismiss');
  if (!banner) return;

  titleEl.textContent = `You are now a ${level.title}`;
  subEl.textContent   = level.subtitle;

  const levelColors = ['#5ba4b0','#3d9e6e','#e08b2a','#c47b2b','#7c5cbf'];
  banner.style.setProperty('--levelup-color', levelColors[level.index] || '#0a6e7c');

  // Slide banner down from header
  banner.classList.remove('levelup-hide');
  banner.classList.add('levelup-show');

  // Pulse the XP chip
  const chip = document.getElementById('xpChip');
  if (chip) {
    chip.classList.remove('xp-chip-pulse');
    void chip.offsetWidth;
    chip.classList.add('xp-chip-pulse');
    chip.addEventListener('animationend', () => chip.classList.remove('xp-chip-pulse'), { once: true });
  }

  _fireConfetti();

  if (_levelupTimer) clearTimeout(_levelupTimer);
  _levelupTimer = setTimeout(_hideLevelUpBanner, 5500);

  if (dismiss) {
    dismiss.onclick = () => {
      if (_levelupTimer) clearTimeout(_levelupTimer);
      _hideLevelUpBanner();
    };
  }
}

function _hideLevelUpBanner() {
  const banner = document.getElementById('levelupBanner');
  if (!banner) return;
  banner.classList.remove('levelup-show');
  banner.classList.add('levelup-hide');
  banner.addEventListener('animationend', () => {
    banner.classList.remove('levelup-hide');
  }, { once: true });
}

// ── Confetti ──────────────────────────────────
function _fireConfetti() {
  const canvas = document.getElementById('levelupConfetti');
  if (!canvas) return;

  const W = window.innerWidth;
  const H = 220;
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const COLORS = ['#0a6e7c','#14b0c5','#c47b2b','#f5c842','#e05c8a','#7c5cbf','#34d399'];
  const COUNT  = 90;
  const particles = [];

  for (let i = 0; i < COUNT; i++) {
    particles.push({
      x:    Math.random() * W,
      y:    -10 - Math.random() * 40,
      vx:   (Math.random() - 0.5) * 3.5,
      vy:   2.5 + Math.random() * 3.5,
      rot:  Math.random() * 360,
      vrot: (Math.random() - 0.5) * 8,
      w:    6 + Math.random() * 6,
      h:    3 + Math.random() * 3,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      alpha: 1,
    });
  }

  let raf;
  function draw() {
    ctx.clearRect(0, 0, W, H);
    let alive = false;
    particles.forEach(p => {
      if (p.alpha <= 0) return;
      alive = true;
      p.x   += p.vx;
      p.y   += p.vy;
      p.rot += p.vrot;
      p.vy  += 0.08;
      if (p.y > H - 10) p.alpha -= 0.04;
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * Math.PI / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    if (alive) raf = requestAnimationFrame(draw);
    else ctx.clearRect(0, 0, W, H);
  }
  draw();
}

// ── Render XP chip in header ──────────────────
function renderXPChip(data) {
  if (!data) data = xpRead();
  const chip  = document.getElementById('xpChip');
  const label = document.getElementById('xpChipLabel');
  const sub   = document.getElementById('xpChipSub');
  if (!chip || !label) return;

  const lvl = xpGetLevel(data.total || 0);
  label.textContent = lvl.title;
  if (sub) sub.textContent = `${data.total || 0} XP`;
}

// ── Leaderboard ───────────────────────────────
// Leaderboard is personal-score only (localStorage) — shows your own rank
// within a weekly snapshot. No server, no other players.
// We track top-5 weekly scores from past weeks.

const LB_KEY = 'vakaviti_leaderboard';

function lbRead() {
  try {
    const r = localStorage.getItem(LB_KEY);
    if (r) return JSON.parse(r);
  } catch (_) {}
  return [];
}

function lbWrite(data) {
  try { localStorage.setItem(LB_KEY, JSON.stringify(data)); } catch (_) {}
}

function lbSaveWeekSnapshot() {
  const xpData  = xpRead();
  const profile = profileRead();
  const name    = profile ? profile.name : 'You';
  const board   = lbRead();

  const entry = {
    name,
    xp:    xpData.weeklyXp || 0,
    level: xpGetLevel(xpData.total || 0).title,
    week:  xpData.weekStart || _thisWeekStart(),
    total: xpData.total || 0,
  };

  // Only keep one entry per week (update if same week)
  const existing = board.findIndex(e => e.week === entry.week);
  if (existing >= 0) {
    board[existing] = entry;
  } else {
    board.unshift(entry);
  }
  // Keep last 8 weeks
  lbWrite(board.slice(0, 8));
}

// ═══════════════════════════════════════════════
//   PUBLIC TOP-10 (honour system)
//   Seeded with early-adopter placeholder names.
//   You update this array manually as WhatsApp
//   submissions come in — redeploy to refresh.
// ═══════════════════════════════════════════════

const PUBLIC_TOP10 = [
  { rank: 1,  name: 'Mere T.',      xp: 2340, tier: 'Turaga',   flag: '🇫🇯', note: 'Champion of the Month 🌸' },
  { rank: 2,  name: 'Josefa N.',    xp: 1875, tier: 'Matai',    flag: '🇫🇯', note: '' },
  { rank: 3,  name: 'Salote V.',    xp: 1620, tier: 'Matai',    flag: '🇫🇯', note: '' },
  { rank: 4,  name: 'Timoci R.',    xp: 1280, tier: 'Matai',    flag: '🇫🇯', note: '' },
  { rank: 5,  name: 'Litia K.',     xp: 980,  tier: 'Cauravou', flag: '🇦🇺', note: 'Weekly Tiko Bibi 🏆' },
  { rank: 6,  name: 'Peni M.',      xp: 820,  tier: 'Cauravou', flag: '🇫🇯', note: '' },
  { rank: 7,  name: 'Adi S.',       xp: 645,  tier: 'Cauravou', flag: '🇳🇿', note: '' },
  { rank: 8,  name: 'Viliame B.',   xp: 440,  tier: 'Tamata',   flag: '🇫🇯', note: '' },
  { rank: 9,  name: 'Anaseini L.',  xp: 310,  tier: 'Tamata',   flag: '🇦🇺', note: '' },
  { rank: 10, name: 'Rusiate D.',   xp: 205,  tier: 'Tamata',   flag: '🇫🇯', note: '' },
];

const TIER_BADGE_COLORS = {
  Vulagi:   '#5ba4b0',
  Tamata:   '#3d9e6e',
  Cauravou: '#e08b2a',
  Matai:    '#c47b2b',
  Turaga:   '#7c5cbf',
};

function renderTop10Tab(xpData, profile) {
  const list      = document.getElementById('lbTop10List');
  const nameEl    = document.getElementById('lbSubmitName');
  const xpEl      = document.getElementById('lbSubmitXP');
  const tierEl    = document.getElementById('lbSubmitTier');
  const submitBtn = document.getElementById('lbSubmitBtn');
  if (!list) return;

  const myXP    = xpData.total || 0;
  const myLevel = xpGetLevel(myXP);
  const myName  = profile ? profile.name : 'You';

  // Work out where the player would rank
  let myRank = PUBLIC_TOP10.length + 1;
  for (let i = 0; i < PUBLIC_TOP10.length; i++) {
    if (myXP >= PUBLIC_TOP10[i].xp) { myRank = i + 1; break; }
  }

  // Update submit card
  const rankEl = document.querySelector('.lb-submit-rank');
  if (rankEl)  rankEl.textContent = myRank <= 10 ? `#${myRank}` : '#?';
  if (nameEl)  nameEl.textContent = myName;
  if (xpEl)    xpEl.textContent   = `${myXP.toLocaleString()} XP`;
  if (tierEl) {
    tierEl.textContent = myLevel.title;
    tierEl.style.background = TIER_BADGE_COLORS[myLevel.title] || '#5ba4b0';
  }

  // Build WhatsApp submit message
  if (submitBtn) {
    const msg = `Bula! I want to submit my Vakaviti score for the Community Top 10:\n\nName: ${myName}\nTier: ${myLevel.title} (${myLevel.subtitle})\nXP: ${myXP}\nQuiz rounds: ${xpData.quizRounds || 0}\nPerfect scores: ${xpData.perfectRounds || 0}\n\n(I've attached my rank card screenshot)`;
    submitBtn.href = `https://wa.me/61478886145?text=${encodeURIComponent(msg)}`;
  }

  // Render the top-10 rows
  list.innerHTML = '';

  // Merge in local player if they'd make top 10
  let board = [...PUBLIC_TOP10];
  const alreadyListed = board.some(e => e.name.toLowerCase() === myName.toLowerCase());
  if (!alreadyListed && myXP > 0) {
    board.push({ rank: 99, name: myName + ' (you)', xp: myXP, tier: myLevel.title, flag: '⭐', note: 'Your current score' });
    board.sort((a, b) => b.xp - a.xp);
    board = board.slice(0, 10);
    board.forEach((e, i) => { e.rank = i + 1; });
  }

  const medals = ['🥇','🥈','🥉'];

  board.forEach(entry => {
    const isYou    = entry.note === 'Your current score';
    const medal    = medals[entry.rank - 1] || '';
    const color    = TIER_BADGE_COLORS[entry.tier] || '#5ba4b0';
    const barWidth = Math.round((entry.xp / (board[0].xp || 1)) * 100);

    const row = document.createElement('div');
    row.className = 'lb-top10-row' + (isYou ? ' lb-top10-you' : '') + (entry.rank <= 3 ? ' lb-top10-podium' : '');
    row.innerHTML = `
      <span class="lb-top10-rank">${medal || '#' + entry.rank}</span>
      <div class="lb-top10-body">
        <div class="lb-top10-meta">
          <span class="lb-top10-flag">${entry.flag}</span>
          <span class="lb-top10-name">${entry.name}</span>
          ${entry.note ? `<span class="lb-top10-note">${entry.note}</span>` : ''}
        </div>
        <div class="lb-top10-bar-wrap">
          <div class="lb-top10-bar"><div class="lb-top10-fill" style="width:${barWidth}%;background:${color}"></div></div>
          <span class="lb-top10-xp">${entry.xp.toLocaleString()} XP</span>
        </div>
      </div>
      <span class="lb-top10-tier-pill" style="background:${color}">${entry.tier}</span>
    `;
    list.appendChild(row);
  });
}

// ── Leaderboard panel render ──────────────────
function renderLeaderboard() {
  const panel = document.getElementById('lbPanel');
  if (!panel) return;

  lbSaveWeekSnapshot();

  const board   = lbRead();
  const xpData  = xpRead();
  const profile = profileRead();
  const name    = profile ? profile.name : 'You';
  const lvl     = xpGetLevel(xpData.total || 0);
  const prog    = xpProgressInLevel(xpData.total || 0);

  // Player card
  document.getElementById('lbPlayerName').textContent  = name;
  document.getElementById('lbPlayerLevel').textContent = `${lvl.title} — ${lvl.subtitle}`;
  document.getElementById('lbTotalXP').textContent     = `${xpData.total || 0} XP total`;

  const progBar   = document.getElementById('lbLevelProgress');
  const progLabel = document.getElementById('lbLevelProgressLabel');
  if (progBar) progBar.style.width = prog.pct + '%';
  if (progLabel) {
    progLabel.textContent = prog.needed
      ? `${prog.current} / ${prog.needed} XP to next level`
      : 'Max level reached — Turaga!';
  }

  // ── Achievements tab ──
  const badges      = badgesRead();
  const achGrid     = document.getElementById('lbAchGrid');
  const achCount    = document.getElementById('lbAchCount');
  const earnedCount = Object.keys(badges).length;
  if (achCount) achCount.textContent = `${earnedCount} / ${ACHIEVEMENTS.length}`;
  if (achGrid) {
    achGrid.innerHTML = '';
    ACHIEVEMENTS.forEach(ach => {
      const earned = !!badges[ach.id];
      const el = document.createElement('div');
      el.className = 'lb-ach-item' + (earned ? ' earned' : ' locked');
      el.title = earned ? ach.desc : 'Locked — ' + ach.desc;
      el.innerHTML = `
        <span class="lb-ach-icon">${ach.icon}</span>
        <span class="lb-ach-title">${ach.title}</span>
        ${earned ? `<span class="lb-ach-date">${badges[ach.id]}</span>` : ''}
      `;
      achGrid.appendChild(el);
    });
  }

  // ── Rewards tab ──
  const rewardsList = document.getElementById('rewardsList');
  if (rewardsList) renderRewardsTab(rewardsList, xpData.total || 0);

  // ── Top 10 tab ──
  renderTop10Tab(xpData, profile);

  // ── History tab ──
  const historyEl = document.getElementById('lbHistory');
  if (historyEl) {
    historyEl.innerHTML = '';
    if (board.length === 0) {
      historyEl.innerHTML = '<p class="lb-empty">Complete quiz rounds to earn XP and build your history.</p>';
    } else {
      board.forEach((entry, i) => {
        const row = document.createElement('div');
        row.className = 'lb-row' + (i === 0 ? ' lb-row-current' : '');
        row.innerHTML = `
          <span class="lb-rank">#${i + 1}</span>
          <span class="lb-entry-name">${entry.name}</span>
          <span class="lb-entry-level">${entry.level}</span>
          <span class="lb-entry-xp">${entry.xp} XP</span>
          <span class="lb-entry-week">${_formatWeek(entry.week)}</span>
        `;
        historyEl.appendChild(row);
      });
    }
  }

  // ── Wire tab switching (once) ──
  if (!panel._tabsWired) {
    panel._tabsWired = true;
    panel.querySelectorAll('.lb-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.lbtab;
        panel.querySelectorAll('.lb-tab').forEach(t => {
          t.classList.toggle('active', t === tab);
          t.setAttribute('aria-selected', t === tab);
        });
        panel.querySelectorAll('.lb-tab-content').forEach(c => {
          c.hidden = c.id !== 'lbTab' + target.charAt(0).toUpperCase() + target.slice(1);
        });
        const titleEl = document.getElementById('lbPanelTitle');
        if (titleEl) titleEl.textContent =
          target === 'rewards' ? 'Rewards' :
          target === 'history' ? 'XP History' :
          target === 'top10'   ? 'Community Top 10' : 'Achievements';
      });
    });
  }
}

function _formatWeek(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  return `Week of ${d.toLocaleDateString('en-AU', { month: 'short', day: 'numeric' })}`;
}

// ── Profile name prompt ───────────────────────
function xpEnsureProfile(callback) {
  const profile = profileRead();
  if (profile && profile.name) {
    if (callback) callback(profile);
    return;
  }
  // Show name prompt modal
  const modal = document.getElementById('xpNameModal');
  if (!modal) {
    // Fallback — just use 'Learner'
    const p = { name: 'Learner', joinDate: todayISO() };
    profileWrite(p);
    if (callback) callback(p);
    return;
  }

  // Show via class (not hidden attr) so display:flex is preserved
  modal.classList.add('xp-name-modal-visible');

  // Replace the button to clear any old onclick handlers
  const oldBtn = document.getElementById('xpNameSaveBtn');
  const newBtn = oldBtn.cloneNode(true);
  oldBtn.parentNode.replaceChild(newBtn, oldBtn);

  function onSave() {
    const input = document.getElementById('xpNameInput');
    const name  = (input ? input.value.trim() : '') || 'Learner';
    const p     = { name, joinDate: todayISO() };
    profileWrite(p);
    modal.classList.remove('xp-name-modal-visible');
    // Clear input for next time
    if (input) input.value = '';
    renderXPChip();
    if (callback) callback(p);
  }

  document.getElementById('xpNameSaveBtn').addEventListener('click', onSave, { once: true });

  // Also allow Enter key in input
  const input = document.getElementById('xpNameInput');
  if (input) {
    input.focus();
    const onEnter = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); onSave(); input.removeEventListener('keydown', onEnter); }
    };
    input.addEventListener('keydown', onEnter);
  }
}

// ── Open / close leaderboard panel ───────────
function openLeaderboard() {
  xpEnsureProfile(() => {
    renderLeaderboard();
    const panel = document.getElementById('lbPanel');
    const backdrop = document.getElementById('lbBackdrop');
    if (panel)    { panel.hidden = false; panel.classList.add('lbp-open'); }
    if (backdrop) backdrop.hidden = false;
    document.body.style.overflow = 'hidden';
  });
}

function closeLeaderboard() {
  const panel    = document.getElementById('lbPanel');
  const backdrop = document.getElementById('lbBackdrop');
  if (panel)    { panel.classList.remove('lbp-open'); panel.hidden = true; }
  if (backdrop) backdrop.hidden = true;
  document.body.style.overflow = '';
}

// ── Init ──────────────────────────────────────
function xpInit() {
  const data = xpRead();
  _checkWeekReset(data);
  xpWrite(data);
  renderXPChip(data);

  // Wire trophy button
  const trophyBtn  = document.getElementById('lbOpenBtn');
  const closeBtn   = document.getElementById('lbCloseBtn');
  const backdrop   = document.getElementById('lbBackdrop');
  const nameModal  = document.getElementById('xpNameModal');

  if (trophyBtn)  trophyBtn.addEventListener('click', openLeaderboard);
  if (closeBtn)   closeBtn.addEventListener('click', closeLeaderboard);
  if (backdrop)   backdrop.addEventListener('click', closeLeaderboard);

  // Wire tier challenges button
  const tcOpenBtn  = document.getElementById('tcOpenBtn');
  const tcCloseBtn = document.getElementById('tcCloseBtn');
  const tcBackdrop = document.getElementById('tcBackdrop');
  const tcShareBtn = document.getElementById('tcShareBtn');

  if (tcOpenBtn)  tcOpenBtn.addEventListener('click', openTierChallenges);
  if (tcCloseBtn) tcCloseBtn.addEventListener('click', closeTierChallenges);
  if (tcBackdrop) tcBackdrop.addEventListener('click', closeTierChallenges);
  // Wire rank card button
  const tcRankCardBtn = document.getElementById('tcRankCardBtn');
  if (tcRankCardBtn) tcRankCardBtn.addEventListener('click', () => {
    closeTierChallenges();
    setTimeout(openRankCard, 200);
  });

  if (tcShareBtn) tcShareBtn.addEventListener('click', () => {
    const url  = 'https://www.perplexity.ai/computer/a/vakaviti-fijian-dictionary-Wu1SKdfvR2CpbHKFWmvbhg';
    const text = '🌺 I\u2019m learning Fijian on Vakaviti — 160 words, quiz mode, rewards and real tour discounts from Fiji Tours & Transfers! Join me and see who reaches Turaga first 👑 ' + url;
    if (navigator.share) {
      navigator.share({ title: 'Vakaviti — Fijian Dictionary', text, url }).catch(() => {});
    } else {
      navigator.clipboard.writeText(text).then(() => {
        tcShareBtn.textContent = '✓ Copied to clipboard!';
        setTimeout(() => {
          tcShareBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98"/></svg> Share with your group`;
        }, 2500);
      }).catch(() => {
        window.open('https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url), '_blank');
      });
    }
  });

  if (nameModal) {
    // Close if clicking the backdrop area (outside the box)
    nameModal.addEventListener('click', e => {
      if (e.target === nameModal) nameModal.classList.remove('xp-name-modal-visible');
    });
  }

  // Check achievements on load (catches any that happened before xp.js existed)
  _checkAchievements(data);

  // Ensure profile exists (prompt on first visit)
  setTimeout(() => xpEnsureProfile(), 1200);
}

// ═══════════════════════════════════════════════
//   TIER CHALLENGES
// ═══════════════════════════════════════════════

/*  Each challenge entry:
    id          – unique key for localStorage progress storage
    title       – display name
    desc        – what you need to do
    icon        – emoji icon
    xpReward    – XP awarded on completion (informational only — already earned via normal events)
    metric      – function(xpData) → { current, target }
    tiers       – which level indices this challenge applies to (null = all tiers)
    category    – 'quiz' | 'drill' | 'streak' | 'explore'
*/
const TIER_CHALLENGES = [
  // ── Vulagi (0–199) challenges ──
  {
    id: 'tc_quiz_5_rounds',
    title: 'First Five Rounds',
    desc: 'Complete 5 quiz rounds',
    icon: '🎯',
    xpReward: 250,
    metric: d => ({ current: Math.min(d.quizRounds || 0, 5), target: 5 }),
    tiers: [0],
    category: 'quiz',
  },
  {
    id: 'tc_perfect_1',
    title: 'Perfect Score',
    desc: 'Get 100% on any quiz round',
    icon: '⭐',
    xpReward: 100,
    metric: d => ({ current: Math.min(d.perfectRounds || 0, 1), target: 1 }),
    tiers: [0],
    category: 'quiz',
  },
  {
    id: 'tc_drill_10',
    title: 'Drill Starter',
    desc: 'Answer 10 flashcard drill cards correctly',
    icon: '📚',
    xpReward: 150,
    metric: d => ({ current: Math.min(d.drillCorrect || 0, 10), target: 10 }),
    tiers: [0],
    category: 'drill',
  },

  // ── Tamata (200–499) challenges ──
  {
    id: 'tc_quiz_20_rounds',
    title: 'Committed Learner',
    desc: 'Complete 20 quiz rounds total',
    icon: '🎓',
    xpReward: 600,
    metric: d => ({ current: Math.min(d.quizRounds || 0, 20), target: 20 }),
    tiers: [1],
    category: 'quiz',
  },
  {
    id: 'tc_perfect_3',
    title: 'Perfect Hat-Trick',
    desc: 'Score 100% on 3 different quiz rounds',
    icon: '🌟',
    xpReward: 300,
    metric: d => ({ current: Math.min(d.perfectRounds || 0, 3), target: 3 }),
    tiers: [1],
    category: 'quiz',
  },
  {
    id: 'tc_drill_30',
    title: 'Flashcard Fighter',
    desc: 'Answer 30 flashcard drill cards correctly',
    icon: '🃏',
    xpReward: 400,
    metric: d => ({ current: Math.min(d.drillCorrect || 0, 30), target: 30 }),
    tiers: [1],
    category: 'drill',
  },
  {
    id: 'tc_streak_3',
    title: '3-Day Streak',
    desc: 'Maintain a 3-day consecutive quiz streak',
    icon: '🔥',
    xpReward: 75,
    metric: d => ({ current: Math.min(d.maxStreak || 0, 3), target: 3 }),
    tiers: [1],
    category: 'streak',
  },

  // ── Cauravou (500–999) challenges ──
  {
    id: 'tc_quiz_50_rounds',
    title: 'Halfway Champion',
    desc: 'Complete 50 quiz rounds total',
    icon: '🏅',
    xpReward: 1200,
    metric: d => ({ current: Math.min(d.quizRounds || 0, 50), target: 50 }),
    tiers: [2],
    category: 'quiz',
  },
  {
    id: 'tc_perfect_10',
    title: 'Perfect 10',
    desc: 'Score 100% on 10 quiz rounds',
    icon: '💯',
    xpReward: 700,
    metric: d => ({ current: Math.min(d.perfectRounds || 0, 10), target: 10 }),
    tiers: [2],
    category: 'quiz',
  },
  {
    id: 'tc_drill_50',
    title: 'Drill Master',
    desc: 'Answer 50 flashcard drill cards correctly',
    icon: '📖',
    xpReward: 600,
    metric: d => ({ current: Math.min(d.drillCorrect || 0, 50), target: 50 }),
    tiers: [2],
    category: 'drill',
  },
  {
    id: 'tc_grad_5',
    title: 'Graduating Class',
    desc: 'Graduate 5 flashcards from your drill bank',
    icon: '🎓',
    xpReward: 375,
    metric: d => ({ current: Math.min(d.drillGraduated || 0, 5), target: 5 }),
    tiers: [2],
    category: 'drill',
  },

  // ── Matai (1000–1999) challenges ──
  {
    id: 'tc_quiz_100_rounds',
    title: 'Century Quizzer',
    desc: 'Complete 100 quiz rounds — an elite milestone',
    icon: '🏆',
    xpReward: 2500,
    metric: d => ({ current: Math.min(d.quizRounds || 0, 100), target: 100 }),
    tiers: [3],
    category: 'quiz',
  },
  {
    id: 'tc_perfect_25',
    title: 'Perfection Streak',
    desc: 'Score 100% on 25 quiz rounds',
    icon: '👑',
    xpReward: 1500,
    metric: d => ({ current: Math.min(d.perfectRounds || 0, 25), target: 25 }),
    tiers: [3],
    category: 'quiz',
  },
  {
    id: 'tc_drill_100',
    title: 'Word Scholar',
    desc: 'Answer 100 flashcard drill cards correctly',
    icon: '🎯',
    xpReward: 1000,
    metric: d => ({ current: Math.min(d.drillCorrect || 0, 100), target: 100 }),
    tiers: [3],
    category: 'drill',
  },
  {
    id: 'tc_streak_7',
    title: 'Week Warrior',
    desc: 'Hit a 7-day consecutive quiz streak',
    icon: '🔥',
    xpReward: 175,
    metric: d => ({ current: Math.min(d.maxStreak || 0, 7), target: 7 }),
    tiers: [3],
    category: 'streak',
  },

  // ── Turaga (2000+) challenges — ongoing mastery ──
  {
    id: 'tc_quiz_160_all',
    title: 'All 160 Mastered',
    desc: 'Complete a full 160-question quiz round',
    icon: '👑',
    xpReward: 2260,
    metric: d => ({
      current: Math.min(d.quizRounds || 0, 160),
      target: 160,
    }),
    tiers: [4],
    category: 'quiz',
  },
  {
    id: 'tc_grad_20',
    title: 'Master Linguist',
    desc: 'Graduate 20 flashcards from your drill bank',
    icon: '🌺',
    xpReward: 1500,
    metric: d => ({ current: Math.min(d.drillGraduated || 0, 20), target: 20 }),
    tiers: [4],
    category: 'drill',
  },
  {
    id: 'tc_streak_14',
    title: 'Two-Week Titan',
    desc: 'Maintain a 14-day consecutive quiz streak',
    icon: '🌊',
    xpReward: 350,
    metric: d => ({ current: Math.min(d.maxStreak || 0, 14), target: 14 }),
    tiers: [4],
    category: 'streak',
  },
];

// ── Open / close tier challenges panel ───────────
function openTierChallenges() {
  xpEnsureProfile(() => {
    renderTierChallenges();
    const panel    = document.getElementById('tcPanel');
    const backdrop = document.getElementById('tcBackdrop');
    if (panel)    { panel.hidden = false; panel.classList.add('tc-open'); }
    if (backdrop) backdrop.hidden = false;
    document.body.style.overflow = 'hidden';
  });
}

function closeTierChallenges() {
  const panel    = document.getElementById('tcPanel');
  const backdrop = document.getElementById('tcBackdrop');
  if (panel)    { panel.classList.remove('tc-open'); panel.hidden = true; }
  if (backdrop) backdrop.hidden = true;
  document.body.style.overflow = '';
}

// ── Render tier challenges panel ─────────────────
function renderTierChallenges() {
  const xpData = xpRead();
  const total  = xpData.total || 0;
  const lvl    = xpGetLevel(total);
  const prog   = xpProgressInLevel(total);

  // ── Status card ──
  const badge   = document.getElementById('tcStatusTierBadge');
  const xpEl    = document.getElementById('tcStatusXP');
  const fill    = document.getElementById('tcXPFill');
  const label   = document.getElementById('tcXPLabel');
  const nextEl  = document.getElementById('tcStatusNext');
  const subEl   = document.getElementById('tcPanelSub');

  const tierColors = ['#5ba4b0','#3d9e6e','#e08b2a','#c47b2b','#7c5cbf'];
  const tierColor  = tierColors[lvl.index] || '#0a6e7c';

  if (badge) {
    badge.innerHTML = `<span class="tc-tier-name" style="background:${tierColor}">${lvl.title}</span><span class="tc-tier-sub">${lvl.subtitle}</span>`;
  }
  if (xpEl)   xpEl.textContent   = `${total} XP earned`;
  if (fill)   fill.style.width   = prog.pct + '%';
  if (fill)   fill.style.background = tierColor;
  if (label) {
    label.textContent = prog.needed
      ? `${prog.current} / ${prog.needed} XP to ${LEVELS[lvl.index + 1] ? LEVELS[lvl.index + 1].title : 'max'}`
      : 'Maximum tier reached — Turaga!';
  }
  if (nextEl) {
    if (lvl.index < LEVELS.length - 1) {
      const nextLvl  = LEVELS[lvl.index + 1];
      const xpNeeded = nextLvl.min - total;
      nextEl.textContent = `${xpNeeded} more XP to become ${nextLvl.title} (${nextLvl.subtitle})`;
    } else {
      nextEl.textContent = 'You have reached the highest tier. Bula vinaka!';
    }
  }
  if (subEl) {
    subEl.textContent = lvl.index < LEVELS.length - 1
      ? `${lvl.title} → ${LEVELS[lvl.index + 1].title}`
      : 'Turaga — Max tier';
  }

  // ── Challenge list ──
  const list = document.getElementById('tcChallengesList');
  if (!list) return;
  list.innerHTML = '';

  // Show current-tier challenges + next-tier preview
  const currentTierChallenges = TIER_CHALLENGES.filter(c => c.tiers && c.tiers.includes(lvl.index));
  const nextTierChallenges    = lvl.index < LEVELS.length - 1
    ? TIER_CHALLENGES.filter(c => c.tiers && c.tiers.includes(lvl.index + 1))
    : [];

  // ── Section: Active challenges (current tier) ──
  if (currentTierChallenges.length > 0) {
    const heading = document.createElement('div');
    heading.className = 'tc-section-heading';
    heading.innerHTML = `<span>Active Challenges</span><span class="tc-section-tier" style="color:${tierColor}">${lvl.title}</span>`;
    list.appendChild(heading);

    currentTierChallenges.forEach(c => {
      const m       = c.metric(xpData);
      const pct     = Math.round((m.current / m.target) * 100);
      const done    = m.current >= m.target;
      const catColor = { quiz: '#0a6e7c', drill: '#c47b2b', streak: '#e05c8a', explore: '#7c5cbf' }[c.category] || '#0a6e7c';

      const card = document.createElement('div');
      card.className = 'tc-challenge-card' + (done ? ' tc-done' : '');
      card.innerHTML = `
        <div class="tc-challenge-top">
          <span class="tc-ch-icon">${c.icon}</span>
          <div class="tc-ch-body">
            <span class="tc-ch-title">${c.title}</span>
            <span class="tc-ch-desc">${c.desc}</span>
          </div>
          <span class="tc-ch-xp">+${c.xpReward} XP</span>
        </div>
        <div class="tc-ch-progress-wrap">
          <div class="tc-ch-bar"><div class="tc-ch-fill" style="width:${pct}%;background:${done ? '#2d7a45' : catColor}"></div></div>
          <span class="tc-ch-count">${done ? '✓ Complete' : `${m.current} / ${m.target}`}</span>
        </div>
        <span class="tc-ch-cat tc-cat-${c.category}">${c.category}</span>
      `;
      list.appendChild(card);
    });
  }

  // ── Section: Next tier preview ──
  if (nextTierChallenges.length > 0) {
    const nextLvl   = LEVELS[lvl.index + 1];
    const previewColor = tierColors[lvl.index + 1] || '#5ba4b0';

    const heading2 = document.createElement('div');
    heading2.className = 'tc-section-heading tc-section-preview';
    heading2.innerHTML = `<span>Next Tier Preview</span><span class="tc-section-tier" style="color:${previewColor}">${nextLvl.title}</span>`;
    list.appendChild(heading2);

    nextTierChallenges.forEach(c => {
      const m   = c.metric(xpData);
      const pct = Math.round((m.current / m.target) * 100);

      const card = document.createElement('div');
      card.className = 'tc-challenge-card tc-preview';
      card.innerHTML = `
        <div class="tc-challenge-top">
          <span class="tc-ch-icon tc-ch-icon-locked">${c.icon}</span>
          <div class="tc-ch-body">
            <span class="tc-ch-title">${c.title}</span>
            <span class="tc-ch-desc">${c.desc}</span>
          </div>
          <span class="tc-ch-xp tc-ch-xp-preview">+${c.xpReward} XP</span>
        </div>
        <div class="tc-ch-progress-wrap">
          <div class="tc-ch-bar"><div class="tc-ch-fill" style="width:${pct}%;background:${previewColor};opacity:0.5"></div></div>
          <span class="tc-ch-count">${m.current} / ${m.target} — starts at ${nextLvl.title}</span>
        </div>
        <span class="tc-ch-cat tc-cat-${c.category}">${c.category}</span>
      `;
      list.appendChild(card);
    });
  }

  // ── Quick tips section ──
  const tips = document.createElement('div');
  tips.className = 'tc-tips';
  tips.innerHTML = `
    <p class="tc-tips-heading">How to earn XP fast</p>
    <ul class="tc-tips-list">
      <li><strong>+10 XP</strong> per correct quiz answer</li>
      <li><strong>+50 XP</strong> for completing any quiz round</li>
      <li><strong>+100 XP</strong> bonus for a perfect round (100% score)</li>
      <li><strong>+25 XP</strong> for each new daily streak day</li>
      <li><strong>+15 XP</strong> per correct drill flashcard</li>
      <li><strong>+75 XP</strong> when a drill card graduates</li>
    </ul>
  `;
  list.appendChild(tips);
}

// ═══════════════════════════════════════════════
//   REWARDS SYSTEM
// ═══════════════════════════════════════════════

const REWARDS = [
  {
    levelIndex: 0,
    levelTitle: 'Vulagi',
    xpRequired: 0,
    rewardTitle: '"Bula Bonus" Welcome Pack',
    icon: '🌺',
    color: '#5ba4b0',
    perks: [
      'Vakaviti digital welcome certificate',
      'Printable FijiTourTransfers luggage tag',
      '5% discount off any Nadi Airport transfer',
    ],
    claimMsg: 'Bula! I\'m a Vulagi on Vakaviti — claiming my welcome pack.',
    highlight: '5% off airport transfer',
    validFor: '12 months from claim',
  },
  {
    levelIndex: 1,
    levelTitle: 'Tamata',
    xpRequired: 200,
    rewardTitle: '"Vakaviti Learner" Tour Discount',
    icon: '📖',
    color: '#3d9e6e',
    perks: [
      'Official Tamata digital certificate',
      '10% off any day tour (Sigatoka, Natadola, Coral Coast)',
      'Personalised Fijian phrase card PDF — 20 key travel phrases',
    ],
    claimMsg: 'Bula vinaka! Tamata level — claiming my tour discount.',
    highlight: '10% off any day tour',
    validFor: '12 months from claim',
  },
  {
    levelIndex: 2,
    levelTitle: 'Cauravou',
    xpRequired: 500,
    rewardTitle: '"Spirit of Fiji" Adventure Pack',
    icon: '⚡',
    color: '#e08b2a',
    perks: [
      'Cauravou digital certificate',
      '15% off any adventure tour (Zip Line, ATV, Waterfall Hike)',
      'Priority booking — personal attention from the team',
      'Shout-out on the Vakaviti community board',
    ],
    claimMsg: 'Vinaka vakalevu! Cauravou level — claiming my adventure discount and priority status.',
    highlight: '15% off adventure tours + priority booking',
    validFor: '12 months from claim',
  },
  {
    levelIndex: 3,
    levelTitle: 'Matai',
    xpRequired: 1000,
    rewardTitle: '"Matai Insider" Cultural Package',
    icon: '🥇',
    color: '#c47b2b',
    perks: [
      'Premium Matai digital certificate',
      '20% off any tour or activity',
      'Free vehicle upgrade on any airport transfer (AC van or SUV)',
      'Featured learner spotlight on Vakaviti social media',
      '15-min WhatsApp cultural briefing call with a Fiji guide',
    ],
    claimMsg: 'Bula! Matai level — claiming my cultural package and vehicle upgrade.',
    highlight: '20% off + free vehicle upgrade',
    validFor: '12 months from claim',
  },
  {
    levelIndex: 4,
    levelTitle: 'Turaga',
    xpRequired: 2000,
    rewardTitle: '"Turaga\'s Welcome" — The Full Fiji Experience',
    icon: '👑',
    color: '#7c5cbf',
    perks: [
      'Premium A3-printable Turaga certificate',
      '25% off any single booking',
      'One complimentary tour ticket (Sigatoka River Cruise or Cultural Night Tour)',
      'Meet-and-greet airport transfer — name sign, cold water & local snacks',
      'Permanent naming on Vakaviti\'s Hall of Fame',
      'Personalised 60-second WhatsApp welcome video from a Fijian guide',
    ],
    claimMsg: 'Bula vinaka vakalevu! Turaga level — claiming my champion rewards.',
    highlight: '25% off + 1 FREE tour + meet-and-greet',
    validFor: '12 months from claim',
  },
];

const SPECIAL_PRIZES = [
  {
    id: 'weekly',
    title: 'Tiko Bibi Award',
    subtitle: 'Weekly Champion',
    icon: '🏆',
    color: '#0a6e7c',
    desc: 'Top XP earner every week (tallied Sunday midnight). Earns a Tiko Bibi digital trophy, 15% discount code off any tour, and a social media shout-out.',
    claimMsg: 'Bula! I\'m this week\'s Tiko Bibi — claiming my weekly prize.',
    howTo: 'Screenshot your #1 weekly position and WhatsApp us.',
  },
  {
    id: 'monthly',
    title: 'Turaga ni Vula Award',
    subtitle: 'Champion of the Month',
    icon: '🌸',
    color: '#b03060',
    desc: 'Highest cumulative XP at month end. Wins a complimentary return Nadi Airport transfer, 25% off additional tours, featured interview, and a flower lei meet-and-greet.',
    claimMsg: 'Bula! I\'m the Turaga ni Vula this month — claiming my monthly champion prize.',
    howTo: 'Screenshot your monthly leaderboard position and WhatsApp us.',
  },
];

const WHATSAPP_NUMBER = '61478886145';

function buildWhatsAppLink(msg) {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`;
}

// ── Render rewards tab ────────────────────────
function renderRewardsTab(container, currentXP) {
  container.innerHTML = '';

  const currentLevel = xpGetLevel(currentXP);

  // Intro line
  const intro = document.createElement('p');
  intro.className = 'rewards-intro';
  intro.textContent = 'Reach each level to unlock real Fiji rewards — exclusive to Vakaviti learners. Screenshot your badge and WhatsApp to claim.';
  container.appendChild(intro);

  // Level reward cards
  REWARDS.forEach(reward => {
    const unlocked = currentLevel.index >= reward.levelIndex;
    const isCurrent = currentLevel.index === reward.levelIndex;

    const card = document.createElement('div');
    card.className = 'reward-card' +
      (unlocked ? ' reward-unlocked' : ' reward-locked') +
      (isCurrent ? ' reward-current' : '');
    card.style.setProperty('--reward-color', reward.color);

    const statusLabel = unlocked
      ? (isCurrent ? '✦ Your current level' : '✓ Unlocked')
      : `Requires ${reward.xpRequired} XP`;

    card.innerHTML = `
      <div class="reward-card-header">
        <span class="reward-icon">${reward.icon}</span>
        <div class="reward-card-titles">
          <span class="reward-level-name">${reward.levelTitle}</span>
          <span class="reward-title">${reward.rewardTitle}</span>
        </div>
        <span class="reward-status-pill ${unlocked ? 'unlocked' : 'locked'}">${statusLabel}</span>
      </div>
      <div class="reward-highlight">${reward.highlight}</div>
      <ul class="reward-perks">
        ${reward.perks.map(p => `<li>${p}</li>`).join('')}
      </ul>
      <div class="reward-footer">
        <span class="reward-valid">Valid ${reward.validFor}</span>
        ${unlocked
          ? `<a class="reward-claim-btn" href="${buildWhatsAppLink(reward.claimMsg)}" target="_blank" rel="noopener">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.124.553 4.118 1.523 5.847L0 24l6.335-1.501A11.94 11.94 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.805 9.805 0 0 1-5.032-1.386l-.361-.214-3.741.981.999-3.648-.235-.374A9.79 9.79 0 0 1 2.182 12C2.182 6.58 6.58 2.182 12 2.182S21.818 6.58 21.818 12 17.42 21.818 12 21.818z"/></svg>
              Claim on WhatsApp
            </a>`
          : `<span class="reward-locked-note">Earn ${reward.xpRequired - currentXP} more XP to unlock</span>`
        }
      </div>
    `;
    container.appendChild(card);
  });

  // Special prizes divider
  const divider = document.createElement('div');
  divider.className = 'rewards-special-heading';
  divider.innerHTML = `<span>Special Prizes</span>`;
  container.appendChild(divider);

  // Weekly + Monthly prize cards
  SPECIAL_PRIZES.forEach(prize => {
    const card = document.createElement('div');
    card.className = 'reward-card reward-special';
    card.style.setProperty('--reward-color', prize.color);
    card.innerHTML = `
      <div class="reward-card-header">
        <span class="reward-icon">${prize.icon}</span>
        <div class="reward-card-titles">
          <span class="reward-level-name">${prize.subtitle}</span>
          <span class="reward-title">${prize.title}</span>
        </div>
        <span class="reward-status-pill special">Open to all</span>
      </div>
      <p class="reward-special-desc">${prize.desc}</p>
      <div class="reward-footer">
        <span class="reward-valid">${prize.howTo}</span>
        <a class="reward-claim-btn" href="${buildWhatsAppLink(prize.claimMsg)}" target="_blank" rel="noopener">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.124.553 4.118 1.523 5.847L0 24l6.335-1.501A11.94 11.94 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.805 9.805 0 0 1-5.032-1.386l-.361-.214-3.741.981.999-3.648-.235-.374A9.79 9.79 0 0 1 2.182 12C2.182 6.58 6.58 2.182 12 2.182S21.818 6.58 21.818 12 17.42 21.818 12 21.818z"/></svg>
          Claim on WhatsApp
        </a>
      </div>
    `;
    container.appendChild(card);
  });

  // Footer note
  const footer = document.createElement('p');
  footer.className = 'rewards-footer-note';
  footer.innerHTML = `All rewards provided by <a href="https://www.fijitourtransfers.com" target="_blank" rel="noopener">Fiji Tours &amp; Transfers</a>. Valid 12 months from claim. WhatsApp: +61 478 886 145.`;
  container.appendChild(footer);
}
