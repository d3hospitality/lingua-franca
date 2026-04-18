// ═══════════════════════════════════════════════════════════════════
// Lingua Franca — Page Builders for G2 Glasses
// Max 4 containers per page (soPHICON pattern)
// Navigation: Home (menu) → Languages → Groups → Phrases → Detail / Quiz
// ═══════════════════════════════════════════════════════════════════

import {
  CreateStartUpPageContainer, RebuildPageContainer,
  ListContainerProperty, TextContainerProperty,
  ImageContainerProperty, ListItemContainerProperty,
} from '@evenrealities/even_hub_sdk';
import {
  LANG_CODES, LANG_LABEL, LANG_FLAG, LANG_NATIVE, I_SPEAK_CODES,
  PHRASE_KEYS, TR, TR_ROM,
  VOCAB, CULTURE, needsRom, needsPhon, langPhrase, langRom, langPhon,
  uiGroupLabel, uiPhraseLabel,
  type LangCode, type PhraseKey, type VocabCategory, type VocabItem,
} from './constants';

const BACK_LABEL = "Back";

// ── Scenario categories for phrase browsing ──
export const SCENARIO_GROUPS = [
  { label: "Social & Greetings", keys: ["flirty_hello","warm_hello","good_to_see","nice_to_meet"] as PhraseKey[] },
  { label: "Food & Drinks",     keys: ["ask_drinks","like_most","try_food","order_drink","food_is","prefer_or","after_dinner","offer_drink","continue_over"] as PhraseKey[] },
  { label: "Compliments",       keys: ["smile_compliment"] as PhraseKey[] },
  { label: "Navigation & Help", keys: ["where_place","polite_help","city_is"] as PhraseKey[] },
  { label: "Formal",            keys: ["formal_thanks"] as PhraseKey[] },
];

// ── Home menu items (main navigation) ──
export const HOME_MENU_ITEMS = ["🗣 Speak", "🌐 Languages", "📖 Library", "🧠 Quiz", "⚙ Settings"];

// ── Language list items (alphabetical) ──
export const LANG_LIST_ITEMS = LANG_CODES.map(
  code => `${LANG_FLAG[code]} ${LANG_LABEL[code]}`
);

// ══════════════════════════════════════════════════════════════════
// Layout constants — matching sommNI panel pattern
// ══════════════════════════════════════════════════════════════════
const PANEL_X = 298;
const PANEL_W = 190;
const PANEL_HALF_H = 95;
const PANEL_TOP_Y = 2;
const PANEL_BOT_Y = PANEL_TOP_Y + PANEL_HALF_H;      // 97
const PANEL_TAG_Y = PANEL_BOT_Y + PANEL_HALF_H;       // 192

// ══════════════════════════════════════════════════════════════════
// HOME — 4 containers
//   2 = menu list (left side)
//   3 = logo (single 190×144 — SDK max image height)
//   5 = "Language / Done Different" tagline
//   6 = "Speak / See / Connect" tagline
// ══════════════════════════════════════════════════════════════════

const LOGO_W = 190;
const LOGO_H = 144;  // SDK max image height

function homeContainers() {
  // Main menu: Languages, Library, Quiz — vertically centered
  const MENU_ITEM_H = 50;
  const menuH = HOME_MENU_ITEMS.length * MENU_ITEM_H;
  const menuY = Math.max(2, Math.floor((288 - menuH) / 2));

  const menuList = new ListContainerProperty({
    xPosition: 2, yPosition: menuY, width: 185, height: Math.max(menuH, 80),
    containerID: 2, containerName: "home-menu",
    itemContainer: new ListItemContainerProperty({
      itemCount: HOME_MENU_ITEMS.length,
      itemWidth: 0,
      isItemSelectBorderEn: 1,
      itemName: [...HOME_MENU_ITEMS],
    }),
    isEventCapture: 1,
  });

  const logo = new ImageContainerProperty({
    xPosition: 336, yPosition: 48, width: 190, height: 144,
    containerID: 3, containerName: "logo",
  });

  const tagLine1 = new TextContainerProperty({
    xPosition: 300, yPosition: 190, width: 270, height: 30,
    containerID: 5, containerName: "tag1",
    content: "Language / Done Different",
    isEventCapture: 0,
  });

  const tagLine2 = new TextContainerProperty({
    xPosition: 300, yPosition: 220, width: 270, height: 30,
    containerID: 6, containerName: "tag2",
    content: "Speak / See / Connect",
    isEventCapture: 0,
  });

  return { menuList, logo, tagLine1, tagLine2 };
}

export function buildHomePage(): CreateStartUpPageContainer {
  const c = homeContainers();
  return new CreateStartUpPageContainer({
    containerTotalNum: 4,
    listObject: [c.menuList],
    textObject: [c.tagLine1, c.tagLine2],
    imageObject: [c.logo],
  });
}

export function rebuildHomePage(): RebuildPageContainer {
  const c = homeContainers();
  return new RebuildPageContainer({
    containerTotalNum: 4,
    listObject: [c.menuList],
    textObject: [c.tagLine1, c.tagLine2],
    imageObject: [c.logo],
  });
}

// ══════════════════════════════════════════════════════════════════
// SPEAK — select the language of the person you're talking to
//   Then mic opens → live TTS + AI dialogue suggestions (RPG logic)
//
//   Layout mirrors Languages page (split-panel pattern):
//   2 = language list + Back (left side, scrollable)
//   3 = logo top (right panel)
//   4 = logo bottom (right panel)
//   5 = context hint ("Select their language · Mic opens automatically")
//
//   Flow: Home → Speak → pick language → Dialogue HUD (mic active)
//
//   Once a language is selected, the system:
//   · Opens the mic and begins listening
//   · Runs live TTS on the other person's speech
//   · Translates into the user's mother tongue
//   · AI generates context-aware response suggestions (Elder Scrolls logic):
//     - world state  = environment (location, event, setting)
//     - quest state   = user's goal (rapport, negotiate, learn, etc.)
//     - NPC disposition = social read of the person (tone, culture, status)
//     - dialogue options = best next moves (ask / reply / support)
//     - hidden variables = urgency, memory, relationship, cultural norms
//   · Displays the Dialogue HUD: their speech (top) + your options (bottom)
//   · Ring scroll to pick a response. Double-tap = dismiss / back.
// ══════════════════════════════════════════════════════════════════

