#!/usr/bin/env bash
# Asserts the public production alias actually resolves to the EXACT deployment id
# that this deploy just produced — closing the "alias serves a healthy build, but
# is it THIS build?" gap. Without this, deploy.sh smokes the public alias and a
# green run only proves "the alias serves a healthy build" — it could be a stale
# (but still healthy) prior deployment if alias promotion lagged or silently
# failed. This check upgrades the guarantee to "this exact build is live."
#
# Mechanism: `vercel inspect <url> --json` returns the deployment's `id` (dpl_…).
# We inspect the just-deployed URL to learn its dpl_ id, then inspect the public
# alias to learn which dpl_ the alias currently serves, and require they match.
# Alias promotion can lag a few seconds after `vercel --prod` returns, so we poll.
#
# Usage:   ./scripts/verify-alias.sh <deploy-url-or-dpl-id> <alias-url> [opts]
#          --retries N   alias-resolution attempts before giving up (default 6)
#          --delay S     seconds between attempts                    (default 5)
# Exit:    0 = alias resolves to this exact build (safe to smoke)
#          1 = alias serves a DIFFERENT deployment (this build is NOT live)
#          2 = prerequisite failure (no vercel/python3, or id unresolvable)

set -uo pipefail
cd "$(dirname "$0")/.."

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }
dim()   { printf '\033[2m%s\033[0m\n' "$1"; }

DEPLOY_REF="${1:-}"
ALIAS_URL="${2:-}"
RETRIES=6
DELAY=5
shift $(( $# >= 2 ? 2 : $# )) 2>/dev/null || true
while [ $# -gt 0 ]; do
  case "$1" in
    --retries) RETRIES="${2:-6}"; shift 2 ;;
    --delay)   DELAY="${2:-5}";   shift 2 ;;
    *) red "verify-alias: unknown arg '$1'"; exit 2 ;;
  esac
done

if [ -z "$DEPLOY_REF" ] || [ -z "$ALIAS_URL" ]; then
  red "verify-alias: usage: verify-alias.sh <deploy-url-or-dpl-id> <alias-url> [--retries N] [--delay S]"
  exit 2
fi

command -v python3 >/dev/null 2>&1 || { red "verify-alias: python3 required to parse vercel JSON — skipping (treat as prereq fail)"; exit 2; }
command -v npx     >/dev/null 2>&1 || { red "verify-alias: npx/vercel unavailable — cannot inspect deployments"; exit 2; }

# Pull the deployment id (dpl_…) for a URL via `vercel inspect --json`. Vercel
# accepts a deployment URL OR an alias/custom domain and resolves it to the
# deployment currently behind it, so the SAME call works for both sides of the
# comparison. Returns empty string on any failure (caller decides severity).
inspect_id() {
  npx --yes vercel inspect "$1" --json 2>/dev/null \
    | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin)
    print(d.get("id") or d.get("uid") or "")
except Exception:
    print("")' 2>/dev/null
}

bold "== verify-alias :: does the public alias serve THIS exact build? =="
dim  "   alias=$ALIAS_URL"

# ── Resolve the just-deployed deployment id ───────────────────────────────────
if printf '%s' "$DEPLOY_REF" | grep -qE '^dpl_'; then
  DEPLOY_ID="$DEPLOY_REF"            # caller already had the dpl_ id (e.g. --json deploy)
else
  DEPLOY_ID="$(inspect_id "$DEPLOY_REF")"
fi
if [ -z "$DEPLOY_ID" ]; then
  red "  ✗ Could not resolve the deployment id for '$DEPLOY_REF' via vercel inspect."
  red "    Cannot prove this build is live — failing prereq (exit 2)."
  exit 2
fi
dim "   this build = $DEPLOY_ID"

# ── Poll the alias until it resolves to our id (promotion can lag a few s) ─────
# Track whether we ever got a CONCRETE alias id. If every attempt comes back empty
# the alias was never inspectable (no vercel auth/scope, network, bad URL) — that's
# a prerequisite failure (exit 2), NOT proof of a stale build (exit 1). The
# distinction matters for callers that treat 1 as fatal-abort but 2 as warn-and-
# continue (deploy.sh and the CI smoke gate both do): a token-scope hiccup must not
# masquerade as "the alias serves the wrong build".
attempt=1
saw_concrete_id=0
while [ "$attempt" -le "$RETRIES" ]; do
  ALIAS_ID="$(inspect_id "$ALIAS_URL")"
  [ -n "$ALIAS_ID" ] && saw_concrete_id=1
  if [ -n "$ALIAS_ID" ] && [ "$ALIAS_ID" = "$DEPLOY_ID" ]; then
    green "  ✓ Alias resolves to $ALIAS_ID — this exact build is LIVE. Safe to smoke."
    exit 0
  fi
  if [ "$attempt" -lt "$RETRIES" ]; then
    dim "   [$attempt/$RETRIES] alias serves ${ALIAS_ID:-<unresolved>} ≠ $DEPLOY_ID — waiting ${DELAY}s for promotion…"
    sleep "$DELAY"
  fi
  attempt=$((attempt+1))
done

if [ "$saw_concrete_id" -eq 0 ]; then
  red "  ✗ Could not resolve the alias '$ALIAS_URL' to any deployment id across $RETRIES attempts."
  red "    vercel inspect returned nothing every time (auth/scope/network?) — cannot"
  red "    prove the alias↔build link either way. Treating as prereq failure (exit 2)."
  exit 2
fi

red "  ✗ Alias serves ${ALIAS_ID:-<unresolved>}, but this deploy is $DEPLOY_ID."
red "    The public alias is NOT pointing at the build we just shipped — smoking it"
red "    would test a stale deployment. Promote it explicitly, then re-verify:"
red "      npx vercel alias set $DEPLOY_ID ${ALIAS_URL#https://}"
exit 1
