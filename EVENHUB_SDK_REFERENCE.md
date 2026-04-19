# Even Hub SDK — Complete Developer Reference

> Compiled from https://hub.evenrealities.com/docs — April 2026
> For Lingua Franca G2 + sommNI G2 + soPHICON G2 development

---

## 1. Overview

The Even Realities G2 are smart glasses with:

- **Display:** 576 × 288 pixels per eye
- **Color depth:** 4-bit greyscale (16 shades of green)
- **Connectivity:** Bluetooth 5.2
- **Audio input:** 4-mic array (single stream, 16kHz PCM signed 16-bit LE mono)
- **Input:** Touchpads on temples (press, double-press, swipe up/down) + optional R1 ring (same gestures)
- **No:** camera, speaker, background colors, font control, text alignment, animations, arbitrary pixel drawing, audio output

App logic runs on the phone (in a WebView); the glasses handle display rendering and native scroll processing.

**Architecture:**
```
Even Hub Cloud ↔ (HTTPS) ↔ Phone (WebView) ↔ (Bluetooth) ↔ G2 Glasses
```

The SDK injects a JavaScript bridge (`EvenAppBridge`) into the WebView.
- **Web → Glasses:** `bridge.callEvenApp(method, params)`
- **Glasses → Web:** Input events trigger `window._listenEvenAppMessage(...)`

---

## 2. Installation

### Prerequisites
- Node.js v18+
- Web framework (Vite recommended)
- Even Realities App on phone (for testing)
- G2 glasses (for hardware testing)
- R1 ring (optional)

### SDK
```bash
npm install @evenrealities/even_hub_sdk    # v0.0.9
```
Typed methods for display control, input handling, audio, device info, and local storage.

### Simulator
```bash
npm install -g @evenrealities/evenhub-simulator    # v0.6.2
```
Cross-platform (macOS, Linux, Windows). Supplements but does not replace hardware testing.

### CLI
```bash
npm install -D @evenrealities/evenhub-cli    # v0.1.10
```
Handles authentication, QR sideloading, and app packaging.

---

## 3. Your First App

### Initialize the SDK
```typescript
import { waitForEvenAppBridge, EvenAppBridge } from '@evenrealities/even_hub_sdk'

// Recommended: async wait — resolves when the bridge is ready
const bridge = await waitForEvenAppBridge()

// Alternative: synchronous singleton — only after bridge is initialized
const bridge = EvenAppBridge.getInstance()
```

### Create a Page
```typescript
import { waitForEvenAppBridge, TextContainerProperty } from '@evenrealities/even_hub_sdk'

const bridge = await waitForEvenAppBridge()

const textContainer = new TextContainerProperty({
  xPosition: 0,
  yPosition: 0,
  width: 576,
  height: 288,
  borderWidth: 0,
  borderColor: 5,
  paddingLength: 4,
  containerID: 1,
  containerName: 'main',
  content: 'Hello from G2!',
  isEventCapture: 1,
})

const result = await bridge.createStartUpPageContainer(1, [textContainer])
// result: 0 = success, 1 = invalid, 2 = oversize, 3 = out of memory
```

### Run It
```bash
# With simulator
evenhub-simulator http://localhost:5173

# On real hardware
evenhub qr --url "http://192.168.1.100:5173"
```

---

## 4. App Structure

```
my-app/
├── src/            (main.ts, components/)
├── public/         (assets/)
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
└── app.json        ← Even Hub manifest (required)
```

### Testing Approaches
1. **QR sideloading** — local dev server + CLI QR codes, hot reload
2. **Private builds** — package via CLI, upload to developer portal
3. **Simulator** — preview on computer without hardware
4. **PWA** — host independently, bypass Even Hub packaging/review

---

## 5. Page Lifecycle

### Core Methods