export function buildSpeakSelectPage(highlightIdx?: number): RebuildPageContainer {
  const listItems = [...LANG_LIST_ITEMS, BACK_LABEL];

  const safeIdx = (highlightIdx !== undefined && highlightIdx >= 0 && highlightIdx < LANG_CODES.length)
    ? highlightIdx : 0;
  const code = LANG_CODES[safeIdx];
  const flag = LANG_FLAG[code] || '';
  const name = LANG_LABEL[code] || code;

  const langList = new ListContainerProperty({
    xPosition: 2, yPosition: 2, width: 290, height: 280,
    containerID: 2, containerName: "speak-lang-list",
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length,
      itemWidth: 0,
      isItemSelectBorderEn: 1,
      itemName: listItems,
    }),
    isEventCapture: 1,
  });

  // Big language sprite — same layout as Languages page
  const langSprite = new ImageContainerProperty({
    xPosition: LANG_SPRITE_X,
    yPosition: LANG_SPRITE_Y,
    width: LANG_SPRITE_W,
    height: LANG_SPRITE_H,
    containerID: 3,
    containerName: "speak-sprite",
  });

  const langLabel = new TextContainerProperty({
    xPosition: LANG_SPRITE_X,
    yPosition: LANG_LABEL_Y,
    width: LANG_SPRITE_W,
    height: LANG_LABEL_H,
    containerID: 4,
    containerName: "speak-name",
    content: `🗣 ${flag} ${name}`,
    isEventCapture: 0,
  });

  return new RebuildPageContainer({
    containerTotalNum: 3,
    listObject: [langList],
    textObject: [langLabel],
    imageObject: [langSprite],
  });
}

// ══════════════════════════════════════════════════════════════════
// LANGUAGES PAGE — scrollable list + large dynamic language sprite
//   2 = language list + Back (left, narrow)
//   3 = language sprite (right, as big as possible — updates on scroll)
//   4 = language name label (below sprite)
//
// As user scrolls the list, the sprite + label update to show
// whichever language is currently highlighted.
// ══════════════════════════════════════════════════════════════════

// Right-side sprite: SDK max image is 288×144
const LANG_SPRITE_X = 296;
const LANG_SPRITE_Y = 4;
const LANG_SPRITE_W = 272;   // fits right of the 290-wide list
const LANG_SPRITE_H = 144;   // SDK max image height
const LANG_LABEL_Y  = LANG_SPRITE_Y + LANG_SPRITE_H + 4;  // 152
const LANG_LABEL_H  = 44;

export function buildLanguagesPage(highlightIdx?: number): RebuildPageContainer {
  const listItems = [...LANG_LIST_ITEMS, BACK_LABEL];

  // Figure out which language to show in the sprite
  const safeIdx = (highlightIdx !== undefined && highlightIdx >= 0 && highlightIdx < LANG_CODES.length)
    ? highlightIdx : 0;
  const code = LANG_CODES[safeIdx];
  const flag = LANG_FLAG[code] || '';
  const name = LANG_LABEL[code] || code;

  const langList = new ListContainerProperty({
    xPosition: 2, yPosition: 2, width: 290, height: 280,
    containerID: 2, containerName: "lang-list",
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length,
      itemWidth: 0,
      isItemSelectBorderEn: 1,
      itemName: listItems,
    }),
    isEventCapture: 1,
  });

  // Big language sprite — dynamically pushed via pushLangSprite()
  const langSprite = new ImageContainerProperty({
    xPosition: LANG_SPRITE_X,
    yPosition: LANG_SPRITE_Y,
    width: LANG_SPRITE_W,
    height: LANG_SPRITE_H,
    containerID: 3,
    containerName: "lang-sprite",
  });

  // Language name label below the sprite
  const langLabel = new TextContainerProperty({
    xPosition: LANG_SPRITE_X,
    yPosition: LANG_LABEL_Y,
    width: LANG_SPRITE_W,
    height: LANG_LABEL_H,
    containerID: 4,
    containerName: "lang-name",
    content: `${flag} ${name}`,
    isEventCapture: 0,
  });

  return new RebuildPageContainer({
    containerTotalNum: 3,
    listObject: [langList],
    textObject: [langLabel],
    imageObject: [langSprite],
  });
}

/** Export sprite dimensions so events.ts can push to the right container */
export const LANG_PAGE_SPRITE = {
  containerID: 3,
  containerName: "lang-sprite",
  width: LANG_SPRITE_W,
  height: LANG_SPRITE_H,
  labelID: 4,
  labelName: "lang-name",
};

// ══════════════════════════════════════════════════════════════════
// MOTHER TONGUE PAGE — select "I speak" language from glasses
//   2 = language list + Back (scrollable)
//   3 = title text ("Select My Mother Tongue")
// ══════════════════════════════════════════════════════════════════

export const MOTHER_TONGUE_ITEMS = I_SPEAK_CODES.map(code => {
  const flag = LANG_FLAG[code] || '';
  const native = LANG_NATIVE[code] || LANG_LABEL[code] || code;
  const label = LANG_LABEL[code] || code;
  return native === label ? `${flag} ${native}` : `${flag} ${native} — ${label}`;
});

export function buildMotherTonguePage(currentSpeakLang?: string): RebuildPageContainer {
  const listItems = [...MOTHER_TONGUE_ITEMS, BACK_LABEL];

  const langList = new ListContainerProperty({
    xPosition: 2, yPosition: 2, width: 400, height: 254,
    containerID: 2, containerName: "tongue-list",
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length,
      itemWidth: 0,
      isItemSelectBorderEn: 1,
      itemName: listItems,
    }),
    isEventCapture: 1,
  });

  const currentFlag = LANG_FLAG[currentSpeakLang || 'en'] || '🇺🇸';
  const currentName = LANG_NATIVE[currentSpeakLang || 'en'] || 'English';

  const titleText = new TextContainerProperty({
    xPosition: 410, yPosition: 2, width: 160, height: 80,
    containerID: 3, containerName: "tongue-title",
    content: `Select My\nMother Tongue\n\nCurrent:\n${currentFlag} ${currentName}`,
    isEventCapture: 0,
  });

  return new RebuildPageContainer({
    containerTotalNum: 2,
    listObject: [langList],
    textObject: [titleText],
  });
}

