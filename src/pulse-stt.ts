// ═══════════════════════════════════════════════════════════════════
// Lingua Franca — Batch STT (HTTP POST, proven in Even Hub webview)
//
// The Even Hub glasses webview CANNOT maintain WebSocket connections
// to external servers (wss://api.deepgram.com fails silently).
// Sophicon proved that HTTP fetch() POST works reliably.
//
// Strategy: collect audio chunks for ~2 seconds, batch them,
// POST to transcription proxy (same pattern as Sophicon ER-G2).
//
// Audio format: linear16 (signed 16-bit LE), 16kHz, mono
// Proxy: Sophicon's Vercel proxy → OpenAI gpt-4o-transcribe
// ═══════════════════════════════════════════════════════════════════

import { log } from './ui';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface PulseResult {
  text: string;           // transcription in the spoken language
  language: string;       // detected language code (or 'unknown')
  isFinal: boolean;       // batch mode = always true
}

type STTCallback = (result: PulseResult) => void;

// ═══════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════

// Transcription proxy — Sophicon's Vercel endpoint (proven to work)
const TRANSCRIBE_URL = 'https://sophicon-api.vercel.app/api/transcribe';

// Deepgram API key (kept for future use if WebSocket proxy is added)
const DEFAULT_DEEPGRAM_KEY = '2241f7f8cb42af1ef7711a2c9fb0b7d783aad830';
let apiKey = DEFAULT_DEEPGRAM_KEY;

let listeners: STTCallback[] = [];
let streaming = false;

// Audio batch state
let audioChunks: Uint8Array[] = [];
let batchTimer: ReturnType<typeof setInterval> | null = null;
let transcribing = false;  // prevent overlapping transcription requests
const BATCH_INTERVAL_MS = 2500;  // send audio every 2.5 seconds
const MIN_AUDIO_BYTES = 8000;    // don't transcribe < 0.25s of audio (16kHz × 2 bytes × 0.25s)

// Rolling transcript
let fullTranscript = '';
let lastTranscriptTime = 0;
const TRANSCRIPT_RESET_MS = 5000;  // reset after 5s silence

/** Subscribe to STT results */
export function onPulseResult(cb: STTCallback): () => void {
  listeners.push(cb);
  return () => { listeners = listeners.filter(l => l !== cb); };
}

// ═══════════════════════════════════════════════════════════════════
// API KEY (kept for settings UI compatibility)
// ═══════════════════════════════════════════════════════════════════

export function setPulseKey(key: string): void {
  apiKey = key || DEFAULT_DEEPGRAM_KEY;
  log(key ? 'STT API key set' : 'STT API key → default');
}

export function hasPulseKey(): boolean {
  return true;  // always available — proxy handles auth
}

export function getPulseKey(): string {
  return apiKey;
}

// ═══════════════════════════════════════════════════════════════════
// START / STOP — batch audio collection + periodic transcription
// ═══════════════════════════════════════════════════════════════════

export function startPulseStream(): void {
  if (streaming) return;
  streaming = true;
  audioChunks = [];
  fullTranscript = '';
  transcribing = false;

  log('[STT] Batch mode started — collecting audio', 'success');

  // Periodically send batched audio for transcription
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

  // Process any remaining audio
  if (audioChunks.length > 0 && !transcribing) {
    processBatch();
  }

  audioChunks = [];
  fullTranscript = '';
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
  audioChunks.push(new Uint8Array(pcm));  // defensive copy
}

export function flushAudioBuffer(): void {
  if (audioChunks.length > 0 && !transcribing) {
    processBatch();
  }
}

// ═══════════════════════════════════════════════════════════════════
// BATCH PROCESSING — combine chunks → base64 → POST to proxy
// Same proven pattern as Sophicon ER-G2 speak.ts
// ═══════════════════════════════════════════════════════════════════

async function processBatch(): Promise<void> {
  if (transcribing || audioChunks.length === 0) return;

  // Grab current chunks and reset buffer
  const chunks = audioChunks;
  audioChunks = [];

  // Combine all chunks into one buffer
  const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
  if (totalLen < MIN_AUDIO_BYTES) {
    // Too little audio — put chunks back and wait for more
    audioChunks = chunks;
    return;
  }

  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  // Encode to base64 (same as Sophicon)
  let binary = '';
  for (let i = 0; i < combined.length; i++) {
    binary += String.fromCharCode(combined[i]);
  }
  const base64 = btoa(binary);

  transcribing = true;
  log(`[STT] Transcribing ${totalLen} bytes...`);

  try {
    const resp = await fetch(TRANSCRIBE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: base64 }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      log(`[STT] Transcribe failed: ${resp.status} ${err.slice(0, 60)}`, 'error');
      transcribing = false;
      return;
    }

    const data = await resp.json();
    const text = (data.text || '').trim();

    if (!text) {
      transcribing = false;
      return;
    }

    const now = Date.now();

    // Reset rolling transcript if there was a long pause
    if (now - lastTranscriptTime > TRANSCRIPT_RESET_MS) {
      fullTranscript = '';
    }
    lastTranscriptTime = now;

    // Append to rolling transcript
    if (fullTranscript) {
      fullTranscript += ' ' + text;
    } else {
      fullTranscript = text;
    }

    log(`[STT] "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"`);

    // Notify all listeners
    const result: PulseResult = {
      text: fullTranscript,
      language: 'unknown',  // OpenAI Whisper auto-detects but doesn't always report
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
