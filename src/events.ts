// ═══════════════════════════════════════════════════════════════════
// Lingua Franca — Event Handlers
// Nav: Home (menu) → Speak → Dialogue HUD (live conversation)
//       Home → Languages → Scenario Groups → Phrase List → Detail
//       Home → Library → Phrase Detail
//       Home → Quiz
// + Quiz flow on glasses
// Double-tap = BACK on ALL pages
// ═══════════════════════════════════════════════════════════════════

import { EvenAppBridge, EvenHubEvent, OsEventTypeList, TextContainerUpgrade } from '@evenrealities/even_hub_sdk';
import {
  LANG_CODES, LANG_LABEL, LANG_FLAG, LANG_NATIVE, I_SPEAK_CODES,
  PHRASE_KEYS, needsRom,
  langPhrase, langRom, langPhon, VOCAB,
  type LangCode, type PhraseKey, type VocabCategory, type VocabItem,
} from './constants';
import {
  rebuildHomePage, buildLanguagesPage, buildLibraryPage, buildMotherTonguePage,
  buildSpeakSelectPage, buildDialogueHUDPage, LANG_PAGE_SPRITE,
  buildScenarioGroupPage, buildPhraseListPage,
  buildPhraseDetailPage, buildQuizQuestionPage, buildQuizFeedbackPage,
  buildQuizScorePage, fillSlots, fillSlotsRom, fillSlotsPhon, fillSlotsEnglish,
  fillSlotsHighlighted, fillSlotsRomHighlighted, fillSlotsPhonHighlighted, fillSlotsEnglishHighlighted,
  fillSlotsForSpeaker, fillSlotsForSpeakerHighlighted, getSpeakerSlotLabel,
  pickSlotsForTemplate, getSlotCategories, EN_TEMPLATES,
  SCENARIO_GROUPS, HOME_MENU_ITEMS, phraseLabel,
  type GlassesQuizQuestion, type SlotCategory,
} from './pages';
import { pushHomeSprite, pushLangFlagSprite, pushGroupsSprite, pushPhrasesSprite, pushDialogueSprites, pushTextSprite } from './image-utils';
import { initSync, getSavedPhrases, recordQuizResult, getQuizStats } from './sync';
import { getCustomSlots, cycleSlotOption, buildCustomPhrasePage } from './custom-phrase';
import { initAdaptiveRender, clearSnapshot } from './adaptive-render';
import { log } from './ui';

// ═══ STATE ═══
type Page =
  | "home" | "speak-select" | "dialogue-hud"
  | "languages" | "library" | "groups" | "phrases" | "detail"
  | "quiz-question" | "quiz-feedback" | "quiz-score"
  | "custom" | "mother-tongue";

let currentPage: Page = "home";
let currentLang: LangCode | null = null;
let speakLang: string = "en";  // user's native / "I speak" language
let speakTargetLang: LangCode | null = null;  // language of the person you're speaking with
let languageLocked = false;  // true when user explicitly picked a language from speak-select
let currentGroupIdx: number = -1;
let currentPhraseIdx: number = -1;
// Detail state: filled texts for the currently displayed phrase
let detailEn = "";
let detailNative = "";
let detailRom = "";
let detailEnHL = "";       // highlighted version (brackets around slot words)
let detailNativeHL = "";   // highlighted version
let detailRomHL = "";      // highlighted rom (brackets around slot words)
let detailPhon = "";       // phonetic pronunciation (syllable breaks)
let detailPhonHL = "";     // highlighted phonetic
let detailKey: PhraseKey | null = null;
// Slot cycling state: track which vocab index each slot is on
let detailSlotCats: SlotCategory[] = [];
let detailSlotIdxs: number[] = [];  // index into VOCAB[lang][cat] for each slot

// Quiz state
let quizQuestions: GlassesQuizQuestion[] = [];
let quizIdx = 0;
let quizScore = 0;

/** Fill detail texts using pre-picked vocab so speaker + learner use same items.
 *  Respects speakLang: if non-English, uses speaker's language for the top line. */
function fillDetailTexts(lang: LangCode, key: PhraseKey): void {
  const nativeTemplate = langPhrase(lang, key);
  const romTemplate = langRom(lang, key);
  const enTemplate = EN_TEMPLATES[key] || key;

  // Get slot categories for this phrase
  detailSlotCats = getSlotCategories(key);

  // Pre-pick vocab items (same items used for both languages)
  const picks = pickSlotsForTemplate(enTemplate, lang);

  // Track which index each pick is at in its category
  const vocab = VOCAB[lang];
  detailSlotIdxs = picks.map((pick, i) => {
    if (!vocab) return 0;
    const cat = detailSlotCats[i];
    const items = vocab[cat];
    return items ? items.findIndex(v => v.en === pick.en && v.tr === pick.tr) : 0;
  });

  // Speaker line (top) — English or mother tongue
  if (speakLang === "en") {
    detailEn = fillSlotsEnglish(key, lang, picks);
    detailEnHL = fillSlotsEnglishHighlighted(key, lang, picks);
  } else {
    detailEn = fillSlotsForSpeaker(key, speakLang, picks);
    detailEnHL = fillSlotsForSpeakerHighlighted(key, speakLang, picks);
  }

  // Learning line (bottom) — target language
  detailNative = fillSlots(nativeTemplate, lang, picks);
  detailRom = needsRom(lang) ? fillSlotsRom(romTemplate, lang, picks) : "";
  detailRomHL = needsRom(lang) ? fillSlotsRomHighlighted(romTemplate, lang, picks) : "";
  detailNativeHL = fillSlotsHighlighted(nativeTemplate, lang, picks);

  // Phonetic pronunciation line
  const phonTemplate = langPhon(lang, key);
  detailPhon = phonTemplate ? fillSlotsPhon(phonTemplate, lang, picks) : "";
  detailPhonHL = phonTemplate ? fillSlotsPhonHighlighted(phonTemplate, lang, picks) : "";
}

