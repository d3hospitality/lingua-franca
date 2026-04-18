#!/usr/bin/env python3
"""
Lingua Franca — Unified Sprite System
=====================================
Forked from sommNI Sprite System. One tool to generate every visual asset
for Lingua Franca G2 smart-glasses language learning app:

  - LANGUAGE sprites (20)   — cultural-landmark icons per target language
  - SCENE sprites (6)       — category icons (Social, Food, Compliments,
                               Navigation, Formal, Custom)
  - UTILITY sprites (8)     — app affordances (favorite, saved, recent,
                               quiz, home, compose, push, search)

Architecture mirrors sommNI + soPHICON:
  Master Template (compass anchor) → Category Templates → Individual Assets

Outputs land in TWO places:
  1. ./sprites/<cat>/<id>.png         — working set, editable
  2. ../public/sprites/<cat>/<id>.png — shipped with Vite build

Manifest is emitted to ../public/sprites/manifest.json plus
../src/sprites.ts (TypeScript constants the app imports).

Port: 5444
"""

import os, sys, re, json, base64, time, shutil
from pathlib import Path
from io import BytesIO
from urllib.parse import quote_plus

import requests
from flask import Flask, request, jsonify, send_from_directory, send_file

# ══════════════════════════════════════════════════════════════════
# PATHS
# ══════════════════════════════════════════════════════════════════

BASE_DIR     = Path(__file__).parent              # lingua-franca/sprite-system
PROJECT_ROOT = BASE_DIR.parent                    # lingua-franca/
SPRITES_DIR  = BASE_DIR / "sprites"               # working set
REFS_DIR     = BASE_DIR / "references"
TEMPLATE_DIR = SPRITES_DIR / "_master_template"
EXPORT_DIR   = BASE_DIR / "export"

# Final PNGs the Vite app serves
PUBLIC_DIR   = PROJECT_ROOT / "public" / "sprites"
MANIFEST_JSON = PUBLIC_DIR / "manifest.json"
TS_CONSTANTS  = PROJECT_ROOT / "src" / "sprites.ts"

CATEGORIES = ("language", "scene", "utility")

for cat in CATEGORIES:
    (SPRITES_DIR / cat).mkdir(parents=True, exist_ok=True)
    (REFS_DIR    / cat).mkdir(parents=True, exist_ok=True)
    (PUBLIC_DIR  / cat).mkdir(parents=True, exist_ok=True)
TEMPLATE_DIR.mkdir(parents=True, exist_ok=True)
EXPORT_DIR.mkdir(parents=True, exist_ok=True)

ENV_PATH = BASE_DIR / ".env"

app = Flask(__name__, static_folder=str(BASE_DIR))


# ══════════════════════════════════════════════════════════════════
# API KEY
# ══════════════════════════════════════════════════════════════════

def load_api_key():
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text().splitlines():
            if line.startswith("OPENAI_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return os.environ.get("OPENAI_API_KEY")

def save_api_key(key):
    lines = []
    if ENV_PATH.exists():
        lines = [l for l in ENV_PATH.read_text().splitlines() if not l.startswith("OPENAI_API_KEY=")]
    lines.append(f'OPENAI_API_KEY="{key}"')
    ENV_PATH.write_text("\n".join(lines) + "\n")


# ══════════════════════════════════════════════════════════════════
# TEMPLATE CONFIG (editable per-master name + prompt overrides)
# ══════════════════════════════════════════════════════════════════

CONFIG_PATH = BASE_DIR / "template_config.json"

DEFAULT_TEMPLATE_NAMES = {
    "master":           "Master Dummy",
    "language":         "Flag Master",
    "scene":            "Scene Master",
    "utility":          "Utility Master",
    "world":            "World Master",
    # Per-scene masters (common templates that country variants inherit from)
    "scene_social":     "Scene · Social",
    "scene_food":       "Scene · Food",
    "scene_compliment": "Scene · Compliment",
    "scene_navigate":   "Scene · Navigate",
    "scene_formal":     "Scene · Formal",
}

def load_template_config():
    if CONFIG_PATH.exists():
        try:
            return json.loads(CONFIG_PATH.read_text())
        except Exception:
            pass
    return {}

def save_template_config(cfg):
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2) + "\n")

def get_template_name(key):
    cfg = load_template_config()
    return (cfg.get(key) or {}).get("name") or DEFAULT_TEMPLATE_NAMES.get(key, key)

def get_template_prompt_override(key):
    cfg = load_template_config()
    return (cfg.get(key) or {}).get("prompt") or None


# ══════════════════════════════════════════════════════════════════
# UNIFIED STYLE PROMPT  (the Rosetta Stone)
# ══════════════════════════════════════════════════════════════════
# Every sprite references this so Lingua Franca sits alongside sommNI
# and soPHICON as part of the same visual family.

SYSTEM_STYLE = """MANDATORY STYLE RULES (apply to EVERY sprite in this system):
- 32-bit era aesthetic, Game Boy Advance / early PS1 quality
- Low-poly stylized blend of Metal Gear Solid codec portraits with
  Final Fantasy Tactics / FF6 character portraits — painterly pixel
  hybrid: visible brushstrokes but crisp edges
- RICH BUT LIMITED PALETTE — slightly desaturated like GBA hardware.
  Each portrait pulls its dominant hues from its subject's flag
  (the flag IS the clothing), rendered in the shared painterly style
- Clean solid black background, NO decorations, borders, or text
- Square image, subject centered at 60-70% of canvas
- LIGHTING: Single key light from UPPER LEFT at approximately 45 degrees.
  Creates soft shadow on right side of subject, warm highlight on upper
  left. Subtle rim light on right side. This lighting is IDENTICAL across
  ALL sprites — never change the light source direction or intensity
- Consistent pixel scale and stroke weight across all assets
- Slightly mystical / premium / retro-future feel — a traveler's gallery
  of world portraits, not generic clip-art
- NO text, NO labels, NO country or language names anywhere in the image
  (exception: established script glyphs may appear as DECORATIVE motifs
   layered onto the garment or background, never as captions)
- SAME art style across ALL sprites — every language portrait feels like
  a sibling in the same gallery
- This sprite belongs to the same family as sommNI (wine) and soPHICON
  (philosophy). It is the third sibling — Lingua Franca (world fluency)"""


# ══════════════════════════════════════════════════════════════════
# MASTER ANCHOR — The Blank Traveler (Player 1 Dummy)
# ══════════════════════════════════════════════════════════════════

MASTER_DESCRIPTION = """A BLANK FLAG CANVAS — the visual anchor of Lingua Franca.
Every language sprite is a FLAG. This master establishes exactly how
flags are rendered in this system. The master itself is NOT a real
country's flag; it is the canonical EXAMPLE flag that every real
country's flag will inherit its rendering style from.

LAYOUT:
- A single rectangular flag, aspect ratio 2:3 (or 3:5 — whatever reads
  cleanest), centered on the canvas, filling ~80% of the canvas area
- The flag appears as cloth — slight fabric waver at the edges, subtle
  cloth texture across the surface (gentle dither, not photographic)
- No flagpole, no hanging rope, no hand holding it — just the flag
  itself, floating centered on the background

DESIGN (invented, not a real flag):
- Three equal horizontal bands in three invented muted colors —
  think desaturated teal / warm cream / muted ochre
- A single simple invented ornamental emblem centered on the middle
  band: a geometric eight-point compass-rose star, small, clean,
  rendered in a crisp contrasting color
- No text, no country name, no letters, no real-world symbols

STYLE:
- Painterly pixel art — GBA-era hybrid, visible brushstrokes on the
  fabric, crisp geometric edges on the stripe boundaries and emblem
- Rich but limited palette, slightly desaturated
- Clean solid pure-black background behind the flag
- LIGHTING: soft key light from upper-left at ~45 degrees — subtle
  highlight on the upper-left portion of the cloth, gentle shadow on
  the lower-right. This lighting stays IDENTICAL across every language
  flag that follows
- Strong, clean silhouette of the rectangle; readable at 96×96

This master establishes:
1. EXACT flag aspect ratio and canvas placement
2. EXACT lighting angle and cloth-rendering approach
3. EXACT stripe geometry and emblem placement conventions
4. EXACT palette saturation/mood
5. EXACT pixel rendering style

Every real country's flag sprite inherits THIS rendering and substitutes
that country's real geometry, palette, and symbols.

This portrait establishes:
1. The EXACT head position, size, and canvas placement (all language
   sprites match this framing precisely)
2. The EXACT lighting angle (upper-left key, ~45 degrees)
3. The EXACT art style — GBA-era painterly pixel portrait
4. The shoulder framing and crop
5. The neutral facial expression every language portrait inherits

NOTE: Only the rendering style, lighting, cloth texture, canvas framing,
and ratio conventions carry forward. Every real language sprite uses
THIS template's rendering approach to depict its own country's real
flag — never invented symbols, never the invented teal/cream/ochre
palette. The master is purely a STYLE anchor."""


# ── Per-scene archetypes ──────────────────────────────────────────
# Each scene has a "common template" master that country-specific scene
# sprites inherit from (user request: "each should have a common template
# then coded to fit the country needs"). These replace the single generic
# scene master and let every category (social/food/compliment/navigate/
# formal) carry its own visual archetype.

