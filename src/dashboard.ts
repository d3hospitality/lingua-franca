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
import { startGlassesQuiz, pushPhraseToGlasses, setSpeakLang, setLearnLang, refreshGlassesForLanguageChange, startSpeakSelect, startDialogueHUD, updateDialogueHUD, endSpeakMode, onGlassesPageChange, onGlassesAudio, simulateGlassesClick, type GlassesPageState } from './events';
import { sendAudioChunk, onPulseResult, startPulseStream, stopPulseStream, flushAudioBuffer, setPulseKey, hasPulseKey, getPulseKey, type PulseResult } from './pulse-stt';
import { initCustomPhraseBuilder, setCustomLang, setCustomSpeakLang, setCustomPushFn, renderGlassesPreview, retranslateSavedPhrase } from './custom-phrase';
import { setOpenAIKey, hasOpenAIKey, getOpenAIKey, generateScenarioPhrases, cycleAISlot, type AIPhrase } from './ai-phrases';
import { log } from './ui';

// ═══════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════

let activeSection = 'home';   // which glasses-driven section is showing
let overlayOpen: string | null = null;  // 'compose' | 'settings' | null
let activeLang: LangCode = 'ja';  // default target language

// Compose state
let composePhrases: { key: PhraseKey; en: string; native: string; rom: string; phon: string }[] = [];
let aiPhrases: AIPhrase[] = [];
let composeMode: 'template' | 'ai' = 'template';

// Speak state
let speakActive = false;
let speakTargetLangCode: LangCode | null = null;

// Current "I speak" language (tracked from tumbler — may be any I_SPEAK_CODES value)
let currentSpeakLang: string = 'en';

// Quiz phone state
let phoneQuizActive = false;
let phoneQuizQuestions: { en: string; options: string[]; correctIdx: number }[] = [];
let phoneQuizIdx = 0;
let phoneQuizScore = 0;

// ═══════════════════════════════════════════════════════════════════
// INIT — tab switching + event delegation
// ═══════════════════════════════════════════════════════════════════

