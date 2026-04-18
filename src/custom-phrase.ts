// ═══════════════════════════════════════════════════════════════════
// Lingua Franca — Custom Phrase Builder (Bilingual)
// Pick a template → customize slot words → preview in both languages
// Saved phrases dynamically re-translate when languages change
// ═══════════════════════════════════════════════════════════════════

import {
  RebuildPageContainer,
  TextContainerProperty,
  ListContainerProperty,
  ListItemContainerProperty,
} from '@evenrealities/even_hub_sdk';
import {
  LANG_CODES, LANG_LABEL, LANG_FLAG, VOCAB, needsRom,
  langPhrase, langRom,
  type LangCode, type VocabItem,
} from './constants';
import {
  EN_TEMPLATES, fillSlotsEnglish, fillSlotsEnglishHighlighted,
  fillSlots, fillSlotsRom, fillSlotsHighlighted,
  fillSlotsForSpeaker, fillSlotsForSpeakerHighlighted,
  getSpeakerSlotLabel, pickSlotsForTemplate, getSlotCategories,
  type SlotCategory,
} from './pages';
import type { PhraseKey } from './constants';
import { log } from './ui';

// ═══════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════

let activeLang: LangCode = 'ja';    // learning target
let speakLangCode: string = 'en';    // mother tongue

// Template mode state
let selectedKey: PhraseKey | null = null;
let slotCats: SlotCategory[] = [];
let slotIdxs: number[] = [];         // index into VOCAB[activeLang][cat]

// Generated texts
let speakText = '';
let speakTextHL = '';
let learnText = '';
let learnTextHL = '';
let romText = '';

// Callback for pushing to glasses
let pushToGlassesFn: ((page: RebuildPageContainer) => Promise<void>) | null = null;

// ═══════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════

export function initCustomPhraseBuilder(lang: LangCode): void {
  activeLang = lang;

  // Template dropdown
  const templateSelect = document.getElementById('custom-template-select') as HTMLSelectElement;
  if (templateSelect) {
    templateSelect.innerHTML = '<option value="">— Pick a phrase template —</option>';
    const keys = Object.keys(EN_TEMPLATES) as PhraseKey[];
    keys.forEach(key => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = EN_TEMPLATES[key];
      templateSelect.appendChild(opt);
    });
    templateSelect.addEventListener('change', () => {
      if (templateSelect.value) {
        selectTemplate(templateSelect.value as PhraseKey);
      }
    });
  }

  // Legacy scan button (for free-text input, now secondary)
  const scanBtn = document.getElementById('custom-phrase-scan');
  if (scanBtn) scanBtn.addEventListener('click', handleScan);

  const saveBtn = document.getElementById('custom-save-phrase');
  if (saveBtn) saveBtn.addEventListener('click', handleSave);

  const pushBtn = document.getElementById('custom-push-glasses');
  if (pushBtn) pushBtn.addEventListener('click', handlePushGlasses);

  const reshuffleBtn = document.getElementById('custom-reshuffle');
  if (reshuffleBtn) reshuffleBtn.addEventListener('click', handleReshuffle);

  document.addEventListener('click', handleCustomClick);
}

export function setCustomLang(lang: LangCode): void {
  activeLang = lang;
  if (selectedKey) {
    regenerateTexts();
    renderSlotEditor();
    renderGlassesPreview();
  }
}

export function setCustomSpeakLang(lang: string): void {
  speakLangCode = lang;
  if (selectedKey) {
    regenerateTexts();
    renderSlotEditor();
    renderGlassesPreview();
  }
}

export function setCustomPushFn(fn: (page: RebuildPageContainer) => Promise<void>): void {
  pushToGlassesFn = fn;
}

// ═══════════════════════════════════════════════════════════════════
// TEMPLATE SELECTION
// ═══════════════════════════════════════════════════════════════════

