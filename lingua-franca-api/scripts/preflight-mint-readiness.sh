#!/usr/bin/env bash
# Pre-mint readiness gate for ROTATE-BRANCH-PROTECTION-PAT.md — proves that
# everything around the human mint is green BEFORE the human spends their one
# irreducible web-UI shot.
#
# WHY THIS EXISTS (the footgun this guards):
#   Minting a fine-grained PAT is the single step an agent cannot do — GitHub
#   gates it behind a web-UI consent click. mint-branch-protection-pat.sh already
#   shrinks that to click-copy-paste and then pre-flights the pasted token. But a
#   fine-grained PAT is irreducible and PERISHABLE: if the operator mints + pastes
#   one and ONLY THEN discovers gh is unauthenticated, they aren't an admin of the
#   repo, the audit workflow that confirm-rotation.sh dispatches is gone, or a
#   chained script is missing/non-executable, the freshly-minted token is wasted —
#   it must be revoked (another web-UI trip) and re-minted from scratch. The mint
#   wizard checks only that `gh` is *present*; every other prerequisite is
#   discovered LATE, after the human action that's most expensive to redo.
#
#   This gate closes that window. It asserts — using the operator's CURRENT
#   bootstrap auth, no new token needed — every precondition the rotation depends
#   on, so the human is sent to the mint page only when their click is guaranteed
#   to land. It mutates nothing; it is read-only reconnaissance.
#
# WHAT IT PROVES (all must hold for READY / exit 0):
#   - gh is present AND authenticated (else inconclusive, exit 2).
#   - the caller is an ADMIN of REPO — required both to read branch protection and
#     to write the secret/variable the wizard stores (else exit 1: minting as a
#     non-admin produces a token that can never read protection).
#   - the CURRENT credential can actually read branch protection right now — this
#     proves the read path the FG-PAT must replicate works AND that the rollback
#     path (re-store the bootstrap) is live before we touch anything (else exit 1).
#   - the branch-protection-audit workflow exists and is active — confirm-rotation.sh
#     dispatches it as the end-to-end proof; without it the rotation can't be
#     confirmed (else exit 1).
#   - every script the wizard chains (set-branch-protection-pat, confirm-rotation,
#     retire-bootstrap-token) is present and executable (else exit 1).
#   - reports the required-check context state and the recorded PAT kind so the
#     operator knows they're going bootstrap -> fine-grained (and is told to STOP
#     and run retire-bootstrap-token.sh if the rotation already completed).
#
# Usage:
#   ./scripts/preflight-mint-readiness.sh          # full readiness report
#   ./scripts/preflight-mint-readiness.sh --quiet  # only the final verdict line
#
# Env:  REPO     (default d3hospitality/lingua-franca)
#       OWNER    (default d3hospitality)
#       WORKFLOW (default branch-protection-audit — the run confirm-rotation dispatches)
#       CONTEXT  (default check-alias-guard — the required status check being guarded)
# Exit: 0 = READY — every prerequisite but the human mint is green; mint away
#           (also 0 when the rotation already completed; verdict says so)
#       1 = NOT READY — a fixable blocker that would WASTE a minted token; fix first
#       2 = inconclusive: gh missing or unauthenticated

set -uo pipefail

REPO="${REPO:-d3hospitality/lingua-franca}"
OWNER="${OWNER:-d3hospitality}"
WORKFLOW="${WORKFLOW:-branch-protection-audit}"
CONTEXT="${CONTEXT:-check-alias-guard}"
KIND_VAR="BRANCH_PROTECTION_PAT_KIND"
SECRET="BRANCH_PROTECTION_PAT"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }
dim()   { printf '\033[2m%s\033[0m\n' "$1"; }

QUIET=0
for arg in "$@"; do
  case "$arg" in
    --quiet)   QUIET=1 ;;
    -h|--help) grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) red "  unknown arg: $arg (try --help)"; exit 2 ;;
  esac
done

say()  { [ "$QUIET" -eq 1 ] || echo "$1"; }
sayb() { [ "$QUIET" -eq 1 ] || bold "$1"; }
pass() { [ "$QUIET" -eq 1 ] || green "  PASS  $1"; }
fail() { red "  FAIL  $1"; FAILED=1; }
warn() { [ "$QUIET" -eq 1 ] || yellow "  WARN  $1"; }

FAILED=0

[ "$QUIET" -eq 1 ] || bold "== preflight-mint-readiness :: is everything but the human mint green for $REPO? =="
say ""