SCENE_MASTER_PROMPTS = {
    "social": """A SOCIAL & GREETINGS SCENE ARCHETYPE — the universal template.
Two stylized figures facing each other in 3/4 angle, each raising a small
drinking vessel in a toast. A cluster of decorative sparkle glyphs (small
+ and * marks and dots) floats in the space between their faces, suggesting
warm conversation meeting in the middle.
- Both figures rendered as adult silhouettes, gender-ambiguous, neutral
  clothing colors so country-specific variants can re-tint.
- Composed, warm energy. Eye-line meets at canvas center.
- Painterly pixel art, GBA-era palette, upper-left key light,
  solid pure-black background. Square canvas, subjects fill ~65%.
This is the COMMON TEMPLATE. Each country's social scene inherits this
framing, pose, and lighting — only clothing palette, cultural props, and
small backdrop details change per country.""",
    "food": """A FOOD & DRINKS SCENE ARCHETYPE — the universal template.
A low dining still-life centered on a table cloth: a tall tapered bottle
silhouette on the left, a round plate in the center with a small domed
dish on it, and a drinking cup on the right. All three objects sit at the
same eye-line, grouped tightly.
- Neutral cloth color, neutral tableware so country variants can restyle.
- Painterly pixel art, GBA-era palette, upper-left key light, solid black
  background. Objects fill ~60% of canvas, centered.
This is the COMMON TEMPLATE every country's food scene inherits from —
same framing and lighting, only the dish shapes, drink type, and table
textile change to match each country.""",
    "compliment": """A COMPLIMENTS SCENE ARCHETYPE — the universal template.
A generous rounded speech bubble floating at canvas center, containing a
single filled five-point star glyph inside, with a tiny heart nested in the
star's upper arm. A short bubble tail points down-left. Two or three
decorative sparkle dots float in the space around the bubble.
- Warm, generous energy. Star is solid-filled, heart is outlined.
- Painterly pixel art, GBA-era palette, upper-left key light, solid black
  background. Bubble fills ~55% of canvas.
This is the COMMON TEMPLATE. Each country's compliment sprite inherits
this bubble composition and re-tints the bubble and trim in that
country's flag-derived palette.""",
    "navigate": """A NAVIGATION & HELP SCENE ARCHETYPE — the universal template.
A tall wayfinding signpost at canvas center: a vertical wooden pole with
two arrow-shaped plank signs branching horizontally in opposite directions,
a small ornate compass rose mounted on the top of the pole. In the
foreground, a stylized winding path leads from the base of the pole
toward the lower edge of the canvas.
- Neutral wood color, pale sky implied behind.
- Painterly pixel art, GBA-era palette, upper-left key light, solid black
  background. Signpost fills ~70% of the vertical canvas, centered.
This is the COMMON TEMPLATE every country's navigation scene inherits —
same pole, same arrows, same compass; only the signage treatment and
path-surface texture adapt to each country's landscape.""",
    "formal": """A FORMAL / CEREMONIAL SCENE ARCHETYPE — the universal template.
A heraldic kite-shield crest centered on the canvas, rendered in
high-contrast pixel art. Inside the shield's heart, two stylized hands
meet in a handshake — wrists crossing at shield center, palms clasped.
Laurel branches frame the shield's left and right sides, curling gently
upward. A simple ribbon banner (blank) ripples across the shield's base.
- Neutral metallic colors, neutral laurel, blank banner so country
  variants can apply flag palette + country-specific crest motifs.
- Painterly pixel art, GBA-era palette, upper-left key light, solid black
  background. Crest fills ~70% of canvas, centered.
This is the COMMON TEMPLATE every country's formal scene inherits — same
shield shape, handshake, laurel, ribbon; only the crest motifs and ribbon
embellishments adapt per country.""",
}

SCENE_MASTER_KEYS = list(SCENE_MASTER_PROMPTS.keys())   # ["social","food","compliment","navigate","formal"]


WORLD_MASTER_DESCRIPTION = """A WORLD HERO SPRITE — a stylized globe surrounded by an orbital halo of
national flag banners. This is a splash/hero asset for the Lingua Franca
app — not a style anchor, but a feature image that represents the entire
ecosystem in one square.

COMPOSITION:
- Dead-center: a painterly pixel-art world globe, filling ~45% of canvas
- The globe shows simplified, recognizable continent silhouettes in muted
  earth tones (warm ochre / terracotta landmasses, soft deep teal oceans)
- Subtle longitude/latitude grid lines across the sphere, very faint
- A gentle glow/aura around the globe (tasteful, not neon)

FLAG HALO:
- A single orbital ring of 20 small rectangular national flag banners
  distributed evenly around the globe (roughly one every 18° of arc)
- Each flag is ~7–9% of canvas size, slightly wavering like cloth
- Flags rendered in the SAME Lingua Franca pixel style as the individual
  language sprites (painterly pixel, crisp stripe edges, upper-left light)
- If real national flags are depicted, they must be accurate — correct
  geometry, palette, and symbols. The halo should read as "the world of
  languages this app supports"
- No flagpoles, no ropes — flags float cleanly as banners in the ring

STYLE:
- Painterly pixel art, GBA-era palette, slightly desaturated
- Single key light from upper-left at ~45 degrees across both globe and flags
- Solid pure-black background behind everything
- Square canvas; globe centered; halo centered on the globe

ABSOLUTES:
- NO text, NO labels, NO country names, NO app logo
- NO people, NO characters — just globe + flag halo + black background
- Composition reads as one cohesive piece, not a collage"""


# ══════════════════════════════════════════════════════════════════
# ASSET CATEGORY DEFINITIONS
# ══════════════════════════════════════════════════════════════════

# ─── LANGUAGE SPRITES ────────────────────────────────────────────
# One sprite per target language in constants.ts (LANG_CODES).
# Each is a cultural-landmark or iconic motif, NOT a literal flag
# (1-bit can't carry tricolor), but a silhouette that reads instantly.