| Method | Purpose | Notes |
|--------|---------|-------|
| `createStartUpPageContainer` | Create initial page | Called once at startup. Returns result code (0=success, 1=invalid, 2=oversize, 3=OOM) |
| `rebuildPageContainer` | Replace entire page | Full redraw, state loss, brief flicker |
| `textContainerUpgrade` | Update text in-place | Faster, flicker-free. Container ID + name must match exactly |
| `updateImageRawData` | Update image container | No concurrent sends allowed |
| `shutDownPageContainer` | Exit the app | Accepts parameter for immediate or confirmed exit |
| `callEvenApp` | Generic method call | Wrapper foundation for typed methods |

### Result Codes
- **Startup:** 0=success, 1=invalid params, 2=oversize, 3=out of memory
- **Rebuild/Upgrade/Shutdown:** boolean
- **Image update:** "success", "imageException", "imageSizeInvalid", "imageToGray4Failed", "sendFailed"

### Best Practices
- Use `textContainerUpgrade` for frequent text updates (counters, status, live data)
- Use `rebuildPageContainer` when changing the container layout
- Container ID + name must match precisely during text upgrades
- Image updates must be sequential — no concurrent sends

---

## 6. Display & UI System

### Canvas
- 576 × 288 px per eye
- Origin: top-left (0, 0)
- 4-bit greyscale (16 levels of green)

### Container Architecture
UI = rectangular containers with absolute positioning.

**Constraints:**
- Max **4 image containers** and **8 other containers** per page
- Exactly **one container** must have `isEventCapture: 1`
- Containers overlap based on declaration order (no z-index)

### Shared Container Properties
All containers: `xPosition`, `yPosition`, `width`, `height`, `containerID`, `containerName`, `isEventCapture`
Text/List only: `borderWidth`, `borderColor`, `borderRadius`, `paddingLength`

### Text Containers (`TextContainerProperty`)
- Plain, left-aligned text only — no formatting options
- Content limits: 1,000 chars at startup, 2,000 for upgrades
- Text wraps at container width
- `\n` for line breaks
- ~400–500 characters fill a full-screen text container
- Update via `textContainerUpgrade` (flicker-free) when layout unchanged

### List Containers (`ListContainerProperty`)
- Native scrollable lists
- Max **20 items**, max **64 characters** per item
- **Cannot be updated in-place** — requires full page rebuild
- Configured via `ListItemContainerProperty`:
  - `itemCount`: number of items
  - `itemWidth`: 0 for auto
  - `isItemSelectBorderEn`: 1 to show selection border
  - `itemName`: string array of item labels

### Image Containers (`ImageContainerProperty`)
- Accepts greyscale images
- Size range per SDK protobuf: **20–288px width, 20–144px height**
- Original docs stated 20–200 width / 20–100 height — this is outdated. The TypeScript `.d.ts` confirms 288×144.
- **Proven safe dimensions (from sommNI 2):** up to 190×140 per container. Heights above 100 work (tested at 140).
- **Cannot send images during `createStartUpPageContainer`** — use placeholder, then push via `updateImageRawData`
- Image data: raw grayscale PNG bytes as `number[]`
- Max **4 image containers** per page

### Unicode Support
The glasses use a single embedded LVGL font. Useful characters:
- Box-drawing elements for borders/separators
- Progress bar symbols (block characters)
- Navigation arrows for UI construction

---

## 7. Input & Events

### Input Sources
- **G2 touchpads** (temple): Press, double press, swipe up/down
- **R1 touchpads** (ring): Same gesture set, distinguishable by source
- **IMU sensors**: Head orientation and motion data

### Event Types (`OsEventTypeList`)

| Event | Value | Description |
|-------|-------|-------------|
| `CLICK_EVENT` | 0 | Single press |
| `SCROLL_TOP_EVENT` | 1 | Swipe up / scroll reaches top |
| `SCROLL_BOTTOM_EVENT` | 2 | Swipe down / scroll reaches bottom |
| `DOUBLE_CLICK_EVENT` | 3 | Double press |
| `FOREGROUND_ENTER_EVENT` | 4 | App comes to foreground |
| `FOREGROUND_EXIT_EVENT` | 5 | App goes to background |
| `ABNORMAL_EXIT_EVENT` | 6 | Unexpected disconnect |

