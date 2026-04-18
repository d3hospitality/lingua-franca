// ═══════════════════════════════════════════════════════════════════
// Lingua Franca — Image Utilities
// Grayscale pipeline for G2 glasses display
//
// Candidate sprite system — all images follow the golden/amber
// painterly aesthetic from sprite-system master templates:
//   candidate_master.png   — portrait (Home page, user identity)
//   candidate_language.png — golden dome/landmark (Groups, Dialogue)
//   candidate_scene.png    — scroll/quill (Phrase lists)
//   candidate_utility.png  — golden star (utility/actions)
//   candidate_world.png    — globe with flags (Language select, Speak)
// ═══════════════════════════════════════════════════════════════════

import { EvenAppBridge, ImageRawDataUpdate } from '@evenrealities/even_hub_sdk';
import { encodeGrayscalePng } from './pngEncoder';

/** Push raw PNG data to a glasses image container */
async function pushImg(bridge: EvenAppBridge, id: number, name: string, data: Uint8Array): Promise<void> {
  await bridge.updateImageRawData(new ImageRawDataUpdate({
    containerID: id, containerName: name, imageData: Array.from(data),
  }));
}

// ═══════════════════════════════════════════════════════════════════
// UNIFIED SPRITE CACHE — one cache for all candidate sprites
// ═══════════════════════════════════════════════════════════════════

const spriteCache = new Map<string, ImageBitmap>();

/** Available candidate sprite names (map to public/sprites/candidate_*.png) */
export type SpriteKey = "master" | "language" | "scene" | "utility" | "world";

/**
 * Core sprite push: fetch a candidate sprite, scale to container size,
 * convert to grayscale, push to glasses. Cached after first load.
 */
