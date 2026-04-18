// ═══════════════════════════════════════════════════════════════════
// Lingua Franca — Phone-side Interactive Dashboard
// Vanilla TS — runs inside Even Hub webview
// Tab switching, language picker, compose, library, quiz, settings
// ═══════════════════════════════════════════════════════════════════

import {
  LANG_CODES, LANG_LABEL, LANG_FLAG, LANG_NATIVE, I_SPEAK_CODES,
  PHRASE_KEYS, VOCAB, CULTURE,
  TR, TR_ROM, needsRom, langPhrase, langRom, langPhon,
  TOTAL_LANGUAGES, TOTAL_SCENARIOS,
  type LangCode, type PhraseKey, type VocabCategory, type VocabItem,
} from './constants';
import {
  SCENARIO_GROUPS, fillSlots, fillSlotsRom, fillSlotsPhon, fillSlotsEnglish,
} from './pages';
import {
  getSavedPhrases, savePhrase, deletePhrase,
  getCustomWords, addCustomWord, removeCustomWord, getCustomWordsForLang,
  getQuizStats, getQuizHistory, recordQuizResult, recordQuizSession,
  getActiveLang, setActiveLang, getSettings, saveSettings,
  type SavedPhrase, type QuizStats,
} from './sync';
import { startGlassesQuiz, pushPhraseToGlasses, setSpeakLang, setLearnLang, refreshGlassesForLanguageChange, startSpeakSelect, startDialogueHUD, updateDialogueHUD, endSpeakMode } from './events';
import { initCustomPhraseBuilder, setCustomLang, setCustomSpeakLang, setCustomPushFn, renderGlassesPreview, retranslateSavedPhrase } from './custom-phrase';
import { setOpenAIKey, hasOpenAIKey, generateScenarioPhrases, cycleAISlot, type AIPhrase } from './ai-phrases';
import { log } from './ui';

// ═══════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════

let activeTab = 'home';
let activeLang: LangCode = 'ja';  // default target language

// Compose state
let composePhrases: { key: PhraseKey; en: string; native: string; rom: string; phon: string }[] = [];
let aiPhrases: AIPhrase[] = [];
let composeMode: 'template' | 'ai' = 'template';

// Speak state
let speakActive = false;
let speakTargetLangCode: LangCode | null = null;

// Quiz phone state
let phoneQuizActive = false;
let phoneQuizQuestions: { en: string; options: string[]; correctIdx: number }[] = [];
let phoneQuizIdx = 0;
let phoneQuizScore = 0;

// ═══════════════════════════════════════════════════════════════════
// INIT — tab switching + event delegation
// ═══════════════════════════════════════════════════════════════════

