#!/usr/bin/env bash
# Step 5 of ROTATE-BRANCH-PROTECTION-PAT.md — the mission's FINAL clause made
# executable: retire the broad bootstrap token, but ONLY once it is provably safe.
#
# WHY THIS EXISTS (the footgun this guards):
#   The whole rotation exists to stop the branch-protection-audit gate from
#   running on a broad `repo+workflow` bootstrap token. The last step is to
#   retire that bootstrap. But retiring it BEFORE the fine-grained PAT is actually
#   in the secret AND proven to work would silently break the gate: the audit
#   would lose its credential, fall to check-branch-protection.sh's exit-2 NEUTRAL
#   warning, and keep showing conclusion=success while verifying NOTHING (the same
#   silent-pass failure confirm-rotation.sh was written to catch). The recorded
#   ops rule has been "don't revoke the bootstrap token yet" — this script makes
#   that rule executable so neither a human nor an agent can jump the gun.
#
# THE SAFETY GATE (all must hold before it greenlights retirement):
#   1. The repo variable BRANCH_PROTECTION_PAT_KIND == "fine-grained".
#      set-branch-protection-pat.sh (the single secret-write chokepoint) records
#      this from the stored token's prefix, so it is truthful for both the mint
#      and any rollback. If it's still "bootstrap"/unset, the FG-PAT was never
#      stored — retiring now would strand the gate. EXIT 1.
#   2. A LIVE branch-protection-audit really re-verifies the gate right now
#      (delegated to confirm-rotation.sh, which inspects the log, not just the
#      conclusion). This proves the *currently stored* secret reads protection
#      independently of your local gh auth. If it can't, EXIT 1 — do NOT retire.
#   Only when BOTH pass does it print the precise, token-type-aware retire steps.
#
# This script never revokes anything itself (revoking a credential is irreversible
# and GitHub gates it behind the web UI / a human confirm) — it is the gate plus
# the exact instructions, so the irreducible human click is all that's left.
#
# Usage:
#   ./scripts/retire-bootstrap-token.sh            # full gate: kind-check + live audit, then guidance
#   ./scripts/retire-bootstrap-token.sh --check    # readiness only: report safe/not-safe, no audit dispatch
#   ./scripts/retire-bootstrap-token.sh --no-confirm  # trust the recorded kind; skip the live audit dispatch
#
# Env:  REPO  (default d3hospitality/lingua-franca)
# Exit: 0 = SAFE to retire — FG-PAT is in the secret and the gate re-verified; steps printed
#       1 = NOT safe yet — bootstrap is still load-bearing; do NOT retire (run the mint wizard first)
#       2 = inconclusive: gh missing/unauth, or the live audit could not complete

set -uo pipefail

REPO="${REPO:-d3hospitality/lingua-franca}"
KIND_VAR="BRANCH_PROTECTION_PAT_KIND"
SECRET="BRANCH_PROTECTION_PAT"
TOKENS_URL="https://github.com/settings/tokens"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }
dim()   { printf '\033[2m%s\033[0m\n' "$1"; }

CHECK_ONLY=0
NO_CONFIRM=0
for arg in "$@"; do
  case "$arg" in
    --check)      CHECK_ONLY=1 ;;
    --no-confirm) NO_CONFIRM=1 ;;
    -h|--help)    grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) red "  unknown arg: $arg (try --help)"; exit 2 ;;
  esac
done

bold "== retire-bootstrap-token :: only greenlight once the FG-PAT is provably live on $REPO =="
echo ""

if ! command -v gh >/dev/null 2>&1; then
  yellow "  SKIP  gh CLI not found — install https://cli.github.com then re-run"
  exit 2
fi
if ! gh auth status >/dev/null 2>&1; then
  yellow "  SKIP  gh not authenticated — run 'gh auth login' then re-run"
  exit 2
fi

