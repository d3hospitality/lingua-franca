#!/usr/bin/env bash
# One-shot guided wizard for ROTATE-BRANCH-PROTECTION-PAT.md.
#
# Minting a fine-grained PAT is the ONE step an agent cannot do — GitHub only
# mints them in the web UI behind a human consent click. This wizard shrinks that
# human action to its irreducible core (click "Generate", copy, paste) and
# automates everything around it: it prints the exact field values, opens the mint
# page, then chains the runbook's step 2 (pre-flight, no write), step 3 (verify-
# then-store), and step 4 (dispatch the audit and assert a REAL gate PASS) — each
# reusing the single token you paste, so you are never prompted twice.
#
# It writes the secret ONLY if the pasted token genuinely reads branch protection
# (set-branch-protection-pat.sh re-pre-flights before storing), and it confirms
# the rotation by reading the audit LOG, not just its conclusion — so a neutered
# token can never masquerade as a green run. Nothing is stored on any failure.
#
# Usage:
#   ./scripts/mint-branch-protection-pat.sh             # full guided flow (open page, paste, store, confirm)
#   ./scripts/mint-branch-protection-pat.sh --no-open   # don't launch a browser; just print the URL
#   ./scripts/mint-branch-protection-pat.sh --no-confirm# store but skip the step-4 audit dispatch
#
# Env:  REPO   (default d3hospitality/lingua-franca)
#       OWNER  (default d3hospitality — the resource owner the PAT must be scoped to)
# Exit: 0 = token minted, verified, stored, and the gate re-verified (or --no-confirm)
#       1 = pasted token cannot read branch protection — nothing stored, re-mint it
#       2 = inconclusive: gh missing/unauth, no token pasted, or the audit timed out

set -uo pipefail

REPO="${REPO:-d3hospitality/lingua-franca}"
OWNER="${OWNER:-d3hospitality}"
TOKEN_NAME="lingua-franca-branch-protection-audit"
MINT_URL="https://github.com/settings/personal-access-tokens/new"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }
dim()   { printf '\033[2m%s\033[0m\n' "$1"; }

NO_OPEN=0
NO_CONFIRM=0
for arg in "$@"; do
  case "$arg" in
    --no-open)    NO_OPEN=1 ;;
    --no-confirm) NO_CONFIRM=1 ;;
    -h|--help)    grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) red "  unknown arg: $arg (try --help)"; exit 2 ;;
  esac
done

if ! command -v gh >/dev/null 2>&1; then
  yellow "  SKIP  gh CLI not found — install https://cli.github.com then re-run"
  exit 2
fi

bold "== mint-branch-protection-pat :: guided least-privilege rotation for $REPO =="
echo ""
bold "Step 1 — mint the fine-grained PAT (the only part only a human can do)."
echo "  At the page that's about to open, set EXACTLY these and nothing else:"
echo ""
printf '    Token name ........ %s\n' "$TOKEN_NAME"
printf '    Resource owner .... %s   (the org — NOT your personal account)\n' "$OWNER"
printf '    Expiration ........ 90 days\n'
printf '    Repository access . Only select repositories -> %s\n' "$REPO"
printf '    Permissions ....... Repository -> Administration -> Read-only  (Metadata auto-adds)\n'
echo ""
dim  "  You must be an ADMIN of $REPO or the token cannot read protection (pre-flight will catch it)."
echo ""

if [ "$NO_OPEN" -eq 0 ]; then
  if command -v open >/dev/null 2>&1; then
    open "$MINT_URL" 2>/dev/null && green "  → opened $MINT_URL in your browser" || yellow "  (could not auto-open) $MINT_URL"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$MINT_URL" 2>/dev/null && green "  → opened $MINT_URL" || yellow "  (could not auto-open) $MINT_URL"
  else
    yellow "  Open this manually: $MINT_URL"
  fi
else
  echo "  Open this manually: $MINT_URL"
fi
echo ""

# ── Capture the pasted token once; reuse it for every downstream step ─────────
if [ ! -t 0 ]; then
  yellow "  SKIP  no TTY to read the pasted token — run this in an interactive shell."
  exit 2
fi
printf 'Step 2 — paste the github_pat_… token here (input hidden), then press Enter: '
read -r -s BP_PAT
echo ""
echo ""

if [ -z "${BP_PAT:-}" ]; then
  yellow "  SKIP  no token pasted — nothing to do."
  exit 2
fi
if ! printf '%s' "$BP_PAT" | grep -q '^github_pat_'; then
  yellow "  NOTE  that doesn't look like a fine-grained PAT (expected to start with github_pat_)."
  yellow "        Continuing anyway — the pre-flight is the real gate."
  echo ""
fi
export BP_PAT

# ── Step 2 — pre-flight (no write) ────────────────────────────────────────────
bold "Pre-flighting the token (no write) …"
if ! REPO="$REPO" "$DIR/set-branch-protection-pat.sh" --verify-only; then
  rc=$?
  echo ""
  red "  Pre-flight failed (exit $rc). Nothing stored. Re-mint with Administration:Read-only as a repo admin."
  unset BP_PAT
  exit "$rc"
fi
echo ""

# ── Step 3 — verify-then-store (atomic; re-pre-flights internally) ────────────
bold "Storing the verified token as the BRANCH_PROTECTION_PAT secret …"
if ! REPO="$REPO" "$DIR/set-branch-protection-pat.sh"; then
  rc=$?
  echo ""
  red "  Store failed (exit $rc). Secret unchanged."
  unset BP_PAT
  exit "$rc"
fi
unset BP_PAT
echo ""

# ── Step 4 — confirm the gate really re-verifies with the new token ───────────
if [ "$NO_CONFIRM" -eq 1 ]; then
  yellow "  --no-confirm: skipping the step-4 audit dispatch. Run ./scripts/confirm-rotation.sh yourself."
  green  "== token minted, verified, and stored. =="
  exit 0
fi

bold "Confirming the gate re-verifies with the rotated token (dispatches the audit) …"
if "$DIR/confirm-rotation.sh"; then
  echo ""
  green "== ROTATION COMPLETE — least-privilege PAT stored and the gate re-verified end-to-end. =="
  green "   The bootstrap token can now be retired. Re-run this wizard when the 90-day PAT lapses."
  exit 0
else
  rc=$?
  echo ""
  red  "  Step-4 confirmation failed (exit $rc): the audit did NOT show a real gate PASS with the new token."
  red  "  ROLL BACK now:  BP_PAT=\"\$(gh auth token)\" $DIR/set-branch-protection-pat.sh"
  exit "$rc"
fi
