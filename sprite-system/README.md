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

A launcher lives at `~/Desktop/d3-infra/launchers/lingua-franca-sprites.command` —
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