/** Cycle a specific slot's vocab and rebuild detail texts */
function cycleDetailSlot(lang: LangCode, key: PhraseKey, slotIdx: number): void {
  const vocab = VOCAB[lang];
  if (!vocab || slotIdx >= detailSlotCats.length) return;

  const cat = detailSlotCats[slotIdx];
  const items = vocab[cat];
  if (!items || items.length === 0) return;

  // Cycle to next vocab item in this category
  detailSlotIdxs[slotIdx] = (detailSlotIdxs[slotIdx] + 1) % items.length;

  // Rebuild picks from current indexes
  const picks = detailSlotCats.map((c, i) => {
    const catItems = vocab[c];
    if (!catItems) return { en: "?", tr: "?" };
    return catItems[detailSlotIdxs[i] % catItems.length];
  });

  const nativeTemplate = langPhrase(lang, key);
  const romTemplate = langRom(lang, key);

  // Speaker line
  if (speakLang === "en") {
    detailEn = fillSlotsEnglish(key, lang, picks);
    detailEnHL = fillSlotsEnglishHighlighted(key, lang, picks);
  } else {
    detailEn = fillSlotsForSpeaker(key, speakLang, picks);
    detailEnHL = fillSlotsForSpeakerHighlighted(key, speakLang, picks);
  }

  // Learning line
  detailNative = fillSlots(nativeTemplate, lang, picks);
  detailRom = needsRom(lang) ? fillSlotsRom(romTemplate, lang, picks) : "";
  detailRomHL = needsRom(lang) ? fillSlotsRomHighlighted(romTemplate, lang, picks) : "";
  detailNativeHL = fillSlotsHighlighted(nativeTemplate, lang, picks);

  // Phonetic
  const phonTemplate = langPhon(lang, key);
  detailPhon = phonTemplate ? fillSlotsPhon(phonTemplate, lang, picks) : "";
  detailPhonHL = phonTemplate ? fillSlotsPhonHighlighted(phonTemplate, lang, picks) : "";
}

/** Get the current slot labels for the detail page list (ALL CAPS, respects speakLang) */
function getDetailSlotLabels(lang: LangCode): string[] {
  const vocab = VOCAB[lang];
  if (!vocab) return [];
  return detailSlotCats.map((cat, i) => {
    const items = vocab[cat];
    if (!items || items.length === 0) return "?";
    const enWord = items[detailSlotIdxs[i] % items.length].en;
    return getSpeakerSlotLabel(speakLang, cat, enWord);
  });
}

// Scroll highlight state — tracks which list item is highlighted on each page
let langHighlightIdx = 0;
let groupHighlightIdx = 0;
let phraseHighlightIdx = 0;
let lastSpriteUpdateMs = 0;
const SPRITE_DEBOUNCE_MS = 100;  // don't re-push sprites faster than this

let navigating = false;
let lastNavigationTime = 0;
const NAV_DEBOUNCE_MS = 150;  // minimal debounce — just enough to prevent double-fires

// Mic / audio state
let micActive = false;
type AudioCallback = (pcm: Uint8Array) => void;
let audioListeners: AudioCallback[] = [];

/** Subscribe to raw PCM audio from glasses mic (each chunk ~3200 bytes / 100ms) */
export function onGlassesAudio(cb: AudioCallback): () => void {
  audioListeners.push(cb);
  return () => { audioListeners = audioListeners.filter(l => l !== cb); };
}

let bridgeRef: EvenAppBridge | null = null;
let baseUrlRef = "";

// ═══ REGISTER ═══
export function registerEventHandlers(bridge: EvenAppBridge, baseUrl: string): () => void {
  bridgeRef = bridge;
  baseUrlRef = baseUrl;

  // Initialize adaptive render engine
  initAdaptiveRender(bridge);

  return bridge.onEvenHubEvent((event: EvenHubEvent) => {
    handleEvent(bridge, event, baseUrl);
  });
}

// ═══ GO HOME ═══
async function goHome(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  clearSnapshot();  // reset adaptive render state for new page
  await bridge.rebuildPageContainer(rebuildHomePage());
  currentPage = "home";
  currentLang = null;
  currentGroupIdx = -1;
  currentPhraseIdx = -1;
  quizQuestions = [];
  lastNavigationTime = Date.now();
  pushHomeSprite(bridge, baseUrl).catch(() => {});  // non-blocking
  log("< Back to Home", "success");
  notifyPageChange();
}

// ═══ GO BACK ═══
async function goBack(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  if (navigating) return;
  navigating = true;

  try {
    log(`[BACK] from ${currentPage}`);

    if (currentPage === "detail" && currentLang && currentGroupIdx >= 0) {
      await bridge.rebuildPageContainer(buildPhraseListPage(currentLang, currentGroupIdx, speakLang));
      pushPhrasesSprite(bridge, baseUrl, currentGroupIdx).catch(() => {});
      currentPage = "phrases";
      currentPhraseIdx = -1;
      lastNavigationTime = Date.now();
      log("< Back to phrases", "success");
    }
    else if (currentPage === "phrases" && currentLang) {
      groupHighlightIdx = 0;
      await bridge.rebuildPageContainer(buildScenarioGroupPage(currentLang, speakLang));
      pushGroupsSprite(bridge, baseUrl, currentLang).catch(() => {});
      currentPage = "groups";
      currentGroupIdx = -1;
      lastNavigationTime = Date.now();
      log("< Back to groups", "success");
    }
    else if (currentPage === "groups") {
      // Back to languages page with dynamic flag sprite
      langHighlightIdx = 0;
      await bridge.rebuildPageContainer(buildLanguagesPage(0));
      pushLangFlagSprite(
        bridge, LANG_CODES[0],
        LANG_PAGE_SPRITE.containerID, "lang-sprite",
        LANG_PAGE_SPRITE.width, LANG_PAGE_SPRITE.height, baseUrl,
      ).catch(() => {});
      currentPage = "languages";
      currentLang = null;
      currentGroupIdx = -1;
      lastNavigationTime = Date.now();
      log("< Back to languages", "success");
    }
    else if (currentPage === "dialogue-hud") {
      // Stop mic before leaving dialogue
      if (micActive && bridge) {
        bridge.audioControl(false).catch(() => {});
        micActive = false;
      }
      speakTargetLang = null;
      lastDetectedLang = null;
      languageLocked = false;
      dialogueLayoutReady = false;
      lastSuggestions = [];
      // Go back to speak-select so user can pick a different language
      langHighlightIdx = 0;
      await bridge.rebuildPageContainer(buildSpeakSelectPage(0));
      const speakBackCode = LANG_CODES[0];
      pushLangFlagSprite(
        bridge, speakBackCode,
        3, "speak-sprite",
        LANG_PAGE_SPRITE.width, LANG_PAGE_SPRITE.height, baseUrl,
      ).catch(() => {});
      currentPage = "speak-select";
      log("< Back to language select", "success");
    }
    else if (currentPage === "speak-select") {
      languageLocked = false;
      await goHome(bridge, baseUrl);
      log("< Back to Home", "success");
    }
    else if (currentPage === "languages" || currentPage === "library" || currentPage === "mother-tongue") {
      await goHome(bridge, baseUrl);
    }
    // Quiz back = quit quiz
    else if (currentPage === "quiz-question" || currentPage === "quiz-feedback") {
      await goHome(bridge, baseUrl);
      quizQuestions = [];
      lastNavigationTime = Date.now();
      log("< Quit quiz", "success");
    }
    else if (currentPage === "custom") {
      await goHome(bridge, baseUrl);
    }
    else if (currentPage === "quiz-score") {
      await goHome(bridge, baseUrl);
    }
    else {
      await goHome(bridge, baseUrl);
    }
  } catch (err) {
    log(`[BACK] ERROR: ${err}`, "error");
  } finally {
    navigating = false;
    notifyPageChange();
  }
}