### Handling Events
```typescript
bridge.onEvenHubEvent((event: EvenHubEvent) => {
  if (event.listEvent) {
    // List scroll/click events
    const idx = event.listEvent.currentSelectItemIndex;
    const type = event.listEvent.eventType;
  }
  if (event.textEvent) {
    // Text container events
    const type = event.textEvent.eventType;
  }
  if (event.sysEvent) {
    // System events (double-click, lifecycle)
    const type = event.sysEvent.eventType;
  }
  if (event.audioEvent) {
    // Microphone audio data
    const pcm = event.audioEvent.audioPcm;
  }
});
```

### Event Routing
- Only **one container per page** can capture events (`isEventCapture: 1`)
- Events route to text or list containers based on that flag

---

## 8. Device APIs

### Audio Control
```typescript
await bridge.audioControl(true);   // Start mic capture
await bridge.audioControl(false);  // Stop mic capture
```
PCM format: 16kHz, signed 16-bit LE, mono. Arrives via `audioEvent` callbacks.

### IMU (Motion Sensors)
```typescript
bridge.imuControl(frequency);  // 100–1000 protocol pacing codes
```
Data arrives as `Sys_ItemEvent` objects with x, y, z axis values.

### Device Information
```typescript
const device = await bridge.getDeviceInfo();
// device.model, device.sn, device.status.isConnected(), device.status.batteryLevel

bridge.onDeviceStatusChanged((status) => {
  // status.connectType: Connected, Disconnected, Connecting
  // status.batteryLevel, status.wearingStatus, status.chargingState
});
```

### User Information
```typescript
const user = await bridge.getUserInfo();
// user.id, user.name, user.avatar, user.country
```

### Local Storage
```typescript
await bridge.setLocalStorage("key", "value");
const val = await bridge.getLocalStorage("key");
```

### Known Limitations
No direct Bluetooth access, no arbitrary pixel drawing, no audio output, no text alignment, no font control, no background colors, no per-item list styling, no programmatic scroll position, no animations, no camera, images are greyscale only.

---

## 9. Design Guidelines

### Display Constraints
- 576 × 288 px canvas
- 4-bit greyscale
- No background fills
- Max 4 image containers, 8 other containers
- One event-capturing container per page

### Icon Design
- Design at native resolution
- Keep it simple — recognizable silhouettes
- **Test on actual hardware** — green-tinted greyscale differs from monitor

### Common UI Patterns
- **Fake buttons:** Use `>` as cursor indicator
- **Selection highlights:** Toggle `borderWidth` on text containers
- **Multi-row layouts:** Stack text containers vertically
- **Progress bars:** Unicode block characters
- **Page flipping:** Pre-paginate text at ~400–500 character boundaries

### Figma
Official design file available (linked from docs site).

---

## 10. Simulator Reference

### Usage
```bash
evenhub-simulator [OPTIONS] [targetUrl]
```

### Options
| Flag | Description |
|------|-------------|
| `-c, --config <path>` | Path to config file |
| `-g, --glow` | Enable glow effect |
| `--no-glow` | Disable glow effect |
| `-b, --bounce <type>` | Animation type (default or spring) |
| `--list-audio-input-devices` | List available audio devices |
| `--aid <device>` | Choose specific audio input device |
| `--no-aid` | Use default audio device |
| `--print-config-path` | Print default config file path |
| `-V, --version` | Print version |

### Audio Spec
16,000 Hz sample rate, signed 16-bit LE PCM, 100ms per event (3,200 bytes).

### Screenshot (v0.5.0+)
Click screenshot button → RGBA PNG with timestamp filename to current directory.

