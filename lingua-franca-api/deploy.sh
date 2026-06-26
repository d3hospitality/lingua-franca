#!/usr/bin/env bash
# Deploys lingua-franca-api to Vercel production, then runs scripts/smoke-test.sh
# as a post-deploy gate. If any smoke check fails the deploy is reported FAILED
# (non-zero exit) so a broken prod build is caught immediately instead of by users.
#
# Usage:   ./deploy.sh [--skip-smoke]
# Env:     SMOKE_BASE  override the URL the smoke test targets (default: the
#                      production alias resolved from `vercel --prod`).

set -uo pipefail

cd "$(dirname "$0")"

SKIP_SMOKE=0
[ "${1:-}" = "--skip-smoke" ] && SKIP_SMOKE=1

bold()  { printf '\033[1m%s\033[0m\n' "$1"; }
green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }

# ── 1. Deploy to production ───────────────────────────────────────────────────
bold "== lingua-franca-api :: deploy to production =="
DEPLOY_LOG="$(mktemp)"
trap 'rm -f "$DEPLOY_LOG"' EXIT

# Tee so the user sees live output while we also capture the final deployment URL.
if ! npx vercel --prod 2>&1 | tee "$DEPLOY_LOG"; then
  red "✗ vercel --prod failed — aborting before smoke test."
  exit 1
fi

# ── Resolve the base URL the smoke test targets ───────────────────────────────
# Prefer the STABLE PUBLIC production alias over the deployment-specific URL.
# Vercel prints both on a prod deploy:
#   Production   https://<id>-<team>-projects.vercel.app   ← deployment-specific
#   ▲ Aliased    https://lingua-franca-api.vercel.app      ← stable public alias
# The deployment-specific host sits behind Vercel Deployment Protection and
# 302-redirects unauthenticated traffic, so smoke checks against it ALL fail with
# 302 (and that same bad URL would be handed to CI via client_payload, failing the
# smoke-prod gate too). The alias is public. Resolution order:
#   SMOKE_BASE → "▲ Aliased" line → any non-deployment-scoped *.vercel.app →
#   deployment URL → hardcoded default.
ALL_URLS="$(grep -Eo 'https://[A-Za-z0-9.-]+\.vercel\.app' "$DEPLOY_LOG")"
ALIAS_URL="$(grep -i 'alias' "$DEPLOY_LOG" | grep -Eo 'https://[A-Za-z0-9.-]+\.vercel\.app' | tail -n1)"
[ -z "$ALIAS_URL" ] && ALIAS_URL="$(printf '%s\n' "$ALL_URLS" | grep -vE '\-projects\.vercel\.app$' | tail -n1)"
DEPLOY_URL="$(printf '%s\n' "$ALL_URLS" | tail -n1)"
BASE="${SMOKE_BASE:-${ALIAS_URL:-${DEPLOY_URL:-https://lingua-franca-api.vercel.app}}}"

# ── 1b. Assert the alias serves THIS exact build (not a stale healthy one) ────
# Smoking the public alias only proves "the alias serves a healthy build" — it
# could be a prior deployment if Vercel hadn't finished promoting our new build
# to the alias. verify-alias.sh inspects both the just-deployed URL and the alias
# via `vercel inspect --json` and requires their dpl_ ids match, upgrading the
# guarantee to "this exact build is live" before we spend time smoking it.
# Skipped when SMOKE_BASE is a user override (the alias↔deploy link no longer
# applies) or when smoking the raw deployment URL (no alias to verify).
VERIFY_TARGET="${ALIAS_URL:-$BASE}"
# Resolved dpl_ id of the build we just shipped. Captured here so we can hand it to
# CI in the dispatch payload — the smoke-prod-live workflow re-runs the SAME
# alias↔build assertion on a clean Linux runner, and needs this id to know which
# build the alias must be serving. Empty if vercel/python3 are unavailable.
DEPLOY_DPL=""
resolve_dpl() {  # <url-or-dpl> -> deployment id (dpl_…) or empty
  npx --yes vercel inspect "$1" --json 2>/dev/null \
    | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin); print(d.get("id") or d.get("uid") or "")