function selectTemplate(key: PhraseKey): void {
  selectedKey = key;
  const enTemplate = EN_TEMPLATES[key];
  if (!enTemplate) return;

  slotCats = getSlotCategories(key);

  // Random initial picks
  const picks = pickSlotsForTemplate(enTemplate, activeLang);
  const vocab = VOCAB[activeLang];
  slotIdxs = picks.map((pick, i) => {
    if (!vocab) return 0;
    const cat = slotCats[i];
    const items = vocab[cat];
    return items ? items.findIndex(v => v.en === pick.en && v.tr === pick.tr) : 0;
  });

  regenerateTexts();
  renderSlotEditor();
  renderGlassesPreview();
  updateButtons();

  log(`Template: ${key} — ${slotCats.length} slots`, "success");
}

/** Rebuild speak + learn texts from current slot indexes */
function regenerateTexts(): void {
  if (!selectedKey) return;
  const vocab = VOCAB[activeLang];
  if (!vocab) return;

  const picks: VocabItem[] = slotCats.map((cat, i) => {
    const items = vocab[cat];
    if (!items || items.length === 0) return { en: '?', tr: '?' };
    return items[slotIdxs[i] % items.length];
  });

  const nativeTemplate = langPhrase(activeLang, selectedKey);
  const romTemplate = langRom(activeLang, selectedKey);

  // Speaker line (mother tongue or English)
  if (speakLangCode === 'en') {
    speakText = fillSlotsEnglish(selectedKey, activeLang, picks);
    speakTextHL = fillSlotsEnglishHighlighted(selectedKey, activeLang, picks);
  } else {
    speakText = fillSlotsForSpeaker(selectedKey, speakLangCode, picks);
    speakTextHL = fillSlotsForSpeakerHighlighted(selectedKey, speakLangCode, picks);
  }

  // Learning line (target language)
  learnText = fillSlots(nativeTemplate, activeLang, picks);
  learnTextHL = fillSlotsHighlighted(nativeTemplate, activeLang, picks);
  romText = needsRom(activeLang) ? fillSlotsRom(romTemplate, activeLang, picks) : '';
}

/** Cycle a slot to next vocab item */
function cycleSlot(slotIdx: number): void {
  const vocab = VOCAB[activeLang];
  if (!vocab || slotIdx >= slotCats.length) return;

  const cat = slotCats[slotIdx];
  const items = vocab[cat];
  if (!items || items.length === 0) return;

  slotIdxs[slotIdx] = (slotIdxs[slotIdx] + 1) % items.length;

  regenerateTexts();
  renderSlotEditor();
  renderGlassesPreview();
}

function handleReshuffle(): void {
  if (!selectedKey) return;
  const enTemplate = EN_TEMPLATES[selectedKey];
  if (!enTemplate) return;

  const picks = pickSlotsForTemplate(enTemplate, activeLang);
  const vocab = VOCAB[activeLang];
  slotIdxs = picks.map((pick, i) => {
    if (!vocab) return 0;
    const cat = slotCats[i];
    const items = vocab[cat];
    return items ? items.findIndex(v => v.en === pick.en && v.tr === pick.tr) : 0;
  });

  regenerateTexts();
  renderSlotEditor();
  renderGlassesPreview();
  log('Reshuffled all slots');
}

// ═══════════════════════════════════════════════════════════════════
// SLOT EDITOR — show current slot words with cycle buttons
// ═══════════════════════════════════════════════════════════════════

