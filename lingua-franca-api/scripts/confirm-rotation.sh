#!/usr/bin/env bash
# Automates step 4 of ROTATE-BRANCH-PROTECTION-PAT.md: re-dispatch the
# branch-protection-audit workflow with the freshly-stored BRANCH_PROTECTION_PAT
# and prove it genuinely re-verified the gate.
#
# WHY THIS EXISTS (the subtle bug in a naive step 4):
#   The runbook's step 4 says "expect conclusion success". That is NOT sufficient.
#   When the stored PAT can't read branch protection, check-branch-protection.sh
#   exits 2, and branch-protection-audit.yml deliberately maps exit 2 -> exit 0
#   with a ::warning (a missing/blip secret must not page as a real regression).
#   So a token-degraded run STILL shows conclusion=success. Checking the
#   conclusion alone cannot tell a REAL pass from a silently-neutered one —
#   exactly the failure mode the whole rotation runbook is trying to prevent.
#
#   This script closes that gap: it dispatches a fresh run, waits for it, and then
#   inspects the LOG. A rotation is confirmed ONLY if the run concluded success
#   AND the log carries the real gate line:
#       PASS  'check-alias-guard' is a required status check
#   If instead the log carries the neutral-warning marker, the rotation FAILED
#   (the new token can't read protection) and we exit 1 so the operator rolls back.
#
# Usage:
#   ./scripts/confirm-rotation.sh            # dispatch + wait + assert real PASS
#   ./scripts/confirm-rotation.sh --latest   # skip dispatch; assert the most recent run
#
# Env:  REPO     (default d3hospitality/lingua-franca)
#       WORKFLOW (default branch-protection-audit)
#       CONTEXT  (default check-alias-guard)
#       TIMEOUT  (default 120 — seconds to wait for the run to complete)
# Exit: 0 = fresh run concluded success AND really verified the gate (PASS line present)
#       1 = run completed but the gate was NOT really verified
#           (neutral exit-2 warning, or an actual FAIL) — rotation is bad, roll back
#       2 = inconclusive: gh missing/unauth, dispatch failed, or the run timed out

set -uo pipefail

REPO="${REPO:-d3hospitality/lingua-franca}"
WORKFLOW="${WORKFLOW:-branch-protection-audit}"
CONTEXT="${CONTEXT:-check-alias-guard}"
TIMEOUT="${TIMEOUT:-120}"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }

PASS_LINE="PASS  '$CONTEXT' is a required status check"

bold "== confirm-rotation :: prove $WORKFLOW really re-verified '$CONTEXT' on $REPO =="
echo ""

if ! command -v gh >/dev/null 2>&1; then
  yellow "  SKIP  gh CLI not found — install https://cli.github.com then re-run"
  exit 2
fi
if ! gh auth status >/dev/null 2>&1; then
  yellow "  SKIP  gh not authenticated — run 'gh auth login' then re-run"
  exit 2
fi

LATEST_ONLY=0
[ "${1:-}" = "--latest" ] && LATEST_ONLY=1

run_id=""
if [ "$LATEST_ONLY" -eq 0 ]; then
  # Record the newest existing run id so we can wait for a STRICTLY newer one and
  # never assert against a stale prior run.
  prev_id="$(gh run list -R "$REPO" --workflow "$WORKFLOW" -L 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null)"

  bold "  → dispatching $WORKFLOW"
  if ! gh workflow run "$WORKFLOW" -R "$REPO" >/dev/null 2>&1; then
    red "  FAIL  could not dispatch $WORKFLOW (no workflow_dispatch trigger, or insufficient perms)."
    exit 2
  fi

  bold "  → waiting for a new run to appear (was: ${prev_id:-none})"
  waited=0
  while [ "$waited" -lt "$TIMEOUT" ]; do
    run_id="$(gh run list -R "$REPO" --workflow "$WORKFLOW" -L 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null)"
    if [ -n "$run_id" ] && [ "$run_id" != "$prev_id" ]; then
      break
    fi
    sleep 3; waited=$((waited + 3)); run_id=""
  done
  if [ -z "$run_id" ]; then
    yellow "  SKIP  no new run appeared within ${TIMEOUT}s — check Actions queue and re-run with --latest."
    exit 2
  fi
