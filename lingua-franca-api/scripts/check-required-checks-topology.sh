#!/usr/bin/env bash
# Meta-guard: every LIVE required status check on main is trigger-topology clean,
# and main requires branches to be up to date before merge (strict mode).
#
# WHY THIS EXISTS — the gap the per-workflow guards can't see
# ----------------------------------------------------------
# check-trigger-topology.sh locks ONE workflow's triggers (push scoped to main,
# pull_request with NO path filter) so a required check fires exactly once per PR
# and never hangs as "Expected — waiting for status to be reported". It is wired
# as an in-CI step inside alias-guard-check.yml and fixture-check.yml — each of
# the two current required checks self-locks.
#
# But that wiring is MANUAL and per-workflow. Nothing forces a FUTURE 3rd required
# check to carry the topology step. Add a new context to main's branch protection
# whose workflow has a path-filtered `pull_request:` and you silently reintroduce
# the exact hang that forced three owner `--admin` merge bypasses (#14, #17,
# earlier). The two embedded steps each guard themselves; none guards "did someone
# add a third required check that no one topology-locked?".
#
# This script closes that gap by deriving the work-list from the LIVE repo instead
# of a hard-coded pair:
#   1. Read main's required status contexts from branch protection (the source of
#      truth for what actually blocks merges).
#   2. Map each context (a status context == a workflow JOB id) to the workflow
#      file that declares it.
#   3. Run check-trigger-topology.sh against EACH such workflow. Any required check
#      whose workflow is path-filtered on pull_request — or can't be mapped to a
#      workflow at all — fails the audit.
#   4. Assert strict==true so PRs must be up to date with main before merge (no
#      stale-base merges). A silent flip back to strict:false is caught here.
# Self-extending: a 4th required context is picked up automatically on the next run.
#
# Usage:   ./scripts/check-required-checks-topology.sh
# Env:     REPO   (default d3hospitality/lingua-franca)
#          BRANCH (default main)
# Exit:    0 = strict on AND every required check's workflow is topology-clean
#          1 = strict off, a required context maps to no workflow, OR a required
#              check's workflow is path-filtered / double-running (a real gate hole)
#          2 = INCONCLUSIVE — gh missing/unauthenticated, no admin:repo read, or the
#              API was unreachable. Distinct from 1 so a token/network blip never
#              masquerades as a regression. Mirrors check-branch-protection.sh.
#
# Reading branch protection needs admin rights, so this runs as an operator/
# scheduled guard with an authenticated gh (or a PAT in GH_TOKEN) — NOT in the
# unauthenticated per-PR job, where the default GITHUB_TOKEN can't read protection.

set -uo pipefail
cd "$(dirname "$0")/.."

REPO="${REPO:-d3hospitality/lingua-franca}"
BRANCH="${BRANCH:-main}"
WF_DIR="../.github/workflows"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }

bold "== check-required-checks-topology :: is every LIVE required check on $REPO@$BRANCH topology-clean, and is strict mode on? =="
echo ""

# ── prerequisites (any failure here is INCONCLUSIVE, exit 2, never exit 1) ─────
if ! command -v gh >/dev/null 2>&1; then
  yellow "  SKIP  gh CLI not found — cannot read branch protection. Install: https://cli.github.com"
  exit 2
fi
if ! gh auth status >/dev/null 2>&1 && [ -z "${GH_TOKEN:-}" ] && [ -z "${GITHUB_TOKEN:-}" ]; then
  yellow "  SKIP  gh is not authenticated and no GH_TOKEN/GITHUB_TOKEN set — run 'gh auth login' or export a PAT with admin:repo read"
  exit 2
fi
if [ ! -d "$WF_DIR" ]; then
  yellow "  SKIP  workflow dir not found at $WF_DIR (run from lingua-franca-api/) — cannot map contexts to workflows"
  exit 2
fi

API="repos/$REPO/branches/$BRANCH/protection/required_status_checks"

# Single read of the whole required_status_checks object: strict + contexts.
RESP="$(gh api "$API" 2>/tmp/check-rct-err.$$)"
RC=$?
ERR="$(cat /tmp/check-rct-err.$$ 2>/dev/null)"
rm -f /tmp/check-rct-err.$$

