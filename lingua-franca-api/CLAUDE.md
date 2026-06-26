<!-- D3-SYNC:START — auto-generated from d3-data.json + claude-md-template.md, do not edit inside this block -->
<!-- last sync: 2026-05-16 17:07 · sources: ~/Desktop/d3-data.json + ~/Desktop/claude-md-template.md · projects: lingua-franca-api -->

# Lingua Franca API

**Status:** Deployed  ·  **Version:** v1.0  ·  **Ecosystem:** lingua-franca
**Folder:** `~/Desktop/lingua-franca/lingua-franca-api/`

# Project Tech
> This is the ACTUAL stack used by this repo. Respect it. The standards
> section further down is forward-looking guidance for NEW projects only —
> do not migrate this project to Next.js / Tailwind / Drizzle on a whim.

- Vercel Serverless + Deepgram + OpenAI

# Overview
Vercel serverless proxy for Lingua Franca G2. Two endpoints: /api/transcribe accepts base64 PCM audio + optional language lock, wraps in WAV header, forwards to Deepgram nova-2 (primary) or OpenAI gpt-4o-transcribe (fallback). /api/suggest accepts conversation context + target language, calls GPT-4o-mini for 3 contextual reply suggestions. Deployed at lingua-franca-api.vercel.app. Env vars: DEEPGRAM_API_KEY, OPENAI_API_KEY.

# Stats
- **Endpoints:** 2
- **Primary STT:** Deepgram
- **AI Model:** GPT-4o-mini
- **Host:** Vercel

# Features
- /api/transcribe — Deepgram nova-2 primary, OpenAI gpt-4o-transcribe fallback
- /api/suggest — GPT-4o-mini contextual reply generation
- Language lock: ?language=es forces single-language STT
- WAV header construction from raw PCM base64
- CORS enabled for Even Hub webview origin
- Env: DEEPGRAM_API_KEY + OPENAI_API_KEY on Vercel dashboard

# How to Run
Launchable entry points the dashboard knows about (paths are relative to `~/Desktop`):

- **Deploy + Smoke Gate** (`launcher`): `lingua-franca/lingua-franca-api/deploy.command` → `./deploy.sh` — runs `npx vercel --prod`, then `scripts/smoke-test.sh` as a post-deploy gate that fails (non-zero exit) if any endpoint check fails. Use `./deploy.sh --skip-smoke` to deploy without the gate.
- **Open API Folder** (`folder`): `lingua-franca/lingua-franca-api/` — lingua-franca/lingua-franca-api/
- **Live API** (`url`): `https://lingua-franca-api.vercel.app` — lingua-franca-api.vercel.app

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