# Language = philosopher. Flag patterns/colors = clothing. Landmark = face motif.
# Each entry describes the character using the MASTER DUMMY's pose and lighting,
# but wearing flag-derived garment and framed beside a small cultural landmark.
LANGUAGE_SPRITES = [
    {"id": "en", "name": "English",
     "flag": {"desc": "Flag of the United States of America (Stars and Stripes): 13 equal-height horizontal stripes alternating red and white, with red on both the top and bottom (7 red stripes, 6 white stripes). In the upper-left canton (covering the top 7 stripes and approximately 2/5 of the flag's width), a solid dark blue rectangle contains 50 small white five-point stars arranged in 9 alternating rows of 6-5-6-5-6-5-6-5-6. Official ratio 10:19.",
              "palette": ["#B22234", "#FFFFFF", "#3C3B6E"],
              "layout": "13-stripe horizontal field with 50-star blue canton in the upper-hoist corner"},
     "search_hint": "american flag united states stars stripes old glory",
     "motif": "The real United States flag as cloth: 13 red-and-white horizontal stripes (7 red, 6 white, red on top and bottom) with a dark blue canton in the upper-hoist corner containing 50 white five-point stars arranged in 9 staggered rows (6-5-6-5-6-5-6-5-6). Official proportions 10:19. Slight cloth waver, painterly pixel rendering on the stars and stripe edges.",
     "alt_motifs": ["The Stars and Stripes flag — 13 red/white stripes with a blue canton of 50 white stars in the upper-left corner.",
                    "American flag rendered as cloth: 13 alternating red and white horizontal stripes, blue canton filled with a field of small white five-point stars.",
                    "A simplified US flag in the pixel style — clear red and white stripes, blue canton with an evenly-spaced grid of white stars."]},
    {"id": "ar", "name": "Arabic",
     "flag": {"desc": "Flag of Saudi Arabia: plain solid green field with the Arabic Shahada (Islamic creed) in white Thuluth calligraphy across the top, and a white horizontal sabre/sword centered beneath the script, handle to the right. Ratio 2:3.",
              "palette": ["#006C35", "#FFFFFF"],
              "layout": "solid field with centered calligraphy + sword"},
     "search_hint": "saudi flag green arabesque pattern calligraphy",
     "motif": "The traveler wears a deep green robe with a flowing Arabic calligraphy band across the chest in white — the color palette taken from the Saudi flag (deep green + white). A small crescent moon and an eight-point Islamic star are embroidered as shoulder motifs. Background hints at a pale sand horizon.",
     "alt_motifs": ["The traveler wears a green robe with white calligraphic trim. A crescent and star sit on one shoulder.",
                    "A figure draped in a deep green garment with white ornamental script along the collar.",
                    "Portrait wearing an emerald scholar's robe with white geometric stars along the front."]},
    {"id": "bg", "name": "Bulgarian",
     "flag": {"desc": "Flag of Bulgaria: three equal horizontal bands — white (top), green (middle), red (bottom). Ratio 3:5. No emblem.",
              "palette": ["#FFFFFF", "#00966E", "#D62612"],
              "layout": "horizontal tricolor"},
     "search_hint": "bulgaria flag white green red folk embroidery rose",
     "motif": "The traveler wears a folk-embroidered tunic striped horizontally in white, green, and red — Bulgaria's tricolor. Red-and-white folk stitch patterns run along the collar and cuffs. A single Bulgarian rose bloom is pinned at the collar. Background hints at rolling Thracian hills.",
     "alt_motifs": ["The traveler wears a white tunic with green and red folk-stitched bands and a rose at the collar.",
                    "A figure in a folk-embroidered shirt in Bulgaria's white/green/red tricolor palette.",
                    "Portrait wearing a horizontally-striped white/green/red folk tunic with floral stitching."]},
    {"id": "zh", "name": "Chinese",
     "flag": {"desc": "Flag of the People's Republic of China: red field with five golden five-point stars in the upper-left canton — one large star and four smaller stars arranged in an arc around it, each smaller star oriented with one point toward the large star. Ratio 2:3.",
              "palette": ["#EE1C25", "#FFFF00"],
              "layout": "solid field with canton of five stars"},
     "search_hint": "china flag red yellow star hanfu dragon pattern",
     "motif": "The traveler wears a red hanfu-style robe with a large yellow five-point star and four smaller yellow stars arranged in an arc at the chest — the Chinese flag rendered as a garment. Subtle yellow dragon embroidery on the sleeves. Behind them, a small pagoda silhouette on a mountain ridge.",
     "alt_motifs": ["A figure in a crimson robe with five yellow stars at the chest and dragon embroidery on the sleeves.",
                    "Portrait wearing a red hanfu with yellow star constellation on the chest.",
                    "The traveler wears a deep red tunic with golden stars at the chest, pagoda in the background."]},
    {"id": "nl", "name": "Dutch",
     "flag": {"desc": "Flag of the Netherlands: three equal horizontal bands — red (top), white (middle), blue (bottom). Ratio 2:3. No emblem.",
              "palette": ["#AE1C28", "#FFFFFF", "#21468B"],
              "layout": "horizontal tricolor"},
     "search_hint": "netherlands flag red white blue tulip windmill",
     "motif": "The traveler wears a high-collared coat horizontally striped in red, white, and blue — the Dutch flag as clothing. A single orange tulip is pinned at the lapel (a nod to the House of Orange). Behind them, a windmill silhouette on a flat horizon.",
     "alt_motifs": ["A figure in a red/white/blue horizontally striped coat with an orange tulip lapel pin.",
                    "Portrait wearing a Dutch tricolor coat with a tulip at the collar, windmill visible behind.",
                    "The traveler wears a red-white-blue striped garment with a tulip flourish at the chest."]},
    {"id": "tl", "name": "Filipino",
     "flag": {"desc": "Flag of the Philippines: horizontal bicolor — royal blue (top band) and red (bottom band) — with a white equilateral triangle on the hoist (left) side. Inside the triangle: a golden eight-ray sun centered, and three golden five-point stars in each corner of the triangle. Ratio 1:2.",
              "palette": ["#0038A8", "#CE1126", "#FFFFFF", "#FCD116"],
              "layout": "horizontal bicolor with hoist-side triangle"},
     "search_hint": "philippines flag blue red yellow sun jeepney",
     "motif": "The traveler wears a barong tagalog-style embroidered tunic where the two halves split blue (upper) and red (lower), with a white triangle across the chest containing a golden eight-ray sun — the Philippine flag as clothing. Three small stars at the corners of the triangle. Behind them, a tropical palm-fringed horizon.",
     "alt_motifs": ["A figure in a split blue/red tunic with a white triangular chest panel containing a golden sun.",
                    "Portrait wearing a barong-style garment patterned with the Philippine flag; sun and stars on the chest.",
                    "The traveler wears a blue-and-red embroidered tunic with a white chest triangle and eight-ray sun."]},
    {"id": "fr", "name": "French",
     "flag": {"desc": "Flag of France: three equal vertical bands — blue (hoist/left), white (middle), red (fly/right). Ratio 2:3. No emblem.",
              "palette": ["#0055A4", "#FFFFFF", "#EF4135"],
              "layout": "vertical tricolor"},
     "search_hint": "france flag blue white red beret",
     "motif": "The traveler wears a long coat with three vertical bands of blue, white, and red — the French tricolor as clothing. A silver fleur-de-lis pin at the collar. A beret tilted on the head. Behind them, a thin silhouette of the Eiffel Tower's upper spire.",
     "alt_motifs": ["A figure in a blue/white/red vertically-striped long coat with a fleur-de-lis pin.",
                    "Portrait wearing the French tricolor as a coat with a silver pin at the collar.",
                    "The traveler wears a vertical-striped tricolor garment, Eiffel Tower outline behind them."]},
    {"id": "de", "name": "German",
     "flag": {"desc": "Flag of Germany: three equal horizontal bands — black (top), red (middle), gold (bottom). Ratio 3:5. No emblem on civil flag.",
              "palette": ["#000000", "#DD0000", "#FFCE00"],
              "layout": "horizontal tricolor"},
     "search_hint": "germany flag black red gold eagle brandenburg",
     "motif": "The traveler wears a high-collared coat horizontally banded in black, red, and gold — the German flag as clothing. A small stylized black eagle crest at the chest. Behind them, a pale silhouette of the Brandenburg Gate's columns.",
     "alt_motifs": ["A figure in a black/red/gold horizontally banded coat with a small eagle crest on the chest.",
                    "Portrait wearing a tricolor coat in black, red, and gold with a heraldic eagle emblem.",
                    "The traveler wears a black-red-gold striped garment, columns of a neoclassical gate behind them."]},
    {"id": "hi", "name": "Hindi",
     "flag": {"desc": "Flag of India: three equal horizontal bands — saffron/orange (top), white (middle), India green (bottom). A navy-blue 24-spoke Ashoka Chakra wheel centered on the white band. Ratio 2:3.",
              "palette": ["#FF9933", "#FFFFFF", "#138808", "#000080"],
              "layout": "horizontal tricolor with centered wheel"},
     "search_hint": "india flag saffron white green chakra taj mahal",
     "motif": "The traveler wears a sherwani-style tunic banded horizontally in saffron (top), white (middle), and green (bottom) — the Indian flag as clothing. A deep navy Ashoka chakra wheel is embroidered at the chest center. Behind them, the small silhouette of the Taj Mahal's central dome.",
     "alt_motifs": ["A figure in a saffron/white/green horizontally banded tunic with a navy wheel emblem at the chest.",
                    "Portrait wearing an Indian tricolor sherwani with a chakra wheel embroidered on the chest.",
                    "The traveler wears a saffron-white-green banded garment with a navy 24-spoke wheel at the heart."]},
    {"id": "id", "name": "Indonesian",
     "flag": {"desc": "Flag of Indonesia: horizontal bicolor — red (top band) over white (bottom band), equal heights. Ratio 2:3. No emblem.",
              "palette": ["#FF0000", "#FFFFFF"],
              "layout": "horizontal bicolor"},
     "search_hint": "indonesia flag red white batik borobudur",
     "motif": "The traveler wears a batik-patterned garment split horizontally — red upper half, white lower half — the Indonesian flag as clothing. Ornate batik flourishes run along the red portion. Behind them, a tiered Borobudur stupa silhouette.",
     "alt_motifs": ["A figure in a garment split red over white with batik pattern flourishes along the red panel.",
                    "Portrait wearing a red-and-white batik tunic, stepped stupa temple silhouette behind.",
                    "The traveler wears a bisected red/white garment with intricate batik trim."]},
    {"id": "it", "name": "Italian",
     "flag": {"desc": "Flag of Italy: three equal vertical bands — green (hoist/left), white (middle), red (fly/right). Ratio 2:3. No emblem.",
              "palette": ["#009246", "#FFFFFF", "#CE2B37"],
              "layout": "vertical tricolor"},
     "search_hint": "italy flag green white red renaissance colosseum",
     "motif": "The traveler wears a Renaissance-style doublet with three vertical panels of green, white, and red — the Italian tricolor as clothing. A small laurel wreath pin on the white central panel. Behind them, the tiered arches of the Colosseum in silhouette.",
     "alt_motifs": ["A figure in a green/white/red vertically-paneled doublet with a laurel wreath pin on the white center.",
                    "Portrait wearing an Italian tricolor doublet with olive-branch pin, Colosseum behind.",
                    "The traveler wears a vertical green-white-red paneled garment with Renaissance tailoring."]},
    {"id": "ja", "name": "Japanese",
     "flag": {"desc": "Flag of Japan (Nisshōki / Hinomaru): plain white rectangular field with a single large crimson-red solar disc centered. The disc's diameter is 3/5 the flag's height, positioned exactly in the center. Ratio 2:3.",
              "palette": ["#FFFFFF", "#BC002D"],
              "layout": "solid field with single centered disc"},
     "search_hint": "japan flag red circle white kimono sun fuji",
     "motif": "The traveler wears a white kimono-style robe with a single large crimson solar disc centered on the chest — the Japanese flag as clothing. Subtle crane embroidery on the sleeves. Behind them, the snow-capped silhouette of Mount Fuji and a small torii gate.",
     "alt_motifs": ["A figure in a white kimono with a single red sun disc centered on the chest.",
                    "Portrait wearing a white robe with crimson rising-sun motif at the heart, Fuji behind.",
                    "The traveler wears a white kimono-style garment with a red sun disc on the chest and a torii behind."]},
    {"id": "ko", "name": "Korean",
     "flag": {"desc": "Flag of South Korea (Taegukgi): white field with a red-and-blue taegeuk (yin-yang circle, red top, blue bottom) centered. Four black trigrams at the corners: Geon (☰, three solid bars, upper-left), Ri (☲, solid/broken/solid, upper-right), Gam (☵, broken/solid/broken, lower-left), Gon (☷, three broken bars, lower-right). Ratio 2:3.",
              "palette": ["#FFFFFF", "#C60C30", "#003478", "#000000"],
              "layout": "white field with centered taegeuk and four corner trigrams"},
     "search_hint": "korea flag taegeuk trigrams hanbok palace",
     "motif": "The traveler wears a hanbok-style jeogori (short jacket) with a red-and-blue taegeuk (yin-yang) centered on the chest, surrounded by four black trigrams at the corners — the South Korean flag as clothing. Behind them, a curved-eave palace pavilion silhouette.",
     "alt_motifs": ["A figure in a white hanbok jacket with a red/blue yin-yang and four trigrams on the chest.",
                    "Portrait wearing a hanbok with the taegeuk centered at the heart, palace behind.",
                    "The traveler wears a white hanbok jacket embroidered with the Korean flag's central motif."]},
    {"id": "pl", "name": "Polish",
     "flag": {"desc": "Flag of Poland: horizontal bicolor — white (top band) over red (bottom band), equal heights. Ratio 5:8. No emblem on civil flag.",
              "palette": ["#FFFFFF", "#DC143C"],
              "layout": "horizontal bicolor"},
     "search_hint": "poland flag white red eagle szlachta",
     "motif": "The traveler wears a szlachta-style noble coat split horizontally — white upper half, deep red lower half — the Polish flag as clothing. A white crowned eagle crest sits at the chest on a red shield. Behind them, a pale Warsaw skyline.",
     "alt_motifs": ["A figure in a coat split white-over-red with a crowned white eagle emblem at the chest.",
                    "Portrait wearing a Polish white-and-red garment with heraldic eagle crest.",
                    "The traveler wears a bisected white/red coat with the Polish eagle on the chest."]},
    {"id": "pt", "name": "Portuguese",
     "flag": {"desc": "Flag of Portugal: vertical bicolor — green (hoist-side 2/5) and red (fly-side 3/5). Where the two colors meet sits the national coat of arms: a golden armillary sphere behind a red-and-white shield with five blue escutcheons in a cross and seven gold castles along the red border. Ratio 2:3.",
              "palette": ["#006600", "#FF0000", "#FFFF00", "#FFFFFF", "#0000FF"],
              "layout": "vertical bicolor with coat of arms at the color seam"},
     "search_hint": "portugal flag green red armillary sphere caravel",
     "motif": "The traveler wears a long overcoat split vertically — green (left third), red (right two-thirds) — the Portuguese flag as clothing. A golden armillary sphere and small shield are embroidered where the two colors meet at the chest. Behind them, the mast and sail of a caravel.",
     "alt_motifs": ["A figure in a green-and-red vertically-split coat with a golden armillary sphere at the chest.",
                    "Portrait wearing Portugal's green/red coat with an armillary sphere emblem on the chest.",
                    "The traveler wears a green-red split garment with a ringed sphere and small shield where the colors meet."]},
    {"id": "ru", "name": "Russian",
     "flag": {"desc": "Flag of the Russian Federation: three equal horizontal bands — white (top), blue (middle), red (bottom). Ratio 2:3. No emblem.",
              "palette": ["#FFFFFF", "#0039A6", "#D52B1E"],
              "layout": "horizontal tricolor"},
     "search_hint": "russia flag white blue red saint basil onion domes",
     "motif": "The traveler wears an overcoat banded horizontally in white, blue, and red — the Russian tricolor as clothing. Elaborate gold braid trim runs along the collar. Behind them, a cluster of colorful St. Basil's Cathedral onion domes as a distant silhouette.",
     "alt_motifs": ["A figure in a white/blue/red horizontally banded overcoat with gold braid at the collar.",
                    "Portrait wearing a Russian tricolor coat with ornate braid trim, onion domes behind.",
                    "The traveler wears a white-blue-red banded coat with golden collar embroidery."]},
    {"id": "es", "name": "Spanish",
     "flag": {"desc": "Flag of Spain: three horizontal bands — red (top 1/4), yellow (middle 1/2, double height), red (bottom 1/4). The Spanish coat of arms (quartered shield with crown and flanking Pillars of Hercules) sits on the yellow band, positioned 1/3 from the hoist. Ratio 2:3.",
              "palette": ["#AA151B", "#F1BF00"],
              "layout": "horizontal triband (1:2:1) with coat of arms on yellow"},
     "search_hint": "spain flag red yellow coat of arms sagrada familia",
     "motif": "The traveler wears a matador-style jacket banded horizontally — red (top), yellow (wide middle), red (bottom) — the Spanish flag as clothing. A small golden royal coat-of-arms crest at the chest. Behind them, the multi-spired silhouette of Sagrada Família.",
     "alt_motifs": ["A figure in a red/yellow/red horizontally banded matador jacket with a royal crest on the chest.",
                    "Portrait wearing Spain's red-yellow-red banded jacket with the coat of arms at the heart.",
                    "The traveler wears a Spanish tricolor jacket with gold embroidered crest at the center."]},
    {"id": "sv", "name": "Swedish",
     "flag": {"desc": "Flag of Sweden: blue field with a yellow/gold Nordic cross — the vertical arm of the cross is offset toward the hoist (left) side. Ratio 5:8.",
              "palette": ["#006AA7", "#FECC00"],
              "layout": "blue field with off-center Nordic cross"},
     "search_hint": "sweden flag blue yellow cross nordic viking longship",
     "motif": "The traveler wears a blue tunic with a large off-center yellow Nordic cross spanning the chest and shoulders — the Swedish flag as clothing. A small silver Tre Kronor (three crowns) pin at the collar. Behind them, a Viking longship's dragon prow in silhouette.",
     "alt_motifs": ["A figure in a deep blue tunic with a yellow off-center Nordic cross across the chest.",
                    "Portrait wearing the Swedish blue-and-gold cross garment, a longship dragon prow behind.",
                    "The traveler wears a blue tunic with a large gold Scandinavian cross extending across the shoulders."]},
    {"id": "th", "name": "Thai",
     "flag": {"desc": "Flag of Thailand (Trairanga): five horizontal bands — red (top, 1/6), white (1/6), deep blue (middle, 1/3 — double height), white (1/6), red (bottom, 1/6). Ratio 2:3. No emblem.",
              "palette": ["#ED1C24", "#FFFFFF", "#241D4F"],
              "layout": "horizontal five-band (red/white/blue-double/white/red)"},
     "search_hint": "thailand flag red white blue wat arun elephant",
     "motif": "The traveler wears a silk wrap banded horizontally in red, white, blue (wide middle), white, red — the Thai flag as clothing. Gold thread trim at the collar with small elephant motifs. Behind them, the stepped prang spire of Wat Arun.",
     "alt_motifs": ["A figure in a silk garment banded red/white/blue/white/red with gold elephant trim.",
                    "Portrait wearing a horizontally-banded five-stripe Thai garment with stepped temple behind.",
                    "The traveler wears a Thai tricolor silk wrap with gold collar embroidery."]},
    {"id": "tr", "name": "Turkish",
     "flag": {"desc": "Flag of Turkey (Ay Yıldız): solid crimson-red field with a white waxing crescent moon (opening to the fly/right) and a white five-point star to the right of the crescent, both positioned slightly left of center. Ratio 2:3.",
              "palette": ["#E30A17", "#FFFFFF"],
              "layout": "solid field with crescent moon and five-point star"},
     "search_hint": "turkey flag red white crescent star hagia sophia",
     "motif": "The traveler wears a crimson kaftan with a large white crescent moon and five-point star centered on the chest — the Turkish flag as clothing. Subtle white tughra-style calligraphic embroidery on the sleeves. Behind them, the dome-and-minarets silhouette of Hagia Sophia.",
     "alt_motifs": ["A figure in a crimson kaftan with a white crescent and star at the chest.",
                    "Portrait wearing a Turkish red kaftan with crescent-and-star emblem, domed mosque behind.",
                    "The traveler wears a red kaftan with white crescent moon and star motif on the chest."]},
    {"id": "vi", "name": "Vietnamese",
     "flag": {"desc": "Flag of Vietnam: solid crimson-red field with a single large golden-yellow five-point star centered. Ratio 2:3.",
              "palette": ["#DA251D", "#FFFF00"],
              "layout": "solid field with single centered five-point star"},
     "search_hint": "vietnam flag red yellow star ao dai lotus non la",
     "motif": "The traveler wears an áo dài-style long tunic in deep red with a large golden five-point star centered on the chest — the Vietnamese flag as clothing. A conical non lá hat tilts on the head. Behind them, a lotus bloom rising from a small sampan boat on a water line.",
     "alt_motifs": ["A figure in a red áo dài tunic with a large golden five-point star at the chest, wearing a conical hat.",
                    "Portrait wearing a crimson long tunic with a single gold star on the chest, lotus behind.",
                    "The traveler wears a red áo dài with a yellow star at the heart and a non lá hat."]},
]