// ══════════════════════════════════════════════════════════════════
// LIBRARY PAGE (on glasses) — show saved phrases list
//   2 = phrase list + Back
//   3 = info text
// ══════════════════════════════════════════════════════════════════

export function buildLibraryPage(phrases: { en: string; native: string }[]): RebuildPageContainer {
  const items = phrases.length > 0
    ? [...phrases.map(p => p.en.slice(0, 30)), BACK_LABEL]
    : ["No saved phrases", BACK_LABEL];

  const phraseList = new ListContainerProperty({
    xPosition: 2, yPosition: 2, width: 400, height: 254,
    containerID: 2, containerName: "library-list",
    itemContainer: new ListItemContainerProperty({
      itemCount: items.length,
      itemWidth: 0,
      isItemSelectBorderEn: 1,
      itemName: items,
    }),
    isEventCapture: 1,
  });

  const infoText = new TextContainerProperty({
    xPosition: 410, yPosition: 2, width: 160, height: 50,
    containerID: 3, containerName: "lib-info",
    content: `📖 ${phrases.length} Saved`,
    isEventCapture: 0,
  });

  return new RebuildPageContainer({
    containerTotalNum: 2,
    listObject: [phraseList],
    textObject: [infoText],
  });
}

// ══════════════════════════════════════════════════════════════════
// SCENARIO GROUP LIST — pick a category after selecting language
//   2 = group list + Back  (left side)
//   3 = language sprite (single 190×144, SDK max)
//   5 = info text ("Japanese · 18 Phrases")
// ══════════════════════════════════════════════════════════════════

export function buildScenarioGroupPage(lang: LangCode, speakLangCode?: string): RebuildPageContainer {
  const spk = speakLangCode || 'en';
  const labels = SCENARIO_GROUPS.map((g, i) => uiGroupLabel(spk, i, g.label));
  const listItems = [...labels, BACK_LABEL];

  const groupList = new ListContainerProperty({
    xPosition: 2, yPosition: 2, width: 294, height: 254,
    containerID: 2, containerName: "groups",
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length,
      itemWidth: 0,
      isItemSelectBorderEn: 1,
      itemName: listItems,
    }),
    isEventCapture: 1,
  });

  const langSprite = new ImageContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_TOP_Y, width: PANEL_W, height: LOGO_H,
    containerID: 3, containerName: "lang-sprite",
  });

  const totalPhrases = SCENARIO_GROUPS.reduce((s, g) => s + g.keys.length, 0);
  const infoText = new TextContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_TAG_Y, width: 274, height: 50,
    containerID: 5, containerName: "info",
    content: `${LANG_FLAG[lang]} ${LANG_LABEL[lang]} · ${totalPhrases} Phrases`,
    isEventCapture: 0,
  });

  return new RebuildPageContainer({
    containerTotalNum: 3,
    listObject: [groupList],
    textObject: [infoText],
    imageObject: [langSprite],
  });
}

// ══════════════════════════════════════════════════════════════════
// PHRASE LIST — browse phrases in a scenario group
//   2 = phrase list + Back (scrollable, shows English summary)
//   3 = scene sprite (single 190×144, SDK max)
//   5 = info text ("Social & Greetings · 4 phrases")
// ══════════════════════════════════════════════════════════════════

/** Get a short English label for a phrase key */
function phraseLabel(key: PhraseKey): string {
  const labels: Record<PhraseKey, string> = {
    flirty_hello: "Flirty hello",
    warm_hello: "Warm hello",
    ask_drinks: "Ask about drinks",
    like_most: "What I like most",
    smile_compliment: "Smile compliment",
    try_food: "Try the food here",
    after_dinner: "After dinner",
    polite_help: "Ask for help",
    where_place: "Where is...?",
    order_drink: "Order a drink",
    city_is: "This city is...",
    formal_thanks: "Formal thanks",
    offer_drink: "Offer a drink",
    continue_over: "Continue over food",
    good_to_see: "Good to see you",
    food_is: "This food is...",
    nice_to_meet: "Nice to meet you",
    prefer_or: "Do you prefer...?",
  };
  return labels[key] || key;
}

export function buildPhraseListPage(lang: LangCode, groupIdx: number, speakLangCode?: string): RebuildPageContainer {
  const spk = speakLangCode || 'en';
  const group = SCENARIO_GROUPS[groupIdx];
  const listItems = [...group.keys.map(k => uiPhraseLabel(spk, k, phraseLabel(k))), BACK_LABEL];

  const phraseList = new ListContainerProperty({
    xPosition: 2, yPosition: 2, width: 294, height: 254,
    containerID: 2, containerName: "phrases",
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length,
      itemWidth: 0,
      isItemSelectBorderEn: 1,
      itemName: listItems,
    }),
    isEventCapture: 1,
  });

  const sceneSprite = new ImageContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_TOP_Y, width: PANEL_W, height: LOGO_H,
    containerID: 3, containerName: "scene-sprite",
  });

  const infoText = new TextContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_TAG_Y, width: 274, height: 50,
    containerID: 5, containerName: "info",
    content: `${uiGroupLabel(spk, groupIdx, group.label)} · ${group.keys.length} phrases`,
    isEventCapture: 0,
  });

  return new RebuildPageContainer({
    containerTotalNum: 3,
    listObject: [phraseList],
    textObject: [infoText],
    imageObject: [sceneSprite],
  });
}

// ══════════════════════════════════════════════════════════════════
// PHRASE DETAIL — show a single phrase with translation + romanization
//   2 = English text (top area)
//   3 = Native text (middle area, larger)
//   4 = Romanized text (below native, if applicable)
//   5 = Navigation hint ("Double-tap = Back")
// ══════════════════════════════════════════════════════════════════