### Caveats
- Display rendering may not perfectly match hardware
- List scrolling behavior differs from real glasses
- Image processing is faster without hardware size limits
- Status events unsupported in simulator; supports Up, Down, Click, Double Click
- **Always validate on actual hardware before deployment**

---

## 11. Packaging & Deployment

### App Manifest (`app.json`)
Generated via `evenhub init`. Required fields:

| Field | Requirements |
|-------|-------------|
| `package_id` | Reverse-domain, lowercase letters/numbers only per segment, min 2 segments, no hyphens |
| `edition` | `"202601"` |
| `name` | Max 20 characters |
| `version` | Semver format |
| `entrypoint` | Path to entry HTML |
| `permissions` | Array of `{ name, desc, whitelist? }` |
| `supported_languages` | Language array |

### Permission Types
`network`, `location`, `microphone` (variants), `album`, `camera`

### Build & Pack
```bash
npm run build
evenhub pack app.json dist -o myapp.ehpk
```

### Distribution
Submit `.ehpk` → users download from Even Hub page → launch from glasses menu or Even Realities App.

### Common Validation Errors
- Invalid package IDs (hyphens, uppercase, <2 segments)
- App name >20 chars
- Incorrect version format
- Missing required fields
- Improper permissions formatting
- Missing entrypoint file

---

## 12. CLI Reference

### Commands

**`evenhub login`** — Authenticate developer account. Optional `--email` parameter.

**`evenhub init`** — Generate starter `app.json` manifest.

**`evenhub qr`** — Create QR codes for sideloading during development.
```bash
evenhub qr --url "http://192.168.1.100:5173"
```
Supports HTTPS, external display, caching management.

**`evenhub pack`** — Bundle built app into `.ehpk` distribution file.
```bash
evenhub pack app.json dist -o myapp.ehpk
```
Optional package ID availability check.

### Shell Completions
Bash, Zsh, Fish supported.

---

## 13. Community Resources

### G2 Development Notes
Independently maintained reference: **even-g2-notes** on GitHub
- Architecture deep-dives, full Unicode glyph tables, SDK quirks, error codes
- Reference implementations: chess, reddit, weather, tesla, pong, snake

### Even Toolkit
Community component library: **even-toolkit** on GitHub
```bash
npm install even-toolkit
```
- 55+ React components (Button, Card, NavBar, ListItem, Toggle, Dialog, Toast, BottomSheet, Charts, Calendar...)
- 191 pixel-art icons
- Glasses bridge utilities: `useGlasses` hook, `buildActionBar`, `mapGlassEvent`, canvas renderer, PNG utils, pagination helpers
- Design tokens, light/dark themes
- Typography: `.text-vlarge-title` (24px) → `.text-detail` (11px)

### Discord
Even Realities developer community for support, bug reports, discussion.

---

## 14. Considerations

Hard-won lessons from building sommNI 2 and Lingua Franca on the G2 platform.

### Image Container Constraints

**Protobuf spec vs reality:**
The SDK `.d.ts` declares `Width: 20~288` and `Height: 20~144`. The original Even Hub docs said 20–200 width and 20–100 height. sommNI 2 has shipped containers at 190×140 without issues. Lingua Franca uses 190×144 and 272×144 — the 272 width is within the 288 protobuf limit but untested in sommNI. If images fail to render in the simulator at wider dimensions, fall back to 190 width.

**The split pattern (sommNI approach):**
sommNI 2 splits every image into two vertically-stacked halves (e.g., 190×95 top + 190×95 bottom = 190×190 virtual image). This works because the SDK doesn't care that two containers share the same x/width — it renders them independently. This pattern is useful when you need an image taller than 144px. For standard-size images that fit within 288×144, a single container is cleaner and simpler.

**When to split vs when not to:**
- Single container: logos, sprites, flags, icons (anything ≤ 144px tall)
- Split into 2: tall bottle images, full portraits, large art (anything > 144px tall)
- The split approach requires careful y-position math: `topY`, `topY + halfH` for the second