if [ $RC -ne 0 ]; then
  # No required checks configured at all is a genuinely DEAD gate (exit 1);
  # anything else (401/403/network) is inconclusive (exit 2).
  if printf '%s' "$ERR" | grep -qiE 'Required status checks not enabled|Branch not protected'; then
    red "  FAIL  $REPO@$BRANCH has NO required status checks — nothing gates merges, nothing to topology-lock"
    echo ""
    red "== required-checks gate is DEAD: re-add the required checks on $BRANCH =="
    exit 1
  fi
  yellow "  SKIP  could not read branch protection (token lacks admin:repo, or API unreachable)"
  printf '         %s\n' "$(printf '%s' "$ERR" | tr '\n' ' ' | cut -c1-160)"
  exit 2
fi

STRICT="$(gh api --jq '.strict' "$API" 2>/dev/null)"
# Read contexts into an array via a portable while-read loop (no bash-4 mapfile —
# this guard also runs on a dev Mac's bash 3.2, like the sibling check-*.sh).
CONTEXTS=()
while IFS= read -r ctx; do
  [ -n "$ctx" ] && CONTEXTS+=("$ctx")
done < <(gh api --jq '.contexts[]' "$API" 2>/dev/null)

FAIL=0

# ── A. strict mode: branches must be up to date before merge ──────────────────
echo "[strict] PRs must be up to date with $BRANCH before merge (no stale-base merges)"
if [ "$STRICT" = "true" ]; then
  green "  PASS  strict=true — a PR built on a stale $BRANCH is blocked until updated"
else
  red   "  FAIL  strict=$STRICT — a PR can merge while behind $BRANCH (stale-base / untested-against-HEAD merge)"
  red   "        Fix: gh api -X PATCH $API -F strict=true -f 'contexts[]=${CONTEXTS[0]:-check-alias-guard}' ..."
  FAIL=1
fi
echo ""

# ── B. every required context's workflow is topology-clean ────────────────────
if [ ${#CONTEXTS[@]} -eq 0 ]; then
  red "  FAIL  branch protection returned an EMPTY contexts list — no required checks block merges"
  FAIL=1
fi

# Map a status context (== a workflow job id) to the workflow file declaring it.
# Job ids sit at 2-space indent under `jobs:`. Portable awk (no gawk extensions).
workflow_for_context() {
  local ctx="$1" wf
  for wf in "$WF_DIR"/*.yml "$WF_DIR"/*.yaml; do
    [ -f "$wf" ] || continue
    if awk -v want="$ctx" '
      /^jobs:[[:space:]]*$/ { injobs = 1; next }
      injobs && /^[^[:space:]#]/ { injobs = 0 }     # dedent past jobs: ends it
      injobs && /^  [A-Za-z0-9_-]+:[[:space:]]*$/ {
        id = $0; sub(/^  /, "", id); sub(/:.*/, "", id)
        if (id == want) { found = 1 }
      }
      END { exit(found ? 0 : 1) }
    ' "$wf"; then
      printf '%s' "$wf"
      return 0
    fi
  done
  return 1
}

for ctx in "${CONTEXTS[@]}"; do
  [ -z "$ctx" ] && continue
  echo "[required:$ctx] locate its workflow and assert trigger topology"
  WF="$(workflow_for_context "$ctx")"
  if [ -z "$WF" ]; then
    red "  FAIL  required check '$ctx' maps to NO workflow under $WF_DIR — gate references a job that no longer exists, or a misnamed context"
    FAIL=1
    echo ""
    continue
  fi
  echo "         workflow: $(basename "$WF")"
  if bash scripts/check-trigger-topology.sh "$WF" >/tmp/check-rct-topo.$$ 2>&1; then
    green "  PASS  '$ctx' ($(basename "$WF")) is topology-clean — fires once per PR, once per main push, never hangs"
  else
    red   "  FAIL  '$ctx' ($(basename "$WF")) FAILED the trigger-topology guard:"
    sed 's/^/           /' /tmp/check-rct-topo.$$
    FAIL=1
  fi
  rm -f /tmp/check-rct-topo.$$
  echo ""
done

if [ "$FAIL" -eq 0 ]; then
  green "== merge gate is SOUND: strict mode on, and all ${#CONTEXTS[@]} required check(s) [${CONTEXTS[*]}] are topology-clean =="
  exit 0
else
  red "== merge gate has a HOLE: strict off and/or a required check is path-filtered / unmapped. A future PR could hang or merge stale. =="
  exit 1
fi
