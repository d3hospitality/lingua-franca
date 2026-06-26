#!/usr/bin/env bash
# Meta-QA: proves the smoke-test gate itself behaves correctly — that it exits
# 0 when prod is healthy AND exits non-zero on an induced failure (so deploy.sh
# actually BLOCKS a bad deploy instead of silently shipping it). Run this after
# editing smoke-test.sh or deploy.sh to confirm the gate still has teeth.
#
# Usage:   ./scripts/verify-gate.sh [--no-live]
#          --no-live   skip the live-prod pass check (only verify failure blocks)
# Exit:    0 = gate behaves correctly, 1 = gate is broken (won't block / won't pass)

set -uo pipefail
cd "$(dirname "$0")/.."

PROD="${SMOKE_BASE:-https://lingua-franca-api.vercel.app}"
BAD="https://lingua-franca-api-DOES-NOT-EXIST.vercel.app"
NO_LIVE=0
[ "${1:-}" = "--no-live" ] && NO_LIVE=1

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }

RC=0

bold "== verify-gate :: does the smoke gate actually block bad deploys? =="
echo ""

# ── 1. Induced failure MUST produce a non-zero exit ───────────────────────────
echo "[1] Induced failure → expect non-zero exit (gate must block)"
./scripts/smoke-test.sh "$BAD" >/dev/null 2>&1
FAIL_CODE=$?
if [ "$FAIL_CODE" -ne 0 ]; then
  green "  PASS  smoke-test exited $FAIL_CODE on unreachable target — deploy.sh would block"
else
  red   "  FAIL  smoke-test exited 0 on a bad target — gate would NOT block a broken deploy"
  RC=1
fi
echo ""

# ── 2. Live prod MUST produce a zero exit (gate must let good deploys through) ─
if [ "$NO_LIVE" -eq 1 ]; then
  echo "[2] Live prod pass check — SKIPPED (--no-live)"
else
  echo "[2] Live prod → expect zero exit (gate must pass healthy prod): $PROD"
  ./scripts/smoke-test.sh "$PROD" >/dev/null 2>&1
  PASS_CODE=$?
  if [ "$PASS_CODE" -eq 0 ]; then
    green "  PASS  smoke-test exited 0 against live prod — healthy deploy passes the gate"
  else
    red   "  FAIL  smoke-test exited $PASS_CODE against live prod — gate would block a healthy deploy"
    RC=1
  fi
fi
echo ""

if [ "$RC" -eq 0 ]; then
  green "== Gate verified: blocks on failure, passes on health =="
else
  red   "== Gate is BROKEN — fix smoke-test.sh / deploy.sh before relying on it =="
fi
exit $RC
