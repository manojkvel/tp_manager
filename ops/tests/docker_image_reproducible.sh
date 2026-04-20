#!/usr/bin/env bash
# TASK-006 — Smoke test: docker_image_reproducible
# Build each service image twice with the same source tree; compare digests.
# Used in CI on unchanged source to verify deterministic builds (AD-10).

set -euo pipefail

cd "$(dirname "$0")/../.."

services=(
  "api:apps/api/Dockerfile"
  "web:apps/web/Dockerfile"
  "aloha-worker:apps/aloha-worker/Dockerfile"
  "ml:services/ml/Dockerfile"
)

fail=0

for entry in "${services[@]}"; do
  name="${entry%%:*}"
  dockerfile="${entry##*:}"

  tag_a="tp/$name:repro-a"
  tag_b="tp/$name:repro-b"

  echo "==> building $name (first pass)"
  DOCKER_BUILDKIT=1 SOURCE_DATE_EPOCH=0 docker build \
    --provenance=false \
    --build-arg SOURCE_DATE_EPOCH=0 \
    -f "$dockerfile" -t "$tag_a" . > /dev/null

  echo "==> building $name (second pass)"
  DOCKER_BUILDKIT=1 SOURCE_DATE_EPOCH=0 docker build \
    --provenance=false \
    --build-arg SOURCE_DATE_EPOCH=0 \
    -f "$dockerfile" -t "$tag_b" . > /dev/null

  digest_a=$(docker inspect --format '{{.Id}}' "$tag_a")
  digest_b=$(docker inspect --format '{{.Id}}' "$tag_b")

  if [ "$digest_a" = "$digest_b" ]; then
    echo "PASS $name  digest=$digest_a"
  else
    echo "FAIL $name  a=$digest_a  b=$digest_b"
    fail=1
  fi
done

exit $fail