export async function pushSprite(
  bridge: EvenAppBridge,
  sprite: SpriteKey,
  containerID: number,
  containerName: string,
  w: number,
  h: number,
  baseUrl: string,
): Promise<void> {
  try {
    const cacheKey = sprite;
    let bmp = spriteCache.get(cacheKey);
    if (!bmp) {
      const url = `${baseUrl}sprites/candidate_${sprite}.png`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Fetch candidate_${sprite}.png: ${resp.status}`);
      const blob = await resp.blob();
      bmp = await createImageBitmap(blob);
      spriteCache.set(cacheKey, bmp);
    }

    const scale = Math.min(w / bmp.width, h / bmp.height);
    const fitW = Math.round(bmp.width * scale);
    const fitH = Math.round(bmp.height * scale);
    const offX = Math.round((w - fitW) / 2);
    const offY = Math.round((h - fitH) / 2);

    const cvs = document.createElement('canvas');
    cvs.width = w; cvs.height = h;
    const ctx = cvs.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, offX, offY, fitW, fitH);

    const px = ctx.getImageData(0, 0, w, h).data;
    const gray = new Uint8Array(w * h);
    for (let i = 0; i < gray.length; i++) {
      const o = i * 4;
      gray[i] = 0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2];
    }
    await pushImg(bridge, containerID, containerName, encodeGrayscalePng(w, h, gray));
    console.log(`[LF] Sprite pushed: candidate_${sprite} → #${containerID} (${w}×${h})`);
  } catch (e) {
    console.error(`[LF] Sprite FAILED: candidate_${sprite} → #${containerID}:`, e);
  }
}

// ═══════════════════════════════════════════════════════════════════
// SPLIT SPRITE — push one image across two vertically-stacked containers
// Used on Home (#3 top, #4 bottom), Groups (#3,#4), Phrases (#3,#4)
// ═══════════════════════════════════════════════════════════════════

export async function pushSplitSprite(
  bridge: EvenAppBridge,
  sprite: SpriteKey,
  topID: number, topName: string,
  botID: number, botName: string,
  w: number, halfH: number,
  baseUrl: string,
): Promise<void> {
  const fullH = halfH * 2;
  try {
    const cacheKey = sprite;
    let bmp = spriteCache.get(cacheKey);
    if (!bmp) {
      const url = `${baseUrl}sprites/candidate_${sprite}.png`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Fetch candidate_${sprite}.png: ${resp.status}`);
      const blob = await resp.blob();
      bmp = await createImageBitmap(blob);
      spriteCache.set(cacheKey, bmp);
    }

    const scale = Math.min(w / bmp.width, fullH / bmp.height);
    const fitW = Math.round(bmp.width * scale);
    const fitH = Math.round(bmp.height * scale);
    const offX = Math.round((w - fitW) / 2);
    const offY = Math.round((fullH - fitH) / 2);

    const cvs = document.createElement('canvas');
    cvs.width = w; cvs.height = fullH;
    const ctx = cvs.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, fullH);
    ctx.drawImage(bmp, offX, offY, fitW, fitH);

    // Top half
    const topPx = ctx.getImageData(0, 0, w, halfH).data;
    const topGray = new Uint8Array(w * halfH);
    for (let i = 0; i < topGray.length; i++) {
      const o = i * 4;
      topGray[i] = 0.299 * topPx[o] + 0.587 * topPx[o + 1] + 0.114 * topPx[o + 2];
    }
    await pushImg(bridge, topID, topName, encodeGrayscalePng(w, halfH, topGray));

    // Bottom half
    const botPx = ctx.getImageData(0, halfH, w, halfH).data;
    const botGray = new Uint8Array(w * halfH);
    for (let i = 0; i < botGray.length; i++) {
      const o = i * 4;
      botGray[i] = 0.299 * botPx[o] + 0.587 * botPx[o + 1] + 0.114 * botPx[o + 2];
    }
    await pushImg(bridge, botID, botName, encodeGrayscalePng(w, halfH, botGray));

    console.log(`[LF] Split sprite pushed: candidate_${sprite} → #${topID}/#${botID} (${w}×${fullH})`);
  } catch (e) {
    console.error(`[LF] Split sprite FAILED: candidate_${sprite}:`, e);
  }
}

// ═══════════════════════════════════════════════════════════════════
// PAGE-SPECIFIC HELPERS — convenience wrappers
// ═══════════════════════════════════════════════════════════════════

/** Home page: logo.png → single container #3 (190×144, SDK max height) */
export async function pushHomeSprite(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  const W = 190, H = 144;
  try {
    let bmp = spriteCache.get("logo");
    if (!bmp) {
      const resp = await fetch(`${baseUrl}sprites/logo.png`);
      if (!resp.ok) throw new Error(`Fetch logo.png: ${resp.status}`);
      const blob = await resp.blob();
      bmp = await createImageBitmap(blob);
      spriteCache.set("logo", bmp);
    }

    const scale = Math.min(W / bmp.width, H / bmp.height);
    const fitW = Math.round(bmp.width * scale);
    const fitH = Math.round(bmp.height * scale);
    const offX = Math.round((W - fitW) / 2);
    const offY = Math.round((H - fitH) / 2);

    const cvs = document.createElement('canvas');
    cvs.width = W; cvs.height = H;
    const ctx = cvs.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(bmp, offX, offY, fitW, fitH);

    const px = ctx.getImageData(0, 0, W, H).data;
    const gray = new Uint8Array(W * H);
    for (let i = 0; i < gray.length; i++) {
      const o = i * 4;
      gray[i] = 0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2];
    }
    await pushImg(bridge, 3, "logo", encodeGrayscalePng(W, H, gray));
    console.log("[LF] Logo pushed → #3 (190×144)");
  } catch (e) {
    // Fallback to candidate_master
    console.warn("[LF] Logo FAILED, falling back to candidate_master:", e);
    await pushSprite(bridge, "master", 3, "logo", W, H, baseUrl);
  }
}

/** World sprite for Languages + Speak Select pages → single #3 container */
export async function pushWorldSprite(
  bridge: EvenAppBridge,
  containerID: number,
  containerName: string,
  w: number,
  h: number,
  baseUrl: string,
): Promise<void> {
  await pushSprite(bridge, "world", containerID, containerName, w, h, baseUrl);
}

/**
 * Push a per-language flag sprite to a container.
 * Loads sprites/language/lang-{code}.png, scales to fit, grayscale, pushes.
 * Falls back to candidate_world.png if the flag doesn't exist.
 */
export async function pushLangFlagSprite(
  bridge: EvenAppBridge,
  langCode: string,
  containerID: number,
  containerName: string,
  w: number,
  h: number,
  baseUrl: string,
): Promise<void> {
  try {
    const cacheKey = `flag-${langCode}`;
    let bmp = spriteCache.get(cacheKey);
    if (!bmp) {
      const url = `${baseUrl}sprites/language/lang-${langCode}.png`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`lang-${langCode}.png: ${resp.status}`);
      const blob = await resp.blob();
      bmp = await createImageBitmap(blob);
      spriteCache.set(cacheKey, bmp);
    }

    const scale = Math.min(w / bmp.width, h / bmp.height);
    const fitW = Math.round(bmp.width * scale);
    const fitH = Math.round(bmp.height * scale);
    const offX = Math.round((w - fitW) / 2);
    const offY = Math.round((h - fitH) / 2);

    const cvs = document.createElement('canvas');
    cvs.width = w; cvs.height = h;
    const ctx = cvs.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, offX, offY, fitW, fitH);

    const px = ctx.getImageData(0, 0, w, h).data;
    const gray = new Uint8Array(w * h);
    for (let i = 0; i < gray.length; i++) {
      const o = i * 4;
      gray[i] = 0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2];
    }
    await pushImg(bridge, containerID, containerName, encodeGrayscalePng(w, h, gray));
    console.log(`[LF] Flag pushed: lang-${langCode} → #${containerID} (${w}×${h})`);
  } catch (e) {
    // Fallback to candidate_world
    console.warn(`[LF] Flag FAILED for ${langCode}, falling back to world:`, e);
    await pushSprite(bridge, "world", containerID, containerName, w, h, baseUrl);
  }
}

/** Groups page: push the selected language flag → single #3 (190×144) */
export async function pushGroupsSprite(bridge: EvenAppBridge, baseUrl: string, langCode?: string): Promise<void> {
  if (langCode) {
    await pushLangFlagSprite(bridge, langCode, 3, "lang-sprite", 190, 144, baseUrl);
  } else {
    await pushSprite(bridge, "language", 3, "lang-sprite", 190, 144, baseUrl);
  }
}