# ─── SCENE SPRITES ────────────────────────────────────────────────
# One sprite per scenario category. These live on the
# Scene Categories page between Language → Scene → Phrase.

SCENE_SPRITES = [
    {"id": "social",     "name": "Social & Gathering", "search_hint": "two figures cheers toast silhouette pixel art",
     "motif": "Two stylized figures facing each other, each raising a cup/glass in a toast. A cluster of conversational spark-glyphs (small + cross shapes and dots) floats in the air between their faces, suggesting speech-meeting-speech. Warm, animated, human.",
     "alt_motifs": ["Two figures raising cups toward each other, small sparkle glyphs floating between them.",
                    "Two travelers meeting in a toast, a cluster of small stars between their raised cups.",
                    "A pair of silhouettes holding drinks aloft, tiny decorative sparks filling the space between."]},
    {"id": "food",       "name": "Food & Drinks", "search_hint": "cup plate bottle icon composite silhouette",
     "motif": "A composite still-life: a drinking cup centered, a flat plate behind it, and a tall tapered bottle silhouette beside them. All three objects grouped tightly. Simple, readable, universal dining iconography.",
     "alt_motifs": ["A cup, plate, and bottle silhouette clustered tightly at the center of the canvas.",
                    "A tall bottle, a cup, and a circular plate arranged as a dining still-life icon.",
                    "A group of three dining objects — bottle, cup, plate — centered on black background."]},
    {"id": "compliment", "name": "Compliments", "search_hint": "sparkle star heart speech bubble icon",
     "motif": "A stylized speech bubble shape with a single five-point sparkle/star floating inside it, plus a tiny heart nested in the sparkle's upper arm. The bubble has a cheerful directional tail pointing down-left. Generous and warm in feel.",
     "alt_motifs": ["A speech bubble containing a single sparkle/star glyph with a tiny heart inside.",
                    "A rounded speech-bubble icon with a five-point star centered and a small heart at one corner.",
                    "A cheerful speech bubble holding a single radiant star motif."]},
    {"id": "navigate",   "name": "Navigation & Help", "search_hint": "signpost arrows compass rose silhouette icon",
     "motif": "A signpost — vertical pole with two arrow-shaped signs pointing opposite horizontal directions. A small compass rose marker at the top of the pole. Underneath, a stylized winding path leads to the bottom edge, like a mini-map.",
     "alt_motifs": ["A signpost with two arrow signs pointing left and right, compass marker at the top.",
                    "A wayfinding signpost icon with arrows and a small compass rose above, stylized path below.",
                    "A pole with two opposing arrow signs and a compass emblem at the top."]},
    {"id": "formal",     "name": "Formal", "search_hint": "heraldic shield crest handshake laurel emblem",
     "motif": "A heraldic crest shield (classic kite-shield shape) centered, with two small hands meeting in a handshake inset at the shield's center. A laurel leaf flourish frames each side. Structured, composed, ceremonial.",
     "alt_motifs": ["A heraldic shield with a handshake inset at the center, laurel wreaths framing the sides.",
                    "A formal crest shield icon with two hands meeting inside, flanked by olive branches.",
                    "A ceremonial kite-shield emblem with a handshake at its heart and laurel flourishes."]},
    {"id": "custom",     "name": "Custom / Saved Scenes", "search_hint": "ornamental scroll parchment rune seal icon",
     "motif": "A partially-unrolled scroll or folded parchment with a single rune-like glyph stamped in its center (invent an ornamental rune — not a real alphabet). A small sealed keyhole or wax seal tucked in the lower corner. Feels like a saved personal spell-page in a traveler's book.",
     "alt_motifs": ["An unrolled parchment scroll with a single ornamental rune glyph in the center and a wax seal below.",
                    "A folded parchment with a decorative rune stamped at its center and a sealed corner.",
                    "A partially-opened scroll bearing a single invented glyph and a small wax seal."]},
]


# ─── UTILITY SPRITES ──────────────────────────────────────────────
# App affordance glyphs. Each is icon-grade (reads at 32×32).

UTILITY_SPRITES = [
    {"id": "favorite", "name": "Favorite", "search_hint": "five point star icon pixel art sparkle",
     "motif": "A single five-point star, solidly filled with a crisp outline. Small sparkle dots in the corners of the canvas. Iconic, instantly-readable favorite/star symbol.",
     "alt_motifs": ["A single filled five-point star with a clean outline and small sparkle dots at the corners.",
                    "A five-pointed star glyph centered on black, with a subtle glow.",
                    "A filled pixel-art star with two or three tiny corner sparkles."]},
    {"id": "saved", "name": "Saved", "search_hint": "bookmark ribbon icon pixel art",
     "motif": "A classic bookmark ribbon — rectangular shape with an inverted V notch cut from the bottom edge. A single small glyph (a tiny compass mark) centered on the ribbon face.",
     "alt_motifs": ["A bookmark ribbon with an inverted V notch at the bottom, small glyph centered on the face.",
                    "A tall rectangular ribbon with a triangular notch cut from its lower edge and a small emblem in the middle.",
                    "A bookmark icon with ornamental emblem at its center."]},
    {"id": "recent", "name": "Recent", "search_hint": "analog clock face icon pixel art",
     "motif": "A round analog clock face viewed head-on — circular outline with tick marks at 12/3/6/9, hour and minute hands pointing to roughly 10:10. A tiny arrow-back swoop beside it to suggest 'recently used'.",
     "alt_motifs": ["A round clock face with tick marks at 12/3/6/9 and hands at 10:10, with a small curved arrow beside it.",
                    "An analog clock icon with a back-arrow swoop suggesting 'recent'.",
                    "A circular clock face with minute/hour hands and a tiny curved arrow nearby."]},
    {"id": "quiz", "name": "Quiz", "search_hint": "speech bubble question mark icon",
     "motif": "A speech bubble shape containing a single bold question mark '?' centered inside it. The bubble has a short directional tail pointing down-left. Playful but confident.",
     "alt_motifs": ["A speech bubble with a bold question mark centered inside.",
                    "A rounded speech bubble icon containing a question mark symbol and a short pointer tail.",
                    "A chat-bubble glyph with a '?' character in the center."]},
    {"id": "home", "name": "Home", "search_hint": "house compass icon pixel art",
     "motif": "A small house silhouette — pitched roof, single door, single window — with a tiny compass needle embedded where the chimney would be. 'Your home-base, your orientation point'.",
     "alt_motifs": ["A pitched-roof house silhouette with door and window and a small compass emblem where the chimney would be.",
                    "A home icon with a tiny compass-needle ornament on the roof.",
                    "A simple house silhouette with a directional compass mark on top."]},
    {"id": "compose", "name": "Compose", "search_hint": "quill feather pen sparkle icon",
     "motif": "A quill pen diagonally crossing the canvas, its nib at the lower-left pointing down-left. A single sparkle/asterisk glyph at the nib tip suggesting fresh writing. Premium, old-world, deliberate.",
     "alt_motifs": ["A quill pen on a diagonal with a small sparkle at the nib tip.",
                    "A feather pen icon crossing the canvas diagonally with a spark at the writing tip.",
                    "An ornamental quill with an asterisk glyph at the writing end."]},
    {"id": "push", "name": "Push to Glasses", "search_hint": "eyeglasses upward broadcast arrow icon",
     "motif": "A pair of eyeglasses silhouette (two round lenses, bridge, temples) with an upward-pointing broadcast arrow rising from the bridge — like sending data up to the glasses. Clean and diagrammatic.",
     "alt_motifs": ["A pair of round eyeglasses with an upward-pointing broadcast arrow rising from the bridge.",
                    "Spectacles icon with an ascending arrow indicating transmission to the glasses.",
                    "Two circular lenses with a bridge and temples, plus an upward directional arrow above."]},
    {"id": "search", "name": "Search", "search_hint": "magnifying glass lens icon pixel art",
     "motif": "A magnifying lens — circular lens with a diagonal handle extending to the lower-right. A single small crosshair or dot in the lens center. Classic search icon, premium stroke weight.",
     "alt_motifs": ["A magnifying glass with a circular lens, diagonal handle to the lower right, and a small center dot.",
                    "A search-lens icon with a round frame and extending handle.",
                    "A classic magnifying glass glyph with a crosshair in the lens center."]},
]


