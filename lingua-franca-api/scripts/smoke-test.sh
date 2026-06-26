#!/usr/bin/env bash
# Smoke-tests the lingua-franca-api Vercel deployment: verifies /api/transcribe and
# /api/suggest return 200, and that the vercel.json maxDuration limits do NOT truncate
# long Whisper/Deepgram transcriptions. Run after every `vercel --prod` deploy.
#
# Usage:   ./scripts/smoke-test.sh [base-url]
#          ./scripts/smoke-test.sh --check-fixture   # offline: validate long-en.b64 only
# Default base-url: https://lingua-franca-api.vercel.app
# Requires: curl, python3. The [3] transcribe check uses macOS `say`+`afconvert`
#           when present, else falls back to the committed scripts/fixtures/long-en.b64
#           so it still runs in Linux CI (no macOS needed).
# Exit code 0 = all pass, 1 = a check failed.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FIXTURE="$SCRIPT_DIR/fixtures/long-en.b64"
PASSAGE_FILE="$SCRIPT_DIR/fixtures/long-en.txt"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PASS=0
FAIL=0

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }

check() { # check "label" actual expected
  if [ "$2" = "$3" ]; then green "  PASS  $1 ($2)"; PASS=$((PASS+1));
  else red "  FAIL  $1 (got $2, want $3)"; FAIL=$((FAIL+1)); fi
}

# Single source of truth for the spoken passage (kept in sync with the b64 fixture
# by gen-fixture.sh). Falls back to an inline copy only if the file is missing.
read_passage() {
  if [ -f "$PASSAGE_FILE" ]; then cat "$PASSAGE_FILE"; else
    printf '%s' "In recent years the hospitality industry has changed in ways nobody expected. Restaurants now rely on technology for reservations, ordering, and even pairing wine with food. When I first started cooking professionally in Lisbon, everything was done by hand and from memory. Today a young chef carries a tablet, checks inventory in real time, and adjusts the menu based on what sells. But the heart of the work has not changed at all. You still need to taste constantly, respect your ingredients, and cook for the person sitting at the table, not for a camera. That is something no machine will ever replace, no matter how advanced the kitchen becomes over the next decade."
  fi
}

# Decode the committed b64 fixture to raw PCM at $1 (Linux `base64 -d`, macOS `-D -i`).
decode_fixture() {
  tr -d '\n' < "$FIXTURE" > "$TMP/a.b64"
  base64 -d "$TMP/a.b64" > "$1" 2>/dev/null || base64 -D -i "$TMP/a.b64" > "$1"
}

