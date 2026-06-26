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
PASSAGE_FILE="$DIR/fixtures/long-en.txt"

if ! command -v say >/dev/null || ! command -v afconvert >/dev/null; then
  echo "error: needs macOS 'say' and 'afconvert' to render the fixture" >&2
  exit 1
fi

# Single source of truth for the spoken passage — smoke-test.sh reads the same file.
# Edit fixtures/long-en.txt (not a copy here) and re-run this to keep them in sync.
if [ ! -f "$PASSAGE_FILE" ]; then
  echo "error: missing passage file $PASSAGE_FILE" >&2
  exit 1
fi
LONG="$(cat "$PASSAGE_FILE")"

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
