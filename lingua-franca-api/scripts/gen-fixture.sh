#!/usr/bin/env bash
# Regenerates scripts/fixtures/long-en.b64 — the raw 16kHz mono PCM (base64) audio
# fixture that smoke-test.sh [3] falls back to when macOS say/afconvert are absent.
# Run this on macOS whenever you change the $LONG passage in smoke-test.sh so the
# committed fixture stays in sync with the word count the test expects.
#
# Usage: ./scripts/gen-fixture.sh
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/fixtures/long-en.b64"

if ! command -v say >/dev/null || ! command -v afconvert >/dev/null; then
  echo "error: needs macOS 'say' and 'afconvert' to render the fixture" >&2
  exit 1
fi

# Keep this passage identical to $LONG in smoke-test.sh.
LONG="In recent years the hospitality industry has changed in ways nobody expected. Restaurants now rely on technology for reservations, ordering, and even pairing wine with food. When I first started cooking professionally in Lisbon, everything was done by hand and from memory. Today a young chef carries a tablet, checks inventory in real time, and adjusts the menu based on what sells. But the heart of the work has not changed at all. You still need to taste constantly, respect your ingredients, and cook for the person sitting at the table, not for a camera. That is something no machine will ever replace, no matter how advanced the kitchen becomes over the next decade."

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$DIR/fixtures"
say -o "$TMP/a.aiff" "$LONG"
afconvert "$TMP/a.aiff" "$TMP/a.wav" -d LEI16@16000 -c 1 -f WAVE >/dev/null 2>&1
tail -c +45 "$TMP/a.wav" > "$TMP/a.pcm"   # strip 44-byte WAV header -> raw 16kHz mono PCM
base64 -i "$TMP/a.pcm" | tr -d '\n' > "$OUT"

WORDS=$(printf '%s' "$LONG" | wc -w | tr -d ' ')
DUR=$(echo "scale=1; $(wc -c < "$TMP/a.pcm")/32000" | bc)
echo "wrote $OUT (~${DUR}s, $WORDS words, $(wc -c < "$OUT" | tr -d ' ') b64 bytes)"