else
  run_id="$(gh run list -R "$REPO" --workflow "$WORKFLOW" -L 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null)"
  if [ -z "$run_id" ]; then
    yellow "  SKIP  no runs found for $WORKFLOW."
    exit 2
  fi
fi

bold "  → watching run $run_id (timeout ${TIMEOUT}s)"
# gh run watch blocks until completion; --exit-status returns nonzero on failure.
timeout "$TIMEOUT" gh run watch "$run_id" -R "$REPO" --exit-status >/dev/null 2>&1
watch_rc=$?

if [ "$watch_rc" -eq 124 ]; then
  conclusion="$(gh run view "$run_id" -R "$REPO" --json conclusion,status --jq '.conclusion // .status' 2>/dev/null)"
  yellow "  SKIP  run $run_id did not finish within ${TIMEOUT}s (conclusion: ${conclusion:-pending})."
  exit 2
fi

# `gh run watch --exit-status` already told us the run's terminal state: rc 0 =
# success, nonzero (and not 124) = the run failed. Seed the conclusion from that
# so a slow/blipping `gh run view` can't make a known-good run read as "unknown"
# and trip the catch-all FAIL below. (watch_rc 124 was already handled above.)
conclusion=""
[ "$watch_rc" -eq 0 ] && conclusion="success"

# Logs can lag the run's conclusion by several seconds on GitHub's side. Poll
# until we actually have a NON-EMPTY log — an empty log means "couldn't read it",
# which is INCONCLUSIVE, not proof the gate failed. Refresh the conclusion too,
# but never let a transient empty read clobber the watch-derived value.
log=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  c="$(gh run view "$run_id" -R "$REPO" --json conclusion,status --jq '.conclusion // .status' 2>/dev/null)"
  [ -n "$c" ] && conclusion="$c"
  log="$(gh run view "$run_id" -R "$REPO" --log 2>/dev/null)"
  if [ -n "$log" ] && { [ "$conclusion" = "success" ] || [ "$conclusion" = "failure" ]; }; then
    break
  fi
  sleep 3
done

echo ""
bold "  run $run_id concluded: ${conclusion:-unknown}"

# Guard the false-negative: if we never managed to read the log, we CANNOT tell a
# real pass from a neutered one — that is "inconclusive" (exit 2: just re-run),
# NOT a gate failure (exit 1: roll back). Telling the operator to roll back a
# healthy token because a log fetch blipped is the exact failure this script
# exists to prevent — so it must not commit that error itself.
if [ -z "$log" ]; then
  yellow "  SKIP  run $run_id concluded '${conclusion:-unknown}' but its log could not be read (transient API / log lag)."
  yellow "        Inconclusive — do NOT roll back. Re-run:  ./scripts/confirm-rotation.sh --latest"
  exit 2
fi

# The decisive check: did the gate REALLY verify, or did it neutral-pass?
if printf '%s' "$log" | grep -qF "$PASS_LINE"; then
  if [ "$conclusion" = "success" ]; then
    green "  PASS  rotation confirmed — log shows: $PASS_LINE"
    green "        the stored token genuinely reads branch protection. Least-privilege rotation is live."
    exit 0
  fi
  # PASS line present but run not green: surface as a real failure rather than mask it.
  red "  FAIL  gate log shows PASS but run concluded '$conclusion' — investigate run $run_id."
  exit 1
fi

if printf '%s' "$log" | grep -qiE 'Inconclusive \(exit 2\)|BRANCH_PROTECTION_PAT secret is unset|lacks admin'; then
  red "  FAIL  run concluded '${conclusion:-?}' but the gate was NOT verified — it hit the exit-2 NEUTRAL warning."
  red "        The stored token cannot read branch protection. Roll back to the bootstrap token:"
  red "          BP_PAT=\"\$(gh auth token)\" ./scripts/set-branch-protection-pat.sh"
  exit 1
fi

red "  FAIL  could not confirm a real gate verification in run $run_id's log (conclusion: ${conclusion:-?})."
red "        Inspect manually:  gh run view $run_id -R $REPO --log"
exit 1
