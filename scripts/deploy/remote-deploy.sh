#!/usr/bin/env bash
# Runs ON the staging host, not in CI. The deploy workflow uploads this script
# next to compose.yaml and invokes it over SSH:
#
#   ssh "$STAGING_USER@$STAGING_HOST" \
#     "bash $STAGING_ROOT/deploy/remote-deploy.sh '$APP_IMAGE' '$WORKER_IMAGE' '$STAGING_ROOT'"
#
# Arguments:
#   $1  fully-qualified app image reference (registry/repo:tag)
#   $2  fully-qualified worker image reference (registry/repo:tag)
#   $3  stack root on the host (default: /srv/spindle-staging)
#
# The script never touches host.env contents; compose reads it via --env-file.
# Image tags are immutable (ADR 0001), so a redeploy of the same tag is safe.
set -euo pipefail

APP_IMAGE="${1:?usage: remote-deploy.sh <app-image> <worker-image> [stack-root]}"
WORKER_IMAGE="${2:?usage: remote-deploy.sh <app-image> <worker-image> [stack-root]}"
STACK_ROOT="${3:-/srv/spindle-staging}"

cd "$STACK_ROOT"

if [[ ! -f compose.yaml ]]; then
  echo "Missing $STACK_ROOT/compose.yaml — upload it before deploying." >&2
  exit 1
fi

if [[ ! -f host.env ]]; then
  echo "Missing $STACK_ROOT/host.env on the staging host." >&2
  exit 1
fi

# Fail before pulling anything if the stack cannot interpolate its variables.
docker compose --env-file host.env config --quiet

export SPINDLE_APP_IMAGE="$APP_IMAGE"
export SPINDLE_WORKER_IMAGE="$WORKER_IMAGE"

docker compose --env-file host.env pull app worker
docker compose --env-file host.env up -d --remove-orphans --wait
docker compose --env-file host.env ps