# ── Inconclusive gate: no point checking anything if gh can't talk to GitHub ──
if ! command -v gh >/dev/null 2>&1; then
  yellow "  SKIP  gh CLI not found — install https://cli.github.com then re-run"
  exit 2
fi
if ! gh auth status >/dev/null 2>&1; then
  yellow "  SKIP  gh not authenticated — run 'gh auth login' then re-run"
  exit 2
fi
pass "gh present and authenticated"

# ── Already-done short-circuit: don't send a human to mint a redundant token ──
KIND="$(gh variable get "$KIND_VAR" --repo "$REPO" 2>/dev/null || true)"
if [ "$KIND" = "fine-grained" ]; then
  say ""
  yellow "  NOTE  $KIND_VAR is already 'fine-grained' — the rotation appears COMPLETE."
  yellow "        Do NOT mint another token. Verify + retire the bootstrap instead:"
  yellow "          ./scripts/retire-bootstrap-token.sh"
  say ""
  green "VERDICT: ALREADY ROTATED — no mint needed (run retire-bootstrap-token.sh)."
  exit 0
fi
say "  current $KIND_VAR = ${KIND:-<unset>}  (rotation target: fine-grained)"

# ── Gate 1: admin on the repo (needed to read protection AND write the secret) ─
ADMIN="$(gh api "repos/$REPO" --jq '.permissions.admin' 2>/dev/null || true)"
if [ "$ADMIN" = "true" ]; then
  pass "you are an admin of $REPO (can read protection and write $SECRET)"
else
  fail "you are NOT an admin of $REPO (permissions.admin=${ADMIN:-unknown}). A non-admin token cannot read branch protection — minting one would waste it. Get admin first."
fi

# ── Gate 2: the current credential can read branch protection right now ────────
# Proves the exact read path the FG-PAT must replicate, and that the rollback
# (re-store the bootstrap) is live before we change anything.
CONTEXTS="$(gh api "repos/$REPO/branches/main/protection" --jq '.required_status_checks.contexts | join(",")' 2>/dev/null || true)"
if [ -n "$CONTEXTS" ]; then
  pass "current credential reads branch protection (rollback path is live)"
else
  fail "current credential CANNOT read branch protection on $REPO main. Fix this before minting — the rollback path must work first."
fi

# ── Gate 3: the required-check context the rotation guards is actually present ──
if printf '%s' "$CONTEXTS" | tr ',' '\n' | grep -qx "$CONTEXT"; then
  pass "required status check '$CONTEXT' is present in protection"
elif [ -n "$CONTEXTS" ]; then
  warn "'$CONTEXT' is NOT in the required contexts ($CONTEXTS). confirm-rotation.sh asserts this exact PASS line — fix branch protection or the post-mint confirm will fail."
fi

# ── Gate 4: the audit workflow confirm-rotation dispatches exists and is active ─
WF_STATE="$(gh api "repos/$REPO/actions/workflows" --jq ".workflows[] | select(.name==\"$WORKFLOW\" or (.path|endswith(\"/$WORKFLOW.yml\"))) | .state" 2>/dev/null | head -1)"
if [ "$WF_STATE" = "active" ]; then
  pass "workflow '$WORKFLOW' exists and is active (confirm-rotation can dispatch it)"
elif [ -n "$WF_STATE" ]; then
  fail "workflow '$WORKFLOW' exists but is '$WF_STATE' (not active) — confirm-rotation.sh cannot dispatch it. Re-enable it."
else
  fail "workflow '$WORKFLOW' not found on $REPO — confirm-rotation.sh has nothing to dispatch. Commit/push it on the default branch first."
fi

# ── Gate 5: every script the wizard chains is present and executable ───────────
for s in set-branch-protection-pat.sh confirm-rotation.sh retire-bootstrap-token.sh; do
  if [ ! -f "$DIR/$s" ]; then
    fail "missing chained script: scripts/$s — the wizard cannot complete the rotation."
  elif [ ! -x "$DIR/$s" ]; then
    fail "scripts/$s is present but not executable — run: chmod +x scripts/$s"
  else
    pass "scripts/$s present and executable"
  fi
done

# ── Verdict ───────────────────────────────────────────────────────────────────
say ""
if [ "$FAILED" -eq 0 ]; then
  green "VERDICT: READY — everything but the human mint is green. Mint with:"
  green "  ./scripts/mint-branch-protection-pat.sh"
  exit 0
else
  red "VERDICT: NOT READY — fix the FAIL line(s) above BEFORE minting, or the token is wasted."
  exit 1
fi