function renderSlotEditor(): void {
  const container = document.getElementById('custom-slot-editor');
  if (!container) return;

  if (!selectedKey || slotCats.length === 0) {
    container.innerHTML = '<span class="muted">Pick a template above to configure slots</span>';
    return;
  }

  const vocab = VOCAB[activeLang];
  if (!vocab) return;

  container.innerHTML = slotCats.map((cat, i) => {
    const items = vocab[cat];
    if (!items || items.length === 0) return '';
    const current = items[slotIdxs[i] % items.length];
    const speakWord = getSpeakerSlotLabel(speakLangCode, cat, current.en);
    const learnWord = current.tr.toUpperCase();
    const totalOptions = items.length;

    return `
      <div class="slot-group">
        <div class="slot-group-header">
          <span class="slot-group-word">${esc(speakWord)}</span>
          <span class="muted" style="font-size:0.7rem">→ ${esc(learnWord)}</span>
          <button class="btn-outline-sm" data-action="cycle-custom-slot" data-si="${i}">↻ ${slotIdxs[i] % totalOptions + 1}/${totalOptions}</button>
        </div>
      </div>
    `;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════════
// GLASSES PREVIEW — canvas render showing bilingual layout
// ═══════════════════════════════════════════════════════════════════

export function renderGlassesPreview(): void {
  const canvas = document.getElementById('custom-preview-canvas') as HTMLCanvasElement;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const W = 576, H = 288;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'top';

  if (!selectedKey) {
    ctx.fillStyle = '#333';
    ctx.font = '14px -apple-system, sans-serif';
    ctx.fillText('Pick a phrase template to preview', 20, 130);
    return;
  }

  const vocab = VOCAB[activeLang];
  if (!vocab) return;

  // ── Layout: slot list left, bilingual text right ──
  const hasSlots = slotCats.length > 0;

  if (hasSlots) {
    // Left panel: slot words
    const listX = 4, listY = 4, listW = 145, listH = 280;
    ctx.fillStyle = '#111';
    ctx.fillRect(listX, listY, listW, listH);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.strokeRect(listX, listY, listW, listH);

    slotCats.forEach((cat, i) => {
      const items = vocab[cat];
      if (!items) return;
      const current = items[slotIdxs[i] % items.length];
      const label = getSpeakerSlotLabel(speakLangCode, cat, current.en);
      const itemY = listY + 8 + i * 36;

      ctx.strokeStyle = '#8b5cf6';
      ctx.lineWidth = 1;
      ctx.strokeRect(listX + 4, itemY, listW - 8, 30);

      ctx.fillStyle = '#c4b5fd';
      ctx.font = 'bold 12px -apple-system, sans-serif';
      ctx.fillText(label, listX + 10, itemY + 8);
    });

    // Right panel: bilingual
    const RX = 156, RW = 416;
    let curY = 4;

    // Speaker label (indented)
    const spkFlag = LANG_FLAG[speakLangCode] || '🇬🇧';
    const spkName = LANG_LABEL[speakLangCode] || 'English';
    ctx.fillStyle = '#8b5cf6';
    ctx.font = 'bold 11px -apple-system, sans-serif';
    ctx.fillText(`${spkFlag} ${spkName}`, RX + 8, curY + 4);
    curY += 22;

    // Speaker text
    ctx.fillStyle = '#ede9f6';
    ctx.font = '13px -apple-system, sans-serif';
    wrapText(ctx, speakTextHL, RX + 4, curY, RW - 8, 18);
    curY += 70;

    // Learn label (indented)
    ctx.fillStyle = '#8b5cf6';
    ctx.font = 'bold 11px -apple-system, sans-serif';
    ctx.fillText(`${LANG_FLAG[activeLang]} ${LANG_LABEL[activeLang]}`, RX + 8, curY + 4);
    curY += 22;

    // Learn text
    ctx.fillStyle = '#ede9f6';
    ctx.font = '13px -apple-system, sans-serif';
    wrapText(ctx, learnTextHL, RX + 4, curY, RW - 8, 18);

    // Rom text if applicable
    if (romText) {
      curY += 50;
      ctx.fillStyle = '#9ca3af';
      ctx.font = '11px -apple-system, sans-serif';
      wrapText(ctx, romText, RX + 4, curY, RW - 8, 16);
    }
  } else {
    // No slots — centered bilingual display
    let curY = 20;

    const spkFlag = LANG_FLAG[speakLangCode] || '🇬🇧';
    const spkName = LANG_LABEL[speakLangCode] || 'English';
    ctx.fillStyle = '#8b5cf6';
    ctx.font = 'bold 12px -apple-system, sans-serif';
    ctx.fillText(`${spkFlag} ${spkName}`, 12, curY);
    curY += 24;

    ctx.fillStyle = '#ede9f6';
    ctx.font = '15px -apple-system, sans-serif';
    wrapText(ctx, speakText, 12, curY, W - 24, 22);
    curY += 60;

    ctx.fillStyle = '#8b5cf6';
    ctx.font = 'bold 12px -apple-system, sans-serif';
    ctx.fillText(`${LANG_FLAG[activeLang]} ${LANG_LABEL[activeLang]}`, 12, curY);
    curY += 24;

    ctx.fillStyle = '#ede9f6';
    ctx.font = '15px -apple-system, sans-serif';
    wrapText(ctx, learnText, 12, curY, W - 24, 22);

    if (romText) {
      curY += 50;
      ctx.fillStyle = '#9ca3af';
      ctx.font = '12px -apple-system, sans-serif';
      wrapText(ctx, romText, 12, curY, W - 24, 18);
    }
  }
}

/** Simple word-wrap text renderer */
function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number): void {
  const words = text.split(' ');
  let lineX = x, lineY = y;
  for (const w of words) {
    const measured = ctx.measureText(w + ' ').width;
    if (lineX + measured > x + maxW && lineX > x) {
      lineX = x;
      lineY += lineH;
    }
    ctx.fillText(w, lineX, lineY);
    lineX += measured;
  }
}

// ═══════════════════════════════════════════════════════════════════
// BUILD GLASSES PAGE — SDK containers (bilingual, matching detail layout)
// ═══════════════════════════════════════════════════════════════════

export function buildCustomPhrasePage(): RebuildPageContainer | null {
  if (!selectedKey) return null;

  const FULL_H = 288;
  const LABEL_H = 26;
  const GAP = 4;
  const textZone = FULL_H - (LABEL_H * 2) - GAP;
  const SPEAK_TEXT_H = Math.floor(textZone * 0.38);
  const LEARN_TEXT_H = textZone - SPEAK_TEXT_H;

  const spkFlag = LANG_FLAG[speakLangCode] || '🇬🇧';
  const spkName = LANG_LABEL[speakLangCode] || 'English';
  const learnDisplay = romText ? `${learnTextHL}\n${romText}` : learnTextHL;

  if (slotCats.length > 0) {
    // Slot list on left
    const vocab = VOCAB[activeLang];
    const slotLabels = slotCats.map((cat, i) => {
      const items = vocab?.[cat];
      if (!items || items.length === 0) return '?';
      return getSpeakerSlotLabel(speakLangCode, cat, items[slotIdxs[i] % items.length].en);
    });
    slotLabels.push('Back');

    const ITEM_H = 40;
    const listH = Math.max(slotLabels.length * ITEM_H, 80);
    const listY = Math.max(2, Math.floor((FULL_H - listH) / 2));

    const slotList = new ListContainerProperty({
      xPosition: 2, yPosition: listY, width: 145, height: listH,
      containerID: 2, containerName: 'custom-slots',
      itemContainer: new ListItemContainerProperty({
        itemCount: slotLabels.length,
        itemWidth: 0,
        isItemSelectBorderEn: 1,
        itemName: slotLabels,
      }),
      isEventCapture: 1,
    });

    const RX = 152, RW = 420;
    const groupH = LABEL_H + SPEAK_TEXT_H + GAP + LABEL_H + LEARN_TEXT_H;
    const startY = Math.max(2, Math.floor((FULL_H - groupH) / 2));
    let curY = startY;

    const speakLabel = new TextContainerProperty({
      xPosition: RX + 8, yPosition: curY, width: RW - 8, height: LABEL_H,
      containerID: 3, containerName: 'speak-label',
      content: `${spkFlag} ${spkName}`,
      isEventCapture: 0,
      borderWidth: 0, paddingLength: 2,
    });
    curY += LABEL_H;

    const speakTxt = new TextContainerProperty({
      xPosition: RX, yPosition: curY, width: RW, height: SPEAK_TEXT_H,
      containerID: 4, containerName: 'speak-text',
      content: speakTextHL,
      isEventCapture: 0,
      borderWidth: 1, borderRadius: 4, paddingLength: 4,
    });
    curY += SPEAK_TEXT_H + GAP;

    const learnLabel = new TextContainerProperty({
      xPosition: RX + 8, yPosition: curY, width: RW - 8, height: LABEL_H,
      containerID: 5, containerName: 'learn-label',
      content: `${LANG_FLAG[activeLang]} ${LANG_LABEL[activeLang]}`,
      isEventCapture: 0,
      borderWidth: 0, paddingLength: 2,
    });
    curY += LABEL_H;

    const learnTxt = new TextContainerProperty({
      xPosition: RX, yPosition: curY, width: RW, height: LEARN_TEXT_H,
      containerID: 6, containerName: 'learn-text',
      content: learnDisplay,
      isEventCapture: 0,
      borderWidth: 1, borderRadius: 4, paddingLength: 4,
    });

    return new RebuildPageContainer({
      containerTotalNum: 5,
      listObject: [slotList],
      textObject: [speakLabel, speakTxt, learnLabel, learnTxt],
      imageObject: [],
    });
  } else {
    // No slots — full-width bilingual
    const FW = 568;
    const groupH = LABEL_H + SPEAK_TEXT_H + GAP + LABEL_H + LEARN_TEXT_H;
    const startY = Math.max(2, Math.floor((FULL_H - groupH) / 2));
    let curY = startY;

    const speakLabel = new TextContainerProperty({
      xPosition: 12, yPosition: curY, width: FW - 8, height: LABEL_H,
      containerID: 2, containerName: 'speak-label',
      content: `${spkFlag} ${spkName}`,
      isEventCapture: 0,
      borderWidth: 0, paddingLength: 2,
    });
    curY += LABEL_H;

    const speakTxt = new TextContainerProperty({
      xPosition: 4, yPosition: curY, width: FW, height: SPEAK_TEXT_H,
      containerID: 3, containerName: 'speak-text',
      content: speakText,
      isEventCapture: 0,
      borderWidth: 1, borderRadius: 4, paddingLength: 4,
    });
    curY += SPEAK_TEXT_H + GAP;

    const learnLabel = new TextContainerProperty({
      xPosition: 12, yPosition: curY, width: FW - 8, height: LABEL_H,
      containerID: 4, containerName: 'learn-label',
      content: `${LANG_FLAG[activeLang]} ${LANG_LABEL[activeLang]}`,
      isEventCapture: 0,
      borderWidth: 0, paddingLength: 2,
    });
    curY += LABEL_H;

    const learnTxt = new TextContainerProperty({
      xPosition: 4, yPosition: curY, width: FW, height: LEARN_TEXT_H,
      containerID: 5, containerName: 'learn-text',
      content: learnDisplay,
      isEventCapture: 0,
      borderWidth: 1, borderRadius: 4, paddingLength: 4,
    });

    return new RebuildPageContainer({
      containerTotalNum: 4,
      listObject: [],
      textObject: [speakLabel, speakTxt, learnLabel, learnTxt],
      imageObject: [],
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// LEGACY SCAN — free-text input (fallback, limited translation)
// ═══════════════════════════════════════════════════════════════════

function handleScan(): void {
  const input = document.getElementById('custom-phrase-input') as HTMLTextAreaElement;
  if (!input || !input.value.trim()) return;

  // Try to match against a template
  const text = input.value.trim();
  const keys = Object.keys(EN_TEMPLATES) as PhraseKey[];
  for (const key of keys) {
    // Simple substring match
    const tmpl = EN_TEMPLATES[key].replace(/\[(DRINKS|FOOD|DESSERT|ADJ_TASTE|GREETING|COMPLIMENT|PLACE)\]/g, '').toLowerCase();
    const cleanInput = text.toLowerCase();
    // Check if the core structure matches (ignoring slot words)
    const tmplWords = tmpl.split(/\s+/).filter(w => w.length > 2);
    const matchCount = tmplWords.filter(w => cleanInput.includes(w)).length;
    if (matchCount >= tmplWords.length * 0.6) {
      // Good enough match — use this template
      const templateSelect = document.getElementById('custom-template-select') as HTMLSelectElement;
      if (templateSelect) templateSelect.value = key;
      selectTemplate(key);
      log(`Matched template: ${key}`);
      return;
    }
  }

  log('No template match found — pick one from the dropdown', 'error');
}

// ═══════════════════════════════════════════════════════════════════
// SAVE & PUSH
// ═══════════════════════════════════════════════════════════════════

async function handleSave(): Promise<void> {
  if (!selectedKey) return;
  const { savePhrase } = await import('./sync');

  await savePhrase({
    lang: activeLang,
    key: selectedKey,
    en: speakText,
    native: learnText,
    rom: romText,
  });

  log(`Saved: "${speakText.slice(0, 40)}..."`, 'success');
  const btn = document.getElementById('custom-save-phrase') as HTMLButtonElement;
  if (btn) { btn.textContent = 'Saved ✓'; setTimeout(() => { btn.textContent = 'Save Phrase'; }, 2000); }
}

async function handlePushGlasses(): Promise<void> {
  const page = buildCustomPhrasePage();
  if (!page) {
    log('No phrase to push', 'error');
    return;
  }
  if (pushToGlassesFn) {
    await pushToGlassesFn(page);
  }
  const { pushCustomToGlasses } = await import('./events');
  await pushCustomToGlasses();
  log('Custom phrase pushed to glasses', 'success');
  const btn = document.getElementById('custom-push-glasses') as HTMLButtonElement;
  if (btn) { btn.textContent = 'Sent ✓'; setTimeout(() => { btn.textContent = 'Push to G2 →'; }, 2000); }
}

// ═══════════════════════════════════════════════════════════════════
// EVENT HANDLERS
// ═══════════════════════════════════════════════════════════════════

function handleCustomClick(e: Event): void {
  const target = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
  if (!target) return;
  const action = target.dataset.action;

  if (action === 'cycle-custom-slot') {
    const si = Number(target.dataset.si);
    cycleSlot(si);
  }
}

function updateButtons(): void {
  const saveBtn = document.getElementById('custom-save-phrase') as HTMLButtonElement;
  const pushBtn = document.getElementById('custom-push-glasses') as HTMLButtonElement;
  const reshuffleBtn = document.getElementById('custom-reshuffle') as HTMLButtonElement;
  const hasPhrase = !!selectedKey;
  if (saveBtn) saveBtn.disabled = !hasPhrase;
  if (pushBtn) pushBtn.disabled = !hasPhrase;
  if (reshuffleBtn) reshuffleBtn.disabled = !hasPhrase;
}

// ═══ Utility ═══
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ═══ Export state for events.ts integration ═══
export function getCustomSlots(): { tokenIndex: number; originalWord: string; alternatives: string[]; activeAltIdx: number }[] {
  // Map slot state to the legacy format events.ts expects
  return slotCats.map((cat, i) => ({
    tokenIndex: i,
    originalWord: getSpeakerSlotLabel(speakLangCode, cat, VOCAB[activeLang]?.[cat]?.[slotIdxs[i] % (VOCAB[activeLang]?.[cat]?.length || 1)]?.en || '?'),
    alternatives: [],
    activeAltIdx: -1,
  }));
}

/** Cycle to next alternative for a given slot (called from glasses events) */
export function cycleSlotOption(slotIndex: number): void {
  cycleSlot(slotIndex);
}

// ═══════════════════════════════════════════════════════════════════
// DYNAMIC RE-TRANSLATE — for saved phrases in the library
// Given a saved phrase with a template key, regenerate for current langs
// ═══════════════════════════════════════════════════════════════════

export function retranslateSavedPhrase(
  key: PhraseKey, lang: LangCode, spkLang: string,
): { en: string; native: string; rom: string } | null {
  if (key === 'custom' as any) return null;  // can't retranslate freetext
  const enTemplate = EN_TEMPLATES[key];
  if (!enTemplate) return null;

  const nativeTemplate = langPhrase(lang, key);
  const romTemplate = langRom(lang, key);
  const picks = pickSlotsForTemplate(enTemplate, lang);

  let en: string;
  if (spkLang === 'en') {
    en = fillSlotsEnglish(key, lang, picks);
  } else {
    en = fillSlotsForSpeaker(key, spkLang, picks);
  }

  const native = fillSlots(nativeTemplate, lang, picks);
  const rom = needsRom(lang) ? fillSlotsRom(romTemplate, lang, picks) : '';

  return { en, native, rom };
}