export function initDashboard(): void {
  // Header icon toggles — Compose and Settings overlays
  const composeBtn = document.getElementById('header-compose-btn');
  const settingsBtn = document.getElementById('header-settings-btn');
  if (composeBtn) composeBtn.addEventListener('click', () => toggleOverlay('compose'));
  if (settingsBtn) settingsBtn.addEventListener('click', () => toggleOverlay('settings'));

  // Language picker — "I speak" tumbler
  initTumbler(
    'input-lang-tumbler',
    'input-lang-sprite',
    I_SPEAK_CODES,
    (code) => {
      const native = LANG_NATIVE[code] || LANG_LABEL[code] || code;
      const label = LANG_LABEL[code] || code;
      return native === label ? native : `${native} — ${label}`;
    },
    I_SPEAK_CODES.indexOf('en'),
    async (code) => {
      currentSpeakLang = code;
      setSpeakLang(code);
      setCustomSpeakLang(code);
      setCustomLang(activeLang);
      refreshHome();
      refreshLibrary();
      await refreshGlassesForLanguageChange(activeLang, import.meta.env.BASE_URL);
      log(`I speak: ${LANG_NATIVE[code] || code}`);
    },
  );

  // Language picker — "Learning" tumbler
  initTumbler(
    'output-lang-tumbler',
    'output-lang-sprite',
    LANG_CODES as unknown as string[],
    (code) => LANG_LABEL[code] || code,
    LANG_CODES.indexOf(activeLang),
    async (code) => {
      activeLang = code as LangCode;
      setActiveLang(activeLang);
      setLearnLang(activeLang);
      setCustomLang(activeLang);
      refreshHome();
      refreshLibrary();
      await refreshGlassesForLanguageChange(activeLang, import.meta.env.BASE_URL);
      log(`Language → ${LANG_LABEL[activeLang]}`);
    },
  );

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

  // Theme picker
  document.querySelectorAll('.theme-swatch').forEach(btn => {
    btn.addEventListener('click', async () => {
      const theme = (btn as HTMLElement).dataset.theme || 'somni';
      document.body.dataset.theme = theme;
      document.querySelectorAll('.theme-swatch').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      await saveSettings({ theme });
      log(`Theme → ${theme}`);
    });
  });
  // Restore saved theme + API keys on load
  getSettings().then(s => {
    if (s.theme) {
      document.body.dataset.theme = s.theme;
      document.querySelectorAll('.theme-swatch').forEach(b => {
        b.classList.toggle('active', (b as HTMLElement).dataset.theme === s.theme);
      });
    }
    if (s.openaiKey) {
      setOpenAIKey(s.openaiKey);
      const keyInput = document.getElementById('settings-api-key') as HTMLInputElement;
      if (keyInput) keyInput.value = s.openaiKey;
    }
    if (s.pulseKey) {
      setPulseKey(s.pulseKey);
      const pulseInput = document.getElementById('settings-pulse-key') as HTMLInputElement;
      if (pulseInput) pulseInput.value = s.pulseKey;
    }
  });

  // Pulse API key input
  const pulseKeyInput = document.getElementById('settings-pulse-key') as HTMLInputElement;
  const pulseKeySaveBtn = document.getElementById('settings-pulse-key-save');
  if (pulseKeySaveBtn && pulseKeyInput) {
    pulseKeySaveBtn.addEventListener('click', async () => {
      const key = pulseKeyInput.value.trim();
      setPulseKey(key);
      await saveSettings({ pulseKey: key });
      log(key ? 'Pulse STT key saved' : 'Pulse STT key cleared');
    });
  }

  // OpenAI API key input
  const keyInput = document.getElementById('settings-api-key') as HTMLInputElement;
  const keySaveBtn = document.getElementById('settings-api-key-save');
  if (keySaveBtn && keyInput) {
    keySaveBtn.addEventListener('click', async () => {
      const key = keyInput.value.trim();
      setOpenAIKey(key);
      await saveSettings({ openaiKey: key });
      log(key ? 'OpenAI key saved' : 'OpenAI key cleared');
    });
  }

  // Subscribe to glasses page state changes — mirror on webapp
  onGlassesPageChange(handleGlassesPageChange);

  // ── Pulse STT pipeline: glasses mic → Pulse WebSocket → HUD ──
  // Stream raw PCM chunks directly to Pulse for real-time transcription
  onGlassesAudio((pcm) => {
    if (!speakActive) return;
    sendAudioChunk(pcm);
  });

  // When Pulse returns a transcription, update both phone HUD + glasses HUD
  let pulseDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPulseText = '';

  onPulseResult(async (result: PulseResult) => {
    if (!speakActive || !speakTargetLangCode) return;

    const displayText = result.text;

    // Update phone UI immediately with transcription
    const ttsEl = document.getElementById('speak-tts-text');
    if (ttsEl) ttsEl.textContent = displayText;

    // Update glasses HUD with live transcription
    await updateDialogueHUD(displayText, ['Listening...'], result.language !== 'unknown' ? result.language : undefined);

    // Debounce AI response generation — wait for speech to settle (1.5s pause)
    // to avoid hammering GPT on every partial transcription
    if (pulseDebounceTimer) clearTimeout(pulseDebounceTimer);

    if (result.text !== lastPulseText && result.text.trim().length > 5) {
      lastPulseText = result.text;

      pulseDebounceTimer = setTimeout(async () => {
        if (!speakActive || !speakTargetLangCode) return;

        log(`[STT] ${result.language}: "${result.text.slice(0, 40)}..."`);

        // Update glasses with "Thinking..." while GPT generates
        await updateDialogueHUD(displayText, ['Thinking...'], result.language !== 'unknown' ? result.language : undefined);

        // Generate AI response suggestions
        const whisperCompat = {
          text: result.text,
          language: result.language,
          translation: undefined as string | undefined,
        };
        const suggestions = await generateQuickResponses(whisperCompat, speakTargetLangCode!);

        // Update phone suggestions
        const sugEl = document.getElementById('speak-suggestions');
        if (sugEl) {
          sugEl.innerHTML = suggestions.map((s: string, i: number) =>
            `<div class="speak-option" data-speak-idx="${i}">${escHtml(s)}</div>`
          ).join('');
        }

        // Push final suggestions to glasses
        await updateDialogueHUD(displayText, suggestions, result.language !== 'unknown' ? result.language : undefined);
      }, 1500);
    }
  });

  // Global event delegation
  document.addEventListener('click', handleGlobalClick);
}

