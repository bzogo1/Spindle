#!/usr/bin/env bash
# Inject production secrets at container start. The image contains no .env
# file; the deploy identity reads the values from Infisical at runtime.
set -euo pipefail

if [[ "${NODE_ENV:-}" != "production" ]]; then
  exec "$@"
fi

if [[ -z "${INFISICAL_TOKEN:-}" ]]; then
  echo "INFISICAL_TOKEN is required to start in production; the deploy identity reads from the secret store." >&2
  exit 1
fi

# Validate the full production secret contract once the store has injected
# the values, before handing off to the start command. `env:check` only covers
# the optional env schema; `secrets:check` requires every production name.
exec infisical run \
  --projectId="${INFISICAL_PROJECT_ID:?INFISICAL_PROJECT_ID is required}" \
  --env="${SPINDLE_ENV:-prod}" \
  --path="${SPINDLE_SECRETS_PATH:-/app}" \
  -- bash -c 'npm run --silent secrets:check -- --production && exec "$@"' bash "$@"
