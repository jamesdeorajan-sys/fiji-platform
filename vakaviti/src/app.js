/* ═══════════════════════════════════════════════
   VAKAVITI — Fijian Dictionary App
   ═══════════════════════════════════════════════ */

// ── State ──────────────────────────────────────
const state = {
  query: '',
  category: 'all',
  sort: 'alpha',
  favorites: new Set(),
  currentWordId: null,
  filteredWords: [...FIJIAN_WORDS],
  speech: null,
};

// ── DOM refs ───────────────────────────────────
const $ = id => document.getElementById(id);
const searchInput  = $('searchInput');
const searchClear  = $('searchClear');
const randomBtn    = $('randomBtn');
const wordGrid     = $('wordGrid');
const noResults    = $('noResults');
const noResultsQ   = $('noResultsQuery');
const resultsCount = $('resultsCount');
const filterScroll = $('filterScroll');
const sortSelect   = $('sortSelect');
const favBadge     = $('favBadge');
const favPanel     = $('favPanel');
const favList      = $('favList');
const favEmpty     = $('favEmpty');
const favPanelClose= $('favPanelClose');
const favoritesToggle = $('favoritesToggle');
const panelBackdrop= $('panelBackdrop');
const clearFavs    = $('clearFavs');
const modalOverlay = $('modalOverlay');
const modalClose   = $('modalClose');
const modalWord    = $('modalWord');
const modalPhonetic= $('modalPhonetic');
const modalPos     = $('modalPos');
const modalCat     = $('modalCategory');
const modalFavBtn  = $('modalFavBtn');
const modalPlayBtn = $('modalPlayBtn');
const audioWave    = $('audioWave');
const modalFijianDef   = $('modalFijianDef');
const modalEnglishDef  = $('modalEnglishDef');
const modalExampleBlock= $('modalExampleBlock');
const modalExample     = $('modalExample');
const modalExampleTrans= $('modalExampleTranslation');
const modalPrev    = $('modalPrev');
const modalNext    = $('modalNext');
const modalRandom  = $('modalRandom');
const clearSearch  = $('clearSearch');

// ── Dark mode toggle ───────────────────────────
(function () {
  const t = document.querySelector('[data-theme-toggle]');
  const r = document.documentElement;
  let d = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  r.setAttribute('data-theme', d);
  updateThemeIcon(t, d);

  t && t.addEventListener('click', () => {
    d = d === 'dark' ? 'light' : 'dark';
    r.setAttribute('data-theme', d);
    updateThemeIcon(t, d);
  });

  function updateThemeIcon(btn, theme) {
    if (!btn) return;
    if (theme === 'dark') {
      btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>';
    } else {
      btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    }
    btn.setAttribute('aria-label', `Switch to ${d === 'dark' ? 'light' : 'dark'} mode`);
  }
})();

// ── Phonetic rule: apply to a Fijian string for display/speech ──────────
function toPhonetic(str) {
  // For display, the phonetic is pre-supplied in data.
  // For speech synthesis: map Fijian letters to approx English sounds
  return str
    .replace(/ngg/gi, 'ngg') // Q → ngg (pre-mapped in data)
    .replace(/ng(?=[^g])/gi, 'ng')
    .replace(/mb/gi, 'mb')
    .replace(/nd/gi, 'nd')
    .replace(/th/gi, 'th');
}

// For speech: convert Fijian word text to phonetic English spelling
function fijianToSpeech(phonetic) {
  // The phonetic field already has the correct pronunciation spelling
  return phonetic;
}

// ── Category filter pills ──────────────────────
function buildFilters() {
  filterScroll.innerHTML = '';
  CATEGORIES.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'filter-btn' + (cat.id === state.category ? ' active' : '');
    btn.textContent = cat.label;
    btn.dataset.cat = cat.id;
    btn.setAttribute('role', 'listitem');
    btn.setAttribute('aria-pressed', cat.id === state.category);
    btn.addEventListener('click', () => {
      state.category = cat.id;
      document.querySelectorAll('.filter-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.cat === cat.id);
        b.setAttribute('aria-pressed', b.dataset.cat === cat.id);
      });
      renderWords();
    });
    filterScroll.appendChild(btn);
  });
}

