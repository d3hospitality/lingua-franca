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
  LANG_CODES, LANG_LABEL, LANG_FLAG, PHRASE_KEYS, TR, TR_ROM,
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
export const HOME_MENU_ITEMS = ["🌐 Languages", "📖 Library", "🧠 Quiz"];

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
// HOME — 5 containers
//   2 = language list (left side)
//   3 = logo top (190×95)
//   4 = logo bottom (190×95)
//   5 = "Lingua Franca" tagline
//   6 = "Real-world fluency" tagline
// ══════════════════════════════════════════════════════════════════

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

  const logoTop = new ImageContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_TOP_Y, width: PANEL_W, height: PANEL_HALF_H,
    containerID: 3, containerName: "logo-top",
  });

  const logoBottom = new ImageContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_BOT_Y, width: PANEL_W, height: PANEL_HALF_H,
    containerID: 4, containerName: "logo-bottom",
  });

  const tagLine1 = new TextContainerProperty({
    xPosition: 297, yPosition: PANEL_TAG_Y, width: 280, height: 30,
    containerID: 5, containerName: "tag1",
    content: "Real-world fluency",
    isEventCapture: 0,
  });

  const tagLine2 = new TextContainerProperty({
    xPosition: 310, yPosition: PANEL_TAG_Y + 25, width: 280, height: 30,
    containerID: 6, containerName: "tag2",
    content: "one scene at a time",
    isEventCapture: 0,
  });

  return { menuList, logoTop, logoBottom, tagLine1, tagLine2 };
}

export function buildHomePage(): CreateStartUpPageContainer {
  const c = homeContainers();
  return new CreateStartUpPageContainer({
    containerTotalNum: 5,
    listObject: [c.menuList],
    textObject: [c.tagLine1, c.tagLine2],
    imageObject: [c.logoTop, c.logoBottom],
  });
}

export function rebuildHomePage(): RebuildPageContainer {
  const c = homeContainers();
  return new RebuildPageContainer({
    containerTotalNum: 5,
    listObject: [c.menuList],
    textObject: [c.tagLine1, c.tagLine2],
    imageObject: [c.logoTop, c.logoBottom],
  });
}

// ══════════════════════════════════════════════════════════════════
// LANGUAGES PAGE — alphabetical language list
//   2 = language list + Back (left side)
//   3 = logo top
//   4 = logo bottom
//   5 = info text ("20 Languages")
// ══════════════════════════════════════════════════════════════════

export function buildLanguagesPage(): RebuildPageContainer {
  const listItems = [...LANG_LIST_ITEMS, BACK_LABEL];

  const langList = new ListContainerProperty({
    xPosition: 2, yPosition: 2, width: 290, height: 254,
    containerID: 2, containerName: "lang-list",
    itemContainer: new ListItemContainerProperty({
      itemCount: listItems.length,
      itemWidth: 0,
      isItemSelectBorderEn: 1,
      itemName: listItems,
    }),
    isEventCapture: 1,
  });

  const logoTop = new ImageContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_TOP_Y, width: PANEL_W, height: PANEL_HALF_H,
    containerID: 3, containerName: "logo-top",
  });

  const logoBottom = new ImageContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_BOT_Y, width: PANEL_W, height: PANEL_HALF_H,
    containerID: 4, containerName: "logo-bottom",
  });

  const infoText = new TextContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_TAG_Y, width: 274, height: 50,
    containerID: 5, containerName: "info",
    content: `${LANG_LIST_ITEMS.length} Languages`,
    isEventCapture: 0,
  });

  return new RebuildPageContainer({
    containerTotalNum: 4,
    listObject: [langList],
    textObject: [infoText],
    imageObject: [logoTop, logoBottom],
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
//   3 = text sprite top (language flag/name rendered as image)
//   4 = text sprite bottom
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

  const spriteTop = new ImageContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_TOP_Y, width: PANEL_W, height: PANEL_HALF_H,
    containerID: 3, containerName: "lang-sprite-top",
  });

  const spriteBot = new ImageContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_BOT_Y, width: PANEL_W, height: PANEL_HALF_H,
    containerID: 4, containerName: "lang-sprite-bot",
  });

  const totalPhrases = SCENARIO_GROUPS.reduce((s, g) => s + g.keys.length, 0);
  const infoText = new TextContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_TAG_Y, width: 274, height: 50,
    containerID: 5, containerName: "info",
    content: `${LANG_FLAG[lang]} ${LANG_LABEL[lang]} · ${totalPhrases} Phrases`,
    isEventCapture: 0,
  });

  return new RebuildPageContainer({
    containerTotalNum: 4,
    listObject: [groupList],
    textObject: [infoText],
    imageObject: [spriteTop, spriteBot],
  });
}

// ══════════════════════════════════════════════════════════════════
// PHRASE LIST — browse phrases in a scenario group
//   2 = phrase list + Back (scrollable, shows English summary)
//   3 = text sprite top (context image)
//   4 = text sprite bottom
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

  const spriteTop = new ImageContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_TOP_Y, width: PANEL_W, height: PANEL_HALF_H,
    containerID: 3, containerName: "ctx-top",
  });

  const spriteBot = new ImageContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_BOT_Y, width: PANEL_W, height: PANEL_HALF_H,
    containerID: 4, containerName: "ctx-bot",
  });

  const infoText = new TextContainerProperty({
    xPosition: PANEL_X, yPosition: PANEL_TAG_Y, width: 274, height: 50,
    containerID: 5, containerName: "info",
    content: `${uiGroupLabel(spk, groupIdx, group.label)} · ${group.keys.length} phrases`,
    isEventCapture: 0,
  });

  return new RebuildPageContainer({
    containerTotalNum: 4,
    listObject: [phraseList],
    textObject: [infoText],
    imageObject: [spriteTop, spriteBot],
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
    const spkFlag = LANG_FLAG[spk] || '🇬🇧';
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
  const spkFlag = LANG_FLAG[spk] || '🇬🇧';
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
