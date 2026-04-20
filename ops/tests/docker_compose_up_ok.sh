#!/usr/bin/env bash
# TASK-005 — Smoke test: docker_compose_up_ok
# Acceptance: `docker compose up -d` brings all services healthy within 60s of last start.
# Exits non-zero on any /healthz failure.

set -euo pipefail

cd "$(dirname "$0")/../.."

DEADLINE=$(( $(date +%s) + 120 ))  # 60s start + 60s health ramp
SERVICES=("postgres" "minio" "api" "ml" "aloha-worker" "web")
ENDPOINTS=(
  "http://127.0.0.1:3001/healthz:api"
  "http://127.0.0.1:8000/healthz:ml"
  "http://127.0.0.1:3002/healthz:aloha-worker"
  "http://127.0.0.1:3000/healthz:web"
)

log() { printf "[%s] %s\n" "$(date +%H:%M:%S)" "$*"; }

cleanup() {
  log "tearing down"
  docker compose down -v --remove-orphans || true
}
trap cleanup EXIT

log "starting stack"
docker compose up -d --wait --wait-timeout 120

log "verifying HTTP /healthz on public ports"
for entry in "${ENDPOINTS[@]}"; do
  url="${entry%%:*}"
  name="${entry##*:}"
  status=0
  while [ "$(date +%s)" -lt "$DEADLINE" ]; do
    if curl -fsS -m 3 "$url" > /dev/null 2>&1; then
      status=1
      log "ok  $name  ($url)"
      break
    fi
    sleep 2
  done
  if [ "$status" -ne 1 ]; then
    log "FAIL $name did not return 200 on $url within deadline"
    docker compose ps
    docker compose logs --no-color --tail=200
    exit 1
  fi
done

log "PASS all services healthy"
