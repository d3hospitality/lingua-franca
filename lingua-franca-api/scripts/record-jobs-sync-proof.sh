#!/usr/bin/env bash
# Durable sink for the ONE-TIME unattended log-level "IN SYNC (exit 0)" jobs-sync
# proof. Wraps assert-schedule-jobs-sync-fired.sh: runs the read-only verifier,
# and ONLY when it exits 0 (a real event=schedule tick proved the
# 'audit-schedule-jobs-sync' job printed "IN SYNC (exit 0)") persists the
# record-ready PROVEN block to a durable on-disk file so the WIN survives
# terminal scrollback and any "did the tick actually capture it?" doubt.
#
# Why a separate wrapper (not a flag on the assert): assert-schedule-jobs-sync-
# fired.sh is a locked, self-tested read-only verifier (exit 0/1/2). Keeping the
# file-write side effect in its own script leaves the verifier untouched and
# independently testable — the same split as record-cron-proof.sh <- capture.
#
# The proof run persists in CI, so this wrapper is idempotent and safe to re-run
# any time after the 13:17/13:30 UTC tick: it appends at most one stamped record
# (keyed on the schedule run URL) and exits 0; pre-tick it forwards exit 2/1.
#
# Exit: mirrors assert-schedule-jobs-sync-fired.sh exactly
#       (0 = proven + recorded to file, 1 = unattended regression,
#        2 = not yet proven / inconclusive — pre-tick, in-progress, or added-after).
# Out:  $RECORD_FILE (default scripts/../JOBS-SYNC-PROOF-CAPTURED.md) on exit 0 only.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSERT="${ASSERT:-$SCRIPT_DIR/assert-schedule-jobs-sync-fired.sh}"
RECORD_FILE="${RECORD_FILE:-$(dirname "$SCRIPT_DIR")/JOBS-SYNC-PROOF-CAPTURED.md}"
STAMP="${STAMP:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$1"; }
strip_ansi() { sed -E 's/\x1b\[[0-9;]*m//g'; }

# Run the verifier, keep a clean copy of its output, and echo it back through.
RAW="$("$ASSERT" 2>&1)"; CODE=$?
printf '%s\n' "$RAW"
OUT="$(printf '%s\n' "$RAW" | strip_ansi)"

[ "$CODE" -ne 0 ] && exit "$CODE"

# exit 0 ⇒ the assert printed the run header + the "PROVEN (exit 0):" block.
# Capture from the run-header line through the end of output — the full context.
BLOCK="$(printf '%s\n' "$OUT" | sed -n '/^[[:space:]]*run[[:space:]].*#/,$p')"
if [ -z "$BLOCK" ]; then
  yellow "  WARN  assert exited 0 but no run/PROVEN block was found in its output — not writing $RECORD_FILE."
  exit 0
fi

# Idempotent: skip if this exact schedule run is already on file (key on the URL).
PROOF_LINE="$(printf '%s\n' "$BLOCK" | grep -E '^[[:space:]]*url[[:space:]].*http' | head -1)"
if [ -n "$PROOF_LINE" ] && [ -f "$RECORD_FILE" ] && grep -qF "$PROOF_LINE" "$RECORD_FILE" 2>/dev/null; then
  green "Already recorded — $RECORD_FILE already holds this schedule run. Nothing to append."
  exit 0
fi

{
  printf '## Unattended log-level jobs-sync proof — captured %s\n\n' "$STAMP"
  printf '```\n%s\n```\n\n' "$BLOCK"
} >> "$RECORD_FILE"

green "RECORDED — durable jobs-sync proof block appended to: $RECORD_FILE"
exit 0