/** Pick a random vocab item, returning both en and tr (and rom if available) */
function pickVocab(arr: VocabItem[]): VocabItem {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Shared slot categories for consistent picking across en + native */
export type SlotCategory = "DRINKS"|"FOOD"|"DESSERT"|"ADJ_TASTE"|"GREETING"|"COMPLIMENT"|"PLACE";
const SLOT_RE = /\[(DRINKS|FOOD|DESSERT|ADJ_TASTE|GREETING|COMPLIMENT|PLACE)\]/;

/** Pre-pick vocab items for all slots in a template, returns ordered picks */
export function pickSlotsForTemplate(template: string, lang: LangCode): VocabItem[] {
  const vocab = VOCAB[lang];
  if (!vocab) return [];
  const picks: VocabItem[] = [];
  let remaining = template;
  let match: RegExpExecArray | null;
  while ((match = SLOT_RE.exec(remaining)) !== null) {
    const cat = match[1] as SlotCategory;
    picks.push(pickVocab(vocab[cat]));
    remaining = remaining.slice(match.index + match[0].length);
  }
  return picks;
}

/** Fill a phrase template with pre-picked vocab (native side) */
export function fillSlots(template: string, lang: LangCode, prePicked?: VocabItem[]): string {
  const vocab = VOCAB[lang];
  if (!vocab) return template;

  if (prePicked && prePicked.length > 0) {
    let result = template;
    let pickIdx = 0;
    let match: RegExpExecArray | null;
    while ((match = SLOT_RE.exec(result)) !== null && pickIdx < prePicked.length) {
      result = result.slice(0, match.index) + prePicked[pickIdx].tr + result.slice(match.index + match[0].length);
      pickIdx++;
    }
    return result;
  }

  // Fallback: random picks (original behavior)
  let result = template;
  const pick = (arr: { tr: string }[]) => arr[Math.floor(Math.random() * arr.length)].tr;
  while (result.includes("[DRINKS]"))    result = result.replace("[DRINKS]",    pick(vocab.DRINKS));
  while (result.includes("[FOOD]"))      result = result.replace("[FOOD]",      pick(vocab.FOOD));
  while (result.includes("[DESSERT]"))   result = result.replace("[DESSERT]",   pick(vocab.DESSERT));
  while (result.includes("[ADJ_TASTE]")) result = result.replace("[ADJ_TASTE]", pick(vocab.ADJ_TASTE));
  while (result.includes("[GREETING]"))  result = result.replace("[GREETING]",  pick(vocab.GREETING));
  while (result.includes("[COMPLIMENT]"))result = result.replace("[COMPLIMENT]",pick(vocab.COMPLIMENT));
  while (result.includes("[PLACE]"))     result = result.replace("[PLACE]",     pick(vocab.PLACE));
  return result;
}

/** Fill a romanization template with pre-picked vocab (uses .rom, falls back to .tr) */
export function fillSlotsRom(template: string, lang: LangCode, prePicked?: VocabItem[]): string {
  const vocab = VOCAB[lang];
  if (!vocab) return template;

  if (prePicked && prePicked.length > 0) {
    let result = template;
    let pickIdx = 0;
    let match: RegExpExecArray | null;
    while ((match = SLOT_RE.exec(result)) !== null && pickIdx < prePicked.length) {
      const word = prePicked[pickIdx].rom || prePicked[pickIdx].tr;
      result = result.slice(0, match.index) + word + result.slice(match.index + match[0].length);
      pickIdx++;
    }
    return result;
  }

  // Fallback: random picks using rom
  let result = template;
  const pick = (arr: VocabItem[]) => {
    const item = arr[Math.floor(Math.random() * arr.length)];
    return item.rom || item.tr;
  };
  while (result.includes("[DRINKS]"))    result = result.replace("[DRINKS]",    pick(vocab.DRINKS));
  while (result.includes("[FOOD]"))      result = result.replace("[FOOD]",      pick(vocab.FOOD));
  while (result.includes("[DESSERT]"))   result = result.replace("[DESSERT]",   pick(vocab.DESSERT));
  while (result.includes("[ADJ_TASTE]")) result = result.replace("[ADJ_TASTE]", pick(vocab.ADJ_TASTE));
  while (result.includes("[GREETING]"))  result = result.replace("[GREETING]",  pick(vocab.GREETING));
  while (result.includes("[COMPLIMENT]"))result = result.replace("[COMPLIMENT]",pick(vocab.COMPLIMENT));
  while (result.includes("[PLACE]"))     result = result.replace("[PLACE]",     pick(vocab.PLACE));
  return result;
}

/** Fill a phonetic template with pre-picked vocab (uses .phon, falls back to .rom, then .tr) */
export function fillSlotsPhon(template: string, lang: LangCode, prePicked?: VocabItem[]): string {
  const vocab = VOCAB[lang];
  if (!vocab) return template;

  if (prePicked && prePicked.length > 0) {
    let result = template;
    let pickIdx = 0;
    let match: RegExpExecArray | null;
    while ((match = SLOT_RE.exec(result)) !== null && pickIdx < prePicked.length) {
      const word = prePicked[pickIdx].phon || prePicked[pickIdx].rom || prePicked[pickIdx].tr;
      result = result.slice(0, match.index) + word + result.slice(match.index + match[0].length);
      pickIdx++;
    }
    return result;
  }

  // Fallback: random picks using phon
  let result = template;
  const pick = (arr: VocabItem[]) => {
    const item = arr[Math.floor(Math.random() * arr.length)];
    return item.phon || item.rom || item.tr;
  };
  while (result.includes("[DRINKS]"))    result = result.replace("[DRINKS]",    pick(vocab.DRINKS));
  while (result.includes("[FOOD]"))      result = result.replace("[FOOD]",      pick(vocab.FOOD));
  while (result.includes("[DESSERT]"))   result = result.replace("[DESSERT]",   pick(vocab.DESSERT));
  while (result.includes("[ADJ_TASTE]")) result = result.replace("[ADJ_TASTE]", pick(vocab.ADJ_TASTE));
  while (result.includes("[GREETING]"))  result = result.replace("[GREETING]",  pick(vocab.GREETING));
  while (result.includes("[COMPLIMENT]"))result = result.replace("[COMPLIMENT]",pick(vocab.COMPLIMENT));
  while (result.includes("[PLACE]"))     result = result.replace("[PLACE]",     pick(vocab.PLACE));
  return result;
}

/** Fill phonetic slots with UPPERCASE bracket highlighting */
export function fillSlotsPhonHighlighted(template: string, lang: LangCode, prePicked: VocabItem[]): string {
  const vocab = VOCAB[lang];
  if (!vocab) return template;
  let result = template;
  let pickIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = SLOT_RE.exec(result)) !== null && pickIdx < prePicked.length) {
    const word = prePicked[pickIdx].phon || prePicked[pickIdx].rom || prePicked[pickIdx].tr;
    result = result.slice(0, match.index) + `[${word.toUpperCase()}]` + result.slice(match.index + match[0].length);
    pickIdx++;
  }
  return result;
}

