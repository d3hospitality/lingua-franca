// ═══════════════════════════════════════════════════════════════════
// Lingua Franca — AI Scenario Phrase Generator
// Uses OpenAI API to generate context-aware bilingual phrases
// with intelligent keyword slots for interactive cycling
// ═══════════════════════════════════════════════════════════════════

import {
  LANG_LABEL, LANG_FLAG, VOCAB, needsRom,
  type LangCode, type VocabItem,
} from './constants';
import { log } from './ui';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface AIPhrase {
  en: string;            // English with [KEYWORD] brackets
  native: string;        // Target language with [KEYWORD] brackets
  rom: string;           // Romanization with [KEYWORD] brackets (if applicable)
  enPlain: string;       // English filled (no brackets)
  nativePlain: string;   // Native filled
  romPlain: string;      // Rom filled
  slots: AISlot[];       // Slot data for interactive cycling
}

export interface AISlot {
  enWord: string;           // Current English word
  nativeWord: string;       // Current native translation
  romWord: string;          // Romanization (if applicable)
  alternatives: AISlotAlt[]; // Other options
}

export interface AISlotAlt {
  en: string;
  native: string;
  rom: string;
}

// ═══════════════════════════════════════════════════════════════════
// API CALL
// ═══════════════════════════════════════════════════════════════════

let apiKey = '';

export function setOpenAIKey(key: string): void {
  apiKey = key;
  log(key ? 'OpenAI API key set' : 'OpenAI API key cleared');
}

export function hasOpenAIKey(): boolean {
  return apiKey.length > 0;
}

export function getOpenAIKey(): string {
  return apiKey;
}

const SYSTEM_PROMPT = `You are a language learning phrase generator for smart glasses. Given a scenario description and a target language, generate 5 practical phrases a traveler would need.

RULES:
1. Each phrase MUST have 1-2 keyword slots wrapped in [BRACKETS] — these are nouns, adjectives, or verbs the user can swap.
2. For each slot, provide 4-6 alternative words (same part of speech, contextually relevant to the scenario).
3. Provide the phrase in English AND the target language.
4. If the target language uses non-Latin script, provide romanization.
5. Phrases should be practical, natural-sounding, and directly relevant to the scenario.
6. Alternatives should be contextually appropriate — e.g., for "buying a car", alternatives for [CAR] would be [VAN], [SUV], [MOTORCYCLE], not [COFFEE].

Respond in this exact JSON format:
{
  "phrases": [
    {
      "en": "I'd like to buy a [CAR], please.",
      "native": "Vorrei comprare un'[AUTO], per favore.",
      "rom": "",
      "slots": [
        {
          "keyword_en": "CAR",
          "keyword_native": "AUTO",
          "keyword_rom": "",
          "alternatives": [
            {"en": "VAN", "native": "FURGONE", "rom": ""},
            {"en": "SUV", "native": "SUV", "rom": ""},
            {"en": "MOTORCYCLE", "native": "MOTO", "rom": ""},
            {"en": "TRUCK", "native": "CAMION", "rom": ""}
          ]
        }
      ]
    }
  ]
}

Only output valid JSON. No markdown, no explanation.`;