// (pushLangTextSprite removed — replaced by pushGroupsSprite / pushPhrasesSprite)

// ═══ QUIZ GENERATOR ═══
function generateQuiz(lang: LangCode, count: number = 5): GlassesQuizQuestion[] {
  const vocab = VOCAB[lang];
  if (!vocab) return [];

  const questions: GlassesQuizQuestion[] = [];
  const categories: VocabCategory[] = ["DRINKS", "FOOD", "GREETING", "COMPLIMENT", "PLACE"];
  const shuffle = <T>(a: T[]): T[] => [...a].sort(() => Math.random() - 0.5);

  for (let i = 0; i < count; i++) {
    const cat = categories[i % categories.length];
    const items = vocab[cat];
    if (!items || items.length < 2) continue;

    const shuffled = shuffle(items);
    const correct = shuffled[0];
    const wrongs = shuffled.slice(1, 4);

    // Question: "What is '[english]' in [language]?"
    const options = shuffle([correct, ...wrongs]).map(item => item.tr);
    const correctIdx = options.indexOf(correct.tr);

    questions.push({
      question: `What is "${correct.en}" in ${LANG_LABEL[lang]}?`,
      options,
      correctIdx,
    });
  }

  return questions;
}

// ═══ PUBLIC: simulate a glasses click from the webapp ═══
export async function simulateGlassesClick(idx: number): Promise<void> {
  if (!bridgeRef) return;
  await handleClick(bridgeRef, idx, baseUrlRef);
}

