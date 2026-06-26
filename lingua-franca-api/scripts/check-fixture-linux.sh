#!/usr/bin/env bash
# One command to run smoke-test.sh --check-fixture inside an ACTUAL Linux
# container — confirms the base64 -d fallback + awk/python3 deps resolve on a
# real glibc box, not just macOS. Needs Docker (or Podman) on the host.
# Usage:  ./scripts/check-fixture-linux.sh
set -uo pipefail
cd "$(dirname "$0")/.."

ENGINE=""
for e in docker podman; do command -v "$e" >/dev/null 2>&1 && { ENGINE="$e"; break; }; done
if [ -z "$ENGINE" ]; then
  echo "ERROR: no container engine found (need docker or podman)." >&2
  echo "       The check itself is in scripts/check-fixture.Dockerfile;" >&2
  echo "       CI runs it on ubuntu-latest via .github/workflows/fixture-check.yml." >&2
  exit 2
fi

echo "== building Linux fixture-check image with $ENGINE =="
"$ENGINE" build -f scripts/check-fixture.Dockerfile -t lf-check-fixture . || exit 1

echo "== running --check-fixture inside Ubuntu container =="
"$ENGINE" run --rm lf-check-fixture
RC=$?
[ "$RC" -eq 0 ] && echo "== Linux container fixture check PASSED ==" \
                || echo "== Linux container fixture check FAILED (rc=$RC) =="
exit $RC