export function initDashboard(): void {
  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = (tab as HTMLElement).dataset.tab;
      if (!target) return;
      switchTab(target);
    });
  });

  // Language picker — "I speak" (input language) with native script names
  const inputSelect = document.getElementById('input-lang-select') as HTMLSelectElement;
  if (inputSelect) {
    inputSelect.innerHTML = '';
    I_SPEAK_CODES.forEach(code => {
      const opt = document.createElement('option');
      opt.value = code;
      const flag = LANG_FLAG[code] || '';
      const native = LANG_NATIVE[code] || LANG_LABEL[code] || code;
      const label = LANG_LABEL[code] || code;
      // Show native name + English label for clarity (e.g. "🇯🇵 日本語 — Japanese")
      opt.textContent = native === label ? `${flag} ${native}` : `${flag} ${native} — ${label}`;
      if (code === 'en') opt.selected = true;
      inputSelect.appendChild(opt);
    });
    inputSelect.addEventListener('change', async () => {
      setSpeakLang(inputSelect.value);
      setCustomSpeakLang(inputSelect.value);  // update custom phrase builder speak lang
      setCustomLang(activeLang);  // refresh custom phrase builder
      refreshHome();  // re-render quick scenarios with new speak language
      refreshLibrary();  // re-translate saved phrases for new speak language
      // Push update to glasses so they reflect the new "I speak" language
      await refreshGlassesForLanguageChange(activeLang, 'https://d3hospitality.github.io/lingua-franca/');
      log(`I speak: ${LANG_NATIVE[inputSelect.value] || inputSelect.value}`);
    });
  }

  // Language picker — "Learning" (output language)
  const outputSelect = document.getElementById('output-lang-select') as HTMLSelectElement;
  if (outputSelect) {
    LANG_CODES.forEach(code => {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = `${LANG_FLAG[code]} ${LANG_LABEL[code]}`;
      if (code === activeLang) opt.selected = true;
      outputSelect.appendChild(opt);
    });
    outputSelect.addEventListener('change', async () => {
      activeLang = outputSelect.value as LangCode;
      setActiveLang(activeLang);
      setLearnLang(activeLang);  // sync glasses state
      setCustomLang(activeLang);
      refreshHome();
      refreshLibrary();  // re-translate saved phrases for new language
      // Push update to glasses so they reflect the new learning language
      await refreshGlassesForLanguageChange(activeLang, 'https://d3hospitality.github.io/lingua-franca/');
      log(`Language → ${LANG_LABEL[activeLang]}`);
    });
  }

  // Compose generate button (template-based)
  const genBtn = document.getElementById('compose-generate');
  if (genBtn) genBtn.addEventListener('click', handleComposeGenerate);

  // Compose AI generate button
  const aiGenBtn = document.getElementById('compose-ai-generate');
  if (aiGenBtn) aiGenBtn.addEventListener('click', handleAIGenerate);

  // Compose push button
  const pushBtn = document.getElementById('compose-push');
  if (pushBtn) pushBtn.addEventListener('click', handleComposePush);

  // Speak tab — populate language picker and wire buttons
  initSpeakTab();

  // Quiz start button
  const quizBtn = document.getElementById('quiz-start');
  if (quizBtn) quizBtn.addEventListener('click', handleQuizStart);

  // Custom phrase builder
  initCustomPhraseBuilder(activeLang);

  // Global event delegation
  document.addEventListener('click', handleGlobalClick);
}

function switchTab(tab: string): void {
  activeTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`.tab[data-tab="${tab}"]`)?.classList.add('active');
  document.getElementById(`tab-${tab}`)?.classList.add('active');

  // Refresh tab content
  if (tab === 'home') refreshHome();
  else if (tab === 'speak') refreshSpeak();
  else if (tab === 'custom') renderGlassesPreview();
  else if (tab === 'library') refreshLibrary();
  else if (tab === 'quiz') refreshQuiz();
}

// ═══════════════════════════════════════════════════════════════════
// HOME TAB
// ═══════════════════════════════════════════════════════════════════

async function refreshHome(): Promise<void> {
  // Update stats
  const saved = await getSavedPhrases();
  const quizStats = await getQuizStats();

  const savedEl = document.getElementById('home-saved');
  if (savedEl) savedEl.textContent = String(saved.length);

  const masteryEl = document.getElementById('home-mastery');
  if (masteryEl) {
    const pct = quizStats.totalAnswered > 0
      ? Math.round((quizStats.totalCorrect / quizStats.totalAnswered) * 100)
      : 0;
    masteryEl.textContent = quizStats.totalAnswered > 0 ? `${pct}%` : '—';
  }

  // Quick scenarios
  renderQuickScenarios();
}

// ═══════════════════════════════════════════════════════════════════
// SPEAK TAB — Live Conversation Mode
// ═══════════════════════════════════════════════════════════════════

function initSpeakTab(): void {
  // Populate language picker
  const langSelect = document.getElementById('speak-lang-select') as HTMLSelectElement;
  if (langSelect) {
    langSelect.innerHTML = '';
    LANG_CODES.forEach(code => {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = `${LANG_FLAG[code]} ${LANG_LABEL[code]}`;
      langSelect.appendChild(opt);
    });
  }

  // Start button
  const startBtn = document.getElementById('speak-start-btn');
  if (startBtn) startBtn.addEventListener('click', handleSpeakStart);

  // Stop button
  const stopBtn = document.getElementById('speak-stop-btn');
  if (stopBtn) stopBtn.addEventListener('click', handleSpeakStop);
}

function refreshSpeak(): void {
  // If speak is active, make sure HUD is visible
  const selectCard = document.getElementById('speak-select-card');
  const hud = document.getElementById('speak-hud');
  if (selectCard) selectCard.style.display = speakActive ? 'none' : '';
  if (hud) hud.style.display = speakActive ? '' : 'none';
}