// ═══ HANDLE CLICK ═══
async function handleClick(bridge: EvenAppBridge, idx: number, baseUrl: string): Promise<void> {
  if (navigating) return;
  navigating = true;

  try {
    log(`[CLICK] page=${currentPage} idx=${idx}`);

    // ── HOME: main menu (Speak / Languages / Library / Quiz / Settings) ──
    if (currentPage === "home") {
      if (idx === 0) {
        // Speak — go to language selection page first
        langHighlightIdx = 0;
        await bridge.rebuildPageContainer(buildSpeakSelectPage(0));
        const speakInitCode = LANG_CODES[0];
        pushLangFlagSprite(
          bridge, speakInitCode,
          3, "speak-sprite",
          LANG_PAGE_SPRITE.width, LANG_PAGE_SPRITE.height, baseUrl,
        ).catch(() => {});
        currentPage = "speak-select";
        log("> Speak: select language", "success");
      } else if (idx === 1) {
        // Languages — phrase browsing with dynamic flag sprite
        langHighlightIdx = 0;
        await bridge.rebuildPageContainer(buildLanguagesPage(0));
        const langInitCode = LANG_CODES[0];
        pushLangFlagSprite(
          bridge, langInitCode,
          LANG_PAGE_SPRITE.containerID, "lang-sprite",
          LANG_PAGE_SPRITE.width, LANG_PAGE_SPRITE.height, baseUrl,
        ).catch(() => {});
        currentPage = "languages";
        lastNavigationTime = Date.now();
        log("> Languages", "success");
      } else if (idx === 2) {
        // Library — show saved phrases on glasses
        const saved = await getSavedPhrases();
        const phraseData = saved.map(p => ({ en: p.en, native: p.native }));
        await bridge.rebuildPageContainer(buildLibraryPage(phraseData));
        currentPage = "library";
        lastNavigationTime = Date.now();
        log(`> Library (${saved.length} phrases)`, "success");
      } else if (idx === 3) {
        // Quiz — use activeLang from dashboard, or first available
        const quizLang = currentLang || LANG_CODES[0];
        currentLang = quizLang;
        quizQuestions = generateQuiz(quizLang, 5);
        if (quizQuestions.length === 0) {
          log("[QUIZ] No questions available", "error");
          return;
        }
        quizIdx = 0;
        quizScore = 0;
        await bridge.rebuildPageContainer(
          buildQuizQuestionPage(quizQuestions[0], 1, quizQuestions.length)
        );
        currentPage = "quiz-question";
        lastNavigationTime = Date.now();
        log(`> Quiz: ${LANG_LABEL[quizLang]}`, "success");
      } else if (idx === 4) {
        // Settings — Mother Tongue selector
        await bridge.rebuildPageContainer(buildMotherTonguePage(speakLang));
        currentPage = "mother-tongue";
        lastNavigationTime = Date.now();
        log("> Settings: Mother Tongue", "success");
      }
      return;
    }

    // ── SPEAK-SELECT: pick a language → start dialogue HUD ──
    if (currentPage === "speak-select") {
      const backIdx = LANG_CODES.length;  // last item is "Back"
      if (idx === backIdx) {
        // Back → home
        await bridge.rebuildPageContainer(rebuildHomePage());
        pushHomeSprite(bridge, `${baseUrl}sprites/candidate_master.png`).catch(() => {});
        currentPage = "home";
        log("> Home", "success");
      } else if (idx >= 0 && idx < LANG_CODES.length) {
        // Language selected → lock and start dialogue HUD
        const lockedLang = LANG_CODES[idx];
        speakTargetLang = lockedLang;
        languageLocked = true;
        await startDialogueHUD();
        log(`> Dialogue HUD — locked to ${LANG_LABEL[lockedLang]}`, "success");
      }
      return;
    }

    // ── DIALOGUE HUD: click cycles through suggestion containers ──
    if (currentPage === "dialogue-hud") {
      // Advance to next suggestion (0→1→2→0)
      dialogueSelectedIdx = (dialogueSelectedIdx + 1) % 3;

      // Update all 3 containers — selected gets ▸ prefix, others plain
      const sugContainers = [
        { id: 45, name: "dlg-sug1" },
        { id: 46, name: "dlg-sug2" },
        { id: 47, name: "dlg-sug3" },
      ];

      for (let i = 0; i < sugContainers.length; i++) {
        const sug = lastSuggestions[i] || '';
        const content = i === dialogueSelectedIdx ? `▸ ${sug}` : sug;
        try {
          await bridgeRef!.textContainerUpgrade(new TextContainerUpgrade({
            containerID: sugContainers[i].id,
            containerName: sugContainers[i].name,
            contentOffset: 0,
            contentLength: content.length,
            content,
          }));
        } catch { /* ignore upgrade failures on individual containers */ }
      }

      log(`[DIALOGUE] → suggestion ${dialogueSelectedIdx + 1}/3`);
      return;
    }

    // ── LANGUAGES: pick a language ──
    if (currentPage === "languages") {
      if (idx === LANG_CODES.length) {
        // Back
        navigating = false;
        await goBack(bridge, baseUrl);
        return;
      }
      if (idx >= 0 && idx < LANG_CODES.length) {
        currentLang = LANG_CODES[idx];
        groupHighlightIdx = 0;
        await bridge.rebuildPageContainer(buildScenarioGroupPage(currentLang, speakLang));
        pushGroupsSprite(bridge, baseUrl, currentLang).catch(() => {});
        currentPage = "groups";
        lastNavigationTime = Date.now();
        log(`> ${LANG_LABEL[currentLang]}`, "success");
      }
      return;
    }

    // ── LIBRARY: tap a saved phrase to view detail, or Back ──
    if (currentPage === "library") {
      const saved = await getSavedPhrases();
      if (idx === saved.length || (saved.length === 0 && idx === 1)) {
        // Back
        navigating = false;
        await goBack(bridge, baseUrl);
        return;
      }
      if (saved.length === 0) return; // "No saved phrases" item
      if (idx >= 0 && idx < saved.length) {
        const p = saved[idx];
        currentLang = p.lang;
        detailKey = p.key;
        detailEn = p.en;
        detailNative = p.native;
        detailRom = p.rom;
        detailEnHL = "";
        detailNativeHL = "";
        await bridge.rebuildPageContainer(
          buildPhraseDetailPage(p.lang, p.key, p.en, p.native, p.rom, undefined, undefined, undefined, undefined, speakLang)
        );
        currentPage = "detail";
        lastNavigationTime = Date.now();
        log(`> Library phrase: ${p.en.slice(0, 30)}`, "success");
      }
      return;
    }

    // ── MOTHER TONGUE: pick "I speak" language ──
    if (currentPage === "mother-tongue") {
      if (idx === I_SPEAK_CODES.length) {
        // Back
        navigating = false;
        await goBack(bridge, baseUrl);
        return;
      }
      if (idx >= 0 && idx < I_SPEAK_CODES.length) {
        speakLang = I_SPEAK_CODES[idx];
        const name = LANG_NATIVE[speakLang] || LANG_LABEL[speakLang] || speakLang;
        log(`Mother tongue → ${name}`, "success");

        // Also update the phone dashboard dropdown to stay in sync
        const inputSelect = document.getElementById('input-lang-select') as HTMLSelectElement | null;
        if (inputSelect) inputSelect.value = speakLang;

        // Go back to home
        await goHome(bridge, baseUrl);
      }
      return;
    }

    // ── GROUPS: pick a scenario category ──
    if (currentPage === "groups" && currentLang) {
      if (idx === SCENARIO_GROUPS.length) {
        // Back
        navigating = false;
        await goBack(bridge, baseUrl);
        return;
      }
      if (idx >= 0 && idx < SCENARIO_GROUPS.length) {
        currentGroupIdx = idx;
        phraseHighlightIdx = 0;
        await bridge.rebuildPageContainer(buildPhraseListPage(currentLang, currentGroupIdx, speakLang));
        pushPhrasesSprite(bridge, baseUrl, currentGroupIdx).catch(() => {});
        currentPage = "phrases";
        lastNavigationTime = Date.now();
        log(`> ${SCENARIO_GROUPS[idx].label}`, "success");
      }
      return;
    }

    // ── PHRASES: pick a specific phrase ──
    if (currentPage === "phrases" && currentLang && currentGroupIdx >= 0) {
      const group = SCENARIO_GROUPS[currentGroupIdx];
      if (idx === group.keys.length) {
        // Back
        navigating = false;
        await goBack(bridge, baseUrl);
        return;
      }
      if (idx >= 0 && idx < group.keys.length) {
        const key = group.keys[idx];
        currentPhraseIdx = idx;
        detailKey = key;

        fillDetailTexts(currentLang, key);
        const slotLabels = getDetailSlotLabels(currentLang);

        await bridge.rebuildPageContainer(
          buildPhraseDetailPage(currentLang, key, detailEn, detailNative, detailRom, detailEnHL, detailNativeHL, slotLabels, detailSlotCats, speakLang, detailRomHL, detailPhon, detailPhonHL)
        );
        currentPage = "detail";
        lastNavigationTime = Date.now();
        log(`> ${key}`, "success");
      }
      return;
    }

    // ── DETAIL: tap a slot item = cycle that slot's vocab ──
    if (currentPage === "detail" && currentLang && detailKey) {
      if (idx >= 0 && idx < detailSlotCats.length) {
        // Cycle just the tapped slot
        cycleDetailSlot(currentLang, detailKey, idx);
      } else {
        // Tap outside slots = reshuffle all
        fillDetailTexts(currentLang, detailKey);
      }
      const slotLabels = getDetailSlotLabels(currentLang);

      await bridge.rebuildPageContainer(
        buildPhraseDetailPage(currentLang, detailKey, detailEn, detailNative, detailRom, detailEnHL, detailNativeHL, slotLabels, detailSlotCats, speakLang, detailRomHL)
      );
      lastNavigationTime = Date.now();
      const label = idx < detailSlotCats.length ? `Cycled slot ${idx}: ${slotLabels[idx]}` : "Reshuffled all";
      log(label, "success");
      return;
    }

    // ── CUSTOM PHRASE: click a slot to cycle options ──
    if (currentPage === "custom") {
      const customSlots = getCustomSlots();
      if (idx === customSlots.length) {
        // "Back" item
        navigating = false;
        await goBack(bridge, baseUrl);
        return;
      }
      if (idx >= 0 && idx < customSlots.length) {
        cycleSlotOption(idx);
        const page = buildCustomPhrasePage();
        if (page) {
          await bridge.rebuildPageContainer(page);
          log(`Cycled slot ${idx}`, "success");
        }
      }
      return;
    }

    // ── QUIZ QUESTION: pick an answer ──
    if (currentPage === "quiz-question" && quizIdx < quizQuestions.length) {
      const q = quizQuestions[quizIdx];
      const correct = idx === q.correctIdx;
      if (correct) quizScore++;

      const correctAnswer = q.options[q.correctIdx];
      await bridge.rebuildPageContainer(buildQuizFeedbackPage(correct, correctAnswer));
      currentPage = "quiz-feedback";
      lastNavigationTime = Date.now();

      if (currentLang) {
        await recordQuizResult(currentLang, correct);
      }
      return;
    }

    // ── QUIZ FEEDBACK: click = next question or score ──
    if (currentPage === "quiz-feedback") {
      quizIdx++;
      if (quizIdx < quizQuestions.length) {
        await bridge.rebuildPageContainer(
          buildQuizQuestionPage(quizQuestions[quizIdx], quizIdx + 1, quizQuestions.length)
        );
        currentPage = "quiz-question";
      } else {
        const langName = currentLang ? LANG_LABEL[currentLang] : "Unknown";
        await bridge.rebuildPageContainer(
          buildQuizScorePage(quizScore, quizQuestions.length, langName)
        );
        currentPage = "quiz-score";
      }
      lastNavigationTime = Date.now();
      return;
    }

    // ── QUIZ SCORE: click = go home ──
    if (currentPage === "quiz-score") {
      await goHome(bridge, baseUrl);
      return;
    }

  } catch (err) {
    log(`[CLICK] ERROR: ${err}`, "error");
  } finally {
    navigating = false;
    notifyPageChange();
  }
}