# ══════════════════════════════════════════════════════════════════
# OPENAI IMAGE API
# ══════════════════════════════════════════════════════════════════

def call_openai_image(prompt, api_key, ref_paths=None, retries=3):
    """Generate an image via gpt-image-1. Optionally include reference images."""
    for attempt in range(retries):
        try:
            if ref_paths:
                return _call_with_refs(prompt, api_key, ref_paths)
            else:
                return _call_simple(prompt, api_key)
        except requests.exceptions.HTTPError as e:
            err_body = ""
            try: err_body = e.response.json()
            except: err_body = e.response.text
            if e.response.status_code == 400 and "moderation" in str(err_body).lower():
                return None, f"moderation_block: {err_body}"
            if e.response.status_code == 429:
                wait = min(2 ** attempt * 5, 30)
                print(f"  Rate limited, waiting {wait}s...")
                time.sleep(wait)
                continue
            return None, f"API error ({e.response.status_code}): {err_body}"
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(2)
                continue
            return None, str(e)
    return None, "Max retries exceeded"


def _call_with_refs(prompt, api_key, ref_paths):
    files = []
    for img_path in ref_paths:
        p = Path(img_path)
        if not p.exists() or p.suffix.lower() == '.gif':
            continue
        mime = {".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                ".png": "image/png", ".webp": "image/webp"
                }.get(p.suffix.lower(), "image/png")
        f = open(p, "rb")
        files.append(("image[]", (p.name, f, mime)))
    if not files:
        return _call_simple(prompt, api_key)
    try:
        resp = requests.post("https://api.openai.com/v1/images/edits",
            headers={"Authorization": f"Bearer {api_key}"},
            data={"model": "gpt-image-1", "prompt": prompt,
                  "n": 1, "size": "1024x1024", "quality": "high"},
            files=files, timeout=180)
        resp.raise_for_status()
        data = resp.json()
        if data.get("data") and data["data"][0].get("b64_json"):
            return base64.b64decode(data["data"][0]["b64_json"]), None
        return None, "No image in response"
    finally:
        for _, (_, f, _) in files:
            try: f.close()
            except: pass


def _call_simple(prompt, api_key):
    resp = requests.post("https://api.openai.com/v1/images/generations",
        headers={"Authorization": f"Bearer {api_key}",
                 "Content-Type": "application/json"},
        json={"model": "gpt-image-1", "prompt": prompt,
              "n": 1, "size": "1024x1024", "quality": "high"},
        timeout=120)
    resp.raise_for_status()
    data = resp.json()
    if data.get("data") and data["data"][0].get("b64_json"):
        return base64.b64decode(data["data"][0]["b64_json"]), None
    return None, "No image in response"


# ══════════════════════════════════════════════════════════════════
# MASTER TEMPLATE GENERATION
# ══════════════════════════════════════════════════════════════════

def generate_system_master(api_key, ref_path=None):
    """Generate the master flag canvas. Honors prompt override from config."""
    ref_note = ""
    if ref_path:
        ref_note = "\n\nA REFERENCE IMAGE is attached. Use it as visual inspiration — but render it in the pixel art style described above."

    override = get_template_prompt_override("master")
    if override:
        # User-edited prompt wins, but we still prepend SYSTEM_STYLE as the guardrail
        prompt = f"""{SYSTEM_STYLE}

{override}{ref_note}"""
    else:
        prompt = f"""{SYSTEM_STYLE}

SUBJECT: {MASTER_DESCRIPTION}

This is the MASTER TEMPLATE for the entire Lingua Franca sprite system.
Every language flag generated after this must match this EXACT pixel art
style, lighting direction, contrast level, and cloth rendering.{ref_note}"""

    if ref_path and Path(ref_path).exists():
        img_bytes, err = _call_with_refs(prompt, api_key, [str(ref_path)])
    else:
        img_bytes, err = _call_simple(prompt, api_key)
    if err:
        return None, err
    TEMPLATE_DIR.mkdir(parents=True, exist_ok=True)
    path = TEMPLATE_DIR / "candidate_master.png"
    with open(path, "wb") as f:
        f.write(img_bytes)
    return str(path), None


def approve_system_master():
    cand = TEMPLATE_DIR / "candidate_master.png"
    if not cand.exists():
        return False, "No candidate to approve"
    dest = TEMPLATE_DIR / "master_neutral.png"
    shutil.copy2(cand, dest)
    return True, str(dest)


# ══════════════════════════════════════════════════════════════════
# CATEGORY TEMPLATE GENERATION
# ══════════════════════════════════════════════════════════════════

CATEGORY_TEMPLATE_PROMPTS = {
    "language": """Now generate a generic LANGUAGE SPRITE EXEMPLAR in the same visual language:
A small country-landmark silhouette composition — think: "landmark + cultural motif fused into a single framed vignette." Pick a generic fantasy landmark (a domed tower beside a stylized tree) centered on black background, filling ~65% of canvas. Same stroke weight and contrast as the master template. Clean silhouette, instantly readable at small sizes. This is NOT a final language sprite — it's the style template every real language sprite will reference.""",
    "scene": """Now generate a generic SCENE ICON EXEMPLAR in the same visual language:
A tight symbolic composition of 2-3 objects grouped together — think: "game inventory category icon." Pick a generic composition (a scroll, a quill, and a single spark, grouped centered) filling ~55% of canvas. Same stroke weight and contrast as the master template. Clean silhouette, high negative space. This is the style template every real scene icon will reference.""",
    "utility": """Now generate a generic UTILITY GLYPH EXEMPLAR in the same visual language:
A single clean symbol with high negative space — think: "premium app toolbar icon." Pick a generic glyph (a sparkle/asterisk with a tiny orbit ring) centered on black, filling ~50% of canvas. Same stroke weight and contrast as the master template. This is the style template every real utility glyph will reference.""",
}


def generate_category_template(category, api_key):
    master = TEMPLATE_DIR / "master_neutral.png"
    if not master.exists():
        return None, "Master template not approved yet"
    override = get_template_prompt_override(category)
    body = override or CATEGORY_TEMPLATE_PROMPTS.get(category)
    if not body:
        return None, f"Unknown category: {category}"
    prompt = f"""{SYSTEM_STYLE}

IMAGE 1 is the MASTER FLAG CANVAS — the style anchor. Match its rendering
approach: fabric texture, pixel treatment, lighting direction, canvas
placement. Substitute its invented design with the design described below.

{body}"""
    img_bytes, err = call_openai_image(prompt, api_key, ref_paths=[str(master)])
    if err:
        return None, err
    path = TEMPLATE_DIR / f"candidate_{category}.png"
    with open(path, "wb") as f:
        f.write(img_bytes)
    return str(path), None


def generate_world_master(api_key):
    """Generate the World Master — globe surrounded by a flag halo.
    References the master dummy + up to 8 existing language flag sprites
    so the halo reads as accurate, in-style flags."""
    master = TEMPLATE_DIR / "master_neutral.png"
    refs = []
    if master.exists():
        refs.append(str(master))
    # Pull up to 8 already-generated language sprites as style + identity refs
    lang_dir = SPRITES_DIR / "language"
    if lang_dir.exists():
        flag_pngs = sorted([f for f in lang_dir.iterdir()
                            if f.suffix.lower() == ".png"])
        for f in flag_pngs[:8]:
            refs.append(str(f))

    override = get_template_prompt_override("world")
    body = override or WORLD_MASTER_DESCRIPTION
    ref_note = ""
    if len(refs) > 1:
        ref_note = (f"\n\nIMAGE 1 is the MASTER DUMMY (style anchor). "
                    f"IMAGES 2+ are already-generated national flag sprites — "
                    f"use them as the visual source of truth for the halo's flag "
                    f"geometry, palette, and style. The halo should include these "
                    f"flags (plus others) in the same rendering.")
    elif len(refs) == 1:
        ref_note = "\n\nIMAGE 1 is the MASTER DUMMY — style anchor."

    prompt = f"""{SYSTEM_STYLE}

SUBJECT: {body}{ref_note}

This is the WORLD MASTER for Lingua Franca — a hero/splash sprite showing the
globe and a halo of national flags. Match the master's rendering approach."""

    img_bytes, err = call_openai_image(prompt, api_key,
                                       ref_paths=refs if refs else None,
                                       retries=3)
    if err:
        return None, err
    TEMPLATE_DIR.mkdir(parents=True, exist_ok=True)
    path = TEMPLATE_DIR / "candidate_world.png"
    with open(path, "wb") as f:
        f.write(img_bytes)
    return str(path), None


def generate_scene_master(scene_id, api_key):
    """Generate one of the per-scene category masters."""
    if scene_id not in SCENE_MASTER_PROMPTS:
        return None, f"Unknown scene master: {scene_id}"
    master = TEMPLATE_DIR / "master_neutral.png"
    refs = [str(master)] if master.exists() else []

    override_key = f"scene_{scene_id}"
    body = get_template_prompt_override(override_key) or SCENE_MASTER_PROMPTS[scene_id]

    prompt = f"""{SYSTEM_STYLE}

{'IMAGE 1 is the MASTER FLAG CANVAS (style anchor) — match its rendering approach: cloth/pixel treatment, lighting, painterly texture.' if refs else ''}

SUBJECT — Scene Master for {scene_id.upper()}:
{body}"""

    img_bytes, err = call_openai_image(prompt, api_key,
                                       ref_paths=refs if refs else None,
                                       retries=3)
    if err:
        return None, err
    TEMPLATE_DIR.mkdir(parents=True, exist_ok=True)
    path = TEMPLATE_DIR / f"candidate_scene_{scene_id}.png"
    with open(path, "wb") as f:
        f.write(img_bytes)
    return str(path), None