/** Fill romanization slots and wrap inserted words with UPPERCASE brackets for highlighting */
export function fillSlotsRomHighlighted(template: string, lang: LangCode, prePicked: VocabItem[]): string {
  const vocab = VOCAB[lang];
  if (!vocab) return template;
  let result = template;
  let pickIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = SLOT_RE.exec(result)) !== null && pickIdx < prePicked.length) {
    const word = prePicked[pickIdx].rom || prePicked[pickIdx].tr;
    result = result.slice(0, match.index) + `[${word.toUpperCase()}]` + result.slice(match.index + match[0].length);
    pickIdx++;
  }
  return result;
}

/** Fill slots and wrap inserted words with UPPERCASE brackets for highlighting */
export function fillSlotsHighlighted(template: string, lang: LangCode, prePicked: VocabItem[]): string {
  const vocab = VOCAB[lang];
  if (!vocab) return template;
  let result = template;
  let pickIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = SLOT_RE.exec(result)) !== null && pickIdx < prePicked.length) {
    const word = `[${prePicked[pickIdx].tr.toUpperCase()}]`;
    result = result.slice(0, match.index) + word + result.slice(match.index + match[0].length);
    pickIdx++;
  }
  return result;
}

export const EN_TEMPLATES: Record<PhraseKey, string> = {
  flirty_hello: "[GREETING], you look really [COMPLIMENT] tonight.",
  warm_hello: "[GREETING], nice to meet you. You look [COMPLIMENT].",
  ask_drinks: "What kind of [DRINKS] do you like?",
  like_most: "I like [DRINKS] the most — very [ADJ_TASTE].",
  smile_compliment: "Your smile is so [COMPLIMENT].",
  try_food: "Want to try the [FOOD] here?",
  after_dinner: "After dinner, how about [DESSERT]?",
  polite_help: "[GREETING], could you help me?",
  where_place: "Where is the nearest [PLACE]?",
  order_drink: "I'd like a [DRINKS], please.",
  city_is: "This city is really [ADJ_TASTE].",
  formal_thanks: "[GREETING], thank you for your time today.",
  offer_drink: "May I offer you a [DRINKS]?",
  continue_over: "Let's continue over [FOOD].",
  good_to_see: "[GREETING]! Great to see you.",
  food_is: "This [FOOD] is very [ADJ_TASTE].",
  nice_to_meet: "[GREETING], nice to meet you.",
  prefer_or: "Do you prefer [DRINKS] or [DRINKS]?",
};

/** Fill an English phrase template with pre-picked or random vocab */
export function fillSlotsEnglish(key: PhraseKey, lang: LangCode, prePicked?: VocabItem[]): string {
  const vocab = VOCAB[lang];
  if (!vocab) return key;

  let result = EN_TEMPLATES[key] || key;

  if (prePicked && prePicked.length > 0) {
    let pickIdx = 0;
    let match: RegExpExecArray | null;
    while ((match = SLOT_RE.exec(result)) !== null && pickIdx < prePicked.length) {
      result = result.slice(0, match.index) + prePicked[pickIdx].en + result.slice(match.index + match[0].length);
      pickIdx++;
    }
    return result;
  }

  // Fallback: random picks
  const pickEn = (arr: VocabItem[]) => arr[Math.floor(Math.random() * arr.length)].en;
  while (result.includes("[DRINKS]"))    result = result.replace("[DRINKS]",    pickEn(vocab.DRINKS));
  while (result.includes("[FOOD]"))      result = result.replace("[FOOD]",      pickEn(vocab.FOOD));
  while (result.includes("[DESSERT]"))   result = result.replace("[DESSERT]",   pickEn(vocab.DESSERT));
  while (result.includes("[ADJ_TASTE]")) result = result.replace("[ADJ_TASTE]", pickEn(vocab.ADJ_TASTE));
  while (result.includes("[GREETING]"))  result = result.replace("[GREETING]",  pickEn(vocab.GREETING));
  while (result.includes("[COMPLIMENT]"))result = result.replace("[COMPLIMENT]",pickEn(vocab.COMPLIMENT));
  while (result.includes("[PLACE]"))     result = result.replace("[PLACE]",     pickEn(vocab.PLACE));
  return result;
}

/** Get all slot categories in order for a phrase template */
export function getSlotCategories(key: PhraseKey): SlotCategory[] {
  const template = EN_TEMPLATES[key] || "";
  const cats: SlotCategory[] = [];
  let remaining = template;
  let match: RegExpExecArray | null;
  while ((match = SLOT_RE.exec(remaining)) !== null) {
    cats.push(match[1] as SlotCategory);
    remaining = remaining.slice(match.index + match[0].length);
  }
  return cats;
}

/** Fill English template and wrap inserted words with UPPERCASE brackets for highlighting */
export function fillSlotsEnglishHighlighted(key: PhraseKey, lang: LangCode, prePicked: VocabItem[]): string {
  const vocab = VOCAB[lang];
  if (!vocab) return key;
  let result = EN_TEMPLATES[key] || key;
  let pickIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = SLOT_RE.exec(result)) !== null && pickIdx < prePicked.length) {
    const word = `[${prePicked[pickIdx].en.toUpperCase()}]`;
    result = result.slice(0, match.index) + word + result.slice(match.index + match[0].length);
    pickIdx++;
  }
  return result;
}

// ══════════════════════════════════════════════════════════════════
// SPEAKER-LANGUAGE FILL — when I-speak ≠ English
// Cross-references vocab from the speaker's language to fill their side.
// ══════════════════════════════════════════════════════════════════

/** Look up a vocab item in a specific language by English key */
function findVocabInLang(lang: string, cat: SlotCategory, enWord: string): VocabItem | undefined {
  return VOCAB[lang]?.[cat]?.find(v => v.en === enWord);
}

/**
 * Fill a phrase template for the speaker's language using cross-referenced vocab.
 * speakLang = the user's native language (e.g. 'fr')
 * learnLang = the learning target (e.g. 'ja') — used to know which vocab was picked
 * picks = VocabItems picked from VOCAB[learnLang]
 */
