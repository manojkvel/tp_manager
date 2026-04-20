#!/usr/bin/env bash
# TASK-010 — Smoke test: infra_deploys_ok
# Verifies /healthz responds from the public ingress after Bicep deployment.
# PARTIAL — expects STAGING_WEB_FQDN and STAGING_API_BEARER to be set by the deploy workflow.

set -euo pipefail

: "${STAGING_WEB_FQDN:?must be set (e.g., ca-tpstaging-web.happy-sea.canadacentral.azurecontainerapps.io)}"

DEADLINE=$(( $(date +%s) + 180 ))
URL="https://${STAGING_WEB_FQDN}/healthz"

echo "polling $URL"
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  if curl -fsS -m 5 "$URL" | grep -qi 'ok'; then
    echo "PASS $URL"
    exit 0
  fi
  sleep 5
done

echo "FAIL $URL did not return ok within 180s"
exit 1
