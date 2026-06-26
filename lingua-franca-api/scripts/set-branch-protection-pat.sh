#!/usr/bin/env bash
# Verify-then-store rotation for the BRANCH_PROTECTION_PAT repo secret.
#
# The branch-protection-audit workflow runs check-branch-protection.sh with
# GH_TOKEN = secrets.BRANCH_PROTECTION_PAT. If that secret is unset OR the token
# can't read branch protection, the audit exits 2 (neutral warning) and the gate
# is never actually verified. This script makes setting/rotating that secret safe
# by PRE-FLIGHTING the candidate token against the exact API the audit uses, then
# storing it ONLY if it really can read required_status_checks. No more silently
# storing a dud token that turns every audit run into an exit-2 warning.
#
# Use it to swap the bootstrap token (a broad `gh auth token`, scopes repo+workflow)
# for a least-privilege credential — ideally a fine-grained PAT scoped to this repo
# with "Administration: Read-only", or a classic PAT with just `repo`. Reading
# branch protection needs admin rights on the repo, so the PAT's owner must be an
# admin of d3hospitality/lingua-franca.
#
# Usage:
#   ./scripts/set-branch-protection-pat.sh                 # prompt for the PAT (hidden input)
#   ./scripts/set-branch-protection-pat.sh <pat>           # pass it as an arg (avoid: lands in shell history)
#   BP_PAT=ghp_xxx ./scripts/set-branch-protection-pat.sh  # pass via env (preferred for CI)
#   ./scripts/set-branch-protection-pat.sh --verify-only   # just check the stored secret/token, store nothing
#
# Env:  REPO    (default d3hospitality/lingua-franca)
#       BRANCH  (default main)
#       SECRET  (default BRANCH_PROTECTION_PAT)
# Exit: 0 = token verified and secret stored (or --verify-only passed)
#       1 = candidate token can read the repo but CANNOT read branch protection
#           (wrong scope / not a repo admin) — nothing stored
#       2 = inconclusive: gh missing, no token supplied, or the API was unreachable

set -uo pipefail

REPO="${REPO:-d3hospitality/lingua-franca}"
BRANCH="${BRANCH:-main}"
SECRET="${SECRET:-BRANCH_PROTECTION_PAT}"
API="repos/$REPO/branches/$BRANCH/protection/required_status_checks"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }

bold "== set-branch-protection-pat :: verify a token can read $REPO@$BRANCH protection, then store it as $SECRET =="
echo ""

if ! command -v gh >/dev/null 2>&1; then
  yellow "  SKIP  gh CLI not found — install https://cli.github.com then re-run"
  exit 2
fi

VERIFY_ONLY=0
PAT=""
case "${1:-}" in
  --verify-only) VERIFY_ONLY=1 ;;
  "") PAT="${BP_PAT:-}" ;;
  *)  PAT="$1" ;;
esac

# In --verify-only mode we test whatever token the *workflow* would actually use:
# the stored secret value isn't readable back, so fall back to the ambient gh auth
# token as the closest proxy a local operator can check.
if [ "$VERIFY_ONLY" -eq 1 ]; then
  PAT="${BP_PAT:-$(gh auth token 2>/dev/null)}"
fi

# Prompt (hidden) if still empty and we have a TTY.
if [ -z "$PAT" ] && [ "$VERIFY_ONLY" -eq 0 ]; then
  if [ -t 0 ]; then
    printf 'Paste the PAT to store as %s (input hidden): ' "$SECRET"
    read -r -s PAT
    echo ""
  fi
fi

if [ -z "$PAT" ]; then
  yellow "  SKIP  no token supplied — pass it as an arg, set BP_PAT, or run interactively"
  exit 2
fi

# ── Pre-flight: can THIS token read required_status_checks? ───────────────────
bold "  → pre-flighting the token against $API"
RESP="$(GH_TOKEN="$PAT" gh api "$API" 2>/tmp/set-bp-err.$$)"
RC=$?
ERR="$(cat /tmp/set-bp-err.$$ 2>/dev/null)"
rm -f /tmp/set-bp-err.$$

if [ $RC -ne 0 ]; then
  # "Branch not protected"/"Required status checks not enabled" means the token
  # CAN read protection — the gate is just open. That's a real DEAD-gate finding,
  # not a token problem, so the token is fine to store; warn and proceed.
  if printf '%s' "$ERR" | grep -qiE 'Required status checks not enabled|Branch not protected'; then
    yellow "  WARN  token reads protection OK, but $REPO@$BRANCH currently has NO required checks (gate is open)."
    yellow "        Storing the token anyway — fix branch protection separately."
  else
    red "  FAIL  this token CANNOT read branch protection (needs repo-admin + Administration:Read / classic 'repo')."
    printf '         %s\n' "$(printf '%s' "$ERR" | tr '\n' ' ' | cut -c1-160)"
    red "        Nothing stored. The audit would only ever exit 2 with this token."
    exit 1
  fi
else
  PRESENT="$(GH_TOKEN="$PAT" gh api --jq '.contexts | contains(["check-alias-guard"])' "$API" 2>/dev/null)"
  CONTEXTS="$(GH_TOKEN="$PAT" gh api --jq '.contexts | join(", ")' "$API" 2>/dev/null)"
  if [ "$PRESENT" = "true" ]; then
    green "  PASS  token reads protection and 'check-alias-guard' is live (required: $CONTEXTS)"
  else
    yellow "  WARN  token reads protection OK, but 'check-alias-guard' is NOT in required checks (present: ${CONTEXTS:-<none>})."
    yellow "        Token is valid to store; the audit will correctly FAIL (exit 1) until the context is re-added."
  fi
fi

if [ "$VERIFY_ONLY" -eq 1 ]; then
  echo ""
  green "== verify-only: token can read branch protection. (Secret not modified.) =="
  exit 0
fi

# ── Store ─────────────────────────────────────────────────────────────────────
echo ""
bold "  → storing as repo secret $SECRET on $REPO"
if printf '%s' "$PAT" | gh secret set "$SECRET" --repo "$REPO" >/dev/null 2>&1; then
  green "  DONE  $SECRET set. The next branch-protection-audit run will verify the gate (exit 0) instead of exit-2 warning."

  # Record the KIND of token now in the secret as a (readable) repo variable so
  # retire-bootstrap-token.sh can prove the bootstrap was really replaced before
  # anyone revokes it. The secret value can't be read back, but its *prefix*
  # tells us what it is. This is the single chokepoint that writes the secret, so
  # the variable stays truthful for BOTH the mint (fine-grained) and any rollback
  # (bootstrap) path. Best-effort: never fail the store if the variable write does.
  case "$PAT" in
    github_pat_*) KIND="fine-grained" ;;
    gho_*)        KIND="bootstrap" ;;     # the broad gh-CLI OAuth token
    ghp_*)        KIND="classic-pat" ;;
    *)            KIND="unknown" ;;
  esac
  if gh variable set BRANCH_PROTECTION_PAT_KIND --repo "$REPO" --body "$KIND" >/dev/null 2>&1; then
    green "  NOTE  recorded BRANCH_PROTECTION_PAT_KIND=$KIND (lets retire-bootstrap-token.sh gate safely)."
  else
    yellow "  NOTE  could not record BRANCH_PROTECTION_PAT_KIND (need 'variables' write); retire script will fall back to a live audit."
  fi
  echo ""
  green "== branch-protection-audit is now armed with a verified token =="
  exit 0
else
  red "  FAIL  gh secret set failed (no admin on $REPO, or gh not authenticated for secret writes)."
  exit 2
fi