# Offline fixture integrity check — no network, no macOS. Proves the committed
# fixture decodes to a sane ~38.8s 16kHz mono PCM so the [3] truncation guard is
# trustworthy in Linux CI. `smoke-test.sh --check-fixture` runs only this.
check_fixture() {
  echo "== fixture integrity check (offline) =="
  local rc=0
  if [ ! -f "$FIXTURE" ]; then red "  FAIL  no fixture at $FIXTURE"; return 1; fi
  decode_fixture "$TMP/a.pcm"
  local bytes dur words
  bytes=$(wc -c < "$TMP/a.pcm" | tr -d ' ')
  dur=$(awk "BEGIN{printf \"%.1f\", $bytes/32000}")
  words=$(read_passage | wc -w | tr -d ' ')
  echo "  decoded: $bytes PCM bytes -> ~${dur}s @16kHz mono 16-bit; passage = $words words"
  # 16kHz mono PCM => 32000 B/s. Expect 30–50s of real speech; flag empty/garbage.
  if [ "$bytes" -lt 960000 ] || [ "$bytes" -gt 1600000 ]; then
    red "  FAIL  decoded duration ${dur}s out of expected 30–50s range — fixture corrupt or wrong format"; rc=1
  else
    green "  PASS  fixture decodes to ${dur}s of PCM (expected range)"
  fi
  # Confirm it is real audio, not silence (catches a zero-filled or truncated b64).
  local peak
  peak=$(python3 - "$TMP/a.pcm" <<'PY' 2>/dev/null || echo 0
import sys,array
d=open(sys.argv[1],'rb').read()
a=array.array('h'); a.frombytes(d[:len(d)//2*2])
print(max((abs(v) for v in a), default=0))
PY
)
  if [ "$peak" -ge 1000 ]; then green "  PASS  contains real audio (peak amplitude $peak/32768)";
  else red "  FAIL  fixture is silent/empty (peak $peak) — regenerate with gen-fixture.sh"; rc=1; fi
  [ "$rc" -eq 0 ] && green "== fixture OK ==" || red "== fixture BAD =="
  return $rc
}

if [ "${1:-}" = "--check-fixture" ]; then check_fixture; exit $?; fi

BASE="${1:-https://lingua-franca-api.vercel.app}"

echo "== lingua-franca-api smoke test =="
echo "Target: $BASE"
echo ""

# ── 1. Routing / CORS / validation (no API cost) ──────────────────────────────
echo "[1] Routing & validation"
check "OPTIONS /api/suggest preflight"    "$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS "$BASE/api/suggest")" 200
check "OPTIONS /api/transcribe preflight" "$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS "$BASE/api/transcribe")" 200
check "GET /api/suggest rejected"         "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/suggest")" 405
check "POST /api/suggest empty body 400"  "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' "$BASE/api/suggest")" 400
check "POST /api/transcribe no audio 400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' "$BASE/api/transcribe")" 400
echo ""

# ── 2. /api/suggest happy path ────────────────────────────────────────────────
echo "[2] /api/suggest (live GPT call)"
SUG=$(curl -s -w '\n%{http_code}' -X POST -H 'Content-Type: application/json' \
  -d '{"conversation":"Them: So what brought you here?\nMe: I moved from Lisbon for a chef job.","targetLang":"Spanish","speakLang":"English"}' \
  "$BASE/api/suggest")
SUG_CODE=$(printf '%s' "$SUG" | tail -n1)
SUG_BODY=$(printf '%s' "$SUG" | sed '$d')
check "POST /api/suggest 200" "$SUG_CODE" 200
N=$(printf '%s' "$SUG_BODY" | python3 -c "import sys,json;print(len(json.load(sys.stdin).get('suggestions',[])))" 2>/dev/null || echo 0)
check "returns 3 suggestions" "$N" 3
echo ""

# ── 3. /api/transcribe + maxDuration truncation guard ─────────────────────────
# Audio source priority: regenerate live via macOS say/afconvert when available
# (keeps the fixture honest), else fall back to the committed scripts/fixtures/
# long-en.b64 so this check runs in Linux CI. The fixture is the same $LONG
# passage rendered to raw 16kHz mono PCM — regenerate it with scripts/gen-fixture.sh
# if you ever change $LONG below, or WORDS_SPOKEN will drift from the audio.
echo "[3] /api/transcribe (long-audio truncation guard)"
LONG="$(read_passage)"
WORDS_SPOKEN=$(printf '%s' "$LONG" | wc -w | tr -d ' ')
AUDIO_SRC=""
if command -v say >/dev/null && command -v afconvert >/dev/null; then
  say -o "$TMP/a.aiff" "$LONG"
  afconvert "$TMP/a.aiff" "$TMP/a.wav" -d LEI16@16000 -c 1 -f WAVE >/dev/null 2>&1
  tail -c +45 "$TMP/a.wav" > "$TMP/a.pcm"            # strip 44-byte WAV header -> raw 16kHz mono PCM
  base64 -i "$TMP/a.pcm" | tr -d '\n' > "$TMP/a.b64"
  AUDIO_SRC="say/afconvert (live)"
elif [ -f "$FIXTURE" ]; then
  decode_fixture "$TMP/a.pcm"
  AUDIO_SRC="committed fixture"
fi
if [ -z "$AUDIO_SRC" ]; then
  red "  SKIP  transcribe test — no macOS 'say'/'afconvert' and no fixture at $FIXTURE"
else
  DUR=$(echo "scale=1; $(wc -c < "$TMP/a.pcm")/32000" | bc)
  python3 -c "import json;print(json.dumps({'audio':open('$TMP/a.b64').read(),'language':'en'}))" > "$TMP/body.json"
  echo "  fixture: ~${DUR}s audio, $WORDS_SPOKEN words spoken (source: $AUDIO_SRC)"
  TR=$(curl -s -w '\n%{http_code}\n%{time_total}' -X POST -H 'Content-Type: application/json' --data @"$TMP/body.json" "$BASE/api/transcribe")
  TR_TIME=$(printf '%s' "$TR" | tail -n1)
  TR_CODE=$(printf '%s' "$TR" | tail -n2 | head -n1)
  TR_BODY=$(printf '%s' "$TR" | sed '$d' | sed '$d')
  check "POST /api/transcribe 200" "$TR_CODE" 200
  WORDS_BACK=$(printf '%s' "$TR_BODY" | python3 -c "import sys,json;print(len(json.load(sys.stdin).get('text','').split()))" 2>/dev/null || echo 0)
  ENDS_OK=$(printf '%s' "$TR_BODY" | python3 -c "import sys,json;t=json.load(sys.stdin).get('text','').strip();print('yes' if t.endswith(('.','!','?')) else 'no')" 2>/dev/null || echo no)
  echo "  transcript: $WORDS_BACK words back, round-trip ${TR_TIME}s (limit 60s)"
  # Allow small ASR word-count drift; truncation would lose a large chunk.
  if [ "$WORDS_BACK" -ge $((WORDS_SPOKEN - 10)) ]; then
    green "  PASS  no truncation (within 10 words of $WORDS_SPOKEN spoken)"; PASS=$((PASS+1))
  else
    red "  FAIL  possible truncation ($WORDS_BACK / $WORDS_SPOKEN words)"; FAIL=$((FAIL+1))
  fi
  check "transcript ends on full sentence" "$ENDS_OK" yes
fi
echo ""

echo "== Result: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
