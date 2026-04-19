// ═══════════════════════════════════════════════════════════════════
// Lingua Franca — Deepgram STT (Live WebSocket Streaming)
// Real-time speech-to-text via wss://api.deepgram.com/v1/listen
// Replaced Smallest.ai Pulse — Deepgram supports browser WebSocket
// natively (no proxy required, auth via query param).
//
// Audio format: linear16 (signed 16-bit LE), 16kHz, mono
// Chunk size: 4096 bytes (~128ms of audio), streamed in real-time
// Model: nova-3 (latest, supports 30+ languages)
// ═══════════════════════════════════════════════════════════════════

import { log } from './ui';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface PulseResult {
  text: string;           // transcription in the spoken language
  language: string;       // detected language code
  isFinal: boolean;       // whether this is a final (settled) transcription
}

type STTCallback = (result: PulseResult) => void;

// ═══════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════

// Default Deepgram API key — hardcoded so STT works immediately without settings load
const DEFAULT_DEEPGRAM_KEY = '2241f7f8cb42af1ef7711a2c9fb0b7d783aad830';
let apiKey = DEFAULT_DEEPGRAM_KEY;
let ws: WebSocket | null = null;
let connected = false;
let listeners: STTCallback[] = [];
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pendingChunks: Uint8Array[] = [];  // buffer chunks while connecting
let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

// Accumulate partial transcriptions into a rolling transcript
let currentTranscript = '';
let lastTranscriptTime = 0;
const TRANSCRIPT_RESET_MS = 3000;  // reset transcript after 3s silence

/** Subscribe to STT results */
export function onPulseResult(cb: STTCallback): () => void {
  listeners.push(cb);
  return () => { listeners = listeners.filter(l => l !== cb); };
}

// ═══════════════════════════════════════════════════════════════════
// API KEY
// ═══════════════════════════════════════════════════════════════════

export function setPulseKey(key: string): void {
  apiKey = key || DEFAULT_DEEPGRAM_KEY;  // fall back to default if cleared
  log(key ? 'Deepgram API key set' : 'Deepgram API key → default');
}

export function hasPulseKey(): boolean {
  return apiKey.length > 0;
}

export function getPulseKey(): string {
  return apiKey;
}

// ═══════════════════════════════════════════════════════════════════
// WEBSOCKET CONNECTION
// Deepgram live streaming: wss://api.deepgram.com/v1/listen
// Auth: token query param (works in browsers — no proxy needed!)
// Response: {"type":"Results","channel":{"alternatives":[{"transcript":"..."}]}}
// ═══════════════════════════════════════════════════════════════════

/**
 * Build the Deepgram WebSocket URL.
 * Unlike Smallest.ai, Deepgram supports browser WebSocket auth
 * via query parameter — no server-side proxy needed.
 */
function buildDeepgramUrl(): string {
  const params = new URLSearchParams({
    model: 'nova-3',
    language: 'multi',           // auto-detect language
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '1',
    punctuate: 'true',
    interim_results: 'true',     // get partial transcriptions
    smart_format: 'true',        // auto-format numbers, dates, etc.
    token: apiKey,               // Deepgram supports token as query param
  });

  return `wss://api.deepgram.com/v1/listen?${params.toString()}`;
}