export async function generateScenarioPhrases(
  scenario: string,
  lang: LangCode,
): Promise<AIPhrase[]> {
  if (!apiKey) {
    log('No OpenAI API key — set it in Settings', 'error');
    return [];
  }

  const langName = LANG_LABEL[lang] || lang;
  const wantsRom = needsRom(lang);

  const userPrompt = `Scenario: "${scenario}"
Target language: ${langName}
Needs romanization: ${wantsRom ? 'YES (provide rom field for all non-Latin text)' : 'NO (leave rom fields empty)'}

Generate 5 contextually relevant phrases for this scenario with interactive keyword slots.`;

  try {
    log('Generating AI phrases...');

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.8,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      log(`OpenAI API error: ${response.status}`, 'error');
      console.error('OpenAI error:', err);
      return [];
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      log('Empty response from OpenAI', 'error');
      return [];
    }

    // Parse JSON (handle potential markdown wrapping)
    let json: any;
    try {
      const cleaned = content.replace(/^```json\n?/, '').replace(/\n?```$/, '');
      json = JSON.parse(cleaned);
    } catch (e) {
      log('Failed to parse AI response', 'error');
      console.error('Parse error:', e, content);
      return [];
    }

    // Transform to AIPhrase format
    const phrases: AIPhrase[] = (json.phrases || []).map((p: any) => {
      const slots: AISlot[] = (p.slots || []).map((s: any) => ({
        enWord: s.keyword_en || '',
        nativeWord: s.keyword_native || '',
        romWord: s.keyword_rom || '',
        alternatives: (s.alternatives || []).map((a: any) => ({
          en: a.en || '',
          native: a.native || '',
          rom: a.rom || '',
        })),
      }));

      // Build plain versions (slots filled with first keyword)
      let enPlain = p.en || '';
      let nativePlain = p.native || '';
      let romPlain = p.rom || '';

      slots.forEach(slot => {
        enPlain = enPlain.replace(`[${slot.enWord}]`, slot.enWord.toLowerCase());
        nativePlain = nativePlain.replace(`[${slot.nativeWord}]`, slot.nativeWord.toLowerCase());
        if (romPlain && slot.romWord) {
          romPlain = romPlain.replace(`[${slot.romWord}]`, slot.romWord.toLowerCase());
        }
      });

      return {
        en: p.en || '',
        native: p.native || '',
        rom: p.rom || '',
        enPlain,
        nativePlain,
        romPlain,
        slots,
      };
    });

    log(`Generated ${phrases.length} AI phrases`, 'success');
    return phrases;

  } catch (err) {
    log(`AI generation failed: ${err}`, 'error');
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════
// SLOT CYCLING — swap a keyword to next alternative
// ═══════════════════════════════════════════════════════════════════

export function cycleAISlot(phrase: AIPhrase, slotIdx: number): AIPhrase {
  const slot = phrase.slots[slotIdx];
  if (!slot || slot.alternatives.length === 0) return phrase;

  // Find current position in alternatives cycle
  const allOptions = [
    { en: slot.enWord, native: slot.nativeWord, rom: slot.romWord },
    ...slot.alternatives,
  ];
  const currentIdx = allOptions.findIndex(
    a => a.en === slot.enWord && a.native === slot.nativeWord,
  );
  const nextIdx = (currentIdx + 1) % allOptions.length;
  const next = allOptions[nextIdx];

  // Rebuild phrase with swapped word
  const newSlot: AISlot = {
    ...slot,
    enWord: next.en,
    nativeWord: next.native,
    romWord: next.rom,
  };

  const newSlots = [...phrase.slots];
  newSlots[slotIdx] = newSlot;

  // Rebuild display strings
  let en = phrase.en;
  let native = phrase.native;
  let rom = phrase.rom;
  let enPlain = phrase.en;
  let nativePlain = phrase.native;
  let romPlain = phrase.rom;

  // Replace old bracket keywords with new ones
  en = en.replace(`[${slot.enWord}]`, `[${next.en}]`);
  native = native.replace(`[${slot.nativeWord}]`, `[${next.native}]`);
  enPlain = en.replace(/\[([^\]]+)\]/g, (_, w) => w.toLowerCase());
  nativePlain = native.replace(/\[([^\]]+)\]/g, (_, w) => w.toLowerCase());

  if (rom) {
    rom = rom.replace(`[${slot.romWord}]`, `[${next.rom}]`);
    romPlain = rom.replace(/\[([^\]]+)\]/g, (_, w) => w.toLowerCase());
  }

  return { en, native, rom, enPlain, nativePlain, romPlain, slots: newSlots };
}