**Image push timing:**
Images cannot be sent during `createStartUpPageContainer`. The pattern is:
1. Create page with empty `ImageContainerProperty` placeholders (just position/size)
2. Wait for page creation to succeed
3. Push image data via `bridge.updateImageRawData()` — sequential only, no concurrent sends
4. On `rebuildPageContainer`, images are cleared — you must re-push after every rebuild

**Grayscale pipeline:**
Source image (any format, any size) → `createImageBitmap()` → scale to fit container (aspect-preserved, centered on black) → canvas `getImageData()` → ITU-R BT.601 luma: `0.299R + 0.587G + 0.114B` → `encodeGrayscalePng()` → `ImageRawDataUpdate` with `imageData: Array.from(pngBytes)`.

The glasses display is 4-bit greyscale (16 shades of green). High-contrast images with strong silhouettes work best. Subtle gradients get crushed to ~4 visible levels.

**Caching:**
Fetch images once, cache as `ImageBitmap`. Re-encoding to grayscale PNG is fast (<5ms) but network fetches are not. sommNI 2 doesn't cache (simpler), Lingua Franca caches all sprites in a `Map<string, ImageBitmap>`.

### Render Modes

**`rebuildPageContainer` (~5fps effective):**
Full page replacement. All containers are destroyed and recreated. Images must be re-pushed. Causes a brief green flash/flicker. Use for layout changes (different number of containers, different positions).

**`textContainerUpgrade` (~20fps effective):**
In-place text update. Container ID + name must match exactly. No flicker. Cannot change position, size, or add/remove containers. Use for live data (TTS text, scores, timers).

**`updateImageRawData` (sequential only):**
Push new image bytes to an existing container. Cannot run concurrently — queue them. Useful for dynamic sprites (language flags, bottle images).

**Adaptive render strategy (Lingua Franca):**
Lingua Franca's `adaptive-render.ts` decides automatically: if only text changed → `textContainerUpgrade`. If layout changed → `rebuildPageContainer` with rate limiting (200ms min interval). This gives smooth TTS updates in the Dialogue HUD while still allowing layout shifts for new suggestion lists.

### Navigation State Machine

Both sommNI 2 and Lingua Franca use a page-type state machine:
- `currentPage` tracks which page is displayed
- Click events dispatch based on `currentPage` + item index
- Double-tap (sysEvent type 3) = universal "back" gesture
- Scroll events route to list containers natively, or intercepted for custom behavior
- Navigation debounce (150–300ms) prevents double-fires from rapid taps
- A `navigating` flag prevents concurrent page transitions

### Audio (Microphone)

`bridge.audioControl(true)` opens the mic. PCM arrives as `audioEvent.audioPcm` — 16kHz, signed 16-bit LE, mono, 3200 bytes per 100ms chunk. The simulator supports audio via `--aid "Built-in Microphone"`. There is no audio output — the glasses have no speaker.

### List Container Gotchas

- Max 20 items per list. If you need more, paginate manually.
- Lists cannot be updated in-place — any change requires a full rebuild.
- Item labels max 64 characters — truncate with ellipsis.
- Only one container per page can capture events. If your page has a list, the list usually gets `isEventCapture: 1`.
- Scroll events fire when the user scrolls past the top/bottom of the list. These can be intercepted for custom scroll behavior (Lingua Franca uses this for dynamic sprite updates on the Languages page).

### Container ID Strategy

sommNI 2 and Lingua Franca both use this convention:
- `#1–#2`: Primary content (bottle image halves in sommNI, list in Lingua Franca)
- `#3–#4`: Secondary visuals (logo/sprite, split or single)
- `#5–#6`: Text labels (taglines, info text)
- `#41–#45`: Reserved for Dialogue HUD overlay (Lingua Franca only)

IDs don't need to be sequential but must be unique per page. IDs from a previous page are invalid after a rebuild.

### Simulator vs Hardware