def approve_scene_master(scene_id):
    if scene_id not in SCENE_MASTER_PROMPTS:
        return False, f"Unknown scene master: {scene_id}"
    cand = TEMPLATE_DIR / f"candidate_scene_{scene_id}.png"
    if not cand.exists():
        return False, f"No candidate for scene_{scene_id}"
    dest = TEMPLATE_DIR / f"master_scene_{scene_id}.png"
    shutil.copy2(cand, dest)
    return True, str(dest)


def approve_world_master():
    cand = TEMPLATE_DIR / "candidate_world.png"
    if not cand.exists():
        return False, "No candidate to approve"
    dest = TEMPLATE_DIR / "master_world.png"
    shutil.copy2(cand, dest)
    return True, str(dest)


def approve_category_template(category):
    cand = TEMPLATE_DIR / f"candidate_{category}.png"
    if not cand.exists():
        return False, f"No candidate for {category}"
    dest = TEMPLATE_DIR / f"master_{category}.png"
    shutil.copy2(cand, dest)
    return True, str(dest)


# ══════════════════════════════════════════════════════════════════
# INDIVIDUAL SPRITE GENERATION
# ══════════════════════════════════════════════════════════════════

def _language_prompts(item, ref_desc_has_master, ref_desc_has_subject_refs):
    """The output sprite IS the country's national flag, rendered in the
    Lingua Franca pixel style. No characters, no portraits — just the flag
    as cloth on a black background, faithfully reproduced.
    Returns prompt variants: primary, then alts in order."""
    flag = item.get("flag", {}) or {}
    flag_desc = flag.get("desc", "").strip()
    flag_palette = ", ".join(flag.get("palette", [])) or "match real flag"
    flag_layout = flag.get("layout", "")

    flag_block = f"""LITERAL NATIONAL FLAG — must match the REAL flag of this country EXACTLY.
No invented designs, no artistic liberties with geometry, proportions,
colors, or symbols. A viewer from this country must recognize it instantly.

SPECIFICATION:
{flag_desc}
Exact palette (hex): {flag_palette}
Layout type: {flag_layout}"""

    header = f"""{SYSTEM_STYLE}

{'IMAGE 1 is the MASTER FLAG CANVAS — the style anchor. Match its rendering approach EXACTLY: fabric texture, stripe geometry, cloth waver, canvas placement, lighting direction, painterly pixel treatment. DISCARD its invented teal/cream/ochre palette and eight-point emblem — those are placeholders. Use the real palette and geometry below.' if ref_desc_has_master else ''}
{'IMAGES 2+ are real-world REFERENCES — photographs of the actual national flag. Use them as the source of truth for GEOMETRY, STRIPE RATIOS, EMBLEM PLACEMENT, and COLORS. Render in the master pixel-art style, never photographic.' if ref_desc_has_subject_refs else ''}

{flag_block}

OUTPUT = THE FLAG ITSELF. The sprite is language-coded for {item['name']}:
a faithful pixel-art rendition of this country's real national flag as cloth.

COMPOSITION:
- The flag fills ~80% of the canvas, centered, on solid pure-black background
- Aspect ratio matches the real flag's official ratio (2:3, 3:5, etc. as per spec)
- Slight fabric waver at the edges — the flag reads as cloth, not a rigid rectangle
- Subtle cloth-texture dither across the surface, same treatment as the master canvas
- No flagpole, no rope, no hand, no person, no character — just the flag
- Same upper-left key light, same shadow pattern as the master

CRITICAL:
- Geometry must match the real flag exactly (stripe count, stripe ratios, emblem
  position, canton placement, symbol rotation) — cross-check against the reference
  images if provided
- Palette must use the real flag's hex values listed above; no creative substitution
- Painterly pixel rendering in the master's style — visible brush on fabric, crisp
  edges on stripe boundaries
- NO text, NO country name, NO captions anywhere in the image
- NO people, NO characters, NO clothing, NO portraits — the sprite is purely the flag"""

    variants = [header]
    for alt in item.get("alt_motifs", []):
        alt_header = f"""{SYSTEM_STYLE}

{flag_block}

OUTPUT = the real national flag of {item['name']}, rendered as cloth in the
Lingua Franca pixel style. Fill ~80% of canvas, centered, solid black background.
Slight fabric waver, subtle cloth dither, upper-left key light. Aspect matches
the real flag's official ratio. No flagpole, no character, no text.

Alternate stylistic hint (safer phrasing): {alt}

Match the reference images for geometry and palette. Nothing but the flag."""
        variants.append(alt_header)
    return variants


def _icon_prompts(category, item, ref_desc):
    """Symbol-style prompt for scene + utility icons. Returns variants list."""
    icon_rules = {
        "scene": """
SPRITE RULES:
- This is a SCENE ICON — a tight symbolic composition of 2-3 objects
- Instantly readable at very small sizes (32×32 to 96×96)
- Clean silhouette, high negative space, center-weighted
- Solid black background, fill ~55-65% of canvas
- Match the master dummy's art style and lighting direction
- NO text, NO labels""",
        "utility": """
GLYPH RULES:
- This is a UTILITY GLYPH — a single clean toolbar-grade symbol
- Must read instantly at 32×32 — this is the primary size constraint
- Minimal composition, high negative space, center-weighted
- Solid black background, fill ~45-55% of canvas
- Match the master dummy's art style and lighting direction
- NO text, NO labels""",
    }[category]

    primary = f"""{SYSTEM_STYLE}

{ref_desc}

Generate the {category.upper()} icon for: {item['name']}

{item['motif']}
{icon_rules}"""
    variants = [primary]
    for alt in item.get("alt_motifs", []):
        variants.append(f"""{SYSTEM_STYLE}

{ref_desc}

Generate the {category.upper()} icon for: {item['name']} (simplified).
{alt}
{icon_rules}""")
    return variants


def _is_moderation_error(err):
    if not err:
        return False
    s = str(err).lower()
    return any(w in s for w in ("moderation", "safety", "blocked", "rejected", "content_policy"))


