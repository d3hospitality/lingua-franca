#!/usr/bin/env bash
# Durable sink for the ONE-TIME unattended exit-0 cron proof. Wraps
# capture-cron-proof.sh: runs it, and ONLY when it exits 0 (genuine N-job
# proof captured) persists the record-ready block to a durable on-disk file
# so the WIN survives terminal scrollback and any "did we capture it?" doubt.
#
# Why a separate wrapper (not a flag on capture): capture-cron-proof.sh is a
# locked, self-tested read-only verifier. Keeping the file-write side effect in
# its own script leaves the verifier untouched and independently testable.
#
# capture-cron-proof.sh is idempotent (the proof run persists in CI), so this
# wrapper is safe to re-run any time after the 13:17/13:30 UTC tick — it appends
# at most one fresh stamped record and exits 0; pre-tick it forwards exit 2/1.
#
# Exit: mirrors capture-cron-proof.sh exactly (0 = captured + recorded to file,
#       1 = unattended regression, 2 = not yet proven / inconclusive).
# Out:  $RECORD_FILE (default scripts/../CRON-PROOF-CAPTURED.md) on exit 0 only.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CAPTURE="${CAPTURE:-$SCRIPT_DIR/capture-cron-proof.sh}"
RECORD_FILE="${RECORD_FILE:-$(dirname "$SCRIPT_DIR")/CRON-PROOF-CAPTURED.md}"
STAMP="${STAMP:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$1"; }
strip_ansi() { sed -E 's/\x1b\[[0-9;]*m//g'; }

# Run the verifier, keep a clean copy of its output, and echo it back through.
RAW="$("$CAPTURE" 2>&1)"; CODE=$?
printf '%s\n' "$RAW"
OUT="$(printf '%s\n' "$RAW" | strip_ansi)"

[ "$CODE" -ne 0 ] && exit "$CODE"

# exit 0 ⇒ capture printed the record-ready block. Extract from the header line.
BLOCK="$(printf '%s\n' "$OUT" | sed -n '/UNATTENDED .*-JOB EXIT-0 PROOF CAPTURED:/,$p')"
if [ -z "$BLOCK" ]; then
  yellow "  WARN  capture exited 0 but no record block was found in its output — not writing $RECORD_FILE."
  exit 0
fi

# Idempotent: skip if this exact proof run is already on file.
PROOF_LINE="$(printf '%s\n' "$BLOCK" | grep -E 'proof workflow run' | head -1)"
if [ -n "$PROOF_LINE" ] && [ -f "$RECORD_FILE" ] && grep -qF "$PROOF_LINE" "$RECORD_FILE" 2>/dev/null; then
  green "Already recorded — $RECORD_FILE already holds this proof run. Nothing to append."
  exit 0
fi

{
  printf '## Unattended exit-0 cron proof — captured %s\n\n' "$STAMP"
  printf '```\n%s\n```\n\n' "$BLOCK"
} >> "$RECORD_FILE"

green "RECORDED — durable proof block appended to: $RECORD_FILE"
exit 0