The simulator is faster at processing images and doesn't enforce all hardware size limits. Always test on real G2 glasses before shipping. Key differences:
- Simulator may render oversized images that hardware rejects silently
- List scrolling feel differs significantly
- Status events (battery, wearing) are unsupported in simulator
- Audio routing requires explicit `--aid` flag on macOS

---

## 10. Vercel Proxy — Why It Exists & How We Built It

### The Problem

The Even Hub WebView **cannot make direct API calls to external services**. Calls to Deepgram, OpenAI, etc. fail silently — no CORS errors, no network logs, just nothing. This is a hard limitation of how Even Hub sandboxes the WebView. Only `fetch()` POST requests to your own backend work reliably.

### The Solution: `lingua-franca-api`

A lightweight Vercel serverless proxy that sits between the glasses WebView and the AI services. Two endpoints, zero infrastructure to maintain.

```
G2 Glasses (4-mic array)
    ↓ PCM audio (16kHz, 16-bit LE, mono)
Phone WebView (Even Hub SDK)
    ↓ batch 2.5s chunks → base64 encode → POST
Vercel Proxy (/api/transcribe)
    ↓ wrap in WAV → forward to Deepgram nova-2 (primary) or OpenAI gpt-4o-transcribe (fallback)
    ↓ return { text, confidence, language, engine }
Phone WebView
    ↓ accumulate transcript → POST
Vercel Proxy (/api/suggest)
    ↓ forward to GPT-4o-mini with conversation context + target language
    ↓ return { suggestions: ["phrase\n(translation)", ...] }
Phone WebView → Glasses Display
```

### Directory Structure

```
lingua-franca-api/
  api/
    transcribe.js    # STT proxy (Deepgram + OpenAI fallback)
    suggest.js       # AI conversation suggestions (GPT-4o-mini)
```

That's it. No `package.json`, no framework, no build step. Vercel auto-detects the `api/` folder and deploys each file as a serverless function.

### `/api/transcribe` — Speech-to-Text Proxy

**Request:**
```json
POST /api/transcribe
{
  "audio": "<base64-encoded PCM>",
  "language": "es"            // optional — forces single-language STT
}
```

**What it does:**
1. Decodes base64 PCM back to raw bytes
2. Wraps in a proper WAV header (44 bytes: RIFF, sample rate 16000, 16-bit, mono)
3. Tries **Deepgram nova-2** first (faster, native language detection, confidence scores)
4. Falls back to **OpenAI gpt-4o-transcribe** if Deepgram fails
5. Returns the transcription with metadata

**Response:**
```json
{
  "text": "Hola, como estas",
  "confidence": 0.94,
  "language": "es",
  "engine": "deepgram"
}
```

**WAV header construction** — the proxy builds a valid 44-byte WAV header in-memory. This is necessary because Deepgram and OpenAI expect audio files, not raw PCM. The header encodes: sample rate (16000), bits per sample (16), channels (1), and the PCM data length.

**Language lock** — when `language` is set, the proxy passes it to Deepgram's `language` parameter (forces single-language transcription) or OpenAI's `language` field. When omitted, Deepgram runs `detect_language: true` for auto-detection. Note: in the current architecture, we DON'T lock the STT language from the client — we let Deepgram auto-detect so both sides of a bilingual conversation are transcribed correctly. The language selection only drives the UI and suggestion direction.

### `/api/suggest` — AI Conversation Coach

**Request:**
```json
POST /api/suggest
{
  "conversation": "Them: Hola, de donde eres?\nMe: I'm from Seattle.",
  "targetLang": "Spanish",
  "speakLang": "English"
}
```

**What it does:**
1. Sends the conversation transcript + language context to GPT-4o-mini
2. System prompt instructs GPT to act as a live conversation coach — not a phrasebook
3. Returns 3 suggestions, each with the target language phrase and a translation

