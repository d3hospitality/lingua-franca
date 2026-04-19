// ═══════════════════════════════════════════════════════════════════
// Lingua Franca — Batch STT (HTTP POST, proven in Even Hub webview)
//
// The Even Hub glasses webview CANNOT make direct API calls to
// external services (Deepgram, OpenAI, etc.) — they fail silently.
// Only fetch() POST to our own Vercel proxy works reliably.
//
// Strategy: collect audio chunks for ~2.5s, batch them,
// POST base64 + language to Lingua Franca's Vercel proxy.
// The proxy wraps in WAV, forwards to Deepgram nova-2 (primary)
// or OpenAI gpt-4o-transcribe (fallback) with the language
// parameter for single-language lock.
//
// Audio format: linear16 (signed 16-bit LE), 16kHz, mono
// ═══════════════════════════════════════════════════════════════════

import { log } from './ui';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface PulseResult {
  text: string;           // transcription in the spoken language
  language: string;       // locked language code or 'unknown'
  isFinal: boolean;       // batch mode = always true
}

type STTCallback = (result: PulseResult) => void;

// ═══════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════

// Lingua Franca's own Vercel proxy — supports language lock
const TRANSCRIBE_URL = 'https://lingua-franca-api.vercel.app/api/transcribe';
// Fallback: Sophicon proxy (no language lock on deployed version)
const TRANSCRIBE_FALLBACK = 'https://sophicon-api.vercel.app/api/transcribe';

// API keys (kept for settings UI compatibility)
const DEFAULT_DEEPGRAM_KEY = '2241f7f8cb42af1ef7711a2c9fb0b7d783aad830';
let deepgramKey = DEFAULT_DEEPGRAM_KEY;
let openaiKey: string | null = null;

let listeners: STTCallback[] = [];
let streaming = false;

// Language lock — when set, proxy forces Deepgram to only transcribe this language
let lockedLanguage: string | null = null;

// Audio batch state
let audioChunks: Uint8Array[] = [];
let batchTimer: ReturnType<typeof setInterval> | null = null;
let transcribing = false;
const BATCH_INTERVAL_MS = 2500;
const MIN_AUDIO_BYTES = 16000;   // ~0.5s at 16kHz×16bit×mono — reject tiny bursts from AC/noise

// Rolling transcript
let fullTranscript = '';
let lastTranscriptTime = 0;
const TRANSCRIPT_RESET_MS = 5000;

/** Subscribe to STT results */
export function onPulseResult(cb: STTCallback): () => void {
  listeners.push(cb);
  return () => { listeners = listeners.filter(l => l !== cb); };
}

// ═══════════════════════════════════════════════════════════════════
// API KEYS
// ═══════════════════════════════════════════════════════════════════

export function setPulseKey(key: string): void {
  deepgramKey = key || DEFAULT_DEEPGRAM_KEY;
  log(key ? 'Deepgram key set' : 'Deepgram key → default');
}

export function hasPulseKey(): boolean {
  return true;  // proxy handles auth
}

export function getPulseKey(): string {
  return deepgramKey;
}

/** Set OpenAI key (kept for reference / future direct-call support) */
export function setPulseOpenAIKey(key: string | null | undefined): void {
  openaiKey = key || null;
}

// ═══════════════════════════════════════════════════════════════════
// LANGUAGE LOCK
// ═══════════════════════════════════════════════════════════════════

/** Lock STT to a specific language (ISO 639-1 code like 'es', 'ja', 'fr').
 *  The proxy passes this to Deepgram's language parameter, forcing it to
 *  only transcribe that language. Pass null for auto-detect. */
export function setPulseLanguage(lang: string | null | undefined): void {
  lockedLanguage = lang || null;
  log(lockedLanguage ? `[STT] Language locked → ${lockedLanguage}` : '[STT] Language → auto-detect');
}

export function getPulseLanguage(): string | null {
  return lockedLanguage;
}

// ═══════════════════════════════════════════════════════════════════
// START / STOP
// ═══════════════════════════════════════════════════════════════════

export function startPulseStream(): void {
  if (streaming) return;
  streaming = true;
  audioChunks = [];
  fullTranscript = '';
  transcribing = false;

  log(`[STT] Batch mode started${lockedLanguage ? ` — locked to ${lockedLanguage}` : ' — auto-detect'}`, 'success');

  batchTimer = setInterval(() => {
    if (!streaming) return;
    processBatch();
  }, BATCH_INTERVAL_MS);
}

export function stopPulseStream(): void {
  streaming = false;

  if (batchTimer) {
    clearInterval(batchTimer);
    batchTimer = null;
  }

  if (audioChunks.length > 0 && !transcribing) {
    processBatch();
  }

  audioChunks = [];
  fullTranscript = '';
  lockedLanguage = null;
  log('[STT] Batch mode stopped');
}

export function isPulseActive(): boolean {
  return streaming;
}

// ═══════════════════════════════════════════════════════════════════
// SEND AUDIO — buffer chunks (called by glasses audio event handler)
// ═══════════════════════════════════════════════════════════════════