// ═══ HANDLE SCROLL ═══
async function handleScroll(
  bridge: EvenAppBridge, direction: "up" | "down", baseUrl: string,
): Promise<void> {
  // In detail view, scroll = cycle to next/prev phrase in the group
  if (currentPage === "detail" && currentLang && currentGroupIdx >= 0) {
    const group = SCENARIO_GROUPS[currentGroupIdx];
    if (direction === "down") {
      currentPhraseIdx = (currentPhraseIdx + 1) % group.keys.length;
    } else {
      currentPhraseIdx = (currentPhraseIdx - 1 + group.keys.length) % group.keys.length;
    }

    const key = group.keys[currentPhraseIdx];
    detailKey = key;
    fillDetailTexts(currentLang, key);
    const slotLabels = getDetailSlotLabels(currentLang);

    await bridge.rebuildPageContainer(
      buildPhraseDetailPage(currentLang, key, detailEn, detailNative, detailRom, detailEnHL, detailNativeHL, slotLabels, detailSlotCats, speakLang, detailRomHL, detailPhon, detailPhonHL)
    );
    lastNavigationTime = Date.now();
    log(`Scroll ${direction} → ${key}`, "success");
    notifyPageChange();
  }
  // Other pages: scroll is handled natively by list containers
}

// ═══ EVENT DISPATCHER ═══
async function handleEvent(bridge: EvenAppBridge, event: EvenHubEvent, baseUrl: string): Promise<void> {

  // Audio events — PCM data from glasses 4-mic array (16kHz, 16-bit LE, mono)
  // Stream each chunk directly to listeners (Deepgram handles buffering internally)
  // NOTE: SDK sends audioPcm as number[] after JSON serialization, not a real Uint8Array.
  //       Always wrap with new Uint8Array() to ensure correct binary type.
  if (event.audioEvent) {
    const raw = event.audioEvent.audioPcm;
    if (raw && micActive) {
      const pcm = new Uint8Array(raw);  // convert number[] → real Uint8Array
      if (pcm.length > 0) {
        for (const cb of audioListeners) {
          try { cb(pcm); } catch (e) { console.warn('[LF] Audio listener error:', e); }
        }
      }
    }
    return;
  }

  // List events (click / scroll on list containers)
  if (event.listEvent) {
    const le = event.listEvent;
    const idx = le.currentSelectItemIndex ?? 0;
    const type = le.eventType;

    // Scroll events on detail page = cycle phrases
    if (currentPage === "detail") {
      if (type === OsEventTypeList.SCROLL_TOP_EVENT) {
        await handleScroll(bridge, "up", baseUrl);
        return;
      }
      if (type === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
        await handleScroll(bridge, "down", baseUrl);
        return;
      }
    }

    // On languages/speak-select pages, scroll = update the big sprite dynamically
    if (type === OsEventTypeList.SCROLL_TOP_EVENT || type === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
      if (currentPage === "languages" || currentPage === "speak-select") {
        // Update highlight index from scroll direction
        if (type === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
          langHighlightIdx = Math.min(langHighlightIdx + 1, LANG_CODES.length - 1);
        } else {
          langHighlightIdx = Math.max(langHighlightIdx - 1, 0);
        }

        // Debounce sprite pushes — they involve image fetch + grayscale conversion
        const now = Date.now();
        if (now - lastSpriteUpdateMs >= SPRITE_DEBOUNCE_MS) {
          lastSpriteUpdateMs = now;
          const code = LANG_CODES[langHighlightIdx];
          const flag = LANG_FLAG[code] || '';
          const name = LANG_LABEL[code] || code;

          // Push the flag sprite for the highlighted language dynamically
          const containerName = currentPage === "speak-select" ? "speak-sprite" : "lang-sprite";
          pushLangFlagSprite(
            bridge, code,
            LANG_PAGE_SPRITE.containerID, containerName,
            LANG_PAGE_SPRITE.width, LANG_PAGE_SPRITE.height, baseUrl,
          ).catch(() => {});

          // Update the text label via textContainerUpgrade (instant)
          const spriteLabel = currentPage === "speak-select" ? `🗣 ${flag} ${name}` : `${flag} ${name}`;
          const labelName = currentPage === "speak-select" ? "speak-name" : "lang-name";
          bridge.textContainerUpgrade({
            containerID: LANG_PAGE_SPRITE.labelID,
            containerName: labelName,
            contentOffset: 0,
            contentLength: spriteLabel.length,
            content: spriteLabel,
          } as any).catch(() => {});

          log(`Scroll → ${flag} ${name}`);
          notifyPageChange();
        }
      }

      // On groups page, scroll = update scene sprite for highlighted group
      if (currentPage === "groups") {
        if (type === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
          groupHighlightIdx = Math.min(groupHighlightIdx + 1, SCENARIO_GROUPS.length - 1);
        } else {
          groupHighlightIdx = Math.max(groupHighlightIdx - 1, 0);
        }

        const now = Date.now();
        if (now - lastSpriteUpdateMs >= SPRITE_DEBOUNCE_MS) {
          lastSpriteUpdateMs = now;
          // Push the scene sprite for the highlighted group
          pushPhrasesSprite(bridge, baseUrl, groupHighlightIdx).catch(() => {});
          log(`Scroll → ${SCENARIO_GROUPS[groupHighlightIdx].label}`);
          notifyPageChange();
        }
      }

      // On phrases page, scroll = update language flag for current lang
      // (sprite stays consistent since we're within a single group)
      if (currentPage === "phrases" && currentLang && currentGroupIdx >= 0) {
        const group = SCENARIO_GROUPS[currentGroupIdx];
        if (type === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
          phraseHighlightIdx = Math.min(phraseHighlightIdx + 1, group.keys.length - 1);
        } else {
          phraseHighlightIdx = Math.max(phraseHighlightIdx - 1, 0);
        }
        notifyPageChange();
      }

      return;
    }

    // Debounce
    if (Date.now() - lastNavigationTime < NAV_DEBOUNCE_MS) return;

    // Click
    await handleClick(bridge, idx, baseUrl);
    return;
  }

  // System events (double-click = back)
  // NOTE: sysEvent fires independently of list events — always handle it
  if (event.sysEvent) {
    const sysType = event.sysEvent.eventType;
    if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT || (sysType as unknown as number) === 3) {
      // Force-clear navigating flag so double-tap always works
      navigating = false;
      await goBack(bridge, baseUrl);
    }
  }
}