export function startPulseStream(): void {
  if (!apiKey) {
    log('[Deepgram] No API key — set it in Settings', 'error');
    return;
  }
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;  // already active
  }

  // Reset state for fresh connection
  currentTranscript = '';
  lastTranscriptTime = 0;
  chunkBuffer = new Uint8Array(0);
  pendingChunks = [];

  const url = buildDeepgramUrl();
  log('[Deepgram] Connecting...');

  ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    connected = true;
    log('[Deepgram] Connected — streaming', 'success');

    // Start keep-alive heartbeat (Deepgram closes after 10s of no data)
    if (keepAliveTimer) clearInterval(keepAliveTimer);
    keepAliveTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'KeepAlive' }));
      }
    }, 5000);  // every 5 seconds

    // Flush any chunks that arrived while connecting
    for (const chunk of pendingChunks) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(chunk);
      }
    }
    pendingChunks = [];
  };

  ws.onmessage = (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data as string);

      // Deepgram response format:
      // {"type":"Results","channel":{"alternatives":[{"transcript":"...","confidence":0.99}]},"is_final":true,"speech_final":true}
      if (data.type !== 'Results') return;

      const alt = data.channel?.alternatives?.[0];
      if (!alt) return;

      const text = alt.transcript || '';
      if (!text.trim()) return;

      const now = Date.now();

      // Reset rolling transcript if there was a long pause
      if (now - lastTranscriptTime > TRANSCRIPT_RESET_MS) {
        currentTranscript = '';
      }
      lastTranscriptTime = now;

      // Update rolling transcript
      currentTranscript = text;

      // Detect language from response metadata
      const detectedLang = data.metadata?.detected_language
        || data.channel?.detected_language
        || 'unknown';

      const result: PulseResult = {
        text: currentTranscript,
        language: detectedLang,
        isFinal: data.is_final === true,
      };

      // Notify all listeners
      for (const cb of listeners) {
        try { cb(result); } catch (e) { console.warn('[Deepgram] Listener error:', e); }
      }
    } catch (e) {
      // Non-JSON message or parse error
      const msg = typeof event.data === 'string' ? event.data : '';
      if (msg) log(`[Deepgram] ${msg.slice(0, 80)}`);
    }
  };

  ws.onerror = (event) => {
    log('[Deepgram] WebSocket error', 'error');
    console.error('[Deepgram] WS error:', event);
  };

  ws.onclose = (event) => {
    connected = false;
    ws = null;

    // Stop keep-alive
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }

    log(`[Deepgram] Disconnected (code: ${event.code})`);

    // Auto-reconnect if we still have an API key (wasn't intentionally stopped)
    if (apiKey && !reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (apiKey) {
          log('[Deepgram] Reconnecting...');
          startPulseStream();
        }
      }, 2000);
    }
  };
}

/** Stop the Deepgram WebSocket stream */
export function stopPulseStream(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
  if (ws) {
    // Send CloseStream signal before closing (tells Deepgram to flush final transcript)
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'CloseStream' }));
      }
    } catch { /* ignore */ }

    ws.onclose = null;  // prevent auto-reconnect
    ws.close();
    ws = null;
  }
  connected = false;
  pendingChunks = [];
  currentTranscript = '';
  log('[Deepgram] Stream stopped');
}

/** Whether the Deepgram stream is active */
export function isPulseActive(): boolean {
  return connected && ws !== null && ws.readyState === WebSocket.OPEN;
}

// ═══════════════════════════════════════════════════════════════════
// SEND AUDIO — stream raw PCM chunks to Deepgram
// Called by the glasses audio event handler with each PCM chunk.
// Deepgram accepts any chunk size, but we buffer to 4096 for
// consistency with the glasses 4-mic array output.
// ═══════════════════════════════════════════════════════════════════

let chunkBuffer = new Uint8Array(0);
const CHUNK_SIZE = 4096;

/** Send raw PCM audio data to Deepgram. Buffers to 4096-byte chunks. */
export function sendAudioChunk(pcm: Uint8Array): void {
  if (!pcm || pcm.length === 0) return;

  // Append to buffer
  const newBuffer = new Uint8Array(chunkBuffer.length + pcm.length);
  newBuffer.set(chunkBuffer, 0);
  newBuffer.set(pcm, chunkBuffer.length);
  chunkBuffer = newBuffer;

  // Send complete chunks
  while (chunkBuffer.length >= CHUNK_SIZE) {
    const chunk = chunkBuffer.slice(0, CHUNK_SIZE);
    chunkBuffer = chunkBuffer.slice(CHUNK_SIZE);

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(chunk);
    } else if (ws && ws.readyState === WebSocket.CONNECTING) {
      pendingChunks.push(chunk);
    }
    // If not connected at all, drop the audio (will reconnect)
  }
}

/** Flush any remaining audio in the buffer + signal end of audio */
export function flushAudioBuffer(): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    if (chunkBuffer.length > 0) {
      ws.send(chunkBuffer.slice(0));
    }
    // Signal end of audio so Deepgram returns final transcription
    ws.send(JSON.stringify({ type: 'CloseStream' }));
  }
  chunkBuffer = new Uint8Array(0);
}