export function fillSlotsForSpeaker(
  key: PhraseKey, speakLang: string, picks: VocabItem[],
): string {
  const speakTemplate = TR[speakLang]?.[key];
  if (!speakTemplate) return fillSlotsEnglish(key, speakLang as LangCode, picks);  // fallback to English

  const cats = getSlotCategories(key);
  let result = speakTemplate;
  let pickIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = SLOT_RE.exec(result)) !== null && pickIdx < picks.length) {
    const cat = cats[pickIdx];
    const speakItem = findVocabInLang(speakLang, cat, picks[pickIdx].en);
    const word = speakItem ? speakItem.tr : picks[pickIdx].en;
    result = result.slice(0, match.index) + word + result.slice(match.index + match[0].length);
    pickIdx++;
  }
  return result;
}

/** Fill speaker template with UPPERCASE bracket highlighting */
export function fillSlotsForSpeakerHighlighted(
  key: PhraseKey, speakLang: string, picks: VocabItem[],
): string {
  const speakTemplate = TR[speakLang]?.[key];
  if (!speakTemplate) return fillSlotsEnglishHighlighted(key, speakLang as LangCode, picks);

  const cats = getSlotCategories(key);
  let result = speakTemplate;
  let pickIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = SLOT_RE.exec(result)) !== null && pickIdx < picks.length) {
    const cat = cats[pickIdx];
    const speakItem = findVocabInLang(speakLang, cat, picks[pickIdx].en);
    const word = speakItem ? speakItem.tr.toUpperCase() : picks[pickIdx].en.toUpperCase();
    result = result.slice(0, match.index) + `[${word}]` + result.slice(match.index + match[0].length);
    pickIdx++;
  }
  return result;
}

/** Get the speaker-language slot label (for the list on left) */
export function getSpeakerSlotLabel(speakLang: string, cat: SlotCategory, enWord: string): string {
  if (speakLang === 'en') return enWord.toUpperCase();
  const speakItem = findVocabInLang(speakLang, cat, enWord);
  return (speakItem ? speakItem.tr : enWord).toUpperCase();
}

/** Category emoji for slot list labels */
const CAT_ICON: Record<string, string> = {
  DRINKS: "☕", FOOD: "🍝", DESSERT: "🍰", ADJ_TASTE: "✦",
  GREETING: "👋", COMPLIMENT: "💎", PLACE: "📍",
};

/**
 * Build phrase detail page for glasses.
 * If slotLabels are provided (interactive mode), shows a clickable slot list
 * on the left so the user can tap individual slots to cycle vocab.
 * Right side: EN highlighted + lang label + native highlighted + rom.
 *
 * Layout with slots (576×288):
 *   Left  (x=2,  w=145): ListContainer — slot words as tappable items
 *   Right (x=152, w=420): EN text, lang label, native text, rom text
 *   Bottom full-width: navigation hint
 *
 * Layout without slots: centered text-only (full width).
 */
