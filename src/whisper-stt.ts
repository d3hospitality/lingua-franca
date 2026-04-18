// ═══════════════════════════════════════════════════════════════════
// Lingua Franca — Whisper Speech-to-Text Pipeline
// Receives raw PCM from G2 glasses mic (16kHz, 16-bit LE, mono),
// converts to WAV, sends to OpenAI Whisper API for transcription
// + language detection. Also translates to English via Whisper.
//
// Supported languages (all 20 Lingua Franca languages):
//   ar, bg, de, en, es, fr, hi, id, it, ja, ko,
//   nl, pl, pt, ru, sv, th, tl, tr, vi, zh
// ═══════════════════════════════════════════════════════════════════

import { hasOpenAIKey, getOpenAIKey } from './ai-phrases';
import { log } from './ui';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface WhisperResult {
  text: string;           // transcription in the spoken language
  language: string;       // ISO 639-1 detected language code (e.g. "ja", "nl")
  translation?: string;   // English translation (if source wasn't English)
}

type STTCallback = (result: WhisperResult) => void;

// ═══════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════

let processing = false;
let listeners: STTCallback[] = [];

/** Subscribe to STT results */
export function onWhisperResult(cb: STTCallback): () => void {
  listeners.push(cb);
  return () => { listeners = listeners.filter(l => l !== cb); };
}

// ═══════════════════════════════════════════════════════════════════
// PCM → WAV CONVERSION
// The glasses send raw PCM: 16kHz, signed 16-bit little-endian, mono.
// Whisper API expects a file upload (WAV, MP3, etc), so we wrap the
// PCM in a minimal WAV header.
// ═══════════════════════════════════════════════════════════════════

const SAMPLE_RATE = 16000;
const BITS_PER_SAMPLE = 16;
const NUM_CHANNELS = 1;

function pcmToWav(pcm: Uint8Array): Blob {
  const dataSize = pcm.length;
  const headerSize = 44;
  const buffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);  // file size - 8
  writeString(view, 8, 'WAVE');

  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);                                           // sub-chunk size
  view.setUint16(20, 1, true);                                            // PCM format
  view.setUint16(22, NUM_CHANNELS, true);                                 // mono
  view.setUint32(24, SAMPLE_RATE, true);                                  // sample rate
  view.setUint32(28, SAMPLE_RATE * NUM_CHANNELS * BITS_PER_SAMPLE / 8, true); // byte rate
  view.setUint16(32, NUM_CHANNELS * BITS_PER_SAMPLE / 8, true);          // block align
  view.setUint16(34, BITS_PER_SAMPLE, true);                             // bits per sample

  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Copy PCM data
  new Uint8Array(buffer, headerSize).set(pcm);

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

// ═══════════════════════════════════════════════════════════════════
// WHISPER API — TRANSCRIBE + TRANSLATE
// Two calls:
//   1. /v1/audio/transcriptions — gets text in original language + detected lang
//   2. /v1/audio/translations  — gets English translation (if not already English)
// ═══════════════════════════════════════════════════════════════════

/** Send PCM audio to Whisper API and return transcription + translation */
export async function transcribeAudio(pcm: Uint8Array): Promise<WhisperResult | null> {
  const apiKey = getOpenAIKey();
  if (!apiKey) {
    log('[STT] No API key — set it in Settings', 'error');
    return null;
  }
  if (processing) {
    // Skip if a previous request is still in flight
    return null;
  }
  if (pcm.length < 3200) {
    // Less than ~100ms of audio, skip
    return null;
  }

  processing = true;

  try {
    const wavBlob = pcmToWav(pcm);

    // Step 1: Transcribe — get text in original language + detected language
    const transcribeForm = new FormData();
    transcribeForm.append('file', wavBlob, 'audio.wav');
    transcribeForm.append('model', 'whisper-1');
    transcribeForm.append('response_format', 'verbose_json');

    const transcribeResp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: transcribeForm,
    });

    if (!transcribeResp.ok) {
      const err = await transcribeResp.text().catch(() => '');
      log(`[STT] Transcribe error: ${transcribeResp.status}`, 'error');
      console.error('[STT] Transcribe error:', err);
      return null;
    }

    const transcribeData = await transcribeResp.json();
    const text: string = transcribeData.text || '';
    const detectedLang: string = transcribeData.language || 'unknown';

    if (!text.trim()) {
      return null;  // silence / no speech detected
    }

    log(`[STT] ${detectedLang}: "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"`);

    // Step 2: Translate to English (if source isn't English)
    let translation: string | undefined;
    if (detectedLang !== 'english' && detectedLang !== 'en') {
      const translateForm = new FormData();
      translateForm.append('file', wavBlob, 'audio.wav');
      translateForm.append('model', 'whisper-1');

      const translateResp = await fetch('https://api.openai.com/v1/audio/translations', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        body: translateForm,
      });

      if (translateResp.ok) {
        const translateData = await translateResp.json();
        translation = translateData.text || '';
      }
    }

    const result: WhisperResult = {
      text,
      language: mapWhisperLang(detectedLang),
      translation: translation || (detectedLang === 'english' || detectedLang === 'en' ? text : undefined),
    };

    // Notify listeners
    for (const cb of listeners) {
      try { cb(result); } catch (e) { console.warn('[STT] Listener error:', e); }
    }

    return result;
  } catch (e) {
    log(`[STT] Error: ${e}`, 'error');
    return null;
  } finally {
    processing = false;
  }
}

// ═══════════════════════════════════════════════════════════════════
// LANGUAGE MAPPING
// Whisper returns full language names (e.g. "japanese", "dutch").
// Map to our ISO 639-1 codes.
// ═══════════════════════════════════════════════════════════════════

const WHISPER_LANG_MAP: Record<string, string> = {
  'arabic': 'ar',
  'bulgarian': 'bg',
  'chinese': 'zh',
  'dutch': 'nl',
  'english': 'en',
  'french': 'fr',
  'german': 'de',
  'hindi': 'hi',
  'indonesian': 'id',
  'italian': 'it',
  'japanese': 'ja',
  'korean': 'ko',
  'polish': 'pl',
  'portuguese': 'pt',
  'russian': 'ru',
  'spanish': 'es',
  'swedish': 'sv',
  'tagalog': 'tl',
  'thai': 'th',
  'turkish': 'tr',
  'vietnamese': 'vi',
};

function mapWhisperLang(whisperLang: string): string {
  // Whisper sometimes returns the ISO code directly, sometimes the full name
  if (whisperLang.length <= 3) return whisperLang;
  return WHISPER_LANG_MAP[whisperLang.toLowerCase()] || whisperLang;
}
