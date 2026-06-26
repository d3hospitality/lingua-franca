#!/usr/bin/env bash
# Empirical merge-gate verifier for a pull request.
#
# check-branch-protection.sh proves the required contexts are LISTED in main's
# branch-protection config. That is necessary but not sufficient: it asserts the
# *configuration*, not the *behaviour*. This script closes the remaining gap by
# reading GitHub's LIVE merge state for a specific PR and asserting that the gate
# actually fires — i.e. that the merge button's blocked/clean status is
# CONSISTENT with the state of every required status check.
#
# The contract it enforces (proving "a fixture regression actually blocks merge"):
#   • Every required context (check-alias-guard, check-fixture) must be PRESENT on
#     the PR's status rollup — a required check that never runs would otherwise sit
#     EXPECTED forever and silently block, or worse be dropped and stop gating.
#   • If ANY required check is failing/pending/absent  →  the PR MUST NOT be
#     reported mergeable (mergeStateStatus must be BLOCKED/BEHIND/UNKNOWN, never
#     CLEAN). A PR that is CLEAN while a required check is red is a DEAD gate:
#     fixture regressions would merge straight through. That is the exit-1 case.
#   • If ALL required checks are green  →  the PR's status-check dimension must be
#     satisfied (mergeStateStatus CLEAN or UNSTABLE — UNSTABLE = a *non*-required
#     check is red, which by design does not block). BLOCKED here means a required
#     check is being demanded that the rollup doesn't show green → reported as a
#     gate violation to investigate.
#
# Unlike check-branch-protection.sh, reading PR merge state needs NO admin rights,
# so this can run with the default per-PR GITHUB_TOKEN or any authenticated gh.
#
# Usage:   ./scripts/check-merge-gate.sh [PR_NUMBER]   (default 9)
# Env:     REPO     (default d3hospitality/lingua-franca)
#          CONTEXTS (space/comma list of required contexts; default: read LIVE
#                    from branch protection, falling back to
#                    "check-alias-guard check-fixture" if protection is unreadable)
# Exit:    0 = gate behaviour CONSISTENT with required-check states (gate healthy)
#          1 = gate VIOLATION — a required check is missing from the PR, OR the PR
#              is mergeable despite a non-green required check (DEAD gate)
#          2 = INCONCLUSIVE — gh missing/unauthenticated, PR not found, or the API
#              was unreachable. Distinct from 1 so a blip never reads as a regression.

set -uo pipefail

REPO="${REPO:-d3hospitality/lingua-franca}"
PR="${1:-9}"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }

bold "== check-merge-gate :: does the merge button on $REPO#$PR honour every required check? =="
echo ""

# ── prerequisites (any failure here is INCONCLUSIVE, exit 2, never exit 1) ─────
if ! command -v gh >/dev/null 2>&1; then
  yellow "  SKIP  gh CLI not found — cannot read PR merge state. Install: https://cli.github.com"
  exit 2
fi
if ! gh auth status >/dev/null 2>&1 && [ -z "${GH_TOKEN:-}" ] && [ -z "${GITHUB_TOKEN:-}" ]; then
  yellow "  SKIP  gh is not authenticated and no GH_TOKEN/GITHUB_TOKEN set — run 'gh auth login'"
  exit 2
fi

# ── required contexts: prefer the LIVE branch-protection list, fall back to the
#    known pair if protection is unreadable (needs admin; absence is not fatal
#    here because the per-PR token legitimately can't read it). ────────────────
DEFAULT_CONTEXTS="check-alias-guard check-fixture"
if [ -n "${CONTEXTS:-}" ]; then
  read -r -a REQUIRED <<< "$(printf '%s' "$CONTEXTS" | tr ',' ' ')"
  SRC="env CONTEXTS"
else
  # Reading branch protection needs admin scope. A non-admin token (e.g. CI's
  # default GITHUB_TOKEN) gets HTTP 403, whose JSON error body gh prints to
  # STDOUT — and on a non-2xx status the --jq filter is bypassed, so LIVE_BP
  # would capture that raw body. Guard on BOTH the exit code AND the shape so
  # the error body is never word-split into a context list (which would
  # fabricate "absent required check" violations against every PR). Either
  # signal means protection is unreadable → fall back to the known pair.
  LIVE_BP="$(gh api "repos/$REPO/branches/main/protection/required_status_checks" --jq '.contexts | join(" ")' 2>/dev/null)"
  BP_RC=$?
  if [ "$BP_RC" -ne 0 ] || printf '%s' "$LIVE_BP" | grep -q '[{}":]'; then
    LIVE_BP=""
  fi
  if [ -n "$LIVE_BP" ]; then
    read -r -a REQUIRED <<< "$LIVE_BP"
    SRC="live branch protection"
  else
    read -r -a REQUIRED <<< "$DEFAULT_CONTEXTS"
    SRC="fallback default (branch protection unreadable with this token)"
  fi
fi
echo "  required contexts ($SRC): ${REQUIRED[*]}"
echo ""

# ── read the PR's merge state + per-check rollup in one shot ──────────────────
PRJSON="$(gh pr view "$PR" --repo "$REPO" --json number,mergeable,mergeStateStatus,isDraft,statusCheckRollup 2>/tmp/check-mg-err.$$)"
RC=$?
ERR="$(cat /tmp/check-mg-err.$$ 2>/dev/null)"; rm -f /tmp/check-mg-err.$$
if [ $RC -ne 0 ] || [ -z "$PRJSON" ]; then
  yellow "  SKIP  could not read PR #$PR on $REPO (not found, or API unreachable)"
  printf '         %s\n' "$(printf '%s' "$ERR" | tr '\n' ' ' | cut -c1-160)"
  exit 2