/** Show a glasses-driven section (home, speak, library, quiz, custom) */
function showSection(section: string): void {
  activeSection = section;

  // Close any open overlay
  closeOverlay();

  // Hide all tab-panels, show the target
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`tab-${section}`)?.classList.add('active');

  // Update section label
  const labelEl = document.getElementById('section-label-text');
  if (labelEl) labelEl.textContent = SECTION_LABELS[section] || section;

  // Refresh the section's content
  if (section === 'home') refreshHome();
  else if (section === 'speak') refreshSpeak();
  else if (section === 'custom') renderGlassesPreview();
  else if (section === 'library') refreshLibrary();
  else if (section === 'quiz') refreshQuiz();
}

/** Section display names */
const SECTION_LABELS: Record<string, string> = {
  'home': 'Home',
  'speak': 'Speak',
  'library': 'Library',
  'quiz': 'Quiz',
  'custom': 'Custom Phrase',
};

/** Toggle an overlay panel (compose or settings) */
function toggleOverlay(panel: string): void {
  if (overlayOpen === panel) {
    closeOverlay();
    return;
  }
  closeOverlay();
  overlayOpen = panel;

  // Hide the current section, show the overlay
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const overlayEl = document.getElementById(`tab-${panel}`);
  if (overlayEl) overlayEl.classList.add('active');

  // Highlight the header button
  document.getElementById(`header-${panel}-btn`)?.classList.add('active');

  // Update section label
  const labelEl = document.getElementById('section-label-text');
  if (labelEl) labelEl.textContent = panel === 'compose' ? 'Compose' : 'Settings';
}

