#!/usr/bin/env bash
# Trigger-topology guard for alias-guard-check.yml. Locks the carefully-tuned
# event triggers so the required `check-alias-guard` status check fires EXACTLY
# ONCE per pull request and exactly once per direct-to-main commit — no more,
# no less. Three invariants, each guarding a real regression this repo has hit:
#
#   [1] push: is scoped to `branches: [main]`. Without that branch filter a push
#       to a PR feature branch ALSO fires the push trigger, so a PR touching the
#       guarded paths runs check-alias-guard TWICE (push + pull_request) — two
#       identical ~seconds jobs per PR, wasted Actions minutes. This was the
#       observed state in PR #3 before the scoping landed. (memory:
#       alias-guard-push-scoped-to-main)
#   [2] push.paths still includes 'lingua-franca-api/scripts/**'. This is the one
#       case pull_request can't see: a direct-to-main commit (admin merge, hotfix
#       push) that bypasses a PR and touches the guard scripts must still fire one
#       push run. Drop this path and a stealth edit to the guards lands on main
#       unchecked.
#   [3] pull_request: carries NO `paths:` filter. The check is a REQUIRED status
#       gate via branch protection; a path-filtered required check hangs forever
#       as "Expected — waiting for status to be reported" on PRs that don't touch
#       the filtered paths, blocking every unrelated PR. (memory:
#       github-required-check-context-name)
#
# Usage:  ./scripts/check-trigger-topology.sh
# Exit:   0 = topology intact (one run per PR, one per main push), 1 = broken.

set -uo pipefail
cd "$(dirname "$0")/.."

WF="../.github/workflows/alias-guard-check.yml"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }

RC=0

bold "== check-trigger-topology :: does alias-guard-check fire exactly once per PR and once per main push? =="
echo ""

if [ ! -f "$WF" ]; then
  red "  FAIL  workflow not found at $WF"
  exit 1
fi

# Extract the child lines of a top-level trigger under `on:` (e.g. push,
# pull_request). Triggers sit at 2-space indent; their config is indented
# deeper. Portable awk only (no gawk 3-arg match) so it runs the same on a dev
# Mac and on ubuntu-latest. Trailing comment lines may leak into the preceding
# trigger's block — harmless, the assertions below grep for concrete tokens.
trigger_block() {
  awk -v want="$1" '
    /^on:[[:space:]]*$/ { inon = 1; next }
    inon && /^[^[:space:]]/ { inon = 0 }        # dedent past on: ends the section
    inon {
      if ($0 ~ /^  [a-z_]+:/) {                  # a 2-space trigger key line
        key = $0; sub(/^  /, "", key); sub(/:.*/, "", key)
        cur = (key == want)
        next
      }
      if (cur) print
    }
  ' "$WF"
}

PUSH_BLOCK="$(trigger_block push)"
PR_BLOCK="$(trigger_block pull_request)"

# ── 1. push restricted to the default branch ─────────────────────────────────
echo "[1] push: is scoped to branches: [main] (no duplicate PR-branch run)"
if printf '%s\n' "$PUSH_BLOCK" | grep -q '^[[:space:]]*branches:' \
   && printf '%s\n' "$PUSH_BLOCK" | grep -Eq '^[[:space:]]*-[[:space:]]+main[[:space:]]*$'; then
  green "  PASS  push fires only on main — a PR feature-branch push won't duplicate the pull_request run"
else
  red   "  FAIL  push has no 'branches: [main]' filter — every PR touching the guarded paths runs check-alias-guard TWICE"
  RC=1
fi
echo ""

# ── 2. push still watches the guard scripts ──────────────────────────────────
echo "[2] push.paths includes lingua-franca-api/scripts/** (direct-to-main commits still gated)"
if printf '%s\n' "$PUSH_BLOCK" | grep -q "lingua-franca-api/scripts/\*\*"; then
  green "  PASS  a direct-to-main commit touching the guard scripts still fires one push run"
else
  red   "  FAIL  push.paths dropped 'lingua-franca-api/scripts/**' — a hotfix to the guards could land on main unchecked"
  RC=1
fi
echo ""

# ── 3. pull_request has no path filter ───────────────────────────────────────
echo "[3] pull_request: present with NO paths filter (required gate can't hang as 'Expected')"
if ! grep -Eq '^  pull_request:[[:space:]]*$' "$WF"; then
  red   "  FAIL  pull_request trigger missing — the required check would never report on PRs"
  RC=1
elif printf '%s\n' "$PR_BLOCK" | grep -q '^[[:space:]]*paths:'; then
  red   "  FAIL  pull_request has a 'paths:' filter — the required check hangs forever on PRs that miss those paths"
  RC=1
else
  green "  PASS  pull_request runs on every PR — the required status gate always reports, never hangs"
fi
echo ""

if [ "$RC" -eq 0 ]; then
  green "== trigger topology verified: exactly one check-alias-guard run per PR, one per direct-to-main push =="
else
  red   "== trigger topology BROKEN — alias-guard-check could double-run, miss a main hotfix, or hang the gate. Fix alias-guard-check.yml =="
fi
exit $RC

# topology probe b4fa359 — throwaway, reverted on close