// ═══ PUBLIC: set speak language from dashboard ═══
export function setSpeakLang(lang: string): void {
  speakLang = lang;
  log(`I speak: ${LANG_LABEL[lang] || lang}`);
}

// ═══ PUBLIC: set learning language from dashboard ═══
export function setLearnLang(lang: LangCode): void {
  currentLang = lang;
  log(`Learning: ${LANG_LABEL[lang] || lang}`);
}

// ═══ PUBLIC: refresh glasses page after language change ═══
export async function refreshGlassesForLanguageChange(learnLang: LangCode, baseUrl: string): Promise<void> {
  if (!bridgeRef) return;

  // If on a page that shows language-specific content, rebuild it
  if (currentPage === "groups" && currentLang) {
    currentLang = learnLang;
    await bridgeRef.rebuildPageContainer(buildScenarioGroupPage(currentLang, speakLang));
    pushGroupsSprite(bridgeRef, baseUrlRef, currentLang).catch(() => {});
    log(`Glasses updated → ${LANG_LABEL[currentLang]} groups`, "success");
  }
  else if (currentPage === "phrases" && currentLang && currentGroupIdx >= 0) {
    currentLang = learnLang;
    await bridgeRef.rebuildPageContainer(buildPhraseListPage(currentLang, currentGroupIdx, speakLang));
    pushPhrasesSprite(bridgeRef, baseUrlRef, currentGroupIdx).catch(() => {});
    log(`Glasses updated → ${LANG_LABEL[currentLang]} phrases`, "success");
  }
  else if (currentPage === "detail" && currentLang && detailKey) {
    currentLang = learnLang;
    fillDetailTexts(currentLang, detailKey);
    const slotLabels = getDetailSlotLabels(currentLang);
    await bridgeRef.rebuildPageContainer(
      buildPhraseDetailPage(currentLang, detailKey, detailEn, detailNative, detailRom, detailEnHL, detailNativeHL, slotLabels, detailSlotCats, speakLang, detailRomHL, detailPhon, detailPhonHL)
    );
    log(`Glasses updated → ${LANG_LABEL[currentLang]} detail`, "success");
  }
  else if (currentPage === "home") {
    // On home: update state and rebuild home to confirm change
    currentLang = learnLang;
    await bridgeRef.rebuildPageContainer(rebuildHomePage());
    pushHomeSprite(bridgeRef, baseUrl).catch(() => {});
    log(`Language set → ${LANG_LABEL[currentLang]} (home refreshed)`, "success");
  }
  else {
    // Other pages: just update state
    currentLang = learnLang;
    log(`Language set → ${LANG_LABEL[currentLang]} (glasses will use on next nav)`, "success");
  }
}

// ═══ PUBLIC: trigger quiz from dashboard ═══
export async function startGlassesQuiz(lang: LangCode): Promise<void> {
  if (!bridgeRef) return;
  quizQuestions = generateQuiz(lang, 5);
  if (quizQuestions.length === 0) {
    log("[QUIZ] No questions available", "error");
    return;
  }
  quizIdx = 0;
  quizScore = 0;
  currentLang = lang;

  await bridgeRef.rebuildPageContainer(
    buildQuizQuestionPage(quizQuestions[0], 1, quizQuestions.length)
  );
  currentPage = "quiz-question";
  lastNavigationTime = Date.now();
  log(`> Quiz: ${LANG_LABEL[lang]} (${quizQuestions.length}Q)`, "success");
}

// ═══ PUBLIC: push custom phrase page to glasses ═══
export async function pushCustomToGlasses(): Promise<void> {
  if (!bridgeRef) return;
  const page = buildCustomPhrasePage();
  if (!page) { log("No custom phrase to push", "error"); return; }
  await bridgeRef.rebuildPageContainer(page);
  currentPage = "custom";
  lastNavigationTime = Date.now();
  log("Custom phrase → glasses", "success");
}

