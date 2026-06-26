<!-- D3-SYNC:START — auto-generated from d3-data.json + claude-md-template.md, do not edit inside this block -->
<!-- last sync: 2026-05-16 17:20 · sources: d3-data.json + claude-md-template.md + this repo's README/docs · projects: lingua-franca -->

# Lingua Franca G2

**Status:** Active Dev  ·  **Version:** v1.0  ·  **Ecosystem:** lingua-franca
**Folder:** `~/Desktop/lingua-franca/`

# Project Tech
> This is the ACTUAL stack used by this repo. Respect it. The standards
> section further down is forward-looking guidance for NEW projects only —
> do not migrate this project to Next.js / Tailwind / Drizzle on a whim.

- Vite + TypeScript + ER SDK

# Overview
Real-world fluency, one scene at a time. A language learning app for Even Realities G2 smart glasses with a phone-side dashboard. 19 target languages with 103 scenario templates using smart slot-filling. Speak mode: Home → Language Select → Dialogue HUD with language-locked STT via Deepgram nova-2 (Vercel proxy). AI reply suggestions powered by GPT-4o-mini refresh every 6s based on live conversation context. Ghost transcription filtering (confidence threshold, gibberish rejection). All external API calls routed through lingua-franca-api.vercel.app since Even Hub webview blocks direct calls.

# Stats
- **Languages:** 19
- **Scenarios:** 103
- **STT Engine:** Deepgram
- **AI Suggest:** GPT-4o

# Features
- 19 target languages with native script + romanization
- 103 scenario templates with smart [SLOT] filling
- Speak flow: Home → Language Select → Dialogue HUD with language lock
- Deepgram nova-2 STT with single-language lock via Vercel proxy
- OpenAI GPT-4o-mini context-aware reply suggestions (6s refresh)
- Ghost transcription filtering: confidence threshold + gibberish rejection
- Vercel proxy architecture: /api/transcribe (Deepgram+OpenAI) + /api/suggest (GPT)
- Batch audio: 2.5s PCM chunks → base64 → POST to proxy
- 7 vocab categories: Drinks, Food, Dessert, Taste, Greeting, Compliment, Place
- Culture-aware city/venue/food data per language
- Vocab quiz on both phone and glasses
- Custom words system — add your own vocab per language

# How to Run
Launchable entry points the dashboard knows about (paths are relative to `~/Desktop`):

- **Dev + Simulator** (`launcher`): `launchers/lingua-franca-dev.command` — Starts server, auto-launches simulator
- **Open Folder** (`folder`): `lingua-franca/` — lingua-franca/

# README (verbatim from this repo)
> Source: `sprite-system/README.md`

# Lingua Franca — Sprite System

Unified 1-bit pixel sprite generator for Lingua Franca G2. Forked from
sommNI's Sprite System; rewired around Lingua Franca's three-bucket taxonomy
so every flag, scene icon, and utility glyph inherits the same visual DNA
as sommNI (wine) and soPHICON (philosophy).

## Taxonomy

| Bucket   | Count | Filename pattern                   | Ships to                        |
| -------- | ----- | ---------------------------------- | ------------------------------- |
| Language | 20    | `public/sprites/language/lang-<code>.png` | served by Vite as `/sprites/language/lang-<code>.png` |
| Scene    | 6     | `public/sprites/scene/scene-<id>.png`      | `/sprites/scene/scene-<id>.png` |
| Utility  | 8     | `public/sprites/utility/utility-<id>.png`  | `/sprites/utility/utility-<id>.png` |

The generator also emits:
- `public/sprites/manifest.json` — full registry with generated/shipped flags
- `src/sprites.ts` — TypeScript constants (`LANG_SPRITE`, `SCENE_SPRITE`,
  `UTILITY_SPRITE`, `SCENE_ORDER`) the app imports

## Directory layout

```
sprite-system/
├── lingua_sprites.py        # Flask app (port 5444)
├── index.html               # UI
├── .env.example             # copy to .env or use in-app "Save"
├── sprites/
│   ├── _master_template/    # master_neutral.png + master_<category>.png
│   ├── language/            # working set (pre-ship)
│   ├── scene/
│   └── utility/
├── references/              # scraped reference images per asset
└── export/                  # optional post-processing scratch
```

## Workflow

1. **Set your OpenAI key** — either paste into the in-app key bar and
   click Save, or copy `.env.example` to `.env` and fill it in.