def _collect_subject_refs(category, sprite_id, max_refs=12):
    """Return all reference image paths for a subject, in a stable order."""
    ref_dir = REFS_DIR / category / sprite_id
    if not ref_dir.exists():
        return []
    refs = sorted([f for f in ref_dir.iterdir()
                   if f.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")])
    return [str(p) for p in refs[:max_refs]]


def generate_sprite(category, sprite_id, api_key):
    """Generate a single sprite using the multi-reference + alt-cycling pattern
    cribbed from soPHICON."""
    master = TEMPLATE_DIR / "master_neutral.png"
    cat_template = TEMPLATE_DIR / f"master_{category}.png"
    # For scene sprites, prefer the scene-specific master (e.g.,
    # master_scene_social.png) over the generic scene master.
    if category == "scene":
        scene_specific = TEMPLATE_DIR / f"master_scene_{sprite_id}.png"
        if scene_specific.exists():
            cat_template = scene_specific

    catalog = {"language": LANGUAGE_SPRITES,
               "scene": SCENE_SPRITES,
               "utility": UTILITY_SPRITES}.get(category)
    if catalog is None:
        return None, f"Unknown category: {category}"
    item = next((x for x in catalog if x["id"] == sprite_id), None)
    if not item:
        return None, f"Unknown {category} sprite: {sprite_id}"

    # ── Assemble reference stack ──────────────────────────────────
    refs = []
    if master.exists():
        refs.append(str(master))               # IMAGE 1 = master dummy
    if cat_template.exists() and str(cat_template) not in refs:
        refs.append(str(cat_template))         # IMAGE 2 = category/scene-specific master

    subject_refs = _collect_subject_refs(category, sprite_id)
    refs.extend(subject_refs)                  # IMAGES 3+ = subject refs

    # ── Build prompt variants ─────────────────────────────────────
    if category == "language":
        variants = _language_prompts(item,
                                     ref_desc_has_master=master.exists(),
                                     ref_desc_has_subject_refs=bool(subject_refs))
    else:
        ref_desc = ("IMAGE 1 is the MASTER STYLE REFERENCE — match its art style, lighting, and rendering."
                    if refs else "")
        variants = _icon_prompts(category, item, ref_desc)

    # ── Try primary, then alts on moderation/soft failures ────────
    img_bytes = None
    last_err = None
    for i, prompt in enumerate(variants):
        label = "primary" if i == 0 else f"alt {i}"
        print(f"  [{category}/{sprite_id}] trying {label} (refs={len(refs)})...")
        img_bytes, err = call_openai_image(prompt, api_key,
                                           ref_paths=refs if refs else None,
                                           retries=2)
        if img_bytes:
            break
        last_err = err
        if _is_moderation_error(err):
            print(f"    moderation on {label}, trying next variant...")
            continue
        # Non-moderation error: bail, alts won't help
        break

    if not img_bytes:
        return None, last_err or "All prompt variants failed"

    # ── Write to BOTH working set and public shipping folder ──────
    filename = f"lang-{sprite_id}.png" if category == "language" else f"{category}-{sprite_id}.png"
    working_path = SPRITES_DIR / category / filename
    public_path  = PUBLIC_DIR  / category / filename
    with open(working_path, "wb") as f:
        f.write(img_bytes)
    shutil.copy2(working_path, public_path)
    return str(working_path), None


# ══════════════════════════════════════════════════════════════════
# MANIFEST & TYPESCRIPT EMITTER
# ══════════════════════════════════════════════════════════════════

def _filename_for(category, sprite_id):
    return f"lang-{sprite_id}.png" if category == "language" else f"{category}-{sprite_id}.png"

def build_manifest():
    """Emit manifest.json + src/sprites.ts mapping every key to its sprite path."""
    manifest = {"language": {}, "scene": {}, "utility": {}}
    for item in LANGUAGE_SPRITES:
        fn = _filename_for("language", item["id"])
        exists = (PUBLIC_DIR / "language" / fn).exists()
        manifest["language"][item["id"]] = {
            "name": item["name"],
            "file": f"/sprites/language/{fn}",
            "generated": exists,
        }
    for item in SCENE_SPRITES:
        fn = _filename_for("scene", item["id"])
        exists = (PUBLIC_DIR / "scene" / fn).exists()
        manifest["scene"][item["id"]] = {
            "name": item["name"],
            "file": f"/sprites/scene/{fn}",
            "generated": exists,
        }
    for item in UTILITY_SPRITES:
        fn = _filename_for("utility", item["id"])
        exists = (PUBLIC_DIR / "utility" / fn).exists()
        manifest["utility"][item["id"]] = {
            "name": item["name"],
            "file": f"/sprites/utility/{fn}",
            "generated": exists,
        }

    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    MANIFEST_JSON.write_text(json.dumps(manifest, indent=2) + "\n")

    # Emit TypeScript constants file the app imports
    def ts_record(cat_key, entries):
        lines = [f"export const {cat_key}: Record<string, string> = {{"]
        for k, v in entries.items():
            lines.append(f'  {json.dumps(k)}: {json.dumps(v["file"])},')
        lines.append("};")
        return "\n".join(lines)

    ts = [
        "// ═══════════════════════════════════════════════════════════════════",
        "// Lingua Franca — Sprite Registry  (auto-generated by sprite-system)",
        "// DO NOT EDIT BY HAND. Regenerate via:",
        "//   cd sprite-system && python3 lingua_sprites.py    then POST /api/manifest",
        "// ═══════════════════════════════════════════════════════════════════",
        "",
        ts_record("LANG_SPRITE",    manifest["language"]),
        "",
        ts_record("SCENE_SPRITE",   manifest["scene"]),
        "",
        ts_record("UTILITY_SPRITE", manifest["utility"]),
        "",
        "/** Scene category ordering used by the app UI. */",
        "export const SCENE_ORDER: ReadonlyArray<string> = [",
        *[f'  {json.dumps(s["id"])},' for s in SCENE_SPRITES],
        "];",
        "",
    ]
    TS_CONSTANTS.parent.mkdir(parents=True, exist_ok=True)
    TS_CONSTANTS.write_text("\n".join(ts))

    return manifest


# ══════════════════════════════════════════════════════════════════
# IMAGE SEARCH (reference-finding)
# ══════════════════════════════════════════════════════════════════

def search_images(query, max_results=50):
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    results = []
    try:
        resp = requests.get(
            f"https://www.bing.com/images/search?q={quote_plus(query)}&first=1&count={max_results}&qft=+filterui:photo-photo",
            headers=headers, timeout=10)
        urls = re.findall(r'murl&quot;:&quot;(https?://[^&]+?)&quot;', resp.text)
        thumbs = re.findall(r'turl&quot;:&quot;(https?://[^&]+?)&quot;', resp.text)
        results = [{"url": u, "thumbnail": thumbs[i] if i < len(thumbs) else u,
                    "title": query, "source": "bing"}
                   for i, u in enumerate(urls[:max_results])]
    except Exception as e:
        print(f"Search error: {e}")
    if len(results) < 5:
        try:
            resp = requests.get("https://duckduckgo.com/", params={"q": query},
                                headers=headers, timeout=10)
            m = re.search(r'vqd=([\d-]+)', resp.text) or re.search(r"vqd='([\d-]+)'", resp.text)
            if m:
                ir = requests.get("https://duckduckgo.com/i.js",
                    params={"l": "us-en", "o": "json", "q": query,
                            "vqd": m.group(1), "f": ",,,,,", "p": "1"},
                    headers=headers, timeout=10)
                for r in ir.json().get("results", [])[:max_results]:
                    results.append({"url": r.get("image", ""),
                                    "thumbnail": r.get("thumbnail", ""),
                                    "title": r.get("title", ""), "source": "ddg"})
        except:
            pass
    return results


def download_ref(url, category, asset_id):
    ref_dir = REFS_DIR / category / asset_id
    ref_dir.mkdir(parents=True, exist_ok=True)
    existing = sorted(ref_dir.glob("ref_*"))
    idx = len(existing) + 1
    try:
        resp = requests.get(url, timeout=15,
                            headers={"User-Agent": "Mozilla/5.0"})
        resp.raise_for_status()
        ct = resp.headers.get("content-type", "")
        ext = ".png" if "png" in ct else ".webp" if "webp" in ct else ".jpg"
        path = ref_dir / f"ref_{idx:02d}{ext}"
        with open(path, "wb") as f:
            f.write(resp.content)
        return str(path), None
    except Exception as e:
        return None, str(e)


# ══════════════════════════════════════════════════════════════════
# FLASK ROUTES
# ══════════════════════════════════════════════════════════════════

@app.route("/api/key/status")
def api_key_status():
    return jsonify({"ok": bool(load_api_key()), "set": bool(load_api_key())})

@app.route("/api/key/save", methods=["POST"])
def api_key_save():
    key = request.json.get("key", "").strip()
    if not key:
        return jsonify({"ok": False, "msg": "No key provided"}), 400
    save_api_key(key)
    return jsonify({"ok": True})


@app.route("/api/assets")
def api_assets():
    """Return full asset registry with generation status."""
    def entry(cat, item):
        fn = _filename_for(cat, item["id"])
        ref_dir = REFS_DIR / cat / item["id"]
        ref_count = 0
        if ref_dir.exists():
            ref_count = sum(1 for f in ref_dir.iterdir()
                            if f.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"))
        return {
            "id": item["id"], "name": item["name"],
            "generated": (SPRITES_DIR / cat / fn).exists(),
            "shipped":   (PUBLIC_DIR  / cat / fn).exists(),
            "ref_count": ref_count,
            "search_hint": item.get("search_hint", ""),
        }

    languages = [entry("language", x) for x in LANGUAGE_SPRITES]
    scenes    = [entry("scene",    x) for x in SCENE_SPRITES]
    utilities = [entry("utility",  x) for x in UTILITY_SPRITES]

    templates = {
        "master":   (TEMPLATE_DIR / "master_neutral.png").exists(),
        "candidate":(TEMPLATE_DIR / "candidate_master.png").exists(),
        "language": (TEMPLATE_DIR / "master_language.png").exists(),
        "scene":    (TEMPLATE_DIR / "master_scene.png").exists(),
        "utility":  (TEMPLATE_DIR / "master_utility.png").exists(),
        "world":    (TEMPLATE_DIR / "master_world.png").exists(),
    }
    # Per-scene masters (5 category archetypes)
    for sid in SCENE_MASTER_KEYS:
        templates[f"scene_{sid}"] = (TEMPLATE_DIR / f"master_scene_{sid}.png").exists()

    return jsonify({
        "templates": templates,
        "languages": languages,
        "scenes": scenes,
        "utilities": utilities,
        "stats": {
            "language_done": sum(1 for x in languages if x["generated"]),
            "language_total": len(languages),
            "scene_done": sum(1 for x in scenes if x["generated"]),
            "scene_total": len(scenes),
            "utility_done": sum(1 for x in utilities if x["generated"]),
            "utility_total": len(utilities),
        }
    })


@app.route("/api/template/generate", methods=["POST"])
def api_generate_master():
    api_key = load_api_key()
    if not api_key:
        return jsonify({"ok": False, "msg": "No API key"}), 400
    ref_path = None
    if "reference" in request.files:
        ref_file = request.files["reference"]
        if ref_file.filename:
            ref_path = REFS_DIR / "language" / f"master_ref_{ref_file.filename}"
            ref_file.save(str(ref_path))
    path, err = generate_system_master(api_key, ref_path=ref_path)
    if err:
        return jsonify({"ok": False, "msg": err}), 500
    return jsonify({"ok": True, "path": path})

@app.route("/api/template/approve", methods=["POST"])
def api_approve_master():
    ok, msg = approve_system_master()
    return jsonify({"ok": ok, "msg": msg})

@app.route("/api/template/scene-master/<scene_id>/generate", methods=["POST"])
def api_generate_scene_master(scene_id):
    api_key = load_api_key()
    if not api_key:
        return jsonify({"ok": False, "msg": "No API key"}), 400
    path, err = generate_scene_master(scene_id, api_key)
    if err:
        return jsonify({"ok": False, "msg": err}), 500
    return jsonify({"ok": True, "path": path})


@app.route("/api/template/scene-master/<scene_id>/approve", methods=["POST"])
def api_approve_scene_master(scene_id):
    ok, msg = approve_scene_master(scene_id)
    return jsonify({"ok": ok, "msg": msg})


@app.route("/api/template/world/generate", methods=["POST"])
def api_generate_world():
    api_key = load_api_key()
    if not api_key:
        return jsonify({"ok": False, "msg": "No API key"}), 400
    path, err = generate_world_master(api_key)
    if err:
        return jsonify({"ok": False, "msg": err}), 500
    return jsonify({"ok": True, "path": path})


@app.route("/api/template/world/approve", methods=["POST"])
def api_approve_world():
    ok, msg = approve_world_master()
    return jsonify({"ok": ok, "msg": msg})


@app.route("/api/template/category/generate", methods=["POST"])
def api_generate_category_template():
    cat = request.json.get("category")
    api_key = load_api_key()
    if not api_key:
        return jsonify({"ok": False, "msg": "No API key"}), 400
    path, err = generate_category_template(cat, api_key)
    if err:
        return jsonify({"ok": False, "msg": err}), 500
    return jsonify({"ok": True, "path": path})

@app.route("/api/template/category/approve", methods=["POST"])
def api_approve_category_template():
    cat = request.json.get("category")
    ok, msg = approve_category_template(cat)
    return jsonify({"ok": ok, "msg": msg})


@app.route("/api/generate/<category>", methods=["POST"])
def api_gen_sprite(category):
    if category not in CATEGORIES:
        return jsonify({"ok": False, "msg": f"Unknown category: {category}"}), 400
    sprite_id = request.json.get("id")
    api_key = load_api_key()
    if not api_key:
        return jsonify({"ok": False, "msg": "No API key"}), 400
    path, err = generate_sprite(category, sprite_id, api_key)
    if err:
        return jsonify({"ok": False, "msg": err}), 500
    return jsonify({"ok": True, "path": path})


@app.route("/api/pipeline/run", methods=["POST"])
def api_pipeline_run():
    """End-to-end for one subject: (optionally) auto-collect refs, then generate.
    Body: { category, id, n_refs?=8, skip_refs?=false, min_refs?=4 }
    - If skip_refs=true OR the subject already has >= min_refs, refs step is skipped.
    """
    cat        = request.json.get("category")
    sprite_id  = request.json.get("id")
    n_refs     = int(request.json.get("n_refs", 8))
    skip_refs  = bool(request.json.get("skip_refs", False))
    min_refs   = int(request.json.get("min_refs", 4))
    api_key    = load_api_key()
    if not api_key:
        return jsonify({"ok": False, "msg": "No API key"}), 400
    if cat not in CATEGORIES:
        return jsonify({"ok": False, "msg": f"Unknown category: {cat}"}), 400
    item = _lookup_item(cat, sprite_id)
    if not item:
        return jsonify({"ok": False, "msg": f"Unknown item: {sprite_id}"}), 400

    summary = {"id": sprite_id, "name": item["name"], "steps": []}

    # ── Step 1: refs (optional / idempotent) ──────────────────────
    existing_count = len(_collect_subject_refs(cat, sprite_id, max_refs=999))
    if not skip_refs and existing_count < min_refs:
        query = item.get("search_hint") or item["name"]
        results = search_images(query, max_results=max(n_refs * 2, 16))
        saved = []
        for r in results:
            if len(saved) >= n_refs:
                break
            path, err = download_ref(r.get("url", ""), cat, sprite_id)
            if path and not err:
                saved.append(path)
        summary["steps"].append({"stage": "refs", "saved": len(saved),
                                 "query": query, "had": existing_count})
    else:
        summary["steps"].append({"stage": "refs", "skipped": True,
                                 "had": existing_count})

    # ── Step 2: generate ──────────────────────────────────────────
    path, err = generate_sprite(cat, sprite_id, api_key)
    if err:
        summary["steps"].append({"stage": "gen", "ok": False, "error": err})
        return jsonify({"ok": False, "summary": summary, "msg": err}), 500
    summary["steps"].append({"stage": "gen", "ok": True, "path": path})

    # Refresh manifest so the app registry stays in sync
    build_manifest()
    return jsonify({"ok": True, "summary": summary})


@app.route("/api/generate/batch", methods=["POST"])
def api_gen_batch():
    """Generate multiple sprites in one call.
    Body: { category: "language"|"scene"|"utility", ids: ["id1",...] }
    """
    cat = request.json.get("category")
    ids = request.json.get("ids", [])
    api_key = load_api_key()
    if not api_key:
        return jsonify({"ok": False, "msg": "No API key"}), 400
    if cat not in CATEGORIES:
        return jsonify({"ok": False, "msg": f"Unknown category: {cat}"}), 400

    results = []
    for asset_id in ids:
        path, err = generate_sprite(cat, asset_id, api_key)
        results.append({"id": asset_id, "ok": err is None,
                        "path": path, "error": err})
        time.sleep(1)
    return jsonify({"ok": True, "results": results})


@app.route("/api/manifest", methods=["POST"])
def api_build_manifest():
    m = build_manifest()
    return jsonify({"ok": True, "manifest": m,
                    "manifest_path": str(MANIFEST_JSON),
                    "ts_path": str(TS_CONSTANTS)})


@app.route("/api/sprite/<category>/<filename>")
def api_serve_sprite(category, filename):
    sprite_dir = SPRITES_DIR / category
    if not (sprite_dir / filename).exists():
        return "Not found", 404
    return send_from_directory(str(sprite_dir), filename)

@app.route("/api/template/<filename>")
def api_serve_template(filename):
    if not (TEMPLATE_DIR / filename).exists():
        return "Not found", 404
    return send_from_directory(str(TEMPLATE_DIR), filename)


def _lookup_item(category, sprite_id):
    catalog = {"language": LANGUAGE_SPRITES,
               "scene": SCENE_SPRITES,
               "utility": UTILITY_SPRITES}.get(category)
    if not catalog:
        return None
    return next((x for x in catalog if x["id"] == sprite_id), None)


@app.route("/api/search", methods=["POST"])
def api_search():
    query = request.json.get("query", "")
    n = int(request.json.get("n", 50))
    return jsonify({"ok": True, "query": query,
                    "results": search_images(query, max_results=n)})


@app.route("/api/refs/save_batch", methods=["POST"])
def api_save_refs_batch():
    """Save multiple selected references in one call.
    Body: { category, id, urls: [<url>, ...] }
    """
    cat = request.json.get("category")
    sprite_id = request.json.get("id")
    urls = request.json.get("urls", []) or []
    if cat not in CATEGORIES:
        return jsonify({"ok": False, "msg": f"Unknown category: {cat}"}), 400
    saved, failed = [], []
    for url in urls:
        path, err = download_ref(url, cat, sprite_id)
        if path and not err:
            saved.append(path)
        else:
            failed.append({"url": url, "error": err})
    return jsonify({"ok": True, "saved": len(saved),
                    "failed": len(failed), "details": failed[:5]})


@app.route("/api/refs/auto_collect", methods=["POST"])
def api_refs_auto_collect():
    """Use the item's search_hint to fetch the top N references automatically.
    Body: { category, id, n (optional, default 8) }
    """
    cat = request.json.get("category")
    sprite_id = request.json.get("id")
    n = int(request.json.get("n", 8))
    if cat not in CATEGORIES:
        return jsonify({"ok": False, "msg": f"Unknown category: {cat}"}), 400
    item = _lookup_item(cat, sprite_id)
    if not item:
        return jsonify({"ok": False, "msg": f"Unknown item: {sprite_id}"}), 400
    query = item.get("search_hint") or item["name"]
    results = search_images(query, max_results=max(n * 2, 16))
    saved = []
    for r in results:
        if len(saved) >= n:
            break
        path, err = download_ref(r.get("url", ""), cat, sprite_id)
        if path and not err:
            saved.append(path)
    return jsonify({"ok": True, "saved": len(saved),
                    "query": query, "paths": saved})


@app.route("/api/refs/clear", methods=["POST"])
def api_refs_clear():
    """Wipe all collected references for a subject."""
    cat = request.json.get("category")
    sprite_id = request.json.get("id")
    if cat not in CATEGORIES:
        return jsonify({"ok": False, "msg": f"Unknown category: {cat}"}), 400
    ref_dir = REFS_DIR / cat / sprite_id
    if ref_dir.exists():
        shutil.rmtree(ref_dir)
    return jsonify({"ok": True})


@app.route("/api/refs/save", methods=["POST"])
def api_save_ref():
    url = request.json.get("url")
    category = request.json.get("category")
    asset_id = request.json.get("asset_id")
    path, err = download_ref(url, category, asset_id)
    if err:
        return jsonify({"ok": False, "msg": err}), 500
    return jsonify({"ok": True, "path": path})

@app.route("/api/refs/<category>/<asset_id>")
def api_list_refs(category, asset_id):
    ref_dir = REFS_DIR / category / asset_id
    if not ref_dir.exists():
        return jsonify({"refs": []})
    refs = sorted([f.name for f in ref_dir.iterdir()
                   if f.suffix.lower() in ('.jpg','.jpeg','.png','.webp')])
    return jsonify({"refs": refs,
                    "paths": [f"/api/refs/serve/{category}/{asset_id}/{n}" for n in refs]})


@app.route("/api/sprite/delete", methods=["POST"])
def api_sprite_delete():
    """Wipe a generated sprite (both working set and public shipping copy)."""
    cat = request.json.get("category")
    sprite_id = request.json.get("id")
    if cat not in CATEGORIES:
        return jsonify({"ok": False, "msg": f"Unknown category: {cat}"}), 400
    fn = _filename_for(cat, sprite_id)
    removed = []
    for path in (SPRITES_DIR / cat / fn, PUBLIC_DIR / cat / fn):
        if path.exists() and path.is_file():
            path.unlink()
            removed.append(str(path))
    # Refresh manifest so sprites.ts reflects the removal
    build_manifest()
    return jsonify({"ok": True, "removed": removed})


@app.route("/api/template/config", methods=["GET"])
def api_template_config_get():
    """Return current template-name/prompt config (merged with defaults)."""
    cfg = load_template_config()
    result = {}
    # Order: master, language, scene, utility
    defaults = {
        "master":   {"default_name": DEFAULT_TEMPLATE_NAMES["master"],
                     "default_prompt": MASTER_DESCRIPTION},
        "language": {"default_name": DEFAULT_TEMPLATE_NAMES["language"],
                     "default_prompt": CATEGORY_TEMPLATE_PROMPTS["language"]},
        "scene":    {"default_name": DEFAULT_TEMPLATE_NAMES["scene"],
                     "default_prompt": CATEGORY_TEMPLATE_PROMPTS["scene"]},
        "utility":  {"default_name": DEFAULT_TEMPLATE_NAMES["utility"],
                     "default_prompt": CATEGORY_TEMPLATE_PROMPTS["utility"]},
        "world":    {"default_name": DEFAULT_TEMPLATE_NAMES["world"],
                     "default_prompt": WORLD_MASTER_DESCRIPTION},
    }
    for sid, body in SCENE_MASTER_PROMPTS.items():
        defaults[f"scene_{sid}"] = {
            "default_name":   DEFAULT_TEMPLATE_NAMES[f"scene_{sid}"],
            "default_prompt": body,
        }
    for key, d in defaults.items():
        entry = cfg.get(key) or {}
        result[key] = {
            "name":   entry.get("name")   or d["default_name"],
            "prompt": entry.get("prompt") or d["default_prompt"],
            "default_name":   d["default_name"],
            "default_prompt": d["default_prompt"],
            "custom_name":   bool(entry.get("name")),
            "custom_prompt": bool(entry.get("prompt")),
        }
    return jsonify({"ok": True, "config": result})


@app.route("/api/template/config", methods=["POST"])
def api_template_config_set():
    """Update template-config for one master. Body: { key, name?, prompt?, reset? }"""
    key    = request.json.get("key")
    name   = request.json.get("name")
    prompt = request.json.get("prompt")
    reset  = bool(request.json.get("reset"))
    if key not in DEFAULT_TEMPLATE_NAMES:
        return jsonify({"ok": False, "msg": f"Unknown key: {key}"}), 400
    cfg = load_template_config()
    if reset:
        cfg.pop(key, None)
    else:
        entry = cfg.get(key) or {}
        if name is not None:   entry["name"]   = name.strip() or None
        if prompt is not None: entry["prompt"] = prompt.strip() or None
        # prune empty
        entry = {k: v for k, v in entry.items() if v}
        if entry: cfg[key] = entry
        else:     cfg.pop(key, None)
    save_template_config(cfg)
    return jsonify({"ok": True})


@app.route("/api/refs/remove", methods=["POST"])
def api_refs_remove():
    """Remove a single saved reference by filename.
    Body: { category, id, filename }
    """
    cat = request.json.get("category")
    sprite_id = request.json.get("id")
    fn = request.json.get("filename", "")
    if cat not in CATEGORIES:
        return jsonify({"ok": False, "msg": f"Unknown category: {cat}"}), 400
    target = REFS_DIR / cat / sprite_id / fn
    # Safety: keep deletions inside the expected folder
    try:
        target = target.resolve()
        allowed = (REFS_DIR / cat / sprite_id).resolve()
        if allowed not in target.parents and target != allowed:
            return jsonify({"ok": False, "msg": "Path escapes ref folder"}), 400
    except Exception:
        return jsonify({"ok": False, "msg": "Invalid path"}), 400
    if target.exists() and target.is_file():
        target.unlink()
        return jsonify({"ok": True, "removed": fn})
    return jsonify({"ok": False, "msg": f"Not found: {fn}"}), 404

@app.route("/api/refs/serve/<category>/<asset_id>/<filename>")
def api_serve_ref(category, asset_id, filename):
    ref_dir = REFS_DIR / category / asset_id
    return send_from_directory(str(ref_dir), filename)


@app.route("/")
def index():
    return send_file(str(BASE_DIR / "index.html"))


# ══════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("  Lingua Franca Unified Sprite System")
    print("  http://localhost:5444")
    print("=" * 60)
    print(f"  Sprites:    {SPRITES_DIR}")
    print(f"  References: {REFS_DIR}")
    print(f"  Templates:  {TEMPLATE_DIR}")
    print(f"  Public:     {PUBLIC_DIR}")
    print(f"  Manifest:   {MANIFEST_JSON}")
    print(f"  TS module:  {TS_CONSTANTS}")
    print("=" * 60 + "\n")
    # Emit an initial manifest so the app has something to import even
    # before any sprite is generated.
    build_manifest()
    app.run(host="0.0.0.0", port=5444, debug=True)
