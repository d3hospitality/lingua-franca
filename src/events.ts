// ═══════════════════════════════════════════════════════════════════
// Lingua Franca — Event Handlers
// Nav: Home (menu) → Speak → Dialogue HUD (live conversation)
//       Home → Languages → Scenario Groups → Phrase List → Detail
//       Home → Library → Phrase Detail
//       Home → Quiz
// + Quiz flow on glasses
// Double-tap = BACK on ALL pages
// ═══════════════════════════════════════════════════════════════════

import { EvenAppBridge, EvenHubEvent, OsEventTypeList } from '@evenrealities/even_hub_sdk';
import {
  LANG_CODES, LANG_LABEL, LANG_FLAG, LANG_NATIVE, I_SPEAK_CODES,
  PHRASE_KEYS, needsRom,
  langPhrase, langRom, langPhon, VOCAB,
  type LangCode, type PhraseKey, type VocabCategory, type VocabItem,
} from './constants';
import {
  rebuildHomePage, buildLanguagesPage, buildLibraryPage, buildMotherTonguePage,
  buildSpeakSelectPage, buildDialogueHUDPage,
  buildScenarioGroupPage, buildPhraseListPage,
  buildPhraseDetailPage, buildQuizQuestionPage, buildQuizFeedbackPage,
  buildQuizScorePage, fillSlots, fillSlotsRom, fillSlotsPhon, fillSlotsEnglish,
  fillSlotsHighlighted, fillSlotsRomHighlighted, fillSlotsPhonHighlighted, fillSlotsEnglishHighlighted,
  fillSlotsForSpeaker, fillSlotsForSpeakerHighlighted, getSpeakerSlotLabel,
  pickSlotsForTemplate, getSlotCategories, EN_TEMPLATES,
  SCENARIO_GROUPS, HOME_MENU_ITEMS,
  type GlassesQuizQuestion, type SlotCategory,
} from './pages';
import { pushLogoToGlasses, pushTextSprite } from './image-utils';
import { initSync, getSavedPhrases, recordQuizResult, getQuizStats } from './sync';
import { getCustomSlots, cycleSlotOption, buildCustomPhrasePage } from './custom-phrase';
import { initAdaptiveRender, smartUpdate, snapshotTextContainers, clearSnapshot, logRenderStats } from './adaptive-render';
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

let navigating = false;
let lastNavigationTime = 0;
const NAV_DEBOUNCE_MS = 500;

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
  dialogueHUDReady = false;
  await bridge.rebuildPageContainer(rebuildHomePage());
  currentPage = "home";
  currentLang = null;
  currentGroupIdx = -1;
  currentPhraseIdx = -1;
  quizQuestions = [];
  lastNavigationTime = Date.now();
  await pushLogoToGlasses(bridge, baseUrl);
  log("< Back to Home", "success");
}

