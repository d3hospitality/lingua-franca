// ═══════════════════════════════════════════════════════════════════
// Lingua Franca — Image Utilities
// Grayscale pipeline for G2 glasses display
// Supports: split logo (190×95 halves), flag sprites
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
// LOGO — split 200×200 logo into two 190×95 containers
// Container 3 = top, Container 4 = bottom (matching sommNI pattern)
// ═══════════════════════════════════════════════════════════════════

export async function pushLogoToGlasses(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  const W = 190;
  const HALF_H = 95;
  const FULL_H = HALF_H * 2;
  try {
    const resp = await fetch(baseUrl + "sprites/logo.png");
    if (!resp.ok) throw new Error(`Fetch ${resp.status}`);
    const blob = await resp.blob();
    const bmp = await createImageBitmap(blob);

    const scale = Math.min(W / bmp.width, FULL_H / bmp.height);
    const fitW = Math.round(bmp.width * scale);
    const fitH = Math.round(bmp.height * scale);
    const offX = Math.round((W - fitW) / 2);
    const offY = Math.round((FULL_H - fitH) / 2);

    const cvs = document.createElement('canvas');
    cvs.width = W; cvs.height = FULL_H;
    const ctx = cvs.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, FULL_H);
    ctx.drawImage(bmp, offX, offY, fitW, fitH);

    // Top half → container 3
    const topPx = ctx.getImageData(0, 0, W, HALF_H).data;
    const topGray = new Uint8Array(W * HALF_H);
    for (let i = 0; i < topGray.length; i++) {
      const o = i * 4;
      topGray[i] = 0.299 * topPx[o] + 0.587 * topPx[o + 1] + 0.114 * topPx[o + 2];
    }
    await pushImg(bridge, 3, "logo-top", encodeGrayscalePng(W, HALF_H, topGray));

    // Bottom half → container 4
    const botPx = ctx.getImageData(0, HALF_H, W, HALF_H).data;
    const botGray = new Uint8Array(W * HALF_H);
    for (let i = 0; i < botGray.length; i++) {
      const o = i * 4;
      botGray[i] = 0.299 * botPx[o] + 0.587 * botPx[o + 1] + 0.114 * botPx[o + 2];
    }
    await pushImg(bridge, 4, "logo-bottom", encodeGrayscalePng(W, HALF_H, botGray));

    console.log("[LF] Logo pushed (split from single source)");
  } catch (e) { console.error("[LF] Logo FAILED:", e); }
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