/** Close any open overlay and restore the glasses-driven section */
function closeOverlay(): void {
  if (!overlayOpen) return;
  document.querySelectorAll('.overlay-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('header-compose-btn')?.classList.remove('active');
  document.getElementById('header-settings-btn')?.classList.remove('active');
  overlayOpen = null;

  // Restore the current section
  document.getElementById(`tab-${activeSection}`)?.classList.add('active');
  const labelEl = document.getElementById('section-label-text');
  if (labelEl) labelEl.textContent = SECTION_LABELS[activeSection] || activeSection;
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
// GLASSES STATE — live sync of glasses page to webapp UI
// ═══════════════════════════════════════════════════════════════════

/** Page name labels for display */
const PAGE_LABELS: Record<string, string> = {
  'home': 'Home',
  'languages': 'Languages',
  'speak-select': 'Speak — Select Language',
  'dialogue-hud': 'Live Conversation',
  'groups': 'Scenario Groups',
  'phrases': 'Phrase List',
  'detail': 'Phrase Detail',
  'library': 'Library',
  'quiz-question': 'Quiz',
  'quiz-feedback': 'Quiz — Feedback',
  'quiz-score': 'Quiz — Score',
  'custom': 'Custom Phrase',
  'mother-tongue': 'Mother Tongue',
};

/** Map glasses page → webapp section */
const PAGE_TO_SECTION: Record<string, string> = {
  'home': 'home',
  'languages': 'home',
  'groups': 'home',
  'phrases': 'home',
  'detail': 'home',
  'speak-select': 'speak',
  'dialogue-hud': 'speak',
  'library': 'library',
  'quiz-question': 'quiz',
  'quiz-feedback': 'quiz',
  'quiz-score': 'quiz',
  'custom': 'custom',
  'mother-tongue': 'home',
};

function handleGlassesPageChange(state: GlassesPageState): void {
  const baseUrl = import.meta.env.BASE_URL;

  // ── Auto-switch webapp section to match glasses page ──
  const targetSection = PAGE_TO_SECTION[state.page] || 'home';
  if (targetSection !== activeSection && !overlayOpen) {
    showSection(targetSection);
  } else if (targetSection !== activeSection && overlayOpen) {
    // Update the underlying section so closing the overlay shows the right one
    activeSection = targetSection;
  }

  // Update section label with more specific page name
  if (!overlayOpen) {
    const labelEl = document.getElementById('section-label-text');
    if (labelEl) labelEl.textContent = PAGE_LABELS[state.page] || SECTION_LABELS[targetSection] || state.page;
  }

  // ── Update the Glasses Activity card on Home tab ──
  const badge = document.getElementById('glasses-page-badge');
  const indicator = document.getElementById('glasses-live-indicator');
  const pageEl = document.getElementById('glasses-activity-page');
  const langEl = document.getElementById('glasses-activity-lang');
  const spriteEl = document.getElementById('glasses-activity-sprite') as HTMLImageElement;
  const detailArea = document.getElementById('glasses-activity-detail');
  const listArea = document.getElementById('glasses-activity-list');

  if (badge) badge.textContent = PAGE_LABELS[state.page] || state.page;
  if (indicator) indicator.style.display = '';
  if (pageEl) pageEl.textContent = PAGE_LABELS[state.page] || state.page;

  // ── Tumbler pages: languages, groups, phrases ──
  // Show a real tumbler card (same as I speak / Learning) with sprite that updates on scroll
  const isTumblerPage = (state.page === 'languages' || state.page === 'groups' || state.page === 'phrases') && state.listItems && state.listItems.length > 0;
  const tumblerCard = document.getElementById('glasses-tumbler-card');
  const tumblerTitle = document.getElementById('glasses-tumbler-title');

  if (isTumblerPage) {
    // Show the tumbler card
    if (tumblerCard) tumblerCard.style.display = '';

    // Set the title
    if (tumblerTitle) {
      if (state.page === 'languages') tumblerTitle.textContent = 'Languages';
      else if (state.page === 'groups') tumblerTitle.textContent = 'Scenarios';
      else if (state.page === 'phrases') tumblerTitle.textContent = state.groupLabel || 'Phrases';
    }

    // Initialize the tumbler only when the page type changes
    const tumblerEl = document.getElementById('glasses-tumbler');
    if (tumblerEl && tumblerEl.dataset.tumblerPage !== state.page) {
      tumblerEl.dataset.tumblerPage = state.page;

      // Build sprite URL function based on page type
      const items = state.listItems!;
      const spriteUrlFn = (idx: number): string => {
        if (state.page === 'languages') {
          const code = LANG_CODES[idx];
          return SPRITE_LANGS.has(code)
            ? `${BASE_URL}sprites/language/lang-${code}.png`
            : `${BASE_URL}sprites/candidate_world.png`;
        } else {
          // groups + phrases: use scene sprites
          const sceneMap: Record<number, string> = {
            0: 'scene-social', 1: 'scene-food', 2: 'scene-compliment',
            3: 'scene-navigate', 4: 'scene-formal',
          };
          const groupIdx = state.page === 'phrases' ? (state.groupIdx ?? 0) : idx;
          const scene = sceneMap[groupIdx];
          return scene
            ? `${BASE_URL}sprites/scene/${scene}.png`
            : `${BASE_URL}sprites/candidate_scene.png`;
        }
      };

      initTumbler(
        'glasses-tumbler',
        'glasses-tumbler-sprite',
        items.map((_, i) => String(i)),  // use indices as codes
        (idxStr) => items[Number(idxStr)] || idxStr,
        state.highlightIdx ?? 0,
        async (idxStr) => {
          const idx = Number(idxStr);
          // Update sprite immediately
          const sprImg = document.getElementById('glasses-tumbler-sprite') as HTMLImageElement;
          if (sprImg) sprImg.src = spriteUrlFn(idx);
          // Tell glasses to select this item
          await simulateGlassesClick(idx);
        },
      );

      // Override the sprite update to use our custom URL function
      const sprImg = document.getElementById('glasses-tumbler-sprite') as HTMLImageElement;
      if (sprImg) {
        sprImg.src = spriteUrlFn(state.highlightIdx ?? 0);
        sprImg.style.display = '';
      }
    }

    // Sync tumbler scroll position from glasses (when glasses scroll, update webapp)
    const highlightIdx = state.highlightIdx ?? 0;
    const tEl = document.getElementById('glasses-tumbler');
    if (tEl) {
      const ITEM_H = 36;
      // Scroll to the highlighted item without triggering onChange
      tEl.scrollTo({ top: highlightIdx * ITEM_H, behavior: 'smooth' });
      tEl.querySelectorAll('.tumbler-item[data-idx]').forEach((el) => {
        el.classList.toggle('selected', el.getAttribute('data-idx') === String(highlightIdx));
      });
    }
    // Update sprite from glasses state
    const tSprImg = document.getElementById('glasses-tumbler-sprite') as HTMLImageElement;
    if (tSprImg && state.spriteUrl) {
      tSprImg.src = state.spriteUrl;
    }

    // Hide the old list area
    if (listArea) listArea.style.display = 'none';

  } else {
    // Hide tumbler card
    if (tumblerCard) tumblerCard.style.display = 'none';
    const tEl = document.getElementById('glasses-tumbler');
    if (tEl) delete tEl.dataset.tumblerPage;

    // Non-tumbler pages — standard rendering

    // Language info
    if (langEl) {
      if (state.langLabel) {
        langEl.textContent = `${state.langFlag || ''} ${state.langLabel}`;
        langEl.style.display = '';
      } else {
        langEl.style.display = 'none';
      }
    }

    // Sprite image
    if (spriteEl) {
      if (state.spriteUrl) {
        spriteEl.src = state.spriteUrl;
        spriteEl.alt = state.langLabel || '';
        spriteEl.style.display = '';
      } else if (state.lang) {
        spriteEl.src = `${baseUrl}sprites/language/lang-${state.lang}.png`;
        spriteEl.alt = state.langLabel || '';
        spriteEl.style.display = '';
      } else {
        spriteEl.style.display = 'none';
      }
    }

    // Phrase detail (when on detail page)
    if (detailArea) {
      if (state.page === 'detail' && (state.speakText || state.learnText)) {
        const speakEl = document.getElementById('glasses-detail-speak');
        const learnEl = document.getElementById('glasses-detail-learn');
        const romEl = document.getElementById('glasses-detail-rom');
        if (speakEl) speakEl.textContent = state.speakText || '';
        if (learnEl) learnEl.textContent = state.learnText || '';
        if (romEl) {
          romEl.textContent = state.romText || '';
          romEl.style.display = state.romText ? '' : 'none';
        }
        detailArea.style.display = '';
      } else {
        detailArea.style.display = 'none';
      }
    }

    // Hide list area on non-carousel pages
    if (listArea) listArea.style.display = 'none';
  }

  // ── Sync webapp controls with glasses state ──

  // Update the "Learning" tumbler if language changed from glasses
  if (state.lang && state.lang !== activeLang && LANG_CODES.includes(state.lang as any)) {
    activeLang = state.lang as LangCode;
    setActiveLang(activeLang);
    const tumblerEl = document.getElementById('output-lang-tumbler');
    if (tumblerEl) {
      const idx = LANG_CODES.indexOf(activeLang);
      if (idx >= 0) {
        tumblerEl.scrollTo({ top: idx * 36, behavior: 'smooth' });
        tumblerEl.querySelectorAll('.tumbler-item[data-idx]').forEach((el) => {
          el.classList.toggle('selected', el.getAttribute('data-idx') === String(idx));
        });
      }
    }
    const outputSprite = document.getElementById('output-lang-sprite') as HTMLImageElement;
    if (outputSprite) {
      outputSprite.src = `${baseUrl}sprites/language/lang-${activeLang}.png`;
      outputSprite.alt = LANG_LABEL[activeLang] || activeLang;
      outputSprite.style.display = '';
    }
  }

  // If glasses entered speak/dialogue, sync phone speak tab + start Pulse STT
  if (state.page === 'dialogue-hud' && state.lang && !speakActive) {
    speakActive = true;
    speakTargetLangCode = state.lang as LangCode;
    const selectCard = document.getElementById('speak-select-card');
    const hud = document.getElementById('speak-hud');
    if (selectCard) selectCard.style.display = 'none';
    if (hud) hud.style.display = '';
    const theirLangEl = document.getElementById('speak-their-lang');
    const theirSprite = document.getElementById('speak-their-sprite') as HTMLImageElement;
    if (theirLangEl) theirLangEl.textContent = state.langLabel || '';
    if (theirSprite && state.lang) {
      theirSprite.src = SPRITE_LANGS.has(state.lang)
        ? `${baseUrl}sprites/language/lang-${state.lang}.png`
        : `${baseUrl}sprites/candidate_language.png`;
    }
    // Open Pulse WebSocket so glasses-initiated speak actually streams audio
    if (hasPulseKey()) {
      startPulseStream();
      log(`Pulse STT started (glasses-initiated speak → ${state.langLabel || state.lang})`);
    } else {
      log('Set your Smallest.ai API key in Settings for live STT', 'error');
    }
  }

  // If glasses left dialogue, reset speak state + stop Pulse STT
  if ((state.page === 'home' || state.page === 'speak-select') && speakActive) {
    speakActive = false;
    speakTargetLangCode = null;
    flushAudioBuffer();
    stopPulseStream();
    const selectCard = document.getElementById('speak-select-card');
    const hud = document.getElementById('speak-hud');
    if (selectCard) selectCard.style.display = '';
    if (hud) hud.style.display = 'none';
  }

  // Refresh library if glasses navigated there
  if (state.page === 'library' && activeSection === 'library') {
    refreshLibrary();
  }
}

// ═══════════════════════════════════════════════════════════════════
// SPEAK TAB — Live Conversation Mode
// Mirrors the G2 glasses Dialogue HUD on the phone in real-time
// ═══════════════════════════════════════════════════════════════════

const SPEAK_BASE_URL = import.meta.env.BASE_URL;

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

  // Update phone UI — show HUD, hide selector
  const selectCard = document.getElementById('speak-select-card');
  const hud = document.getElementById('speak-hud');
  if (selectCard) selectCard.style.display = 'none';
  if (hud) hud.style.display = '';

  // Set their language info
  const theirLangEl = document.getElementById('speak-their-lang');
  const theirSprite = document.getElementById('speak-their-sprite') as HTMLImageElement;
  if (theirLangEl) theirLangEl.textContent = LANG_LABEL[speakTargetLangCode] || speakTargetLangCode;
  if (theirSprite) {
    theirSprite.src = SPRITE_LANGS.has(speakTargetLangCode)
      ? `${SPEAK_BASE_URL}sprites/language/lang-${speakTargetLangCode}.png`
      : `${SPEAK_BASE_URL}sprites/candidate_language.png`;
    theirSprite.alt = LANG_LABEL[speakTargetLangCode] || '';
  }

  // Set your language info
  const yourLangEl = document.getElementById('speak-your-lang');
  const yourSprite = document.getElementById('speak-your-sprite') as HTMLImageElement;
  if (yourLangEl) yourLangEl.textContent = LANG_LABEL[currentSpeakLang] || 'English';
  if (yourSprite) {
    yourSprite.src = SPRITE_LANGS.has(currentSpeakLang)
      ? `${SPEAK_BASE_URL}sprites/language/lang-${currentSpeakLang}.png`
      : `${SPEAK_BASE_URL}sprites/candidate_master.png`;
    yourSprite.alt = LANG_LABEL[currentSpeakLang] || 'English';
  }

  // Initial TTS display
  const ttsEl = document.getElementById('speak-tts-text');
  if (ttsEl) ttsEl.textContent = 'Listening...';

  // Initial suggestions
  const sugEl = document.getElementById('speak-suggestions');
  if (sugEl) sugEl.innerHTML = '<div class="speak-option muted">Waiting for speech...</div>';

  // Push to glasses: dialogue HUD
  await startDialogueHUD(speakTargetLangCode);

  // Start Pulse STT stream (connects WebSocket for real-time transcription)
  if (hasPulseKey()) {
    startPulseStream();
  } else {
    log('Set your Smallest.ai API key in Settings for live STT', 'error');
  }

  log(`Speak: ${LANG_LABEL[speakTargetLangCode]} — conversation started`);
}

async function handleSpeakStop(): Promise<void> {
  speakActive = false;
  speakTargetLangCode = null;

  // Stop Pulse STT stream
  flushAudioBuffer();
  stopPulseStream();

  // Reset phone UI
  const selectCard = document.getElementById('speak-select-card');
  const hud = document.getElementById('speak-hud');
  if (selectCard) selectCard.style.display = '';
  if (hud) hud.style.display = 'none';

  // Reset conversation history
  conversationHistory = [];

  // Return glasses to home
  await endSpeakMode();
  log('Speak: conversation ended');
}

// Conversation history for GPT context
let conversationHistory: { role: string; text: string; lang: string }[] = [];

/**
 * Generate AI-powered response suggestions using GPT.
 * Takes the Whisper transcription and generates contextual things to say back
 * in the target language.
 */
async function generateQuickResponses(result: { text: string; language: string; translation?: string }, targetLang: LangCode): Promise<string[]> {
  // Add to conversation history
  conversationHistory.push({
    role: 'them',
    text: result.text,
    lang: result.language,
  });
  // Keep last 10 exchanges for context
  if (conversationHistory.length > 10) conversationHistory = conversationHistory.slice(-10);

  const apiKey = getOpenAIKey();
  if (!apiKey) {
    // Fallback: simple template responses
    return [
      `Yes, I understand`,
      `Can you repeat that?`,
      `Tell me more`,
    ];
  }

  try {
    const targetName = LANG_LABEL[targetLang] || targetLang;
    const speakName = LANG_LABEL[currentSpeakLang] || 'English';
    const recentContext = conversationHistory.map(h =>
      `${h.role === 'them' ? 'Them' : 'You'}: ${h.text}`
    ).join('\n');

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 300,
        temperature: 0.8,
        messages: [
          {
            role: 'system',
            content: `You are a real-time conversation assistant for smart glasses. The user speaks ${speakName} and is talking to someone who speaks ${targetName}.

Given the conversation so far, suggest 3 SHORT responses the user could say next. Each response should be in ${targetName} with ${speakName} translation in parentheses.

Format: one response per line, like:
${targetName} phrase (${speakName} translation)

Keep responses natural, casual, and contextually relevant. Max 10 words each.`,
          },
          {
            role: 'user',
            content: `Conversation:\n${recentContext}\n\nSuggest 3 responses I could say:`,
          },
        ],
      }),
    });

    if (!resp.ok) return fallbackResponses();

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '';
    const lines = content.split('\n').filter((l: string) => l.trim().length > 0).slice(0, 3);

    return lines.length > 0 ? lines : fallbackResponses();
  } catch (e) {
    console.warn('[LF] GPT response error:', e);
    return fallbackResponses();
  }
}