# ── Gate 1: what kind of token is actually in the secret right now? ────────────
bold "Gate 1 — is the secret the fine-grained PAT (not the bootstrap)?"
KIND="$(gh variable get "$KIND_VAR" --repo "$REPO" 2>/dev/null)"
if [ -z "$KIND" ]; then
  yellow "  UNKNOWN  $KIND_VAR is unset — the secret was last written before kind-tracking, or vars aren't readable."
  yellow "           Cannot prove the bootstrap was replaced. Re-store via the mint wizard to stamp the kind:"
  yellow "             ./scripts/mint-branch-protection-pat.sh"
  red    "  NOT SAFE to retire — the FG-PAT is not provably in $SECRET."
  exit 1
fi
echo "  $KIND_VAR = $KIND"
if [ "$KIND" != "fine-grained" ]; then
  red "  NOT SAFE — $SECRET still holds a '$KIND' token. The bootstrap is still the gate's credential."
  red "  Mint + store the least-privilege PAT first, THEN retire:"
  red "    ./scripts/mint-branch-protection-pat.sh"
  exit 1
fi
green "  PASS  $SECRET holds a fine-grained PAT."
echo ""

# ── Gate 2: prove the stored FG-PAT really re-verifies the gate, live ─────────
if [ "$CHECK_ONLY" -eq 1 ] || [ "$NO_CONFIRM" -eq 1 ]; then
  yellow "  (skipping the live audit: $([ "$CHECK_ONLY" -eq 1 ] && echo --check || echo --no-confirm))"
  yellow "  Recommended before retiring:  ./scripts/confirm-rotation.sh"
else
  bold "Gate 2 — dispatching a live branch-protection-audit to prove the stored FG-PAT verifies the gate…"
  if ! "$DIR/confirm-rotation.sh"; then
    rc=$?
    echo ""
    red "  NOT SAFE — the live audit did not prove a real gate verification (confirm-rotation exit $rc)."
    red "  Do NOT retire the bootstrap. Investigate or roll back before touching the bootstrap token."
    exit 1
  fi
  echo ""
fi

# ── Both gates passed: it is safe. Emit precise, token-type-aware retire steps. ─
green "== SAFE TO RETIRE — the fine-grained PAT is stored and the gate re-verifies. =="
echo ""
bold "What 'the broad bootstrap token' is, and how to retire it:"
ACTIVE="$(gh auth token 2>/dev/null)"
case "$ACTIVE" in
  ghp_*)
    echo "  Your active gh credential is a CLASSIC PAT (ghp_…) with broad scope."
    echo "  It was the bootstrap that seeded $SECRET. Now that the FG-PAT owns the gate,"
    echo "  revoke (or scope down) this classic PAT:"
    echo "    1. Open: $TOKENS_URL"
    echo "    2. Find the broad token used to bootstrap branch-protection-audit."
    echo "    3. Delete it, or regenerate it with only the scopes other workflows still need."
    dim   "    (After deleting, re-auth gh for unrelated work: gh auth login)"
    ;;
  gho_*)
    echo "  Your active gh credential is the gh-CLI OAuth login (gho_…), NOT a hand-minted"
    echo "  classic PAT. The 'broad bootstrap token' that seeded $SECRET was this OAuth token's"
    echo "  value. The gate no longer uses it (the FG-PAT replaced it in the secret), so there is"
    echo "  no separate credential to revoke — retirement here means: confirmed, the secret is"
    echo "  off the broad token. Do NOT 'gh auth logout' just for this; it only breaks local gh."
    yellow "  If a separate broad CLASSIC PAT was minted as the bootstrap, revoke it at $TOKENS_URL."
    ;;
  *)
    echo "  Could not read the active gh token type. Manually retire whatever broad token"
    echo "  seeded $SECRET at: $TOKENS_URL"
    ;;
esac
echo ""
green "  Bootstrap retirement is now safe to complete. Re-run the mint wizard when the 90-day PAT lapses."
exit 0