export function buildPhraseDetailPage(
  lang: LangCode, _key: PhraseKey,
  enText: string, nativeText: string, romText: string,
  enHighlighted?: string, nativeHighlighted?: string,
  slotLabels?: string[], slotCats?: SlotCategory[],
  speakLangCode?: string, romHighlighted?: string,
  phonText?: string, phonHighlighted?: string,
): RebuildPageContainer {
  const maxChars = 200;
  const trunc = (s: string) => s.length > maxChars ? s.slice(0, maxChars - 2) + ".." : s;

  const enDisplay = trunc(enHighlighted || enText);
  const nativeDisplay = trunc(nativeHighlighted || nativeText);
  const romDisplay = romText ? trunc(romHighlighted || romText) : "";
  const phonDisplay = phonText ? trunc(phonHighlighted || phonText) : "";

  // ── Interactive slot layout (list on left, text on right) ──
  // Keeps to 5 containers max: list + en-text + lang-label + native-text + hint
  if (slotLabels && slotLabels.length > 0) {
    const slotItems = slotLabels.map((label, i) => {
      const icon = slotCats ? (CAT_ICON[slotCats[i]] || "↻") : "↻";
      return `${icon} ${label}`;
    });

    // Center the slot list vertically based on item count
    const ITEM_H = 40;
    const listH = Math.max(slotItems.length * ITEM_H, 80);
    const listY = Math.max(2, Math.floor((288 - listH) / 2));

    const slotList = new ListContainerProperty({
      xPosition: 2, yPosition: listY, width: 145, height: listH,
      containerID: 2, containerName: "slot-list",
      itemContainer: new ListItemContainerProperty({
        itemCount: slotItems.length,
        itemWidth: 0,
        isItemSelectBorderEn: 1,
        itemName: slotItems,
      }),
      isEventCapture: 1,
    });

    // Right panel — two labeled sections, each label flush above its phrase
    // Max 5 containers: list + speakLabel + speakText + learnLabel + learnText
    const RX = 152;
    const RW = 420;
    const FULL_H = 288;
    const LABEL_H = 26;
    const GAP = 4;  // gap between speak section and learn section

    const spk = speakLangCode || 'en';
    const spkFlag = LANG_FLAG[spk] || '🇺🇸';
    const spkName = LANG_LABEL[spk] || 'English';

    // Merge romanization into native display to save a container
    // Build learn section: native + rom (if applicable) + phonetic (if applicable)
    const learnLines = [nativeDisplay];
    if (romDisplay) learnLines.push(romDisplay);
    if (phonDisplay) learnLines.push(`🔊 ${phonDisplay}`);
    const nativeFull = learnLines.join('\n');

    // Speak section compact (40% shorter), learn section gets extra room for rom text
    const textZone = FULL_H - (LABEL_H * 2) - GAP;
    const SPEAK_TEXT_H = Math.floor(textZone * 0.38);  // ~88px — compact speaker
    const LEARN_TEXT_H = textZone - SPEAK_TEXT_H;       // ~144px — room for native + rom

    const groupH = LABEL_H + SPEAK_TEXT_H + GAP + LABEL_H + LEARN_TEXT_H;
    const startY = Math.max(2, Math.floor((FULL_H - groupH) / 2));

    let curY = startY;

    // Speaker label — indented for visual depth cue
    const speakLabel = new TextContainerProperty({
      xPosition: RX + 8, yPosition: curY, width: RW - 8, height: LABEL_H,
      containerID: 3, containerName: "speak-label",
      content: `${spkFlag} ${spkName}`,
      isEventCapture: 0,
      borderWidth: 0,
      paddingLength: 2,
    });
    curY += LABEL_H; // flush

    const speakText = new TextContainerProperty({
      xPosition: RX, yPosition: curY, width: RW, height: SPEAK_TEXT_H,
      containerID: 4, containerName: "speak-text",
      content: enDisplay,
      isEventCapture: 0,
      borderWidth: 1,
      borderRadius: 4,
      paddingLength: 4,
    });
    curY += SPEAK_TEXT_H + GAP;

    // Learn label — indented for visual depth cue
    const learnLabel = new TextContainerProperty({
      xPosition: RX + 8, yPosition: curY, width: RW - 8, height: LABEL_H,
      containerID: 5, containerName: "learn-label",
      content: `${LANG_FLAG[lang]} ${LANG_LABEL[lang]}`,
      isEventCapture: 0,
      borderWidth: 0,
      paddingLength: 2,
    });
    curY += LABEL_H; // flush

    const learnText = new TextContainerProperty({
      xPosition: RX, yPosition: curY, width: RW, height: LEARN_TEXT_H,
      containerID: 6, containerName: "learn-text",
      content: nativeFull,
      isEventCapture: 0,
      borderWidth: 1,
      borderRadius: 4,
      paddingLength: 4,
    });

    return new RebuildPageContainer({
      containerTotalNum: 5, // list + 4 texts
      listObject: [slotList],
      textObject: [speakLabel, speakText, learnLabel, learnText],
      imageObject: [],
    });
  }

  // ── Fallback: no slots — centered text-only, two labeled sections ──
  const FW = 568;
  const FULL_H = 288;
  const LABEL_H = 26;
  const GAP = 4;

  const spk = speakLangCode || 'en';
  const spkFlag = LANG_FLAG[spk] || '🇺🇸';
  const spkName = LANG_LABEL[spk] || 'English';

  const nativeFull = romText ? `${nativeDisplay}\n${trunc(romText)}` : nativeDisplay;

  const textZone = FULL_H - (LABEL_H * 2) - GAP;
  const SPEAK_TEXT_H = Math.floor(textZone * 0.38);
  const LEARN_TEXT_H = textZone - SPEAK_TEXT_H;

  const groupH = LABEL_H + SPEAK_TEXT_H + GAP + LABEL_H + LEARN_TEXT_H;
  const startY = Math.max(2, Math.floor((FULL_H - groupH) / 2));

  let curY = startY;

  const speakLabel = new TextContainerProperty({
    xPosition: 12, yPosition: curY, width: FW - 8, height: LABEL_H,
    containerID: 2, containerName: "speak-label",
    content: `${spkFlag} ${spkName}`,
    isEventCapture: 0,
    borderWidth: 0,
    paddingLength: 2,
  });
  curY += LABEL_H;

  const speakText = new TextContainerProperty({
    xPosition: 4, yPosition: curY, width: FW, height: SPEAK_TEXT_H,
    containerID: 3, containerName: "speak-text",
    content: enDisplay,
    isEventCapture: 0,
    borderWidth: 1,
    borderRadius: 4,
    paddingLength: 4,
  });
  curY += SPEAK_TEXT_H + GAP;

  const learnLabel = new TextContainerProperty({
    xPosition: 12, yPosition: curY, width: FW - 8, height: LABEL_H,
    containerID: 4, containerName: "learn-label",
    content: `${LANG_FLAG[lang]} ${LANG_LABEL[lang]}`,
    isEventCapture: 0,
    borderWidth: 0,
    paddingLength: 2,
  });
  curY += LABEL_H;

  const learnText = new TextContainerProperty({
    xPosition: 4, yPosition: curY, width: FW, height: LEARN_TEXT_H,
    containerID: 5, containerName: "learn-text",
    content: nativeFull,
    isEventCapture: 0,
    borderWidth: 1,
    borderRadius: 4,
    paddingLength: 4,
  });

  return new RebuildPageContainer({
    containerTotalNum: 4,
    listObject: [],
    textObject: [speakLabel, speakText, learnLabel, learnText],
    imageObject: [],
  });
}

// ══════════════════════════════════════════════════════════════════
// QUIZ QUESTION — multiple choice on glasses
//   2 = question text (top)
//   3 = options list (scrollable, 4 options)
// ══════════════════════════════════════════════════════════════════

export interface GlassesQuizQuestion {
  question: string;
  options: string[];
  correctIdx: number;
}

export function buildQuizQuestionPage(
  q: GlassesQuizQuestion, qNum: number, totalQ: number,
): RebuildPageContainer {
  const questionText = new TextContainerProperty({
    xPosition: 4, yPosition: 4, width: 568, height: 60,
    containerID: 2, containerName: "question",
    content: `Q${qNum}/${totalQ}: ${q.question}`,
    isEventCapture: 0,
  });

  const optionList = new ListContainerProperty({
    xPosition: 4, yPosition: 70, width: 568, height: 200,
    containerID: 3, containerName: "options",
    itemContainer: new ListItemContainerProperty({
      itemCount: q.options.length,
      itemWidth: 0,
      isItemSelectBorderEn: 1,
      itemName: q.options,
    }),
    isEventCapture: 1,
  });

  return new RebuildPageContainer({
    containerTotalNum: 2,
    listObject: [optionList],
    textObject: [questionText],
    imageObject: [],
  });
}

// ══════════════════════════════════════════════════════════════════
// QUIZ FEEDBACK — correct/wrong + answer
//   2 = feedback text
//   3 = hint to continue
// ══════════════════════════════════════════════════════════════════

export function buildQuizFeedbackPage(correct: boolean, answer: string): RebuildPageContainer {
  const feedbackText = new TextContainerProperty({
    xPosition: 4, yPosition: 30, width: 568, height: 120,
    containerID: 2, containerName: "feedback",
    content: correct ? `Correct! "${answer}"` : `Wrong — answer was: "${answer}"`,
    isEventCapture: 0,
  });

  const hintText = new TextContainerProperty({
    xPosition: 4, yPosition: 200, width: 568, height: 40,
    containerID: 3, containerName: "hint",
    content: "Click = next question  ·  Double-tap = quit",
    isEventCapture: 1,
  });

  return new RebuildPageContainer({
    containerTotalNum: 2,
    listObject: [],
    textObject: [feedbackText, hintText],
    imageObject: [],
  });
}

// ══════════════════════════════════════════════════════════════════
// QUIZ SCORE — final result
//   2 = score summary
//   3 = hint
// ══════════════════════════════════════════════════════════════════