// ═══ GO BACK ═══
async function goBack(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  if (navigating) return;
  navigating = true;

  try {
    log(`[BACK] from ${currentPage}`);

    if (currentPage === "detail" && currentLang && currentGroupIdx >= 0) {
      await bridge.rebuildPageContainer(buildPhraseListPage(currentLang, currentGroupIdx, speakLang));
      await pushLangSprite(bridge, currentLang);
      currentPage = "phrases";
      currentPhraseIdx = -1;
      lastNavigationTime = Date.now();
      log("< Back to phrases", "success");
    }
    else if (currentPage === "phrases" && currentLang) {
      await bridge.rebuildPageContainer(buildScenarioGroupPage(currentLang, speakLang));
      await pushLangSprite(bridge, currentLang);
      currentPage = "groups";
      currentGroupIdx = -1;
      lastNavigationTime = Date.now();
      log("< Back to groups", "success");
    }
    else if (currentPage === "groups") {
      // Back to languages page
      await bridge.rebuildPageContainer(buildLanguagesPage());
      await pushLogoToGlasses(bridge, baseUrl);
      currentPage = "languages";
      currentLang = null;
      currentGroupIdx = -1;
      lastNavigationTime = Date.now();
      log("< Back to languages", "success");
    }
    else if (currentPage === "dialogue-hud") {
      // Back from live conversation → speak language select
      await bridge.rebuildPageContainer(buildSpeakSelectPage());
      await pushLogoToGlasses(bridge, baseUrl);
      currentPage = "speak-select";
      speakTargetLang = null;
      lastNavigationTime = Date.now();
      log("< Back to speak select", "success");
    }
    else if (currentPage === "speak-select" || currentPage === "languages" || currentPage === "library" || currentPage === "mother-tongue") {
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
  }
}

// ═══ PUSH LANGUAGE SPRITE ═══
async function pushLangSprite(bridge: EvenAppBridge, lang: LangCode): Promise<void> {
  const label = `${LANG_FLAG[lang]} ${LANG_LABEL[lang]}`;
  // Render the language name as a text sprite into the image containers
  await pushTextSprite(bridge, label, 3, "lang-sprite-top", 190, 95, 20);
}

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

// ═══ HANDLE CLICK ═══
async function handleClick(bridge: EvenAppBridge, idx: number, baseUrl: string): Promise<void> {
  if (navigating) return;
  navigating = true;

  try {
    log(`[CLICK] page=${currentPage} idx=${idx}`);

    // ── HOME: main menu (Speak / Languages / Library / Quiz / Settings) ──
    if (currentPage === "home") {
      if (idx === 0) {
        // Speak — select the language of the person you're talking to
        await bridge.rebuildPageContainer(buildSpeakSelectPage());
        await pushLogoToGlasses(bridge, baseUrl);
        currentPage = "speak-select";
        lastNavigationTime = Date.now();
        log("> Speak: select language", "success");
      } else if (idx === 1) {
        // Languages — phrase browsing
        await bridge.rebuildPageContainer(buildLanguagesPage());
        await pushLogoToGlasses(bridge, baseUrl);
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

    // ── SPEAK SELECT: pick the language of who you're talking to ──
    // Then open Dialogue HUD with mic active
    if (currentPage === "speak-select") {
      if (idx === LANG_CODES.length) {
        // Back
        navigating = false;
        await goBack(bridge, baseUrl);
        return;
      }
      if (idx >= 0 && idx < LANG_CODES.length) {
        speakTargetLang = LANG_CODES[idx];
        const langLabel = LANG_LABEL[speakTargetLang];
        const langFlag = LANG_FLAG[speakTargetLang];
        // Open Dialogue HUD — mic activates, live TTS + AI response suggestions
        await bridge.rebuildPageContainer(buildDialogueHUDPage({
          detectedLang: `${langFlag} ${langLabel}`,
          translation: "Listening...",
          suggestions: ["Waiting for speech..."],
        }));
        currentPage = "dialogue-hud";
        lastNavigationTime = Date.now();
        log(`> Dialogue HUD: ${langLabel} — mic active`, "success");
        // TODO: activate mic, start TTS pipeline, wire AI response generation
      }
      return;
    }

    // ── DIALOGUE HUD: tap a suggested response ──
    if (currentPage === "dialogue-hud") {
      // User selected a response from the AI suggestions list
      // TODO: speak the selected response via TTS output,
      //       update the HUD with follow-up suggestions
      log(`[DIALOGUE] Selected response idx=${idx}`);
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
        await bridge.rebuildPageContainer(buildScenarioGroupPage(currentLang, speakLang));
        await pushLangSprite(bridge, currentLang);
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
        await bridge.rebuildPageContainer(buildPhraseListPage(currentLang, currentGroupIdx, speakLang));
        await pushLangSprite(bridge, currentLang);
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
  }
  // Other pages: scroll is handled natively by list containers
}

// ═══ EVENT DISPATCHER ═══
async function handleEvent(bridge: EvenAppBridge, event: EvenHubEvent, baseUrl: string): Promise<void> {

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

    // Ignore scroll on list pages (native list handles it)
    if (type === OsEventTypeList.SCROLL_TOP_EVENT || type === OsEventTypeList.SCROLL_BOTTOM_EVENT) return;

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
    await pushLangSprite(bridgeRef, currentLang);
    log(`Glasses updated → ${LANG_LABEL[currentLang]} groups`, "success");
  }
  else if (currentPage === "phrases" && currentLang && currentGroupIdx >= 0) {
    currentLang = learnLang;
    await bridgeRef.rebuildPageContainer(buildPhraseListPage(currentLang, currentGroupIdx, speakLang));
    await pushLangSprite(bridgeRef, currentLang);
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
    await pushLogoToGlasses(bridgeRef, baseUrl);
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

// ═══ SPEAK MODE — start live conversation from dashboard ═══

/** Start Speak mode: push speak-select page to glasses, open from dashboard */
export async function startSpeakSelect(): Promise<void> {
  if (!bridgeRef) { log("[SPEAK] No bridge", "error"); return; }
  await bridgeRef.rebuildPageContainer(buildSpeakSelectPage());
  await pushLogoToGlasses(bridgeRef, baseUrlRef);
  currentPage = "speak-select";
  lastNavigationTime = Date.now();
  log("> Speak: select language (from dashboard)", "success");
}

/** Whether the Dialogue HUD layout has been established (first render done) */
let dialogueHUDReady = false;

/** Start Dialogue HUD: push live conversation page to glasses */
export async function startDialogueHUD(targetLang: LangCode): Promise<void> {
  if (!bridgeRef) { log("[SPEAK] No bridge", "error"); return; }
  speakTargetLang = targetLang;
  dialogueHUDReady = false;
  const langLabel = LANG_LABEL[targetLang];
  const langFlag = LANG_FLAG[targetLang];

  const initialTranslation = "Listening...";
  const initialSuggestions = ["Waiting for speech..."];

  const page = buildDialogueHUDPage({
    detectedLang: `${langFlag} ${langLabel}`,
    translation: initialTranslation,
    suggestions: initialSuggestions,
  });

  // First render: force full rebuild to establish the layout
  await smartUpdate({
    page,
    textUpdates: [
      { containerID: 42, containerName: "dlg-lang-name", content: `${langFlag} ${langLabel}` },
      { containerID: 43, containerName: "dlg-tts-text", content: initialTranslation },
    ],
    forceRebuild: true,
  });

  // Snapshot the text containers so future updates use the fast path
  snapshotTextContainers([
    { containerID: 42, containerName: "dlg-lang-name", content: `${langFlag} ${langLabel}` },
    { containerID: 43, containerName: "dlg-tts-text", content: initialTranslation },
  ]);

  dialogueHUDReady = true;
  currentPage = "dialogue-hud";
  lastNavigationTime = Date.now();
  log(`> Dialogue HUD: ${langLabel} — mic active`, "success");
}

/**
 * Update Dialogue HUD with new TTS translation and AI suggestions.
 *
 * ADAPTIVE RENDERING:
 *   - If only translation text changed → textContainerUpgrade (~20fps, no flicker)
 *   - If suggestions list changed (different count) → rebuildPageContainer (~5fps)
 *   - Engine decides automatically via smartUpdate()
 */
export async function updateDialogueHUD(
  translation: string,
  suggestions: string[],
): Promise<void> {
  if (!bridgeRef || !speakTargetLang) return;
  const langLabel = LANG_LABEL[speakTargetLang];
  const langFlag = LANG_FLAG[speakTargetLang];

  const page = buildDialogueHUDPage({
    detectedLang: `${langFlag} ${langLabel}`,
    translation,
    suggestions,
  });

  // Smart update: engine will use textContainerUpgrade if only text changed,
  // or full rebuild if the suggestion list count changed (layout shift)
  const mode = await smartUpdate({
    page,
    textUpdates: [
      { containerID: 43, containerName: "dlg-tts-text", content: translation },
      // Note: suggestion list (containerID 45) is a ListContainer, not text —
      // list content changes always need a full rebuild.
      // But the TTS text (containerID 43) updates instantly via text-upgrade.
    ],
    forceRebuild: !dialogueHUDReady,
  });

  log(`[HUD] ${mode}: "${translation.slice(0, 35)}..." + ${suggestions.length} suggestions`);
}

/** End Speak mode: go back to home */
export async function endSpeakMode(): Promise<void> {
  if (!bridgeRef) return;
  speakTargetLang = null;
  await goHome(bridgeRef, baseUrlRef);
  log("< Speak mode ended", "success");
}