// ═══ PUBLIC: push a specific phrase to glasses from dashboard ═══
export async function pushPhraseToGlasses(
  lang: LangCode, key: PhraseKey,
  enText: string, nativeText: string, romText: string,
): Promise<void> {
  if (!bridgeRef) return;
  currentLang = lang;
  detailKey = key;
  detailEn = enText;
  detailNative = nativeText;
  detailRom = romText;
  // Generate highlighted versions for dashboard pushes too
  detailEnHL = "";
  detailNativeHL = "";

  await bridgeRef.rebuildPageContainer(
    buildPhraseDetailPage(lang, key, enText, nativeText, romText, undefined, undefined, undefined, undefined, speakLang)
  );
  currentPage = "detail";
  lastNavigationTime = Date.now();
  log(`Pushed: ${key} → glasses`, "success");
}

// ═══ SPEAK MODE — auto-detect live conversation ═══

/** Start Dialogue HUD: open mic immediately, Deepgram auto-detects language.
 *  If languageLocked is true, speakTargetLang is already set from speak-select. */
export async function startDialogueHUD(): Promise<void> {
  if (!bridgeRef) { log("[SPEAK] No bridge", "error"); return; }
  // Only reset target lang if user didn't explicitly pick one from speak-select
  if (!languageLocked) {
    speakTargetLang = null;
  }
  lastDetectedLang = languageLocked ? (speakTargetLang || null) : null;
  dialogueLayoutReady = false;
  lastSuggestions = [];
  dialogueSelectedIdx = 0;

  // If language was locked from speak-select, show it immediately
  const initLang = languageLocked && speakTargetLang
    ? `${LANG_FLAG[speakTargetLang] || ''} ${LANG_LABEL[speakTargetLang] || speakTargetLang}`
    : "🌍 Detecting...";

  const page = buildDialogueHUDPage({
    detectedLang: initLang,
    translation: "Listening...",
    suggestions: ["Speak or let them speak..."],
  });
  await bridgeRef.rebuildPageContainer(page);

  // No flag sprites — containers #41/#44 removed for cleaner layout

  currentPage = "dialogue-hud";
  lastNavigationTime = Date.now();

  // Start microphone capture from glasses 4-mic array
  // SDK prerequisite: createStartUpPageContainer must have succeeded (done in Main.ts)
  try {
    const micOk = await bridgeRef.audioControl(true);
    if (micOk) {
      micActive = true;
      log("> Dialogue HUD: mic ON — waiting for audio", "success");
    } else {
      log("[MIC] audioControl(true) returned false — mic didn't open", "error");
    }
  } catch (e) {
    log(`[MIC] audioControl(true) threw: ${e}`, "error");
  }
}

/** Track the last detected language so we only re-push sprite when it changes */
let lastDetectedLang: string | null = null;

/** Dialogue HUD suggestion cycling — click advances through #45→#46→#47→#45 */
let dialogueSelectedIdx = 0;

/** Track whether the dialogue HUD layout has been built (so we can use fast text updates) */
let dialogueLayoutReady = false;
/** Track last suggestions pushed to glasses (avoid unnecessary full rebuilds) */
let lastSuggestions: string[] = [];
/** Rate limit text upgrades — glasses can't handle more than ~5/sec */
let lastTextUpgradeMs = 0;
const TEXT_UPGRADE_MIN_MS = 200;  // max ~5 updates/sec for text

/**
 * Update Dialogue HUD with new TTS translation and AI suggestions.
 *
 * Modeled after Sophicon's proven approach:
 *   - Layout (containers) set up ONCE via rebuildPageContainer in startDialogueHUD()
 *   - Text-only changes (transcription) → textContainerUpgrade (instant, no flicker)
 *   - Suggestion changes (new AI responses) → full rebuildPageContainer (only when needed)
 *
 * This prevents the glasses from being spammed with full rebuilds on every
 * Deepgram partial result (which was causing the "stuck on Listening..." bug).
 */
export async function updateDialogueHUD(
  translation: string,
  suggestions: string[],
  detectedLangCode?: string,
): Promise<void> {
  if (!bridgeRef) return;

  // Update detected language — skip if user locked a specific language from speak-select
  if (!languageLocked && detectedLangCode && detectedLangCode !== 'unknown' && detectedLangCode !== lastDetectedLang) {
    lastDetectedLang = detectedLangCode;
    speakTargetLang = detectedLangCode as LangCode;
    log(`[HUD] Detected → ${LANG_FLAG[detectedLangCode] || ''} ${LANG_LABEL[detectedLangCode] || detectedLangCode}`, "success");

    // No flag sprites — containers #41/#44 removed for cleaner layout
  }

  const effectiveLang = speakTargetLang || detectedLangCode || '';
  const langLabel = effectiveLang ? (LANG_LABEL[effectiveLang] || effectiveLang) : 'Detecting...';
  const langFlag = effectiveLang ? (LANG_FLAG[effectiveLang] || '') : '🌍';

  // Check if suggestions actually changed (different count or different text)
  const suggestionsChanged =
    suggestions.length !== lastSuggestions.length ||
    suggestions.some((s, i) => s !== lastSuggestions[i]);

  if (suggestionsChanged || !dialogueLayoutReady) {
    // Full rebuild needed — suggestions changed or first render
    const page = buildDialogueHUDPage({
      detectedLang: `${langFlag} ${langLabel}`,
      translation,
      suggestions,
    });
    await bridgeRef.rebuildPageContainer(page);
    dialogueLayoutReady = true;
    lastSuggestions = [...suggestions];
    dialogueSelectedIdx = 0;  // reset selection on new suggestions
    lastTextUpgradeMs = Date.now();
    log(`[HUD] Rebuild: "${translation.slice(0, 35)}..." + ${suggestions.length} suggestions`);
  } else {
    // Fast path: text-only updates (no full rebuild needed)
    const now = Date.now();
    if (now - lastTextUpgradeMs < TEXT_UPGRADE_MIN_MS) return;
    lastTextUpgradeMs = now;

    // Update #43 (tts transcription text) in-place
    const truncated = translation.slice(0, 2000);
    try {
      await bridgeRef.textContainerUpgrade(new TextContainerUpgrade({
        containerID: 43,
        containerName: "dlg-tts-text",
        contentOffset: 0,
        contentLength: truncated.length,
        content: truncated,
      }));
    } catch (e) {
      log(`[HUD] Text upgrade failed, rebuilding: ${e}`);
      const page = buildDialogueHUDPage({
        detectedLang: `${langFlag} ${langLabel}`,
        translation,
        suggestions,
      });
      await bridgeRef.rebuildPageContainer(page);
    }

    // Update #42 (language label)
    const newLangContent = `${langFlag} ${langLabel}`;
    try {
      await bridgeRef.textContainerUpgrade(new TextContainerUpgrade({
        containerID: 42,
        containerName: "dlg-lang-name",
        contentOffset: 0,
        contentLength: newLangContent.length,
        content: newLangContent,
      }));
    } catch { /* lang label rarely changes */ }

    log(`[HUD] Text: "${translation.slice(0, 35)}..."`);
  }
}