async function handleSpeakStart(): Promise<void> {
  const langSelect = document.getElementById('speak-lang-select') as HTMLSelectElement;
  if (!langSelect) return;

  speakTargetLangCode = langSelect.value as LangCode;
  speakActive = true;

  // Update phone UI
  const selectCard = document.getElementById('speak-select-card');
  const hud = document.getElementById('speak-hud');
  if (selectCard) selectCard.style.display = 'none';
  if (hud) hud.style.display = '';

  // Set language labels
  const theirFlag = document.getElementById('speak-their-flag');
  const theirLang = document.getElementById('speak-their-lang');
  if (theirFlag) theirFlag.textContent = LANG_FLAG[speakTargetLangCode] || '';
  if (theirLang) theirLang.textContent = LANG_LABEL[speakTargetLangCode] || speakTargetLangCode;

  // Set user language
  const inputSelect = document.getElementById('input-lang-select') as HTMLSelectElement;
  const userLangCode = (inputSelect?.value || 'en') as LangCode;
  const yourFlag = document.getElementById('speak-your-flag');
  const yourLang = document.getElementById('speak-your-lang');
  if (yourFlag) yourFlag.textContent = LANG_FLAG[userLangCode] || '🇬🇧';
  if (yourLang) yourLang.textContent = LANG_LABEL[userLangCode] || 'English';

  // Initial TTS display
  const ttsEl = document.getElementById('speak-tts-text');
  if (ttsEl) ttsEl.textContent = 'Listening...';

  // Initial suggestions
  const sugEl = document.getElementById('speak-suggestions');
  if (sugEl) sugEl.innerHTML = '<div class="speak-option muted">Waiting for speech...</div>';

  // Push to glasses: dialogue HUD
  await startDialogueHUD(speakTargetLangCode);
  log(`🗣 Speak: ${LANG_LABEL[speakTargetLangCode]} — conversation started`);
}

async function handleSpeakStop(): Promise<void> {
  speakActive = false;
  speakTargetLangCode = null;

  // Reset phone UI
  const selectCard = document.getElementById('speak-select-card');
  const hud = document.getElementById('speak-hud');
  if (selectCard) selectCard.style.display = '';
  if (hud) hud.style.display = 'none';

  // Return glasses to home
  await endSpeakMode();
  log('🗣 Speak: conversation ended');
}

/**
 * Called externally (or by future mic/TTS pipeline) to update the HUD
 * with new translated text and AI-generated response suggestions.
 */
export async function updateSpeakHUD(translation: string, suggestions: string[]): Promise<void> {
  // Update phone UI
  const ttsEl = document.getElementById('speak-tts-text');
  if (ttsEl) ttsEl.textContent = translation;

  const sugEl = document.getElementById('speak-suggestions');
  if (sugEl) {
    sugEl.innerHTML = suggestions.map((s, i) =>
      `<div class="speak-option" data-speak-idx="${i}">${s}</div>`
    ).join('');
  }

  // Update glasses HUD
  await updateDialogueHUD(translation, suggestions);
}

function renderQuickScenarios(): void {
  const container = document.getElementById('home-quick-scenarios');
  if (!container) return;

  // Show 4 random scenarios from different groups
  const shuffled = [...SCENARIO_GROUPS].sort(() => Math.random() - 0.5);
  const picks: { group: string; key: PhraseKey; en: string; native: string; rom: string; phon: string }[] = [];
  for (const g of shuffled) {
    if (picks.length >= 4) break;
    const key = g.keys[Math.floor(Math.random() * g.keys.length)];
    const nativeTemplate = langPhrase(activeLang, key);
    const romTemplate = langRom(activeLang, key);
    const phonTemplate = langPhon(activeLang, key);
    picks.push({
      group: g.label,
      key,
      en: fillSlotsEnglish(key, activeLang),
      native: fillSlots(nativeTemplate, activeLang),
      rom: needsRom(activeLang) ? fillSlotsRom(romTemplate, activeLang) : "",
      phon: phonTemplate ? fillSlotsPhon(phonTemplate, activeLang) : "",
    });
  }

  container.innerHTML = picks.map(p => `
    <div class="phrase-item" data-action="quick-scenario" data-key="${p.key}">
      <div>
        <div class="phrase-en">${escHtml(p.en)}</div>
        <div class="phrase-tr" style="font-size:0.75rem">${escHtml(p.native)}</div>
        ${p.rom ? `<div class="phrase-rom" style="font-size:0.65rem">${escHtml(p.rom)}</div>` : ''}
        ${p.phon ? `<div style="font-size:0.6rem;color:var(--gold);opacity:0.85">🔊 ${escHtml(p.phon)}</div>` : ''}
        <div class="phrase-rom" style="font-size:0.6rem;opacity:0.6">${escHtml(p.group)}</div>
      </div>
      <button class="btn-outline-sm" data-action="push-quick" data-key="${p.key}">→ G2</button>
    </div>
  `).join('');
}

