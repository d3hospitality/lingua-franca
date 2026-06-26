# Minimal Ubuntu image that runs `smoke-test.sh --check-fixture` on real Linux —
# proves the committed long-en.b64 fixture decodes via GNU `base64 -d` and that
# the awk + python3 deps the offline check relies on resolve on a glibc box (not
# just macOS). Build context is lingua-franca-api/.  Build & run:
#   docker build -f scripts/check-fixture.Dockerfile -t lf-check-fixture .
#   docker run --rm lf-check-fixture
# (or just `scripts/check-fixture-linux.sh`, which wraps both steps).
FROM ubuntu:24.04

# bash + coreutils (provides GNU `base64 -d`) ship in the base image; mawk
# provides `awk`. Only python3 must be added — installing exactly what the
# offline fixture check needs and nothing more, so a missing dep fails loudly.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Sanity-fail the build itself if any of the three deps the check uses is absent.
RUN command -v bash && command -v base64 && command -v awk && command -v python3

WORKDIR /app
COPY scripts ./scripts

# Default run executes the offline integrity check; non-zero exit fails CI.
ENTRYPOINT ["bash", "scripts/smoke-test.sh", "--check-fixture"]
