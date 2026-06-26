#!/usr/bin/env bash
# Live-extraction contract guard for the cron-proof DURABILITY-HEADER handshake.
#
# WHY THIS EXISTS (the gap it closes):
#   The mission's win path threads a single header string through THREE scripts:
#     1. capture-cron-proof.sh   PRINTS the record block, whose first line is the
#                                header literal  "UNATTENDED $N_EXPECTED-JOB EXIT-0 PROOF CAPTURED:"
#     2. record-cron-proof.sh    EXTRACTS that block with a sed address pattern
#                                ( sed -n '/UNATTENDED .*-JOB EXIT-0 PROOF CAPTURED:/,$p' )
#                                and appends it to CRON-PROOF-CAPTURED.md.
#     3. close-cron-proof-mission.sh  gate C VERIFIES durability by grepping the file
#                                for  'UNATTENDED .*-JOB EXIT-0 PROOF CAPTURED'.
#   All three must agree on that header text. If ANY of the three is edited out of
#   step with the others, the win path breaks SILENTLY — and only AFTER the 24h
#   wait for the tick:
#     · header text drifts in (1) but not (2) ⇒ record's sed extracts nothing ⇒
#       WARN-skip, exit 0, NOTHING written — the genuine proof is lost.
#     · header text drifts in (1)/(2) but not (3) ⇒ block IS written but gate C's
#       grep misses it ⇒ closeout falsely BLOCKS on a real, durable proof.
#   check-proof-verdict-contract.sh locks the OTHER handshake (check-schedule-fired
#   ↔ capture's PASS verdict). This guard locks THIS one. Neither sees the other's
#   strings, so both are needed.
#
# HOW (no stale mirror — every pattern is LIVE-extracted from the real scripts):
#   - producer header : pulled from capture-cron-proof.sh, $N_EXPECTED rendered to a
#                       concrete sample so it reads as a real captured line.
#   - extractor sed   : the address text between  sed -n '/ ... /,$p'  in record-cron-proof.sh
#   - verifier grep   : the pattern between  grep -qE ' ... '  in close-cron-proof-mission.sh
#   Then it asserts the rendered producer header is matched by BOTH the sed pattern
#   AND the grep pattern, AND survives the full record→file→gateC round-trip.
#
# Usage:  ./scripts/check-record-durability-contract.sh
# Exit:   0 = handshake intact — the win path will persist AND re-find the proof.
#         1 = DRIFT — one of the three scripts no longer agrees on the header text.
#         2 = INCONCLUSIVE — a source line could not be located (refactor moved it).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CAPTURE="$SCRIPT_DIR/capture-cron-proof.sh"
RECORD="$SCRIPT_DIR/record-cron-proof.sh"
CLOSEOUT="$SCRIPT_DIR/close-cron-proof-mission.sh"

# Allow the selftest to point the guard at mutated copies.
CAPTURE="${CAPTURE_SRC:-$CAPTURE}"
RECORD="${RECORD_SRC:-$RECORD}"
CLOSEOUT="${CLOSEOUT_SRC:-$CLOSEOUT}"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$1"; }

for f in "$CAPTURE" "$RECORD" "$CLOSEOUT"; do
  [ -f "$f" ] || { yellow "  INCONCLUSIVE — source not found: $f"; exit 2; }
done

# ── 1. EXTRACTOR: the sed address pattern record-cron-proof.sh uses ───────────
# This is the CANONICAL "what the extractor looks for"; we discover the producer's
# header THROUGH it, so a producer rename that diverges from it reads as DRIFT — not
# a false INCONCLUSIVE. INCONCLUSIVE is reserved for when this anchor line itself is
# gone (a refactor moved it), which the guard genuinely cannot reason about.
# Anchor on the sed block-print idiom (,$p), NOT on the header words — else a header
# rename in record would hide the line from us and read as INCONCLUSIVE not DRIFT.
SED_LINE="$(grep -F "sed -n '/" "$RECORD" | grep -F ',$p' | head -1)"
SED_PAT="$(printf '%s\n' "$SED_LINE" | sed -E "s#.*sed -n '/##; s#/,\\\$p'.*##")"
if [ -z "$SED_PAT" ]; then
  yellow "  INCONCLUSIVE — could not locate the extractor sed pattern in $(basename "$RECORD")."
  exit 2
fi
green "  extractor sed re  : $SED_PAT"

# ── 2. VERIFIER: the grep pattern gate C uses on the durable file ─────────────
GREP_LINE="$(grep -F "grep -qE 'UNATTENDED" "$CLOSEOUT" | head -1)"
GREP_PAT="$(printf '%s\n' "$GREP_LINE" | sed -E "s#.*grep -qE '##; s#'.*##")"
if [ -z "$GREP_PAT" ]; then
  yellow "  INCONCLUSIVE — could not locate gate C's grep pattern in $(basename "$CLOSEOUT")."
  exit 2
fi
green "  verifier  grep re : $GREP_PAT"
echo ""

fail=0

# ── Assertion A: capture must EMIT a header line the extractor's sed recognizes ─
# Discover the producer header via record's OWN pattern. If capture emits no line
# matching it, record would extract an empty block → WARN-skip → exit 0 → NOTHING
# written → the genuine proof is silently lost at the tick. That IS the drift.
PROD_TMPL="$(grep -E "$SED_PAT" "$CAPTURE" | grep -vF 'sed -n' | head -1 | sed -E 's/^[[:space:]]*//')"
if [ -z "$PROD_TMPL" ]; then
  red   "  [A] DRIFT — capture-cron-proof.sh emits NO header line matching the pattern"
  red   "      record-cron-proof.sh extracts with. record would capture NOTHING (WARN-skip,"
  red   "      exit 0, no write) → the genuine proof is silently lost at the tick."
  fail=1
  PROD_HEADER=""
else
  # Render the shell var to a concrete count so it reads as a real captured line.
  PROD_HEADER="${PROD_TMPL/\$N_EXPECTED/5}"
  green "  [A] producer header MATCHES extractor sed — record will capture the block."
  green "      header: $PROD_HEADER"
fi

# ── Assertion B: full round-trip — write the block, then run gate C's grep ────
# Simulate record's append, then assert gate C's grep re-finds it on disk. Only
# meaningful when A found a real producer header to write.
if [ -n "$PROD_HEADER" ]; then
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' EXIT
  {
    printf '## Unattended exit-0 cron proof — captured (contract-check)\n\n'
    printf '```\n  %s\n    proof workflow run : #0 (event=schedule, main)\n```\n' "$PROD_HEADER"
  } > "$tmp"
  if grep -qE "$GREP_PAT" "$tmp"; then
    green "  [B] gate C grep RE-FINDS the written header — durability check will pass."
  else
    red   "  [B] DRIFT — gate C's grep does NOT match the header record actually writes."
    red   "      A genuine, durable proof on disk would be reported as 'not durable' and"
    red   "      the closeout would falsely BLOCK after the 24h wait."
    fail=1
  fi
else
  yellow "  [B] skipped — no producer header to round-trip (see [A] drift above)."
fi

echo ""
if [ "$fail" -eq 0 ]; then
  green "INTACT (exit 0): capture → record → gate C all agree on the durability header."
  green "  The win path will persist the proof AND re-find it. Mission one-shot is safe."
  exit 0
fi
red "DRIFT (exit 1): the three durability-header literals have diverged — fix before the tick."
exit 1