except Exception:
    print("")' 2>/dev/null
}
if [ -z "${SMOKE_BASE:-}" ] && [ -n "$DEPLOY_URL" ] && printf '%s' "$VERIFY_TARGET" | grep -qvE '\-projects\.vercel\.app$'; then
  echo ""
  DEPLOY_DPL="$(resolve_dpl "$DEPLOY_URL")"
  # Pass the dpl_ id (not the URL) as verify-alias's first arg when we have it:
  # verify-alias accepts a dpl_ ref directly and skips re-inspecting the deploy URL,
  # so the id is resolved exactly once and shared by the local check and the payload.
  ./scripts/verify-alias.sh "${DEPLOY_DPL:-$DEPLOY_URL}" "$VERIFY_TARGET"
  VA_RC=$?
  if [ "$VA_RC" -eq 1 ]; then
    red "✗ Aborting: the alias does not serve the build we just deployed."
    red "  Smoking it would validate a stale deployment. Fix the alias and re-run."
    exit 1
  elif [ "$VA_RC" -ne 0 ]; then
    red "  (verify-alias prereq unavailable — continuing; smoke gate still runs against $BASE)"
  fi
fi

# Notify GitHub Actions that prod was deployed. Vercel deploys here via CLI (no
# GitHub app), so it never emits a deployment_status — this repository_dispatch is
# the signal that re-runs .github/workflows/smoke-prod.yml's LIVE smoke gate on a
# clean Linux runner. Non-fatal: a missing gh / failed dispatch only warns.
#
# We attach a UNIQUE deploy marker (client_payload.deploy_id) so the resulting
# smoke-prod run can PROVE it was triggered by this real deploy and is smoking the
# URL we handed it — not silently falling back to the hardcoded default alias.
# Without it, BASE == the public alias == the workflow's fallback string, so a
# green run is ambiguous: it could mean "the loop works" OR "the dispatch never
# arrived and the daily canary/fallback ran." The marker disambiguates and closes
# the loop the manual `gh api dispatches` simulation could never fully verify.
notify_ci() {
  command -v gh >/dev/null 2>&1 || { red "  (gh not installed — skipping smoke-prod dispatch)"; return; }
  local deploy_id="${DEPLOY_ID:-$(git -C "$(dirname "$0")" rev-parse --short HEAD 2>/dev/null || echo nogit)-$(date -u +%Y%m%dT%H%M%SZ)}"
  if gh api -X POST repos/d3hospitality/lingua-franca/dispatches \
       -f event_type=prod-deployed \
       -f "client_payload[url]=$1" \
       -f "client_payload[deploy_id]=$deploy_id" \
       -f "client_payload[deploy_dpl]=${DEPLOY_DPL:-}" \
       -f "client_payload[source]=deploy.sh" >/dev/null 2>&1; then
    green "  ✓ Notified GitHub Actions (repository_dispatch: prod-deployed → $1)"
    green "    deploy_id=$deploy_id  (find the run: gh run list --workflow=smoke-prod-live.yml)"
    DISPATCHED_DEPLOY_ID="$deploy_id"   # surfaced to caller for run correlation
  else
    red "  (repository_dispatch failed — smoke-prod not auto-triggered; check 'gh auth status')"
  fi
}

if [ "$SKIP_SMOKE" -eq 1 ]; then
  green "✓ Deployed to $BASE (smoke test skipped via --skip-smoke)."
  notify_ci "$BASE"
  exit 0
fi

# ── 2. Post-deploy smoke-test gate ────────────────────────────────────────────
echo ""
bold "== post-deploy smoke gate :: $BASE =="
if ./scripts/smoke-test.sh "$BASE"; then
  echo ""
  green "✓ Deploy + smoke gate PASSED — production is live and healthy."
  notify_ci "$BASE"
  exit 0
else
  echo ""
  red "✗ Smoke gate FAILED on $BASE — production deploy is suspect."
  red "  The code is live but failing checks. Investigate or roll back:"
  red "    npx vercel rollback"
  exit 1
fi