/** Map scenario group index → scene sprite filename */
const GROUP_SCENE_SPRITES: Record<number, string> = {
  0: 'scene-social',     // Social & Greetings
  1: 'scene-food',       // Food & Drinks
  2: 'scene-compliment', // Compliments
  3: 'scene-navigate',   // Navigation & Help
  4: 'scene-formal',     // Formal
};

/** Phrases page: push the group-specific scene sprite → single #3 (190×144) */
export async function pushPhrasesSprite(bridge: EvenAppBridge, baseUrl: string, groupIdx?: number): Promise<void> {
  const sceneName = groupIdx !== undefined ? GROUP_SCENE_SPRITES[groupIdx] : undefined;
  if (sceneName) {
    await pushNamedSprite(bridge, `sprites/scene/${sceneName}.png`, 3, "scene-sprite", 190, 144, baseUrl);
  } else {
    await pushSprite(bridge, "scene", 3, "scene-sprite", 190, 144, baseUrl);
  }
}

/** Dialogue HUD: push language-specific flag sprites for both speakers */
export async function pushDialogueSprites(
  bridge: EvenAppBridge,
  baseUrl: string,
  theirLang?: string,
  yourLang?: string,
): Promise<void> {
  // SDK requires sequential image pushes — no concurrent sends
  if (theirLang) {
    await pushLangFlagSprite(bridge, theirLang, 41, "dlg-lang-flag", 80, 80, baseUrl);
  } else {
    await pushSprite(bridge, "language", 41, "dlg-lang-flag", 80, 80, baseUrl);
  }
  if (yourLang) {
    await pushLangFlagSprite(bridge, yourLang, 44, "dlg-user-flag", 80, 80, baseUrl);
  } else {
    await pushSprite(bridge, "master", 44, "dlg-user-flag", 80, 80, baseUrl);
  }
}

/**
 * Push any named sprite from public/sprites/ to a container.
 * Caches by path. Falls back to candidate_scene on error.
 */
async function pushNamedSprite(
  bridge: EvenAppBridge, path: string,
  containerID: number, containerName: string,
  w: number, h: number, baseUrl: string,
): Promise<void> {
  try {
    let bmp = spriteCache.get(path);
    if (!bmp) {
      const resp = await fetch(`${baseUrl}${path}`);
      if (!resp.ok) throw new Error(`${path}: ${resp.status}`);
      const blob = await resp.blob();
      bmp = await createImageBitmap(blob);
      spriteCache.set(path, bmp);
    }
    const scale = Math.min(w / bmp.width, h / bmp.height);
    const fitW = Math.round(bmp.width * scale);
    const fitH = Math.round(bmp.height * scale);
    const offX = Math.round((w - fitW) / 2);
    const offY = Math.round((h - fitH) / 2);
    const cvs = document.createElement('canvas');
    cvs.width = w; cvs.height = h;
    const ctx = cvs.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, offX, offY, fitW, fitH);
    const px = ctx.getImageData(0, 0, w, h).data;
    const gray = new Uint8Array(w * h);
    for (let i = 0; i < gray.length; i++) {
      const o = i * 4;
      gray[i] = 0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2];
    }
    await pushImg(bridge, containerID, containerName, encodeGrayscalePng(w, h, gray));
    console.log(`[LF] Named sprite pushed: ${path} → #${containerID} (${w}×${h})`);
  } catch (e) {
    console.warn(`[LF] Named sprite FAILED: ${path}, falling back:`, e);
    await pushSprite(bridge, "scene", containerID, containerName, w, h, baseUrl);
  }
}

// ═══════════════════════════════════════════════════════════════════
// TEXT SPRITE — Generate text as a greyscale image for the glasses
// Used for rendering language names, phrase headers, etc.
// ═══════════════════════════════════════════════════════════════════

export async function pushTextSprite(
  bridge: EvenAppBridge,
  text: string,
  containerID: number,
  containerName: string,
  w: number,
  h: number,
  fontSize = 16,
): Promise<void> {
  try {
    const cvs = document.createElement('canvas');
    cvs.width = w; cvs.height = h;
    const ctx = cvs.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    ctx.font = `${fontSize}px -apple-system, sans-serif`;
    ctx.textBaseline = 'middle';

    // Word wrap
    const words = text.split(' ');
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > w - 8) {
        if (line) lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);

    const lineHeight = fontSize * 1.3;
    const startY = (h - lines.length * lineHeight) / 2 + lineHeight / 2;
    lines.forEach((l, i) => {
      ctx.fillText(l, 4, startY + i * lineHeight);
    });

    const px = ctx.getImageData(0, 0, w, h).data;
    const gray = new Uint8Array(w * h);
    for (let i = 0; i < gray.length; i++) {
      const o = i * 4;
      gray[i] = 0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2];
    }
    await pushImg(bridge, containerID, containerName, encodeGrayscalePng(w, h, gray));
  } catch (e) {
    console.warn(`[LF] Text sprite FAILED: ${text}`, e);
  }
}
