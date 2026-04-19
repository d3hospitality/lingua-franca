// ═══════════════════════════════════════════════════════════════════
// Lingua Franca — Sync Bridge (localStorage shared phone + glasses)
// Matches sommNI pattern: SDK bridge getLocalStorage / setLocalStorage
// ═══════════════════════════════════════════════════════════════════

import { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import type { LangCode, PhraseKey, VocabCategory, VocabItem } from './constants';

// ── Storage keys ──
export const STORAGE_KEYS = {
  ACTIVE_LANG:    'lf_active_lang',
  SAVED_PHRASES:  'lf_saved_phrases',
  CUSTOM_WORDS:   'lf_custom_words',
  QUIZ_STATS:     'lf_quiz_stats',
  QUIZ_HISTORY:   'lf_quiz_history',
  SETTINGS:       'lf_settings',
} as const;

let _bridge: EvenAppBridge | null = null;

export function initSync(bridge: EvenAppBridge): void {
  _bridge = bridge;
}

// ── Read / Write JSON — uses SDK bridge if available, falls back to localStorage for sim mode ──

async function loadJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    if (_bridge) {
      const raw = await _bridge.getLocalStorage(key);
      return raw ? JSON.parse(raw) : fallback;
    }
    // Sim mode: use browser localStorage
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

async function saveJSON(key: string, data: unknown): Promise<void> {
  try {
    if (_bridge) {
      await _bridge.setLocalStorage(key, JSON.stringify(data));
    } else {
      // Sim mode: use browser localStorage
      localStorage.setItem(key, JSON.stringify(data));
    }
  } catch (e) { console.error(`[sync] saveJSON(${key}) failed:`, e); }
}

// ═══════════════════════════════════════════════════════════════════
// ACTIVE LANGUAGE — persist last selected language
// ═══════════════════════════════════════════════════════════════════

export async function getActiveLang(): Promise<LangCode | null> {
  return loadJSON(STORAGE_KEYS.ACTIVE_LANG, null);
}

export async function setActiveLang(lang: LangCode): Promise<void> {
  await saveJSON(STORAGE_KEYS.ACTIVE_LANG, lang);
}

// ═══════════════════════════════════════════════════════════════════
// SAVED PHRASES — user's phrase library
// { id, lang, key, en, native, rom, savedAt }
// ═══════════════════════════════════════════════════════════════════

export interface SavedPhrase {
  id: string;
  lang: LangCode;
  key: PhraseKey;
  en: string;
  native: string;
  rom: string;
  savedAt: string;
}

export async function getSavedPhrases(): Promise<SavedPhrase[]> {
  return loadJSON(STORAGE_KEYS.SAVED_PHRASES, []);
}

export async function savePhrase(phrase: Omit<SavedPhrase, 'id' | 'savedAt'>): Promise<SavedPhrase> {
  const phrases = await getSavedPhrases();
  const saved: SavedPhrase = {
    ...phrase,
    id: 'p' + Date.now(),
    savedAt: new Date().toISOString(),
  };
  phrases.unshift(saved);
  if (phrases.length > 500) phrases.length = 500;
  await saveJSON(STORAGE_KEYS.SAVED_PHRASES, phrases);
  return saved;
}

export async function deletePhrase(id: string): Promise<void> {
  const phrases = await getSavedPhrases();
  await saveJSON(STORAGE_KEYS.SAVED_PHRASES, phrases.filter(p => p.id !== id));
}

export async function clearSavedPhrases(): Promise<void> {
  await saveJSON(STORAGE_KEYS.SAVED_PHRASES, []);
}

// ═══════════════════════════════════════════════════════════════════
// CUSTOM WORDS — user-added vocab per language per category
// { [lang]: { [category]: VocabItem[] } }
// ═══════════════════════════════════════════════════════════════════

export type CustomWordsMap = Record<string, Record<string, VocabItem[]>>;

export async function getCustomWords(): Promise<CustomWordsMap> {
  return loadJSON(STORAGE_KEYS.CUSTOM_WORDS, {});
}

export async function addCustomWord(
  lang: LangCode, category: VocabCategory, item: VocabItem,
): Promise<void> {
  const words = await getCustomWords();
  if (!words[lang]) words[lang] = {};
  if (!words[lang][category]) words[lang][category] = [];
  // Avoid duplicates by English key
  if (words[lang][category].some(w => w.en === item.en)) return;
  item.custom = true;
  words[lang][category].push(item);
  await saveJSON(STORAGE_KEYS.CUSTOM_WORDS, words);
}

export async function removeCustomWord(
  lang: LangCode, category: VocabCategory, en: string,
): Promise<void> {
  const words = await getCustomWords();
  if (!words[lang]?.[category]) return;
  words[lang][category] = words[lang][category].filter(w => w.en !== en);
  await saveJSON(STORAGE_KEYS.CUSTOM_WORDS, words);
}

export async function getCustomWordsForLang(
  lang: LangCode,
): Promise<Record<string, VocabItem[]>> {
  const words = await getCustomWords();
  return words[lang] || {};
}

// ═══════════════════════════════════════════════════════════════════
// QUIZ STATS — { totalAnswered, totalCorrect, byLang: { [lang]: { answered, correct } } }
// ═══════════════════════════════════════════════════════════════════

export interface QuizStats {
  totalAnswered: number;
  totalCorrect: number;
  byLang: Record<string, { answered: number; correct: number }>;
}

export async function getQuizStats(): Promise<QuizStats> {
  return loadJSON(STORAGE_KEYS.QUIZ_STATS, {
    totalAnswered: 0, totalCorrect: 0, byLang: {},
  });
}

export async function recordQuizResult(lang: LangCode, correct: boolean): Promise<void> {
  const stats = await getQuizStats();
  stats.totalAnswered++;
  if (correct) stats.totalCorrect++;
  if (!stats.byLang[lang]) stats.byLang[lang] = { answered: 0, correct: 0 };
  stats.byLang[lang].answered++;
  if (correct) stats.byLang[lang].correct++;
  await saveJSON(STORAGE_KEYS.QUIZ_STATS, stats);
}

// ═══════════════════════════════════════════════════════════════════
// QUIZ HISTORY — dated sessions
// { id, lang, date, score, total, pct }
// ═══════════════════════════════════════════════════════════════════

export interface QuizSession {
  id: string;
  lang: LangCode;
  date: string;
  score: number;
  total: number;
  pct: number;
}

export async function getQuizHistory(): Promise<QuizSession[]> {
  return loadJSON(STORAGE_KEYS.QUIZ_HISTORY, []);
}

export async function recordQuizSession(
  lang: LangCode, score: number, total: number,
): Promise<void> {
  const history = await getQuizHistory();
  history.unshift({
    id: 'qh' + Date.now(),
    lang,
    date: new Date().toISOString(),
    score,
    total,
    pct: Math.round((score / total) * 100),
  });
  if (history.length > 200) history.length = 200;
  await saveJSON(STORAGE_KEYS.QUIZ_HISTORY, history);
}

// ═══════════════════════════════════════════════════════════════════
// SETTINGS — general app preferences
// ═══════════════════════════════════════════════════════════════════

export interface AppSettings {
  motherTongue: string;  // "en" default
  showRomanization: boolean;
  quizDifficulty: "easy" | "medium" | "hard";
  theme: string;  // "somni" default
  openaiKey: string;  // OpenAI API key for GPT response suggestions
  pulseKey: string;   // Deepgram API key for live STT
}

export async function getSettings(): Promise<AppSettings> {
  return loadJSON(STORAGE_KEYS.SETTINGS, {
    motherTongue: "en",
    showRomanization: true,
    quizDifficulty: "medium",
    theme: "somni",
    openaiKey: "",
    pulseKey: "7fa17b63f8de9ad80f94aac53e43c7f39b475166",
  });
}

export async function saveSettings(settings: Partial<AppSettings>): Promise<void> {
  const current = await getSettings();
  await saveJSON(STORAGE_KEYS.SETTINGS, { ...current, ...settings });
}