export function sendAudioChunk(pcm: Uint8Array): void {
  if (!streaming || !pcm || pcm.length === 0) return;
  audioChunks.push(new Uint8Array(pcm));
}

export function flushAudioBuffer(): void {
  if (audioChunks.length > 0 && !transcribing) {
    processBatch();
  }
}

// ═══════════════════════════════════════════════════════════════════
// BATCH PROCESSING — combine chunks → base64 → POST to proxy
//
// The proxy accepts: { audio: "<base64 PCM>", language?: "es" }
// It wraps PCM in WAV, forwards to Deepgram nova-2 (primary)
// or OpenAI gpt-4o-transcribe (fallback).
// When language is set, Deepgram ONLY transcribes that language.
// ═══════════════════════════════════════════════════════════════════

async function processBatch(): Promise<void> {
  if (transcribing || audioChunks.length === 0) return;

  const chunks = audioChunks;
  audioChunks = [];

  const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
  if (totalLen < MIN_AUDIO_BYTES) {
    audioChunks = chunks;
    return;
  }

  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  // Encode to base64
  let binary = '';
  for (let i = 0; i < combined.length; i++) {
    binary += String.fromCharCode(combined[i]);
  }
  const base64 = btoa(binary);

  transcribing = true;
  log(`[STT] Transcribing ${totalLen} bytes${lockedLanguage ? ` (${lockedLanguage})` : ''}...`);

  try {
    // Build payload — language field triggers single-language lock on the proxy
    const payload: Record<string, string> = { audio: base64 };
    if (lockedLanguage) {
      payload.language = lockedLanguage;
    }
    const body = JSON.stringify(payload);
    const hdrs = { 'Content-Type': 'application/json' };

    // Try Lingua Franca proxy first, fall back to Sophicon
    let resp: Response | null = null;
    try {
      resp = await fetch(TRANSCRIBE_URL, { method: 'POST', headers: hdrs, body });
    } catch {
      log('[STT] LF proxy unreachable, trying fallback...', 'error');
    }

    if (!resp || !resp.ok) {
      if (resp) {
        const err = await resp.text();
        log(`[STT] LF proxy ${resp.status}: ${err.slice(0, 40)}, trying fallback...`, 'error');
      }
      try {
        resp = await fetch(TRANSCRIBE_FALLBACK, { method: 'POST', headers: hdrs, body });
      } catch {
        log('[STT] Both proxies failed', 'error');
        transcribing = false;
        return;
      }
    }

    if (!resp || !resp.ok) {
      const err = resp ? await resp.text() : 'no response';
      log(`[STT] Transcribe failed: ${err.slice(0, 60)}`, 'error');
      transcribing = false;
      return;
    }

    const data = await resp.json();
    const text = (data.text || '').trim();
    const confidence = data.confidence || 0;
    const engine = data.engine || 'unknown';

    log(`[STT] Engine: ${engine}, lang: ${data.language || '?'}, conf: ${confidence > 0 ? (confidence * 100).toFixed(0) + '%' : 'n/a'}`);

    // ── Ghost filtering — aggressive rejection of AC/ambient noise artifacts ──
    if (!text) {
      transcribing = false;
      return;
    }

    // Confidence gate — Deepgram returns 0–1, reject anything below 0.65
    if (confidence > 0 && confidence < 0.65) {
      log(`[STT] Low confidence (${(confidence * 100).toFixed(0)}%), skipping: "${text.slice(0, 30)}"`, 'error');
      transcribing = false;
      return;
    }

    // Word count gate — need at least 2 real words (AC hum = single gibberish word)
    const wordCount = text.split(/\s+/).filter((w: string) => w.length > 0).length;
    if (wordCount <= 1) {
      log(`[STT] Single word, skipping: "${text}"`, 'error');
      transcribing = false;
      return;
    }

    // Short text gate — even 2 words must have some substance
    if (text.length < 6) {
      log(`[STT] Too short (${text.length} chars), skipping: "${text}"`, 'error');
      transcribing = false;
      return;
    }

    // Repetition gate — AC noise often produces repeated syllables/words
    const words = text.toLowerCase().split(/\s+/);
    const unique = new Set(words);
    if (words.length >= 3 && unique.size === 1) {
      log(`[STT] Repeated word, skipping: "${text}"`, 'error');
      transcribing = false;
      return;
    }

    const now = Date.now();
    if (now - lastTranscriptTime > TRANSCRIPT_RESET_MS) {
      fullTranscript = '';
    }
    lastTranscriptTime = now;

    fullTranscript = fullTranscript ? fullTranscript + ' ' + text : text;

    log(`[STT] "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"`);

    const result: PulseResult = {
      text: fullTranscript,
      language: lockedLanguage || 'unknown',
      isFinal: true,
    };

    for (const cb of listeners) {
      try { cb(result); } catch (e) { console.warn('[STT] Listener error:', e); }
    }
  } catch (e) {
    log(`[STT] Network error: ${e}`, 'error');
  } finally {
    transcribing = false;
  }
}