// ── Highlight search match ─────────────────────
function highlight(text, query) {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${escaped})`, 'gi');
  return text.replace(re, '<mark class="highlight">$1</mark>');
}

// ── Filter + sort logic ────────────────────────
function getFilteredWords() {
  let words = [...FIJIAN_WORDS];

  // Category
  if (state.category !== 'all') {
    words = words.filter(w => w.category === state.category);
  }

  // Search
  const q = state.query.trim().toLowerCase();
  if (q) {
    words = words.filter(w => {
      return (
        w.word.toLowerCase().includes(q) ||
        w.englishDef.toLowerCase().includes(q) ||
        w.fijianDef.toLowerCase().includes(q) ||
        (w.phonetic && w.phonetic.toLowerCase().includes(q)) ||
        (w.partOfSpeech && w.partOfSpeech.toLowerCase().includes(q)) ||
        (w.tags && w.tags.some(t => t.toLowerCase().includes(q)))
      );
    });
  }

  // Sort
  if (state.sort === 'alpha') {
    words.sort((a, b) => a.word.localeCompare(b.word));
  } else if (state.sort === 'category') {
    words.sort((a, b) => a.category.localeCompare(b.category) || a.word.localeCompare(b.word));
  } else if (state.sort === 'random') {
    for (let i = words.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [words[i], words[j]] = [words[j], words[i]];
    }
  }

  return words;
}

// ── Render word cards ──────────────────────────
function renderWords() {
  const words = getFilteredWords();
  state.filteredWords = words;

  // Update count
  const q = state.query.trim();
  if (q) {
    resultsCount.innerHTML = `<strong>${words.length}</strong> result${words.length !== 1 ? 's' : ''} for "<strong>${q}</strong>"`;
  } else {
    resultsCount.innerHTML = `<strong>${words.length}</strong> word${words.length !== 1 ? 's' : ''}`;
  }

  if (words.length === 0) {
    wordGrid.innerHTML = '';
    noResults.hidden = false;
    noResultsQ.textContent = state.query;
    return;
  }
  noResults.hidden = true;

  wordGrid.innerHTML = '';

  const fragment = document.createDocumentFragment();
  words.forEach((word, i) => {
    const card = createCard(word, i);
    fragment.appendChild(card);
  });
  wordGrid.appendChild(fragment);
}

function createCard(word, index) {
  const card = document.createElement('div');
  card.className = 'word-card';
  card.setAttribute('role', 'listitem');
  card.style.animationDelay = `${Math.min(index * 30, 300)}ms`;
  card.dataset.id = word.id;

  const isFav = state.favorites.has(word.id);
  const q = state.query.trim();

  const shortEng = word.englishDef.length > 90
    ? word.englishDef.slice(0, 90).trimEnd() + '…'
    : word.englishDef;

  card.innerHTML = `
    <div class="card-top">
      <h3 class="card-word">${highlight(word.word, q)}</h3>
      <button class="card-fav-btn ${isFav ? 'is-fav' : ''}" data-fav="${word.id}" aria-label="${isFav ? 'Remove from' : 'Add to'} favorites">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
        </svg>
      </button>
    </div>
    <p class="card-phonetic">${word.phonetic}</p>
    <p class="card-pos">${word.partOfSpeech}</p>
    <p class="card-translation">${highlight(shortEng, q)}</p>
    <span class="card-cat-pill">${word.category}</span>
  `;

  // Click to open modal
  card.addEventListener('click', e => {
    if (e.target.closest('.card-fav-btn')) return;
    openModal(word.id);
  });

  // Favorite button
  card.querySelector('.card-fav-btn').addEventListener('click', e => {
    e.stopPropagation();
    toggleFavorite(word.id);
  });

  return card;
}

// ── Modal ──────────────────────────────────────
function openModal(id) {
  const word = FIJIAN_WORDS.find(w => w.id === id);
  if (!word) return;

  state.currentWordId = id;
  stopSpeech();

  modalWord.textContent = word.word;
  modalPhonetic.textContent = word.phonetic;
  modalPos.textContent = word.partOfSpeech;
  modalCat.textContent = word.category;
  modalFijianDef.textContent = word.fijianDef;
  modalEnglishDef.textContent = word.englishDef;

  if (word.example) {
    modalExample.textContent = word.example;
    modalExampleTrans.textContent = word.exampleTranslation || '';
    modalExampleBlock.hidden = false;
  } else {
    modalExampleBlock.hidden = true;
  }

  // Favorite state
  updateModalFavBtn(id);

  // Show modal
  modalOverlay.hidden = false;
  document.body.style.overflow = 'hidden';
  setTimeout(() => modalClose.focus(), 50);
}

function closeModal() {
  stopSpeech();
  modalOverlay.hidden = true;
  document.body.style.overflow = '';
}

function updateModalFavBtn(id) {
  const isFav = state.favorites.has(id);
  modalFavBtn.classList.toggle('is-fav', isFav);
  modalFavBtn.setAttribute('aria-label', isFav ? 'Remove from favorites' : 'Add to favorites');
  const path = modalFavBtn.querySelector('path');
  if (path) {
    path.setAttribute('fill', isFav ? 'currentColor' : 'none');
    path.setAttribute('stroke', 'currentColor');
  }
}

// ── Speech / Audio ─────────────────────────────
function stopSpeech() {
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  audioWave.classList.remove('is-playing');
  modalPlayBtn.classList.remove('is-playing');
}

function speakWord(wordId) {
  const word = FIJIAN_WORDS.find(w => w.id === wordId);
  if (!word || !window.speechSynthesis) return;

  stopSpeech();

  // Build the phonetic for TTS — use the English phonetic spelling
  const phonetic = word.phonetic;
  const utterance = new SpeechSynthesisUtterance(phonetic);

  // Try to find an English voice for best phonetic accuracy
  const voices = window.speechSynthesis.getVoices();
  const englishVoice = voices.find(v => v.lang.startsWith('en') && !v.localService === false)
    || voices.find(v => v.lang.startsWith('en'))
    || null;

  if (englishVoice) utterance.voice = englishVoice;
  utterance.rate = 0.7;   // slower for clarity
  utterance.pitch = 1.0;
  utterance.volume = 1.0;

  utterance.onstart = () => {
    audioWave.classList.add('is-playing');
    modalPlayBtn.classList.add('is-playing');
  };
  utterance.onend = () => {
    audioWave.classList.remove('is-playing');
    modalPlayBtn.classList.remove('is-playing');
  };
  utterance.onerror = () => {
    audioWave.classList.remove('is-playing');
    modalPlayBtn.classList.remove('is-playing');
  };

  window.speechSynthesis.speak(utterance);
}

// ── Favorites ──────────────────────────────────
function toggleFavorite(id) {
  if (state.favorites.has(id)) {
    state.favorites.delete(id);
  } else {
    state.favorites.add(id);
  }
  saveFavorites();
  updateFavBadge();
  updateCardFavState(id);
  if (state.currentWordId === id) updateModalFavBtn(id);
  if (!favPanel.hidden) renderFavPanel();
}

function updateCardFavState(id) {
  const card = wordGrid.querySelector(`[data-id="${id}"]`);
  if (!card) return;
  const btn = card.querySelector('.card-fav-btn');
  if (!btn) return;
  const isFav = state.favorites.has(id);
  btn.classList.toggle('is-fav', isFav);
  btn.setAttribute('aria-label', `${isFav ? 'Remove from' : 'Add to'} favorites`);
  const svg = btn.querySelector('path');
  if (svg) svg.setAttribute('fill', isFav ? 'currentColor' : 'none');
}

function updateFavBadge() {
  const count = state.favorites.size;
  favBadge.textContent = count;
  favBadge.dataset.count = count;
}

function renderFavPanel() {
  favList.innerHTML = '';
  const favWords = FIJIAN_WORDS.filter(w => state.favorites.has(w.id));

  if (favWords.length === 0) {
    favEmpty.hidden = false;
    clearFavs.hidden = true;
    return;
  }
  favEmpty.hidden = true;
  clearFavs.hidden = false;

  favWords.sort((a, b) => a.word.localeCompare(b.word));

  favWords.forEach(word => {
    const item = document.createElement('div');
    item.className = 'fav-item';

    const shortEng = word.englishDef.length > 50
      ? word.englishDef.slice(0, 50).trimEnd() + '…'
      : word.englishDef;

    item.innerHTML = `
      <div>
        <div class="fav-item-word">${word.word}</div>
        <div class="fav-item-eng">${shortEng}</div>
      </div>
      <button class="fav-item-remove" data-remove="${word.id}" aria-label="Remove ${word.word} from favorites">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M18 6 6 18M6 6l12 12"/>
        </svg>
      </button>
    `;

    item.addEventListener('click', e => {
      if (e.target.closest('.fav-item-remove')) return;
      closeFavPanel();
      setTimeout(() => openModal(word.id), 150);
    });

    item.querySelector('.fav-item-remove').addEventListener('click', () => {
      toggleFavorite(word.id);
    });

    favList.appendChild(item);
  });
}

function openFavPanel() {
  renderFavPanel();
  favPanel.hidden = false;
  panelBackdrop.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeFavPanel() {
  favPanel.hidden = true;
  panelBackdrop.hidden = true;
  document.body.style.overflow = '';
}

// ── Persistence (in-memory only) ─────────────────
function saveFavorites() {
  // Favorites are kept in memory (state.favorites Set) for this session.
  // No persistent storage is used.
}

function loadFavorites() {
  // No persistent storage — favorites start fresh each session.
  state.favorites = new Set();
}

// ── Random word ────────────────────────────────
function pickRandom(excludeId) {
  const pool = FIJIAN_WORDS.filter(w => w.id !== excludeId);
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Modal navigation ───────────────────────────
function modalNavigate(direction) {
  const currentIndex = state.filteredWords.findIndex(w => w.id === state.currentWordId);
  if (currentIndex === -1) return;

  let nextIndex;
  if (direction === 'prev') {
    nextIndex = (currentIndex - 1 + state.filteredWords.length) % state.filteredWords.length;
  } else {
    nextIndex = (currentIndex + 1) % state.filteredWords.length;
  }
  openModal(state.filteredWords[nextIndex].id);
}

// ── Event bindings ─────────────────────────────

// Search
searchInput.addEventListener('input', () => {
  state.query = searchInput.value;
  searchClear.hidden = !state.query;
  renderWords();
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  state.query = '';
  searchClear.hidden = true;
  searchInput.focus();
  renderWords();
});

clearSearch && clearSearch.addEventListener('click', () => {
  searchInput.value = '';
  state.query = '';
  searchClear.hidden = true;
  renderWords();
});

// Sort
sortSelect.addEventListener('change', () => {
  state.sort = sortSelect.value;
  renderWords();
});

// Random
randomBtn.addEventListener('click', () => {
  const word = pickRandom(state.currentWordId);
  openModal(word.id);
});

// Favorites toggle
favoritesToggle.addEventListener('click', () => {
  if (favPanel.hidden) openFavPanel();
  else closeFavPanel();
});
favPanelClose.addEventListener('click', closeFavPanel);
panelBackdrop.addEventListener('click', closeFavPanel);
clearFavs.addEventListener('click', () => {
  state.favorites.clear();
  saveFavorites();
  updateFavBadge();
  renderFavPanel();
  renderWords();
});

// Modal
modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => {
  if (e.target === modalOverlay) closeModal();
});
modalFavBtn.addEventListener('click', () => {
  if (state.currentWordId) toggleFavorite(state.currentWordId);
});
modalPlayBtn.addEventListener('click', () => {
  if (state.currentWordId) speakWord(state.currentWordId);
});
modalPrev.addEventListener('click', () => modalNavigate('prev'));
modalNext.addEventListener('click', () => modalNavigate('next'));
modalRandom.addEventListener('click', () => {
  const word = pickRandom(state.currentWordId);
  openModal(word.id);
});

// Keyboard
document.addEventListener('keydown', e => {
  if (!modalOverlay.hidden) {
    if (e.key === 'Escape') closeModal();
    if (e.key === 'ArrowLeft') modalNavigate('prev');
    if (e.key === 'ArrowRight') modalNavigate('next');
  }
  if (!favPanel.hidden && e.key === 'Escape') closeFavPanel();
});

// ── Voices: load on demand ─────────────────────
if (window.speechSynthesis) {
  window.speechSynthesis.getVoices(); // trigger load
  window.speechSynthesis.addEventListener('voiceschanged', () => {
    window.speechSynthesis.getVoices(); // refresh
  });
}

// ── Word of the Day ────────────────────────────
function getWordOfTheDay() {
  // Deterministic: pick a word based on the calendar day of year
  // Same word all day, changes at midnight. No storage needed.
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now - start;
  const oneDay = 1000 * 60 * 60 * 24;
  const dayOfYear = Math.floor(diff / oneDay); // 1–365
  const index = dayOfYear % FIJIAN_WORDS.length;
  return FIJIAN_WORDS[index];
}

function initWordOfTheDay() {
  const word = getWordOfTheDay();

  // Date label
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
  $('wotdDate').textContent = dateStr;

  // Word content
  $('wotdWord').textContent = word.word;
  $('wotdPhonetic').textContent = word.phonetic;
  $('wotdPos').textContent = word.partOfSpeech;

  // Truncate translation to 120 chars for banner
  const shortTrans = word.englishDef.length > 120
    ? word.englishDef.slice(0, 120).trimEnd() + '\u2026'
    : word.englishDef;
  $('wotdTranslation').textContent = shortTrans;

  // Example sentence (if present)
  const exampleEl = $('wotdExample');
  if (word.example) {
    exampleEl.textContent = `"${word.example}" — ${word.exampleTranslation || ''}`;
    exampleEl.hidden = false;
  } else {
    exampleEl.hidden = true;
  }

  // Listen button
  $('wotdPlayBtn').addEventListener('click', () => {
    speakWotd(word);
  });

  // Full entry button
  $('wotdOpenBtn').addEventListener('click', () => {
    openModal(word.id);
  });
}

function speakWotd(word) {
  const btn = $('wotdPlayBtn');
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  const utterance = new SpeechSynthesisUtterance(word.phonetic);
  const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  const englishVoice = voices.find(v => v.lang.startsWith('en')) || null;
  if (englishVoice) utterance.voice = englishVoice;
  utterance.rate = 0.7;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;
  utterance.onstart = () => btn.classList.add('is-playing');
  utterance.onend = () => btn.classList.remove('is-playing');
  utterance.onerror = () => btn.classList.remove('is-playing');
  if (window.speechSynthesis) window.speechSynthesis.speak(utterance);
}

// ── Init ───────────────────────────────────────
function init() {
  loadFavorites();
  buildFilters();
  renderWords();
  initWordOfTheDay();
}

init();