// ═══════════════════════════════════════════════════════════════════
// COMPOSE TAB
// ═══════════════════════════════════════════════════════════════════

function handleComposeGenerate(): void {
  composePhrases = [];
  composeMode = 'template';

  // Pick 5 diverse phrases
  const allKeys = [...PHRASE_KEYS].sort(() => Math.random() - 0.5).slice(0, 5);

  for (const key of allKeys) {
    const nativeTemplate = langPhrase(activeLang, key);
    const romTemplate = langRom(activeLang, key);

    const en = fillSlotsEnglish(key, activeLang);
    const native = fillSlots(nativeTemplate, activeLang);
    const rom = needsRom(activeLang) ? fillSlotsRom(romTemplate, activeLang) : "";
    const phonTemplate = langPhon(activeLang, key);
    const phon = phonTemplate ? fillSlotsPhon(phonTemplate, activeLang) : "";

    composePhrases.push({ key, en, native, rom, phon });
  }

  renderComposePhrases();

  const pushBtn = document.getElementById('compose-push') as HTMLButtonElement;
  if (pushBtn) pushBtn.disabled = false;

  log(`Generated ${composePhrases.length} phrases for ${LANG_LABEL[activeLang]}`);
}

function renderComposePhrases(): void {
  const container = document.getElementById('compose-phrases');
  if (!container) return;

  const badge = document.getElementById('phrase-mode-badge');
  if (badge) badge.textContent = 'Template';

  if (composePhrases.length === 0) {
    container.innerHTML = '<span class="muted">Generate a scenario to see phrases</span>';
    return;
  }

  container.innerHTML = composePhrases.map((p, i) => `
    <div class="phrase-item">
      <div style="flex:1">
        <div class="phrase-en">${escHtml(p.en)}</div>
        <div class="phrase-tr">${escHtml(p.native)}</div>
        ${p.rom ? `<div class="phrase-rom">${escHtml(p.rom)}</div>` : ''}
        ${p.phon ? `<div class="phrase-phon" style="font-size:0.65rem;color:var(--gold);opacity:0.85">🔊 ${escHtml(p.phon)}</div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:4px">
        <button class="btn-outline-sm" data-action="save-phrase" data-idx="${i}">Save</button>
        <button class="btn-outline-sm" data-action="push-phrase" data-idx="${i}">→ G2</button>
      </div>
    </div>
  `).join('');
}

async function handleComposePush(): Promise<void> {
  if (composeMode === 'ai' && aiPhrases.length > 0) {
    const p = aiPhrases[0];
    await pushPhraseToGlasses(activeLang, 'ai_phrase' as PhraseKey, p.enPlain, p.nativePlain, p.romPlain);
  } else if (composePhrases.length > 0) {
    const p = composePhrases[0];
    await pushPhraseToGlasses(activeLang, p.key, p.en, p.native, p.rom);
  } else {
    return;
  }

  const statusEl = document.getElementById('push-status');
  if (statusEl) statusEl.textContent = 'Sent to glasses!';
  setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
}

// ═══════════════════════════════════════════════════════════════════
// AI PHRASE GENERATION
// ═══════════════════════════════════════════════════════════════════

async function handleAIGenerate(): Promise<void> {
  if (!hasOpenAIKey()) {
    log('Set your OpenAI API key in Settings first', 'error');
    return;
  }

  const promptEl = document.getElementById('compose-prompt') as HTMLTextAreaElement;
  const scenario = promptEl?.value.trim();
  if (!scenario) {
    log('Enter a scenario description first', 'error');
    return;
  }

  const toneEl = document.getElementById('compose-tone') as HTMLSelectElement;
  const tone = toneEl?.value || 'auto';
  const fullScenario = tone !== 'auto' ? `${scenario} (tone: ${tone})` : scenario;

  // Show loading state
  const container = document.getElementById('compose-phrases');
  if (container) container.innerHTML = '<span class="muted">✦ Generating AI phrases...</span>';

  const aiBtn = document.getElementById('compose-ai-generate') as HTMLButtonElement;
  if (aiBtn) { aiBtn.disabled = true; aiBtn.textContent = 'Generating...'; }

  try {
    aiPhrases = await generateScenarioPhrases(fullScenario, activeLang);
    composeMode = 'ai';
    renderAIPhrases();

    const pushBtn = document.getElementById('compose-push') as HTMLButtonElement;
    if (pushBtn) pushBtn.disabled = aiPhrases.length === 0;

    updateAIBadge();
  } finally {
    if (aiBtn) { aiBtn.disabled = false; aiBtn.textContent = 'AI Generate ✦'; }
  }
}

function renderAIPhrases(): void {
  const container = document.getElementById('compose-phrases');
  if (!container) return;

  if (aiPhrases.length === 0) {
    container.innerHTML = '<span class="muted">No AI phrases generated</span>';
    return;
  }

  const badge = document.getElementById('phrase-mode-badge');
  if (badge) badge.textContent = '✦ AI-generated';

  container.innerHTML = aiPhrases.map((p, i) => {
    // Highlight [KEYWORD] brackets with gold styling
    const enHighlighted = escHtml(p.en).replace(
      /\[([^\]]+)\]/g,
      '<span style="color:var(--gold);font-weight:600">[$1]</span>'
    );
    const nativeHighlighted = escHtml(p.native).replace(
      /\[([^\]]+)\]/g,
      '<span style="color:var(--gold);font-weight:600">[$1]</span>'
    );
    const romHighlighted = p.rom ? escHtml(p.rom).replace(
      /\[([^\]]+)\]/g,
      '<span style="color:var(--gold);font-weight:600">[$1]</span>'
    ) : '';

    const slotBtns = p.slots.map((slot, si) =>
      `<button class="btn-outline-sm" data-action="cycle-ai-slot" data-phrase="${i}" data-slot="${si}" style="font-size:0.6rem;padding:2px 6px" title="Cycle: ${escAttr(slot.enWord)}">${escHtml(slot.enWord)} ↻</button>`
    ).join(' ');

    return `
      <div class="phrase-item" style="flex-direction:column;align-items:stretch;gap:6px">
        <div>
          <div class="phrase-en">${enHighlighted}</div>
          <div class="phrase-tr">${nativeHighlighted}</div>
          ${romHighlighted ? `<div class="phrase-rom">${romHighlighted}</div>` : ''}
        </div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center">
          ${slotBtns}
          <span style="flex:1"></span>
          <button class="btn-outline-sm" data-action="save-ai-phrase" data-idx="${i}">Save</button>
          <button class="btn-outline-sm" data-action="push-ai-phrase" data-idx="${i}">→ G2</button>
        </div>
      </div>
    `;
  }).join('');
}

function updateAIBadge(): void {
  const badge = document.getElementById('ai-badge');
  if (!badge) return;
  if (hasOpenAIKey()) {
    badge.textContent = '✦ AI Ready';
    badge.style.color = 'var(--gold)';
  } else {
    badge.textContent = 'No API key';
    badge.style.color = '';
  }
}

// ═══════════════════════════════════════════════════════════════════
// LIBRARY TAB
// ═══════════════════════════════════════════════════════════════════

async function refreshLibrary(): Promise<void> {
  const phrases = await getSavedPhrases();
  const container = document.getElementById('library-content');
  if (!container) return;

  // Get current speak lang from the dropdown
  const inputSelect = document.getElementById('input-lang-select') as HTMLSelectElement;
  const currentSpeakLang = inputSelect?.value || 'en';

  if (phrases.length === 0) {
    container.innerHTML = '<span class="muted">No saved phrases yet</span>';
  } else {
    container.innerHTML = phrases.map(p => {
      // Dynamically re-translate template phrases for the current language selection
      const retranslated = retranslateSavedPhrase(p.key, activeLang, currentSpeakLang);
      const displayEn = retranslated ? retranslated.en : p.en;
      const displayNative = retranslated ? retranslated.native : p.native;
      const displayRom = retranslated ? retranslated.rom : p.rom;
      const displayLang = retranslated ? activeLang : p.lang;

      return `
      <div class="phrase-item">
        <div style="flex:1">
          <div class="phrase-en">${escHtml(displayEn)}</div>
          <div class="phrase-tr">${escHtml(displayNative)}</div>
          ${displayRom ? `<div class="phrase-rom">${escHtml(displayRom)}</div>` : ''}
          <div class="muted" style="font-size:0.6rem;margin-top:2px">${LANG_FLAG[displayLang]} ${LANG_LABEL[displayLang]}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px">
          <button class="btn-outline-sm" data-action="push-saved" data-id="${p.id}" data-retranslate="${retranslated ? '1' : ''}">→ G2</button>
          <button class="btn-outline-sm" data-action="delete-phrase" data-id="${p.id}">✕</button>
        </div>
      </div>
    `}).join('');
  }

  // Custom words section
  await refreshCustomWords();
}

async function refreshCustomWords(): Promise<void> {
  const container = document.getElementById('custom-words-content');
  if (!container) return;

  const words = await getCustomWordsForLang(activeLang);
  const entries = Object.entries(words).filter(([_, items]) => items.length > 0);

  if (entries.length === 0) {
    container.innerHTML = '<span class="muted">Add custom words from phrase slots</span>';
    return;
  }

  container.innerHTML = entries.map(([cat, items]) => `
    <div style="margin-bottom:8px">
      <div class="section-label">${cat}</div>
      ${items.map(item => `
        <div class="setting-row">
          <span>${escHtml(item.en)} → ${escHtml(item.tr)}${item.rom ? ` (${escHtml(item.rom)})` : ''}</span>
          <button class="btn-outline-sm" data-action="remove-word" data-lang="${activeLang}" data-cat="${cat}" data-en="${escAttr(item.en)}">✕</button>
        </div>
      `).join('')}
    </div>
  `).join('');
}

// ═══════════════════════════════════════════════════════════════════
// QUIZ TAB — phone-side quiz
// ═══════════════════════════════════════════════════════════════════

async function refreshQuiz(): Promise<void> {
  const stats = await getQuizStats();
  const history = await getQuizHistory();

  const totalEl = document.getElementById('quiz-total');
  if (totalEl) totalEl.textContent = String(history.length);

  const avgEl = document.getElementById('quiz-avg');
  if (avgEl) {
    if (history.length > 0) {
      const avg = Math.round(history.reduce((s, h) => s + h.pct, 0) / history.length);
      avgEl.textContent = `${avg}%`;
    } else {
      avgEl.textContent = '—';
    }
  }

  if (!phoneQuizActive) {
    const content = document.getElementById('quiz-content');
    if (content) {
      content.innerHTML = `
        <button id="quiz-start" class="btn-primary" data-action="start-quiz">Start Quiz</button>
        <span class="muted">Quiz yourself on ${LANG_FLAG[activeLang]} ${LANG_LABEL[activeLang]} vocab</span>
        <div style="margin-top:8px">
          <button class="btn-secondary" data-action="quiz-glasses">Quiz on Glasses →</button>
        </div>
      `;
    }
  }
}

function handleQuizStart(): void {
  const vocab = VOCAB[activeLang];
  if (!vocab) return;

  phoneQuizActive = true;
  phoneQuizIdx = 0;
  phoneQuizScore = 0;
  phoneQuizQuestions = [];

  const categories: VocabCategory[] = ["DRINKS", "FOOD", "GREETING", "COMPLIMENT", "PLACE"];
  const shuffle = <T>(a: T[]): T[] => [...a].sort(() => Math.random() - 0.5);

  for (let i = 0; i < 5; i++) {
    const cat = categories[i % categories.length];
    const items = vocab[cat];
    if (!items || items.length < 2) continue;
    const shuffled = shuffle(items);
    const correct = shuffled[0];
    const wrongs = shuffled.slice(1, 4);
    const options = shuffle([correct, ...wrongs]).map(item => item.tr);
    phoneQuizQuestions.push({
      en: correct.en,
      options,
      correctIdx: options.indexOf(correct.tr),
    });
  }

  renderPhoneQuizQuestion();
}

function renderPhoneQuizQuestion(): void {
  const content = document.getElementById('quiz-content');
  if (!content || phoneQuizIdx >= phoneQuizQuestions.length) return;

  const q = phoneQuizQuestions[phoneQuizIdx];
  content.innerHTML = `
    <div style="margin-bottom:12px">
      <div class="section-label">Question ${phoneQuizIdx + 1}/${phoneQuizQuestions.length}</div>
      <div style="font-size:1rem;margin-bottom:12px">What is "<strong>${escHtml(q.en)}</strong>" in ${LANG_LABEL[activeLang]}?</div>
      ${q.options.map((opt, i) => `
        <button class="quiz-option" data-action="quiz-answer" data-idx="${i}">${escHtml(opt)}</button>
      `).join('')}
    </div>
  `;
}

async function handleQuizAnswer(idx: number): Promise<void> {
  if (phoneQuizIdx >= phoneQuizQuestions.length) return;
  const q = phoneQuizQuestions[phoneQuizIdx];
  const correct = idx === q.correctIdx;
  if (correct) phoneQuizScore++;

  await recordQuizResult(activeLang, correct);

  // Highlight correct/wrong
  const buttons = document.querySelectorAll('.quiz-option');
  buttons.forEach((btn, i) => {
    (btn as HTMLButtonElement).disabled = true;
    if (i === q.correctIdx) btn.classList.add('correct');
    if (i === idx && !correct) btn.classList.add('wrong');
  });

  // Auto-advance after 1.2s
  setTimeout(() => {
    phoneQuizIdx++;
    if (phoneQuizIdx < phoneQuizQuestions.length) {
      renderPhoneQuizQuestion();
    } else {
      renderPhoneQuizScore();
    }
  }, 1200);
}

async function renderPhoneQuizScore(): Promise<void> {
  phoneQuizActive = false;
  const pct = Math.round((phoneQuizScore / phoneQuizQuestions.length) * 100);

  await recordQuizSession(activeLang, phoneQuizScore, phoneQuizQuestions.length);

  const content = document.getElementById('quiz-content');
  if (content) {
    content.innerHTML = `
      <div style="text-align:center;padding:16px 0">
        <div class="stat-value" style="font-size:2rem">${pct}%</div>
        <div class="muted" style="margin:8px 0">${phoneQuizScore}/${phoneQuizQuestions.length} correct — ${LANG_LABEL[activeLang]}</div>
        <button class="btn-primary" data-action="start-quiz" style="margin-top:12px">Play Again</button>
      </div>
    `;
  }

  await refreshQuiz();
}

// ═══════════════════════════════════════════════════════════════════
// GLOBAL EVENT DELEGATION
// ═══════════════════════════════════════════════════════════════════

async function handleGlobalClick(e: Event): Promise<void> {
  const target = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
  if (!target) return;

  const action = target.dataset.action;

  // Save compose phrase
  if (action === 'save-phrase') {
    const idx = Number(target.dataset.idx);
    const p = composePhrases[idx];
    if (!p) return;
    await savePhrase({ lang: activeLang, key: p.key, en: p.en, native: p.native, rom: p.rom });
    log(`Saved: ${p.key}`);
    target.textContent = '✓';
    target.setAttribute('disabled', 'true');
  }

  // Push compose phrase to glasses
  if (action === 'push-phrase') {
    const idx = Number(target.dataset.idx);
    const p = composePhrases[idx];
    if (!p) return;
    await pushPhraseToGlasses(activeLang, p.key, p.en, p.native, p.rom);
    log(`Pushed: ${p.key} → glasses`);
  }

  // Push quick scenario to glasses
  if (action === 'push-quick') {
    const key = target.dataset.key as PhraseKey;
    if (!key) return;
    const nativeTemplate = langPhrase(activeLang, key);
    const romTemplate = langRom(activeLang, key);
    const en = fillSlotsEnglish(key, activeLang);
    const native = fillSlots(nativeTemplate, activeLang);
    const rom = needsRom(activeLang) ? fillSlotsRom(romTemplate, activeLang) : "";
    await pushPhraseToGlasses(activeLang, key, en, native, rom);
  }

  // Push saved phrase to glasses (re-translate if template-based)
  if (action === 'push-saved') {
    const id = target.dataset.id;
    if (!id) return;
    const phrases = await getSavedPhrases();
    const p = phrases.find(ph => ph.id === id);
    if (!p) return;
    const inputSelect = document.getElementById('input-lang-select') as HTMLSelectElement;
    const currentSpeakLang = inputSelect?.value || 'en';
    const retranslated = retranslateSavedPhrase(p.key, activeLang, currentSpeakLang);
    if (retranslated) {
      await pushPhraseToGlasses(activeLang, p.key, retranslated.en, retranslated.native, retranslated.rom);
    } else {
      await pushPhraseToGlasses(p.lang, p.key, p.en, p.native, p.rom);
    }
  }

  // Delete saved phrase
  if (action === 'delete-phrase') {
    const id = target.dataset.id;
    if (!id) return;
    await deletePhrase(id);
    await refreshLibrary();
    log("Phrase deleted");
  }

  // Remove custom word
  if (action === 'remove-word') {
    const lang = target.dataset.lang as LangCode;
    const cat = target.dataset.cat as VocabCategory;
    const en = target.dataset.en;
    if (lang && cat && en) {
      await removeCustomWord(lang, cat, en);
      await refreshCustomWords();
      log(`Removed: ${en}`);
    }
  }

  // Quiz answer
  if (action === 'quiz-answer') {
    const idx = Number(target.dataset.idx);
    await handleQuizAnswer(idx);
  }

  // Start quiz (phone)
  if (action === 'start-quiz') {
    handleQuizStart();
  }

  // Quiz on glasses
  if (action === 'quiz-glasses') {
    await startGlassesQuiz(activeLang);
    log(`Quiz pushed to glasses: ${LANG_LABEL[activeLang]}`);
  }

  // Quick scenario click (expand detail)
  if (action === 'quick-scenario') {
    const key = target.dataset.key as PhraseKey;
    if (!key) return;
    // Switch to compose and generate for this key
    switchTab('compose');
    handleComposeGenerate();
  }

  // AI slot cycling
  if (action === 'cycle-ai-slot') {
    const phraseIdx = Number(target.dataset.phrase);
    const slotIdx = Number(target.dataset.slot);
    if (phraseIdx >= 0 && phraseIdx < aiPhrases.length) {
      aiPhrases[phraseIdx] = cycleAISlot(aiPhrases[phraseIdx], slotIdx);
      renderAIPhrases();
      log(`Cycled slot → ${aiPhrases[phraseIdx].slots[slotIdx]?.enWord}`);
    }
  }

  // Save AI phrase
  if (action === 'save-ai-phrase') {
    const idx = Number(target.dataset.idx);
    const p = aiPhrases[idx];
    if (!p) return;
    await savePhrase({
      lang: activeLang,
      key: `ai_${Date.now()}` as PhraseKey,
      en: p.enPlain,
      native: p.nativePlain,
      rom: p.romPlain,
    });
    log(`Saved AI phrase: ${p.enPlain.slice(0, 40)}...`);
    target.textContent = '✓';
    target.setAttribute('disabled', 'true');
  }

  // Push AI phrase to glasses
  if (action === 'push-ai-phrase') {
    const idx = Number(target.dataset.idx);
    const p = aiPhrases[idx];
    if (!p) return;
    await pushPhraseToGlasses(activeLang, 'ai_phrase' as PhraseKey, p.enPlain, p.nativePlain, p.romPlain);
    log(`Pushed AI phrase → glasses`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// PUBLIC — called from Main.ts
// ═══════════════════════════════════════════════════════════════════

export async function refreshAll(): Promise<void> {
  // Restore persisted language
  const stored = await getActiveLang();
  if (stored && LANG_CODES.includes(stored)) {
    activeLang = stored;
    const select = document.getElementById('output-lang-select') as HTMLSelectElement;
    if (select) select.value = activeLang;
  }

  await refreshHome();
  log("Dashboard ready");
}

export function setDeviceInfo(model: string, sn: string): void {
  const el = document.getElementById('settings-device');
  if (el) el.textContent = `${model} (${sn})`;
}

export function setVersionInfo(version: string): void {
  const el = document.getElementById('settings-version');
  if (el) el.textContent = version;
}

export function setGlassesStatus(connected: boolean, battery?: number): void {
  const el = document.getElementById('home-glasses-status');
  if (!el) return;
  if (connected) {
    el.innerHTML = `
      <div class="setting-row">
        <span>Status</span>
        <span style="color:var(--green)">Connected</span>
      </div>
      ${battery !== undefined ? `
      <div class="setting-row">
        <span>Battery</span>
        <span>${battery}%</span>
      </div>` : ''}
    `;
  } else {
    el.innerHTML = '<span class="muted">Glasses not connected</span>';
  }
}

// ═══ Utility ═══

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
