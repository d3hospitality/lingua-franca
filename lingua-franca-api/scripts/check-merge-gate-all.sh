#!/usr/bin/env bash
# Behavioural merge-gate sweep across EVERY open PR.
#
# check-merge-gate.sh proves the gate behaviour for ONE pull request. That is the
# right unit of proof, but a daily audit needs to cover the whole open-PR surface:
# a required check can stop running (or a PR can go CLEAN-while-red) on ANY open PR,
# not just a pinned fixture number. This wrapper enumerates the live open PRs and
# runs the per-PR verifier over each, then collapses the results into ONE exit code
# so the scheduled job (branch-protection-audit.yml) fails within 24h the same way
# the config audit (check-branch-protection.sh) does.
#
# It is the BEHAVIOURAL twin of check-branch-protection.sh:
#   • check-branch-protection.sh — asserts the required contexts are LISTED in
#     main's protection config (the configuration half; needs admin PAT).
#   • this + check-merge-gate.sh  — asserts the merge button actually HONOURS those
#     contexts on real PRs (the behavioural half; runs with the default token).
#
# Aggregation (worst case wins, so a single dead gate fails the whole sweep):
#   • ANY PR returns 1 (gate violation: dead gate / required check never ran)
#       → exit 1. This is the regression the daily audit exists to catch.
#   • No violations, but ALL inspected PRs were inconclusive (exit 2)
#       → exit 2. A blip/auth gap must never read as a regression.
#   • At least one PR verified cleanly (exit 0) and none violated
#       → exit 0.
#   • NO open PRs at all
#       → exit 0 with a note. An empty open-PR set is a legitimate healthy state,
#         not an inconclusive one — there is simply nothing to hold.
#
# Usage:   ./scripts/check-merge-gate-all.sh
# Env:     REPO       (default d3hospitality/lingua-franca)
#          CONTEXTS   (forwarded to check-merge-gate.sh; default: live branch
#                      protection, falling back to "check-alias-guard check-fixture")
#          MAX_PRS    (safety cap on PRs inspected per run; default 50)
#          SKIP_DRAFTS (true|false; default true — drafts are unmergeable by
#                      definition, so their gate behaviour is uninformative)
# Exit:    0 = every open PR's gate is consistent (or no open PRs)
#          1 = at least one open PR has a DEAD/defective gate — investigate now
#          2 = inconclusive only (gh missing/unauth, API unreachable) — never a
#              regression signal

set -uo pipefail

REPO="${REPO:-d3hospitality/lingua-franca}"
MAX_PRS="${MAX_PRS:-50}"
SKIP_DRAFTS="${SKIP_DRAFTS:-true}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PER_PR="$HERE/check-merge-gate.sh"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }

bold "== check-merge-gate-all :: does the merge button honour every required check on EVERY open PR of $REPO? =="
echo ""

# ── prerequisites (any failure here is INCONCLUSIVE, exit 2, never exit 1) ─────
if ! command -v gh >/dev/null 2>&1; then
  yellow "  SKIP  gh CLI not found — cannot enumerate open PRs. Install: https://cli.github.com"
  exit 2
fi
if ! gh auth status >/dev/null 2>&1 && [ -z "${GH_TOKEN:-}" ] && [ -z "${GITHUB_TOKEN:-}" ]; then
  yellow "  SKIP  gh is not authenticated and no GH_TOKEN/GITHUB_TOKEN set — run 'gh auth login'"
  exit 2
fi
if [ ! -f "$PER_PR" ]; then
  yellow "  SKIP  per-PR verifier not found next to this script: $PER_PR"
  exit 2
fi

# ── enumerate the live open PRs (number + draft flag) as TSV ──────────────────
PRLIST_JSON="$(gh pr list --repo "$REPO" --state open --limit "$MAX_PRS" \
                 --json number,isDraft 2>/tmp/check-mga-err.$$)"
RC=$?
ERR="$(cat /tmp/check-mga-err.$$ 2>/dev/null)"; rm -f /tmp/check-mga-err.$$
if [ $RC -ne 0 ] || [ -z "$PRLIST_JSON" ]; then
  yellow "  SKIP  could not list open PRs on $REPO (API unreachable / token lacks read)"
  printf '         %s\n' "$(printf '%s' "$ERR" | tr '\n' ' ' | cut -c1-160)"
  exit 2
fi

PR_TSV="$(printf '%s' "$PRLIST_JSON" | python3 -c '
import sys, json
for p in json.load(sys.stdin):
    num = p["number"]
    draft = str(p.get("isDraft", False)).lower()
    print("%d\t%s" % (num, draft))
')"

if [ -z "$PR_TSV" ]; then
  green "  OK  no open PRs on $REPO — nothing to hold; gate is trivially consistent."
  exit 0
fi

# ── run the per-PR verifier over each open PR, tally worst exit code ───────────
SAW_VIOLATION=0     # any exit 1
SAW_CLEAN=0         # any exit 0
SAW_INCONCLUSIVE=0  # any exit 2
SKIPPED_DRAFTS=()
declare -a SUMMARY  # human-readable per-PR result lines

while IFS=$'\t' read -r PR DRAFT; do
  [ -z "$PR" ] && continue
  if [ "$SKIP_DRAFTS" = "true" ] && [ "$DRAFT" = "true" ]; then
    SKIPPED_DRAFTS+=("$PR")
    continue
  fi

  echo "  ───────────────────────────────────────────────────────────────────"
  bold "  ▶ PR #$PR"
  set +e
  REPO="$REPO" CONTEXTS="${CONTEXTS:-}" bash "$PER_PR" "$PR"
  prc=$?
  set -e 2>/dev/null || true

  case "$prc" in
    0) SAW_CLEAN=1;        SUMMARY+=("PR #$PR  →  exit 0  CONSISTENT");;
    1) SAW_VIOLATION=1;    SUMMARY+=("PR #$PR  →  exit 1  GATE VIOLATION");;
    *) SAW_INCONCLUSIVE=1; SUMMARY+=("PR #$PR  →  exit $prc  inconclusive");;
  esac
done <<< "$PR_TSV"

# ── report ────────────────────────────────────────────────────────────────────
echo ""
echo "  ===================================================================="
bold  "  SWEEP SUMMARY ($REPO)"
if [ ${#SKIPPED_DRAFTS[@]} -gt 0 ]; then
  echo "    skipped drafts (unmergeable by definition): ${SKIPPED_DRAFTS[*]}"
fi
if [ ${#SUMMARY[@]} -eq 0 ]; then
  green "    no non-draft open PRs to inspect — gate trivially consistent."
  exit 0
fi
for line in "${SUMMARY[@]}"; do echo "    $line"; done
echo ""

if [ "$SAW_VIOLATION" -eq 1 ]; then
  red "== SWEEP FAIL: at least one open PR has a DEAD or defective merge gate — see exit-1 PR(s) above =="
  exit 1
fi
if [ "$SAW_CLEAN" -eq 1 ]; then
  green "== SWEEP PASS: every inspected open PR's merge gate is consistent with its required-check states =="
  [ "$SAW_INCONCLUSIVE" -eq 1 ] && yellow "   (some PRs were inconclusive — see exit-2 lines — but none showed a dead gate)"
  exit 0
fi
yellow "== SWEEP INCONCLUSIVE: every inspected PR was inconclusive (no clean verification, no violation) =="
exit 2
