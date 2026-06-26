#!/usr/bin/env bash
# Branch-protection guard for the required status checks that gate `main`.
#
# Two checks must stay live to keep merges honest:
#   • check-alias-guard — the alias-guard YAML/topology gate (alias-guard-check.yml)
#   • check-fixture     — the offline fixture-integrity gate (fixture-check.yml),
#                         so a regression in the committed long-en.b64 / offline
#                         deps blocks merges instead of merely going red.
#
# The topology guard (check-trigger-topology.sh) locks the WORKFLOW YAML so those
# jobs keep firing exactly once per PR. But it is blind to the OTHER half of the
# gate: branch protection on `main` must list each context in its REQUIRED status
# contexts. If a context is silently dropped from branch protection (an admin
# toggles it off, a settings sync overwrites it, the rule is deleted), the
# workflow still RUNS on every PR — green checkmark and all — but its result no
# longer BLOCKS merges. The YAML looks healthy; the gate is dead. No script in
# this repo would catch that, because nothing inspects the live branch-protection
# config. This script closes that gap via the GitHub API.
#
# Invariant: repos/<owner>/<repo>/branches/<branch>/protection/required_status_checks
#            .contexts  MUST contain  EVERY context in $CONTEXTS.
#
# Usage:   ./scripts/check-branch-protection.sh
# Env:     REPO     (default d3hospitality/lingua-franca)
#          BRANCH   (default main)
#          CONTEXTS (default "check-alias-guard check-fixture" — space/comma list)
#          CONTEXT  (legacy single-context override; if set, wins over CONTEXTS)
# Exit:    0 = every required context is present (gate is live)
#          1 = ANY context is ABSENT / no protection / no required checks (gate DEAD)
#          2 = INCONCLUSIVE — gh missing, not authenticated, no permission, or the
#              API was unreachable. Deliberately distinct from 1 so a network blip
#              or a token without admin:repo never masquerades as a real regression.
#
# Reading branch protection requires admin rights on the repo, so this runs as an
# operator/scheduled guard with an authenticated `gh` (or a PAT in GH_TOKEN) — it
# is NOT part of the unauthenticated per-PR CI job, where the default GITHUB_TOKEN
# can't read protection settings and would only ever return exit 2.

set -uo pipefail

REPO="${REPO:-d3hospitality/lingua-franca}"
BRANCH="${BRANCH:-main}"
# CONTEXT (singular) kept for back-compat: if a caller sets it, it is the sole
# context checked. Otherwise assert the full CONTEXTS list. Commas or whitespace
# both separate entries.
CONTEXTS="${CONTEXT:-${CONTEXTS:-check-alias-guard check-fixture}}"
read -r -a REQUIRED <<< "$(printf '%s' "$CONTEXTS" | tr ',' ' ')"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }

bold "== check-branch-protection :: are [${REQUIRED[*]}] still required status checks on $REPO@$BRANCH? =="
echo ""

# ── prerequisites (any failure here is INCONCLUSIVE, exit 2, never exit 1) ─────
if ! command -v gh >/dev/null 2>&1; then
  yellow "  SKIP  gh CLI not found — cannot verify branch protection. Install: https://cli.github.com"
  exit 2
fi

if ! gh auth status >/dev/null 2>&1 && [ -z "${GH_TOKEN:-}" ] && [ -z "${GITHUB_TOKEN:-}" ]; then
  yellow "  SKIP  gh is not authenticated and no GH_TOKEN/GITHUB_TOKEN set — run 'gh auth login' or export a PAT with admin:repo read"
  exit 2
fi

API="repos/$REPO/branches/$BRANCH/protection/required_status_checks"

# Capture body AND status so we can tell "no required checks configured" (a real
# DEAD-gate, exit 1) apart from "couldn't reach / not allowed" (exit 2).
RESP="$(gh api "$API" 2>/tmp/check-bp-err.$$)"
RC=$?
ERR="$(cat /tmp/check-bp-err.$$ 2>/dev/null)"
rm -f /tmp/check-bp-err.$$

if [ $RC -ne 0 ]; then
  # 404 on required_status_checks means protection exists but NO required checks
  # are configured — that is a genuinely open gate, not an access problem.
  if printf '%s' "$ERR" | grep -qiE 'Required status checks not enabled|Branch not protected'; then
    red "  FAIL  $REPO@$BRANCH has NO required status checks — [${REQUIRED[*]}] are not gating merges"
    echo ""
    red "== branch-protection gate is DEAD: re-add [${REQUIRED[*]}] to required checks on $BRANCH =="
    exit 1
  fi
  # Anything else (401/403 no permission, network error, rate limit) is inconclusive.
  yellow "  SKIP  could not read branch protection (token lacks admin:repo, repo private to this token, or API unreachable)"
  printf '         %s\n' "$(printf '%s' "$ERR" | tr '\n' ' ' | cut -c1-160)"
  exit 2
fi

# Authoritative membership test via gh's embedded jq — exact, whitespace-proof.
# The reachability/permission check already passed above, so the contexts array
# is read once; an exact-string array membership beats a substring grep that
# would false-match e.g. "check-alias-guard-staging". Every required context
# must be present; the FIRST missing one flips the gate to DEAD (exit 1).
LIVE="$(gh api --jq '.contexts | join(", ")' "$API" 2>/dev/null)"
MISSING=()
for ctx in "${REQUIRED[@]}"; do
  [ -z "$ctx" ] && continue
  present="$(gh api --jq ".contexts | contains([\"$ctx\"])" "$API" 2>/dev/null)"
  if [ "$present" = "true" ]; then
    green "  PASS  '$ctx' is a required status check"
  else
    red   "  FAIL  '$ctx' is MISSING from required status checks"
    MISSING+=("$ctx")
  fi
done

echo ""
if [ ${#MISSING[@]} -eq 0 ]; then
  green "== branch-protection gate is LIVE: [${REQUIRED[*]}] all block merges on $REPO@$BRANCH (live: ${LIVE:-<none>}) =="
  exit 0
else
  red "== branch-protection gate is DEAD: [${MISSING[*]}] dropped — the job(s) run but no longer block merges (live: ${LIVE:-<none>}) =="
  for ctx in "${MISSING[@]}"; do
    red "   Fix: gh api -X POST $API/contexts -f 'contexts[]=$ctx'  (or re-add it in repo Settings → Branches)"
  done
  exit 1
fi