function fallbackResponses(): string[] {
  return ['Yes, I understand', 'Can you say that again?', 'Tell me more'];
}

/**
 * Called externally (or by future mic/TTS pipeline) to update the HUD
 * with new translated text and AI-generated response suggestions.
 * Updates BOTH the phone canvas + interactive panels AND the glasses.
 */
export async function updateSpeakHUD(translation: string, suggestions: string[]): Promise<void> {
  // Update phone interactive panels
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
      <button class="btn-outline-sm" data-action="push-quick" data-key="${p.key}">G2</button>
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
        <button class="btn-outline-sm" data-action="push-phrase" data-idx="${i}">G2</button>
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
          <button class="btn-outline-sm" data-action="push-ai-phrase" data-idx="${i}">G2</button>
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

  // Get current speak lang from tumbler state
  const speakLang = currentSpeakLang;

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
          <button class="btn-outline-sm" data-action="push-saved" data-id="${p.id}" data-retranslate="${retranslated ? '1' : ''}">G2</button>
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
        <button id="quiz-start" class="btn-primary btn-hero" data-action="start-quiz">Start Quiz</button>
        <p class="muted" style="margin-top:10px">Quiz yourself on ${LANG_FLAG[activeLang]} ${LANG_LABEL[activeLang]} vocab</p>
        <div style="margin-top:10px">
          <button class="btn-secondary" style="width:100%" data-action="quiz-glasses">Quiz on Glasses</button>
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
        <button class="btn-primary btn-hero" data-action="start-quiz" style="margin-top:12px">Play Again</button>
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

  // Carousel item click — select a language or scenario group from the webapp
  if (action === 'carousel-select') {
    const idx = Number(target.dataset.carouselIdx);
    if (!isNaN(idx)) {
      await simulateGlassesClick(idx);
      log(`Carousel → item ${idx}`);
    }
    return;
  }

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
    // Open compose overlay and generate for this key
    toggleOverlay('compose');
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

// ═══════════════════════════════════════════════════════════════════
// TUMBLER — scroll-lock style language picker
// Scroll snaps to items, dynamically updates sprite preview + glasses
// ═══════════════════════════════════════════════════════════════════

const BASE_URL = import.meta.env.BASE_URL;
const SPRITE_LANGS = new Set([
  'en','ar','bg','de','es','fr','hi','id','it','ja','ko',
  'nl','pl','pt','ru','sv','th','tl','tr','vi','zh',
]);

function initTumbler(
  tumblerId: string,
  spriteId: string,
  codes: string[],
  labelFn: (code: string) => string,
  initialIdx: number,
  onChange: (code: string) => Promise<void>,
): void {
  const tumbler = document.getElementById(tumblerId);
  const spriteImg = document.getElementById(spriteId) as HTMLImageElement | null;
  if (!tumbler) return;

  const ITEM_H = 36;
  // Padding items so the first/last can scroll to center
  const PAD_COUNT = Math.floor(120 / ITEM_H / 2);  // ~1-2 padding items

  // Build items: padding + real items + padding
  tumbler.innerHTML = '';
  for (let i = 0; i < PAD_COUNT; i++) {
    const pad = document.createElement('div');
    pad.className = 'tumbler-item dimmed';
    pad.style.height = `${ITEM_H}px`;
    pad.innerHTML = '&nbsp;';
    tumbler.appendChild(pad);
  }
  codes.forEach((code, i) => {
    const item = document.createElement('div');
    item.className = 'tumbler-item';
    item.style.height = `${ITEM_H}px`;
    item.dataset.code = code;
    item.dataset.idx = String(i);
    item.textContent = labelFn(code);
    tumbler.appendChild(item);
  });
  for (let i = 0; i < PAD_COUNT; i++) {
    const pad = document.createElement('div');
    pad.className = 'tumbler-item dimmed';
    pad.style.height = `${ITEM_H}px`;
    pad.innerHTML = '&nbsp;';
    tumbler.appendChild(pad);
  }

  // Scroll to initial position
  const targetScroll = initialIdx * ITEM_H;
  tumbler.scrollTop = targetScroll;

  // Update sprite preview — always visible, fallback to candidate_world
  function updateSprite(code: string): void {
    if (!spriteImg) return;
    if (SPRITE_LANGS.has(code)) {
      spriteImg.src = `${BASE_URL}sprites/language/lang-${code}.png`;
    } else {
      spriteImg.src = `${BASE_URL}sprites/candidate_world.png`;
    }
    spriteImg.alt = LANG_LABEL[code] || code;
    spriteImg.style.display = '';
  }

  updateSprite(codes[initialIdx] || codes[0]);

  // Track selected index
  let currentIdx = initialIdx;
  let scrollTimeout: ReturnType<typeof setTimeout> | null = null;

  tumbler.addEventListener('scroll', () => {
    // Calculate which item is centered
    const scrollTop = tumbler.scrollTop;
    const newIdx = Math.round(scrollTop / ITEM_H);
    const clampedIdx = Math.max(0, Math.min(newIdx, codes.length - 1));

    if (clampedIdx !== currentIdx) {
      currentIdx = clampedIdx;
      const code = codes[currentIdx];

      // Update sprite preview immediately
      updateSprite(code);

      // Highlight the selected item
      tumbler.querySelectorAll('.tumbler-item[data-idx]').forEach((el) => {
        el.classList.toggle('selected', el.getAttribute('data-idx') === String(currentIdx));
      });
    }

    // Debounce the actual selection callback (wait for scroll to settle)
    if (scrollTimeout) clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      // Snap to exact position
      tumbler.scrollTo({ top: currentIdx * ITEM_H, behavior: 'smooth' });
      const code = codes[currentIdx];
      onChange(code);
    }, 200);
  }, { passive: true });

  // Also handle tap to select
  tumbler.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('.tumbler-item[data-idx]') as HTMLElement | null;
    if (!target) return;
    const idx = Number(target.dataset.idx);
    if (isNaN(idx)) return;
    currentIdx = idx;
    tumbler.scrollTo({ top: idx * ITEM_H, behavior: 'smooth' });
    updateSprite(codes[idx]);
    onChange(codes[idx]);
  });

  // Initial highlight
  tumbler.querySelectorAll('.tumbler-item[data-idx]').forEach((el) => {
    el.classList.toggle('selected', el.getAttribute('data-idx') === String(initialIdx));
  });
}

// ═══ Utility ═══

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
