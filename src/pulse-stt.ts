// ═══════════════════════════════════════════════════════════════════
// Lingua Franca — Pulse STT (Smallest.ai WebSocket Streaming)
// Real-time speech-to-text via wss://api.smallest.ai/waves/v1/pulse
// Replaces Whisper REST API with sub-70ms streaming transcription.
//
// Audio format: linear16 (signed 16-bit LE), 16kHz, mono
// Chunk size: 4096 bytes (~128ms of audio), streamed in real-time
// Supports 30+ languages with auto-detect (language=multi)
// ═══════════════════════════════════════════════════════════════════

import { log } from './ui';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface PulseResult {
  text: string;           // transcription in the spoken language
  language: string;       // detected language code (from Pulse or inferred)
  isFinal: boolean;       // whether this is a final (settled) transcription
}

type STTCallback = (result: PulseResult) => void;

// ═══════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════

let apiKey = '';
let ws: WebSocket | null = null;
let connected = false;
let listeners: STTCallback[] = [];
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pendingChunks: Uint8Array[] = [];  // buffer chunks while connecting

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
  apiKey = key;
  log(key ? 'Pulse API key set' : 'Pulse API key cleared');
}

export function hasPulseKey(): boolean {
  return apiKey.length > 0;
}

export function getPulseKey(): string {
  return apiKey;
}

// ═══════════════════════════════════════════════════════════════════
// WEBSOCKET CONNECTION
// Opens a streaming WebSocket to Pulse STT.
// Audio chunks are sent as binary frames; transcription results
// come back as JSON text frames: {"transcription": "..."}
// ═══════════════════════════════════════════════════════════════════

const PULSE_BASE_URL = 'wss://api.smallest.ai/waves/v1/pulse/get_text';

export function startPulseStream(): void {
  if (!apiKey) {
    log('[Pulse] No API key — set it in Settings', 'error');
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

  const params = new URLSearchParams({
    encoding: 'linear16',
    sample_rate: '16000',
    language: 'multi',           // auto-detect from 30+ languages
  });

  // Smallest.ai accepts auth via:
  //   1. Authorization header (not available in browser WebSocket)
  //   2. Token as query parameter
  //   3. Token as Sec-WebSocket-Protocol subprotocol
  // Use query param + subprotocol as belt-and-suspenders approach
  const url = `${PULSE_BASE_URL}?${params.toString()}&token=${encodeURIComponent(apiKey)}`;
  log('[Pulse] Connecting...');

  ws = new WebSocket(url, [`token-${apiKey}`]);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    connected = true;
    log('[Pulse] Connected — streaming', 'success');

    // Also send auth as first text message (covers all auth methods)
    if (ws) {
      ws.send(JSON.stringify({
        type: 'auth',
        token: apiKey,
      }));
    }

    // Flush any chunks that arrived while connecting
    for (const chunk of pendingChunks) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(chunk.buffer);
      }
    }
    pendingChunks = [];
  };

  ws.onmessage = (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data as string);

      // Pulse response format: {"transcription": "...", ...}
      const text = data.transcription || data.text || '';
      if (!text.trim()) return;

      const now = Date.now();

      // Reset rolling transcript if there was a long pause
      if (now - lastTranscriptTime > TRANSCRIPT_RESET_MS) {
        currentTranscript = '';
      }
      lastTranscriptTime = now;

      // Update rolling transcript
      currentTranscript = text;

      // Detect language from response if available
      const detectedLang = data.language || data.detected_language || 'unknown';

      const result: PulseResult = {
        text: currentTranscript,
        language: detectedLang,
        isFinal: data.is_final !== false,  // default to final if not specified
      };

      // Notify all listeners
      for (const cb of listeners) {
        try { cb(result); } catch (e) { console.warn('[Pulse] Listener error:', e); }
      }
    } catch (e) {
      // Non-JSON message or parse error — could be a status message
      const msg = typeof event.data === 'string' ? event.data : '';
      if (msg) log(`[Pulse] ${msg.slice(0, 80)}`);
    }
  };

  ws.onerror = (event) => {
    log('[Pulse] WebSocket error', 'error');
    console.error('[Pulse] WS error:', event);
  };

  ws.onclose = (event) => {
    connected = false;
    ws = null;
    log(`[Pulse] Disconnected (code: ${event.code})`);

    // Auto-reconnect if we still have an API key (wasn't intentionally stopped)
    if (apiKey && !reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (apiKey) {
          log('[Pulse] Reconnecting...');
          startPulseStream();
        }
      }, 2000);
    }
  };
}

/** Stop the Pulse WebSocket stream */
export function stopPulseStream(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    // Send end-of-stream signal before closing
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'end' }));
      }
    } catch { /* ignore */ }

    ws.onclose = null;  // prevent auto-reconnect
    ws.close();
    ws = null;
  }
  connected = false;
  pendingChunks = [];
  currentTranscript = '';
  log('[Pulse] Stream stopped');
}

/** Whether the Pulse stream is active */
export function isPulseActive(): boolean {
  return connected && ws !== null && ws.readyState === WebSocket.OPEN;
}

// ═══════════════════════════════════════════════════════════════════
// SEND AUDIO — stream raw PCM chunks to Pulse
// Called by the glasses audio event handler with each PCM chunk.
// Pulse expects 4096-byte chunks at 50-100ms intervals.
// The glasses send ~3200 bytes/100ms (16kHz * 2 bytes * 0.1s),
// so we accumulate to 4096 before sending.
// ═══════════════════════════════════════════════════════════════════

let chunkBuffer = new Uint8Array(0);
const PULSE_CHUNK_SIZE = 4096;

/** Send raw PCM audio data to Pulse. Buffers to 4096-byte chunks. */
export function sendAudioChunk(pcm: Uint8Array): void {
  if (!pcm || pcm.length === 0) return;

  // Append to buffer
  const newBuffer = new Uint8Array(chunkBuffer.length + pcm.length);
  newBuffer.set(chunkBuffer, 0);
  newBuffer.set(pcm, chunkBuffer.length);
  chunkBuffer = newBuffer;

  // Send complete 4096-byte chunks
  while (chunkBuffer.length >= PULSE_CHUNK_SIZE) {
    const chunk = chunkBuffer.slice(0, PULSE_CHUNK_SIZE);
    chunkBuffer = chunkBuffer.slice(PULSE_CHUNK_SIZE);

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(chunk.buffer);
    } else if (ws && ws.readyState === WebSocket.CONNECTING) {
      // Buffer while connecting
      pendingChunks.push(chunk);
    }
    // If not connected at all, drop the audio (will reconnect)
  }
}

/** Flush any remaining audio in the buffer (e.g., when mic stops) */
export function flushAudioBuffer(): void {
  if (chunkBuffer.length > 0 && ws && ws.readyState === WebSocket.OPEN) {
    // Send whatever we have, even if < 4096
    ws.send(chunkBuffer.buffer.slice(0, chunkBuffer.length));
  }
  chunkBuffer = new Uint8Array(0);
}