/** End Speak mode: stop mic, go back to home */
export async function endSpeakMode(): Promise<void> {
  if (!bridgeRef) return;

  // Stop microphone
  if (micActive) {
    try {
      await bridgeRef.audioControl(false);
    } catch (e) { /* ignore */ }
    micActive = false;
    log("[MIC] Stopped", "success");
  }

  speakTargetLang = null;
  lastDetectedLang = null;
  languageLocked = false;
  dialogueLayoutReady = false;
  lastSuggestions = [];
  await goHome(bridgeRef, baseUrlRef);
  log("< Speak mode ended", "success");
}

// ═══════════════════════════════════════════════════════════════════
// PAGE STATE NOTIFICATIONS — broadcast to webapp for live mirroring
// ═══════════════════════════════════════════════════════════════════

export interface GlassesPageState {
  page: Page;
  lang?: string;        // current language code (if applicable)
  langLabel?: string;   // human-readable language name
  langFlag?: string;    // flag emoji
  groupIdx?: number;    // scenario group index
  groupLabel?: string;  // scenario group name
  phraseKey?: string;   // current phrase key
  speakText?: string;   // speaker text (en or mother tongue)
  learnText?: string;   // learning text (native)
  romText?: string;     // romanization
  spriteUrl?: string;   // URL of the current image sprite
  listItems?: string[]; // current list items on glasses
  highlightIdx?: number; // which list item is highlighted
}

type PageChangeCallback = (state: GlassesPageState) => void;
let pageChangeListeners: PageChangeCallback[] = [];

/** Subscribe to glasses page state changes */
export function onGlassesPageChange(cb: PageChangeCallback): () => void {
  pageChangeListeners.push(cb);
  return () => { pageChangeListeners = pageChangeListeners.filter(l => l !== cb); };
}

/** Broadcast current state to all listeners */
function notifyPageChange(): void {
  const baseUrl = baseUrlRef || import.meta.env.BASE_URL;
  const state: GlassesPageState = { page: currentPage };

  if (currentLang) {
    state.lang = currentLang;
    state.langLabel = LANG_LABEL[currentLang];
    state.langFlag = LANG_FLAG[currentLang];
  }

  if (currentPage === "languages" || currentPage === "speak-select") {
    const code = LANG_CODES[langHighlightIdx];
    state.lang = code;
    state.langLabel = LANG_LABEL[code];
    state.langFlag = LANG_FLAG[code];
    state.spriteUrl = `${baseUrl}sprites/language/lang-${code}.png`;
    state.highlightIdx = langHighlightIdx;
    state.listItems = LANG_CODES.map(c => `${LANG_FLAG[c]} ${LANG_LABEL[c]}`);
  }
  else if (currentPage === "groups" && currentLang) {
    // Sprite updates dynamically on scroll via groupHighlightIdx
    const sceneMap: Record<number, string> = {
      0: 'scene-social', 1: 'scene-food', 2: 'scene-compliment',
      3: 'scene-navigate', 4: 'scene-formal',
    };
    const sceneName = sceneMap[groupHighlightIdx];
    state.spriteUrl = sceneName
      ? `${baseUrl}sprites/scene/${sceneName}.png`
      : `${baseUrl}sprites/language/lang-${currentLang}.png`;
    state.groupIdx = currentGroupIdx;
    state.highlightIdx = groupHighlightIdx;
    state.groupLabel = SCENARIO_GROUPS[groupHighlightIdx]?.label;
    state.listItems = SCENARIO_GROUPS.map(g => g.label);
  }
  else if (currentPage === "phrases" && currentLang && currentGroupIdx >= 0) {
    const sceneMap: Record<number, string> = {
      0: 'scene-social', 1: 'scene-food', 2: 'scene-compliment',
      3: 'scene-navigate', 4: 'scene-formal',
    };
    const sceneName = sceneMap[currentGroupIdx];
    state.spriteUrl = sceneName
      ? `${baseUrl}sprites/scene/${sceneName}.png`
      : `${baseUrl}sprites/candidate_scene.png`;
    state.groupIdx = currentGroupIdx;
    state.groupLabel = SCENARIO_GROUPS[currentGroupIdx]?.label;
    state.highlightIdx = phraseHighlightIdx;
    state.listItems = SCENARIO_GROUPS[currentGroupIdx].keys.map(k => phraseLabel(k));
  }
  else if (currentPage === "detail" && currentLang && detailKey) {
    state.phraseKey = detailKey;
    state.speakText = detailEn;
    state.learnText = detailNative;
    state.romText = detailRom;
  }
  else if (currentPage === "home") {
    state.spriteUrl = `${baseUrl}sprites/logo.png`;
  }
  else if (currentPage === "dialogue-hud" && speakTargetLang) {
    state.lang = speakTargetLang;
    state.langLabel = LANG_LABEL[speakTargetLang];
    state.langFlag = LANG_FLAG[speakTargetLang];
    state.spriteUrl = `${baseUrl}sprites/language/lang-${speakTargetLang}.png`;
  }

  for (const cb of pageChangeListeners) {
    try { cb(state); } catch (e) { console.warn('[LF] Page change listener error:', e); }
  }
}

// Inject notifyPageChange calls into critical navigation points
// This is done by wrapping goHome and key navigation spots

/** Get the current glasses page state (for initial sync on dashboard load) */
export function getGlassesPageState(): GlassesPageState {
  // Build and return current state without notifying
  const baseUrl = baseUrlRef || import.meta.env.BASE_URL;
  const state: GlassesPageState = { page: currentPage };
  if (currentLang) {
    state.lang = currentLang;
    state.langLabel = LANG_LABEL[currentLang];
    state.langFlag = LANG_FLAG[currentLang];
  }
  if (currentPage === "home") state.spriteUrl = `${baseUrl}sprites/logo.png`;
  return state;
}
