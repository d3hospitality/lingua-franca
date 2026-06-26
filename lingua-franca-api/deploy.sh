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

# Notify GitHub Actions that prod was deployed. Vercel deploys here via CLI (no
# GitHub app), so it never emits a deployment_status — this repository_dispatch is
# the signal that re-runs .github/workflows/smoke-prod.yml's LIVE smoke gate on a
# clean Linux runner. Non-fatal: a missing gh / failed dispatch only warns.
notify_ci() {
  command -v gh >/dev/null 2>&1 || { red "  (gh not installed — skipping smoke-prod dispatch)"; return; }
  if gh api -X POST repos/d3hospitality/lingua-franca/dispatches \
       -f event_type=prod-deployed -f "client_payload[url]=$1" >/dev/null 2>&1; then
    green "  ✓ Notified GitHub Actions (repository_dispatch: prod-deployed → $1)"
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
