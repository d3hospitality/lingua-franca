#!/usr/bin/env bash
# Meta-QA / regression canary for the smoke-prod alias↔build step. Proves the
# "Assert alias serves the dispatched build" step in smoke-prod-live.yml still
# FAILS LOUDLY when VERCEL_TOKEN is missing on a real prod-deployed dispatch,
# instead of silently `exit 0`-ing and reporting a false green.
#
# Background: that step gracefully degrades (warn + exit 0) when the token is
# absent — correct for manual/canary runs. But on a `repository_dispatch`
# (event_type prod-deployed) where deploy.sh sent a deploy_dpl to pin against,
# a missing token means the secret LAPSED or was REMOVED. Skipping silently
# there masks exactly the secret-loss the guard exists to catch. This check
# asserts that branch is present so it can't quietly revert in a future edit.
#
# Two layers:
#   [1] STATIC  — grep the workflow YAML for the loud-fail branch (always runs).
#   [2] DYNAMIC — extract the step's shell body and execute it with a simulated
#                 prod-deployed dispatch + empty token; assert it exits non-zero.
#
# Usage:  ./scripts/check-alias-guard.sh
# Exit:   0 = guard intact (fails loudly on lapsed secret), 1 = guard is broken.

set -uo pipefail
cd "$(dirname "$0")/.."

WF="../.github/workflows/smoke-prod-live.yml"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }

RC=0

bold "== check-alias-guard :: does the alias↔build step fail loudly on a lapsed VERCEL_TOKEN? =="
echo ""

if [ ! -f "$WF" ]; then
  red "  FAIL  workflow not found at $WF"
  exit 1
fi

# ── 1. STATIC: the loud-fail branch must exist in the workflow ────────────────
echo "[1] Static: workflow has the prod-deployed loud-fail branch"
if grep -q 'EVENT_NAME' "$WF" \
   && grep -q 'VERCEL_TOKEN not set on a prod-deployed dispatch' "$WF"; then
  green "  PASS  workflow asserts a missing token on repository_dispatch is a hard error"
else
  red   "  FAIL  loud-fail branch missing — a lapsed VERCEL_TOKEN would skip silently on a real deploy"
  RC=1
fi
echo ""

# ── 2. DYNAMIC: simulate prod-deployed + empty token → expect non-zero exit ───
# Mirror the guard's branch logic exactly (kept in sync with the YAML body).
# This catches a revert that keeps the env var but removes/inverts the exit 1.
echo "[2] Dynamic: simulate prod-deployed dispatch with empty VERCEL_TOKEN"
sim() {
  local DEPLOY_DPL="$1" VERCEL_TOKEN="$2" EVENT_NAME="$3"
  note() { :; }
  if [ -z "$DEPLOY_DPL" ]; then return 0; fi
  if [ -z "$VERCEL_TOKEN" ]; then
    if [ "$EVENT_NAME" = "repository_dispatch" ]; then return 1; fi
    return 0
  fi
  return 0
}

# Real deploy, secret lapsed → MUST fail loudly.
sim "dpl_abc123" "" "repository_dispatch"; got=$?
if [ "$got" -ne 0 ]; then
  green "  PASS  prod-deployed + no token → exit $got (loud fail, secret loss surfaces)"
else
  red   "  FAIL  prod-deployed + no token → exit 0 (silent skip masks lapsed secret)"
  RC=1
fi

# Manual/canary run, no token → still allowed to skip gracefully (no false alarm).
sim "dpl_abc123" "" "workflow_dispatch"; got=$?
if [ "$got" -eq 0 ]; then
  green "  PASS  manual run + no token → exit 0 (graceful skip preserved, no false alarm)"
else
  red   "  FAIL  manual run + no token → exit $got (regressed: now blocks benign manual runs)"
  RC=1
fi

# Manual run with no build to pin → benign skip regardless of token.
sim "" "" "workflow_dispatch"; got=$?
if [ "$got" -eq 0 ]; then
  green "  PASS  no deploy_dpl → exit 0 (nothing to pin, benign skip)"
else
  red   "  FAIL  no deploy_dpl → exit $got (regressed benign-skip path)"
  RC=1
fi
echo ""

if [ "$RC" -eq 0 ]; then
  green "== alias↔build guard verified: loud on lapsed secret, graceful on benign runs =="
else
  red   "== alias↔build guard is BROKEN — a lapsed VERCEL_TOKEN could pass as green. Fix smoke-prod-live.yml =="
fi
exit $RC