2. **Generate the Master** — clicks in order:
   - `Gen Candidate` on the Master (Traveler's Compass) tile
   - Review the candidate image
   - `Approve` → locks it as `master_neutral.png`
3. **Generate Category Templates** — for each of `language`, `scene`,
   `utility`: `Gen` → review → `Approve`. Each category template
   inherits the master's visual DNA but focuses it for that bucket.
4. **Generate Sprites** — per-tab:
   - `Generate All Missing (Current Tab)` for batch
   - Individual `Gen` / `Regen` per cell
5. **Rebuild Manifest** — writes `public/sprites/manifest.json` and
   `src/sprites.ts`. Every sprite that exists in `public/sprites/` gets
   a real path; missing sprites still get entries (the app falls back
   to the emoji flag in `constants.ts`).

## Running it

```bash
cd lingua-franca/sprite-system
pip install flask requests
python3 lingua_sprites.py
```

Then open [http://localhost:5444](http://localhost:5444).

A launcher lives at `~/Desktop/launchers/lingua-franca-sprites.command` —
double-click to boot, or wire it into the d3 dashboard.

## Style DNA

Every sprite is rendered under one shared **system style prompt**:

> Strict 1-bit pixel art (pure black + pure white only, dithered mid-tones),
> thick chunky outlines, single key light from upper-left 45°, museum-grade
> pixel craftsmanship, slightly mystical/premium/retro-future feel — the
> third sibling to sommNI and soPHICON.

The **master anchor** is the **Traveler's Compass** — an ornate compass
rose with four-alphabet ornamental glyphs at the cardinal points.
Everything else references it.

## Integration with the app

```ts
import { LANG_SPRITE, SCENE_SPRITE, UTILITY_SPRITE } from "./sprites";

// Languages page — swap the emoji LANG_FLAG for the generated sprite
const flagSrc = LANG_SPRITE[code];         // e.g. "/sprites/language/lang-ja.png"

// Scene categories page
const sceneSrc = SCENE_SPRITE["social"];   // e.g. "/sprites/scene/scene-social.png"

// Toolbar glyphs
const saveSrc = UTILITY_SPRITE["saved"];
```

If a sprite hasn't been generated yet, `LANG_SPRITE[code]` still resolves to
a path — the `<img>` will 404 silently until the PNG is generated. Keep
the existing emoji flag as a fallback.

# Other Docs in This Repo
> Read these for deeper context — agents should open them on demand, not assume.

- `EVENHUB_SDK_REFERENCE.md` (26.4 KB)

# Build / Config Files Present
> Tells agents what build system to expect.

- `app.json`
- `package.json`
- `tsconfig.json`
- `vite.config.ts`

# ─── Standards (forward-looking guidance for NEW projects) ───

> The conventions below describe the **target stack and patterns for new d3 repos**.
> They are NOT a mandate to refactor existing projects. For this repo, follow the
> 'Project Tech' / 'How to Run' sections above — they describe what actually exists
> on disk. Surgical changes only.

# Tech Stack
- AI SDK 6
- Tailwind CSS
- NextJS 16
- PostgreSQL
- Auth.js
- Drizzle ORM

# Programming
- Use explicit variable names.

# Project Structure & Architecture

## Directory Organization

```
app/
├── api/                # API routes
├── (authenticated)/    # Protected routes (require auth)
└── (public)/           # Public routes

components/
├── ui/                 # shadcn/ui primitives
├── [feature]/          # Feature-specific components (e.g., instructors/, courses/)
└── [shared].tsx        # Shared components at root level

lib/
├── services/           # Business logic and external integrations
├── utils/              # Pure utility functions
├── constants.ts        # App-wide constants
└── config.ts           # Configuration and environment
```

## Prompt Management

**All AI prompts must be stored in `prompts/`** (top-level):

- Export prompts as functions that accept dynamic parameters.
- Keep prompts version-controlled and reviewable.
- Use template literals for dynamic content injection.
- Document prompt purpose and expected behavior.

```typescript
// prompts/instructor.ts
export function buildInstructorPrompt(instructor: Instructor): string {
  const prompt = `You are ${instructor.name}...`;
  return prompt;
}
```

# Frontend Engineer

You are the world's best UI/UX engineer specializing in Next.js 16 (App Router) and Tailwind CSS. You possess deep expertise in modern web design principles, accessibility standards, and creating exceptional user experiences. Your work is characterized by pixel-perfect implementations, thoughtful interaction design, and code that is both beautiful and maintainable.

**Client components vs. Server components**: Default to Server Components; use Client Components only when interactivity requires it.

# Backend Engineer

You are an elite backend engineer with world-class expertise in secure, efficient, and scalable backend architecture. You have a database-first approach to systems thinking.

## **Prompting Instructions** (this is CRUCIAL for our job!)

All LLM system prompts in this repo must use the XML template below. When adding a prompt to an existing file, upgrade neighboring prompts to match so the file stays consistent.

```xml
<role-and-goal>
You are [role description].
Your goal is [objective].
</role-and-goal>

<instructions>
Primary instructions here.

<sub-instructions-guidelines>
Detailed instructions for this sub-topic.
</sub-instructions-guidelines>

<sub-instructions-guidelines>
Another grouping of related instructions.
</sub-instructions-guidelines>
</instructions>

<reasoning>
Step-by-step reasoning process (optional).
</reasoning>

<output-format>
Specify expected output structure.
</output-format>

<examples>
<example>
Input: ...
Output: ...
</example>
<example>
Input: ...
Output: ...
</example>
</examples>

<context>
{{VARIABLE_DATA}}
</context>

<final-instructions>
Think step by step before responding.
</final-instructions>
```

# Coding Principles

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

<!-- D3-SYNC:END -->