fi

MERGE_STATE="$(printf '%s' "$PRJSON" | python3 -c 'import sys,json;print(json.load(sys.stdin)["mergeStateStatus"])')"
IS_DRAFT="$(printf '%s' "$PRJSON" | python3 -c 'import sys,json;print(str(json.load(sys.stdin)["isDraft"]).lower())')"

# Per-context conclusion as TSV "name<TAB>STATE", last occurrence per name kept
# (rollup may list a context more than once across re-runs and GitHub keys the
# gate off the latest run). Stored in a plain string for bash 3.2 portability
# (macOS local runs) — no associative arrays.
ROLLUP_TSV="$(printf '%s' "$PRJSON" | python3 -c '
import sys,json
d=json.load(sys.stdin)
last={}
for c in d.get("statusCheckRollup") or []:
    name=c.get("name") or c.get("context") or ""
    if not name: continue
    concl=(c.get("conclusion") or c.get("state") or c.get("status") or "").upper()
    last[name]=concl
for name,concl in last.items():
    print(f"{name}\t{concl}")
')"

# State of a single context from ROLLUP_TSV; prints __ABSENT__ if not present.
ctx_state() {
  local want="$1" line
  line="$(printf '%s\n' "$ROLLUP_TSV" | awk -F'\t' -v n="$want" '$1==n{print $2}' | tail -1)"
  [ -z "$line" ] && line="__ABSENT__"
  printf '%s' "$line"
}

is_green() { case "$1" in SUCCESS|NEUTRAL|SKIPPED) return 0;; *) return 1;; esac; }

# ── evaluate each required context ────────────────────────────────────────────
NOT_GREEN=()   # required checks that are red / pending
ABSENT=()      # required checks not present on the PR at all
for ctx in "${REQUIRED[@]}"; do
  [ -z "$ctx" ] && continue
  st="$(ctx_state "$ctx")"
  if [ "$st" = "__ABSENT__" ]; then
    red   "  FAIL  '$ctx' is REQUIRED but ABSENT from PR #$PR's checks — it never ran"
    ABSENT+=("$ctx"); NOT_GREEN+=("$ctx")
  elif is_green "$st"; then
    green "  PASS  '$ctx' = $st"
  else
    yellow "  WARN  '$ctx' = $st (not green — must block merge)"
    NOT_GREEN+=("$ctx")
  fi
done
echo ""
echo "  observed mergeStateStatus = $MERGE_STATE   (mergeable rollup read from GitHub)"
[ "$IS_DRAFT" = "true" ] && yellow "  note: PR is a DRAFT — drafts are unmergeable regardless of checks"
echo ""

# ── assert the gate behaviour is consistent with the check states ─────────────
if [ ${#NOT_GREEN[@]} -gt 0 ]; then
  # A required check is not green → the PR MUST NOT be mergeable. CLEAN here = the
  # gate let a regression through (the exact failure this mission guards against).
  if [ "$MERGE_STATE" = "CLEAN" ]; then
    red "== GATE VIOLATION: PR #$PR is CLEAN/mergeable while required [${NOT_GREEN[*]}] are NOT green =="
    red "   A fixture/alias regression would merge straight through — the gate is DEAD."
    [ ${#ABSENT[@]} -gt 0 ] && red "   Absent required checks (never ran): ${ABSENT[*]}"
    exit 1
  fi
  if [ ${#ABSENT[@]} -gt 0 ]; then
    # Required-but-never-ran is itself a defect even when the PR is correctly
    # blocked: an EXPECTED check that never reports blocks forever and masks which
    # gate is actually failing. Surface it as a violation to fix the trigger.
    red "== GATE DEFECT: required [${ABSENT[*]}] never ran on PR #$PR (merge currently blocked: $MERGE_STATE) =="
    red "   Fix the workflow trigger so every required context reports on every PR."
    exit 1
  fi
  green "== gate CONSISTENT: required [${NOT_GREEN[*]}] not green AND merge is blocked ($MERGE_STATE) — regressions are held =="
  exit 0
else
  # All required checks green → the status-check dimension must be satisfied.
  case "$MERGE_STATE" in
    CLEAN|UNSTABLE)
      green "== gate CONSISTENT: all required checks green AND merge is unblocked on checks ($MERGE_STATE) =="
      [ "$MERGE_STATE" = "UNSTABLE" ] && yellow "   (UNSTABLE = a NON-required check is red; by design it does not block)"
      exit 0
      ;;
    BLOCKED)
      # All required contexts read green but GitHub still blocks on checks — the
      # rollup the API hands us disagrees with what branch protection demands
      # (e.g. a context name mismatch, or a same-named check from another app id).
      red "== GATE VIOLATION: all required checks read green yet PR #$PR is BLOCKED =="
      red "   Branch protection is demanding a context the rollup doesn't satisfy — check exact context names / app ids."
      exit 1
      ;;
    DRAFT|BEHIND|DIRTY|HAS_HOOKS)
      yellow "== INCONCLUSIVE on checks: merge blocked for a NON-check reason ($MERGE_STATE) — checks themselves are green =="
      exit 2
      ;;
    *)
      yellow "== INCONCLUSIVE: unrecognised mergeStateStatus '$MERGE_STATE' with all checks green =="
      exit 2
      ;;
  esac
fi