**Response:**
```json
{
  "suggestions": [
    "Me encanta la lluvia de Seattle\n(I love Seattle's rain)",
    "¿Y tú, eres de aquí?\n(And you, are you from here?)",
    "¿Qué me recomiendas hacer por aquí?\n(What do you recommend doing around here?)"
  ]
}
```

**Prompt design** — the system prompt tells GPT to think like a wingman. Each set of 3 suggestions has a different energy: one safe/polite, one that deepens the conversation, one bold wildcard. It references specific details from the conversation, never falls back to generic small talk, and adapts to the vibe (flirty, professional, deep, casual). Temperature is set to 0.85 for variety.

**Suggestion format** — each suggestion is two lines separated by `\n`: target language phrase on top, `(translation)` on the second line. The parser on the client groups these pairs by checking if the next line starts with `(`.

### How We Deploy

```bash
cd lingua-franca-api
npx vercel --prod
```

First deploy prompts you to link to a Vercel project. After that, one command redeploys.

**Environment variables** (set in Vercel dashboard → Settings → Environment Variables):
- `DEEPGRAM_API_KEY` — Deepgram nova-2 API key (primary STT)
- `OPENAI_API_KEY` — OpenAI API key (STT fallback + suggestion generation)

**URLs:**
- Primary: `https://lingua-franca-api.vercel.app/api/transcribe`
- Primary: `https://lingua-franca-api.vercel.app/api/suggest`
- Fallback STT: `https://sophicon-api.vercel.app/api/transcribe` (legacy Sophicon proxy, no language lock)

### Client-Side Integration (pulse-stt.ts)

The client batches audio and sends to the proxy:

```typescript
// Audio pipeline: glasses mic → chunks → batch → base64 → POST
const BATCH_INTERVAL_MS = 2500;    // collect 2.5s of audio
const MIN_AUDIO_BYTES = 8000;      // ~0.25s minimum to avoid empty requests

// Every 2.5s, combine buffered PCM chunks:
const combined = new Uint8Array(totalLen);
let offset = 0;
for (const chunk of chunks) {
  combined.set(chunk, offset);
  offset += chunk.length;
}

// Base64 encode (manual — btoa only takes strings):
let binary = '';
for (let i = 0; i < combined.length; i++) {
  binary += String.fromCharCode(combined[i]);
}
const base64 = btoa(binary);

// POST to proxy:
const payload = { audio: base64 };
// language field intentionally omitted — auto-detect both sides
const resp = await fetch(TRANSCRIBE_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
```

**Ghost filtering** — the client rejects low-quality transcriptions before displaying them:
- Confidence below 0.4 → rejected (Deepgram noise)
- Single word under 4 characters → rejected (gibberish)
- Empty text → rejected

### Client-Side Integration (dashboard.ts)

Suggestions are triggered by conversation activity:

```typescript
// STT debounce: wait 8s after speech before generating suggestions
// This gives GPT more conversation context to work with
sttDebounceTimer = setTimeout(async () => {
  await generateAndPushSuggestions(transcript, language);
}, 8000);

// Cooldown: hold suggestions stable for 10s before allowing refresh
const SUGGESTION_COOLDOWN_MS = 10000;

// Rolling refresh: regenerate every 20s during active conversation
const ROLLING_SUGGESTION_MS = 20000;
```

### Why This Pattern Works for Even Hub

1. **WebView sandbox** — the only reliable outbound network call from Even Hub is `fetch()` POST to a known URL. The proxy gives us that stable endpoint.
2. **No API keys on client** — Deepgram/OpenAI keys live in Vercel env vars, never shipped to the phone.
3. **WAV wrapping on server** — the glasses send raw PCM. The proxy adds the WAV header server-side, keeping the client payload small (just base64 PCM, no header overhead).
4. **Fallback chain** — Deepgram is fast but sometimes drops. OpenAI is slower but more reliable. The proxy tries both automatically.
5. **Zero infrastructure** — no Docker, no EC2, no databases. Just two .js files in an `api/` folder deployed to Vercel's edge network.