export function buildQuizScorePage(score: number, total: number, lang: string): RebuildPageContainer {
  const pct = Math.round((score / total) * 100);
  const scoreText = new TextContainerProperty({
    xPosition: 4, yPosition: 30, width: 568, height: 100,
    containerID: 2, containerName: "score",
    content: `Quiz complete! ${score}/${total} (${pct}%) — ${lang}`,
    isEventCapture: 0,
  });

  const hintText = new TextContainerProperty({
    xPosition: 4, yPosition: 200, width: 568, height: 40,
    containerID: 3, containerName: "hint",
    content: "Double-tap = Home",
    isEventCapture: 1,
  });

  return new RebuildPageContainer({
    containerTotalNum: 2,
    listObject: [],
    textObject: [scoreText, hintText],
    imageObject: [],
  });
}

// ══════════════════════════════════════════════════════════════════
// DIALOGUE HUD — Real-time conversation assist (Elder Scrolls logic)
//
// Layout (576 × 288):
//   ┌─────────┬──────────────────────────────────────────┐
//   │  #41    │  #42 "SPANISH"  (detected lang, dynamic) │
//   │  flag   │──────────────────────────────────────────│
//   │  image  │  #43 Live TTS of their speech            │
//   │         │  + live translation underneath           │
//   ├─────────┼──────────────────────────────────────────┤
//   │  #44    │  #45 Content-aware response options      │
//   │  my     │  ▸ "What brought you to Seattle?"        │
//   │  flag   │  ▸ "I work in hospitality and AI"        │
//   │  image  │  ▸ "Tell me about your project"          │
//   │         │  (scrollable list — ring scroll)         │
//   └─────────┴──────────────────────────────────────────┘
//
// 5 containers:
//   41 = detected language flag (image, top-left) — updates when lang detected
//   42 = detected language name (text, top) — e.g. "SPANISH", changes dynamically
//   43 = live TTS transcription + translation (text, top-right)
//   44 = user's mother tongue flag (image, bottom-left) — from settings
//   45 = AI response suggestions (list, bottom-right, scrollable, reactive)
//
// Top = what they're saying (their language, live TTS, translation)
// Bottom = what you could say (your language, AI-generated options)
// Ring scroll to pick a response. Double-tap = back.
// ══════════════════════════════════════════════════════════════════

// ── Dialogue HUD layout constants ──
const DLG_IMG_W    = 80;     // width of flag/sprite images
const DLG_IMG_H    = 80;     // height of flag/sprite images
const DLG_PAD      = 4;      // edge padding
const DLG_GAP      = 4;      // gap between image and text area
const DLG_TOP_H    = 138;    // height of top zone (their speech)
const DLG_DIVIDER  = 12;     // divider gap between zones
const DLG_TEXT_X   = DLG_PAD + DLG_IMG_W + DLG_GAP;  // 88
const DLG_TEXT_W   = 576 - DLG_TEXT_X - DLG_PAD;      // 484
const DLG_LABEL_H  = 28;     // language label height
const DLG_BOT_Y    = DLG_PAD + DLG_TOP_H + DLG_DIVIDER;   // 154
const DLG_BOT_H    = 288 - DLG_BOT_Y - DLG_PAD;           // 130 (fits within display)

export interface DialogueHUDOptions {
  /** Detected language label, e.g. "Dutch", "Indonesian" */
  detectedLang: string;
  /** Live TTS translation of what the other person said */
  translation: string;
  /** AI-generated response suggestions (3–5 options) */
  suggestions: string[];
  /** Optional: user's language label, e.g. "English" */
  userLang?: string;
}

export function buildDialogueHUDPage(opts: DialogueHUDOptions): RebuildPageContainer {
  const {
    detectedLang,
    translation,
    suggestions,
    userLang = 'English',
  } = opts;

  // ── Top zone: their speech ──

  // #41 — Detected language flag (top-left, updates when lang detected)
  const langSprite = new ImageContainerProperty({
    xPosition: DLG_PAD,
    yPosition: DLG_PAD,
    width: DLG_IMG_W,
    height: DLG_IMG_H,
    containerID: 41,
    containerName: "dlg-lang-flag",
  });

  // #42 — Detected language name (dynamic — "SPANISH", "DUTCH", etc.)
  const langLabel = new TextContainerProperty({
    xPosition: DLG_TEXT_X,
    yPosition: DLG_PAD,
    width: DLG_TEXT_W,
    height: DLG_LABEL_H,
    containerID: 42,
    containerName: "dlg-lang-name",
    content: detectedLang,
    isEventCapture: 0,
    borderWidth: 0,
  });

  // #43 — Live TTS transcription + translation (top-right, below lang name)
  const ttsText = new TextContainerProperty({
    xPosition: DLG_TEXT_X,
    yPosition: DLG_PAD + DLG_LABEL_H,
    width: DLG_TEXT_W,
    height: DLG_TOP_H - DLG_LABEL_H,
    containerID: 43,
    containerName: "dlg-tts-text",
    content: translation,
    isEventCapture: 0,
    borderWidth: 1,
    borderRadius: 4,
    paddingLength: 4,
  });

  // ── Bottom zone: your responses ──

  // #44 — User's mother tongue flag (bottom-left, from settings or detection)
  const userSprite = new ImageContainerProperty({
    xPosition: DLG_PAD,
    yPosition: DLG_BOT_Y,
    width: DLG_IMG_W,
    height: DLG_IMG_H,
    containerID: 44,
    containerName: "dlg-user-flag",
  });

  // #45 — Content-aware response suggestions (scrollable, reactive)
  const responseList = new ListContainerProperty({
    xPosition: DLG_TEXT_X,
    yPosition: DLG_BOT_Y,
    width: DLG_TEXT_W,
    height: DLG_BOT_H,
    containerID: 45,
    containerName: "dlg-responses",
    itemContainer: new ListItemContainerProperty({
      itemCount: suggestions.length,
      itemWidth: 0,
      isItemSelectBorderEn: 1,
      itemName: suggestions,
    }),
    isEventCapture: 1,  // reactive — ring scroll to select
  });

  return new RebuildPageContainer({
    containerTotalNum: 5,
    listObject: [responseList],
    textObject: [langLabel, ttsText],
    imageObject: [langSprite, userSprite],
  });
}
