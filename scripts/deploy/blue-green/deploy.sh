#!/usr/bin/env bash
# Blue-green deployer for the Spindle origin (ADR 0001).
#
# Ships a built artifact to the inactive slot, health-checks it, flips the
# `current` symlink (and any configured switch command), health-checks the
# public endpoint, and reverts automatically when the post-switch check fails.
#
# The script is transport-agnostic: it owns the slot directories and the
# `current` symlink. Anything that actually steers traffic — a web server
# resolving through the symlink, a Caddy/nginx upstream rewrite, or a
# cloudflared ingress change — is delegated to the *_COMMAND hooks below.
# See docs/deploy/blue-green.md for the mapping onto infra/origin.
#
# Usage:
#
#   SPINDLE_BG_SOURCE_DIR=/srv/spindle/build/out \
#   SPINDLE_BG_HEALTH_URL=https://app.spindle.app/healthz \
#   ./scripts/deploy/blue-green/deploy.sh [--dry-run] [--slot blue|green]
#
# All targets are env-configured; see deploy.env.example next to this file.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

DRY_RUN=0
SLOT_OVERRIDE=""

usage() {
  cat <<'EOF'
Usage: deploy.sh [--dry-run] [--slot blue|green] [--help]

Blue-green deploy for the Spindle origin. See deploy.env.example and
docs/deploy/blue-green.md for the full configuration surface.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --slot)
      SLOT_OVERRIDE=${2:?--slot requires blue or green}
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

# --- Configuration (all overridable via environment) ------------------------

SPINDLE_BG_ROOT=${SPINDLE_BG_ROOT:-/srv/spindle/releases}
SPINDLE_BG_CURRENT_LINK=${SPINDLE_BG_CURRENT_LINK:-${SPINDLE_BG_ROOT}/current}
SPINDLE_BG_SOURCE_DIR=${SPINDLE_BG_SOURCE_DIR:-}
SPINDLE_BG_RELEASE_ID=${SPINDLE_BG_RELEASE_ID:-$(date -u +%Y%m%d%H%M%S)}
SPINDLE_BG_EXTRA_RSYNC_EXCLUDES=${SPINDLE_BG_EXTRA_RSYNC_EXCLUDES:-}
SPINDLE_BG_HEALTH_TIMEOUT=${SPINDLE_BG_HEALTH_TIMEOUT:-90}
SPINDLE_BG_HEALTH_INTERVAL=${SPINDLE_BG_HEALTH_INTERVAL:-2}
SPINDLE_BG_HEALTH_CURL_TIMEOUT=${SPINDLE_BG_HEALTH_CURL_TIMEOUT:-5}

# Per-slot health URLs are checked *before* the switch; the slot being
# deployed must already be serving on its own address (loopback port,
# internal hostname, or a slot-specific path). Leave unset to skip.
SPINDLE_BG_HEALTH_URL_BLUE=${SPINDLE_BG_HEALTH_URL_BLUE:-}
SPINDLE_BG_HEALTH_URL_GREEN=${SPINDLE_BG_HEALTH_URL_GREEN:-}

# Public endpoint checked *after* the switch. Required unless the operator
# disables health checks deliberately.
SPINDLE_BG_HEALTH_URL=${SPINDLE_BG_HEALTH_URL:-}

# Optional hooks, run through `bash -c`. Keep them idempotent: the switch
# command runs again during an automatic revert.
#   PRE_SWITCH:   start/prepare the target slot's server (e.g. compose up).
#   SWITCH:       steer traffic to the new slot (upstream rewrite + reload).
#   POST_SWITCH:  settle steps after the switch (cache purge, metrics).
SPINDLE_BG_PRE_SWITCH_COMMAND=${SPINDLE_BG_PRE_SWITCH_COMMAND:-}
SPINDLE_BG_SWITCH_COMMAND=${SPINDLE_BG_SWITCH_COMMAND:-}
SPINDLE_BG_POST_SWITCH_COMMAND=${SPINDLE_BG_POST_SWITCH_COMMAND:-}

log() { printf '==> %s\n' "$*"; }
warn() { printf 'WARN: %s\n' "$*" >&2; }
die() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

# run CMD... — prints instead of executing under --dry-run.
run() {
  if [[ ${DRY_RUN} -eq 1 ]]; then
    printf '+ '
    printf '%q ' "$@"
    printf '\n'
  else
    "$@"
  fi
}

# run_shell CMD — same for hook strings evaluated by bash -c.
run_shell() {
  local cmd=$1
  if [[ ${DRY_RUN} -eq 1 ]]; then
    printf '+ bash -c %q\n' "${cmd}"
  else
    bash -c "${cmd}"
  fi
}

# health_check URL — polls until the URL answers with a non-error status.
health_check() {
  local url=$1 label=$2
  if [[ ${DRY_RUN} -eq 1 ]]; then
    printf '+ curl -fsS -o /dev/null -m %s %q   # poll until healthy (timeout %ss)\n' \
      "${SPINDLE_BG_HEALTH_CURL_TIMEOUT}" "${url}" "${SPINDLE_BG_HEALTH_TIMEOUT}"
    return 0
  fi
  local deadline=$((SECONDS + SPINDLE_BG_HEALTH_TIMEOUT))
  local attempt=0

  while ((SECONDS < deadline)); do
    attempt=$((attempt + 1))
    if curl -fsS -o /dev/null -m "${SPINDLE_BG_HEALTH_CURL_TIMEOUT}" "${url}" 2>/dev/null; then
      log "${label} healthy after ${attempt} attempt(s): ${url}"
      return 0
    fi
    sleep "${SPINDLE_BG_HEALTH_INTERVAL}"
  done

  warn "${label} did not become healthy within ${SPINDLE_BG_HEALTH_TIMEOUT}s: ${url}"
  return 1
}

# slot_health_url SLOT — resolves the pre-switch health URL for a slot.
slot_health_url() {
  case "$1" in
    blue) printf '%s' "${SPINDLE_BG_HEALTH_URL_BLUE}" ;;
    green) printf '%s' "${SPINDLE_BG_HEALTH_URL_GREEN}" ;;
    *) return 1 ;;
  esac
}

# active_slot — prints blue or green based on the `current` symlink.
active_slot() {
  local target
  if [[ -L ${SPINDLE_BG_CURRENT_LINK} ]]; then
    target=$(basename "$(readlink "${SPINDLE_BG_CURRENT_LINK}")")
  else
    target=""
  fi
  case "${target}" in
    blue|green) printf '%s' "${target}" ;;
    *) printf 'blue' ;; # first deploy: blue is the implicit active slot
  esac
}

other_slot() {
  case "$1" in
    blue) printf 'green' ;;
    green) printf 'blue' ;;
    *) die "invalid slot: $1" ;;
  esac
}

point_current_at() {
  local slot=$1
  # Atomic switch: build the link under a temp name, then rename over `current`.
  local tmp="${SPINDLE_BG_CURRENT_LINK}.tmp.$$"
  ln -sfn "${slot}" "${tmp}"
  mv -T "${tmp}" "${SPINDLE_BG_CURRENT_LINK}"
}

# --- Main -------------------------------------------------------------------

if [[ ${DRY_RUN} -eq 1 ]]; then
  log "DRY RUN — no files or commands will be changed"
fi

PREVIOUS_SLOT=$(active_slot)
TARGET_SLOT=${SLOT_OVERRIDE:-$(other_slot "${PREVIOUS_SLOT}")}

case "${TARGET_SLOT}" in
  blue|green) ;;
  *) die "slot must be blue or green, got: ${TARGET_SLOT}" ;;
esac

if [[ "${TARGET_SLOT}" == "${PREVIOUS_SLOT}" && -z ${SLOT_OVERRIDE} ]]; then
  die "target slot equals the active slot (${TARGET_SLOT}); pass --slot to force"
fi

log "Active slot: ${PREVIOUS_SLOT} -> deploying to: ${TARGET_SLOT}"
log "Release id: ${SPINDLE_BG_RELEASE_ID}"

# 1. Sync the built artifact into the target slot.
if [[ -z ${SPINDLE_BG_SOURCE_DIR} ]]; then
  die "SPINDLE_BG_SOURCE_DIR is not set (the directory holding the built artifact)"
fi

RSYNC_ARGS=(-a --delete --human-readable)
if [[ ${DRY_RUN} -eq 1 ]]; then
  RSYNC_ARGS+=(-n -i)
fi
if [[ -n ${SPINDLE_BG_EXTRA_RSYNC_EXCLUDES} ]]; then
  # shellcheck disable=SC2206
  RSYNC_ARGS+=(${SPINDLE_BG_EXTRA_RSYNC_EXCLUDES})
fi

SLOT_DIR="${SPINDLE_BG_ROOT}/${TARGET_SLOT}"
log "Syncing ${SPINDLE_BG_SOURCE_DIR}/ -> ${SLOT_DIR}/"
if [[ ${DRY_RUN} -eq 1 ]]; then
  printf '+ rsync'
  printf ' %q' "${RSYNC_ARGS[@]}"
  printf ' %q %q\n' "${SPINDLE_BG_SOURCE_DIR}/" "${SLOT_DIR}/"
else
  mkdir -p "${SLOT_DIR}"
  rsync "${RSYNC_ARGS[@]}" "${SPINDLE_BG_SOURCE_DIR}/" "${SLOT_DIR}/"
  printf '%s\n' "${SPINDLE_BG_RELEASE_ID}" >"${SLOT_DIR}/.release-id"
fi

# 2. Prepare and health-check the target slot before any traffic moves.
if [[ -n ${SPINDLE_BG_PRE_SWITCH_COMMAND} ]]; then
  log "Running pre-switch command"
  run_shell "${SPINDLE_BG_PRE_SWITCH_COMMAND}"
fi

PRE_URL=$(slot_health_url "${TARGET_SLOT}")
if [[ -n ${PRE_URL} ]]; then
  log "Health-checking target slot before switch"
  health_check "${PRE_URL}" "target slot" || die "target slot failed its pre-switch health check; aborting before any traffic moves"
else
  warn "no SPINDLE_BG_HEALTH_URL_${TARGET_SLOT^^} set; skipping pre-switch health check"
fi

# 3. Switch traffic.
log "Switching ${SPINDLE_BG_CURRENT_LINK} -> ${TARGET_SLOT}"
if [[ ${DRY_RUN} -eq 0 ]]; then
  point_current_at "${TARGET_SLOT}"
else
  printf '+ ln -sfn %q %q.tmp.$$ && mv -T %q.tmp.$$ %q\n' \
    "${TARGET_SLOT}" "${SPINDLE_BG_CURRENT_LINK}" "${SPINDLE_BG_CURRENT_LINK}" "${SPINDLE_BG_CURRENT_LINK}"
fi
SWITCH_OK=1
if [[ -n ${SPINDLE_BG_SWITCH_COMMAND} ]]; then
  log "Running switch command"
  if ! run_shell "${SPINDLE_BG_SWITCH_COMMAND}"; then
    warn "switch command failed; reverting without trusting the endpoint check"
    SWITCH_OK=0
  fi
fi

# 4. Verify the public endpoint. When the switch command failed we do NOT
# trust the endpoint check: it could still be answering from the old slot,
# which would mask the failed switch. Go straight to the revert instead.
if [[ -z ${SPINDLE_BG_HEALTH_URL} ]]; then
  warn "SPINDLE_BG_HEALTH_URL is not set; cannot verify the switch"
  if [[ ${DRY_RUN} -eq 1 ]]; then
    exit 0
  fi
  if [[ ${SWITCH_OK} -eq 0 ]]; then
    die "switch command failed and no health URL is configured to verify the result; manual intervention required"
  fi
  die "refusing to finish without a post-switch health check; set SPINDLE_BG_HEALTH_URL"
fi

HEALTH_OK=0
if [[ ${SWITCH_OK} -eq 1 ]]; then
  log "Health-checking public endpoint"
  if health_check "${SPINDLE_BG_HEALTH_URL}" "public endpoint"; then
    HEALTH_OK=1
  fi
else
  warn "skipping post-switch health check; the switch command already failed"
fi

if [[ ${HEALTH_OK} -eq 1 ]]; then
  if [[ -n ${SPINDLE_BG_POST_SWITCH_COMMAND} ]]; then
    log "Running post-switch command"
    run_shell "${SPINDLE_BG_POST_SWITCH_COMMAND}"
  fi
  log "Deploy complete: ${PREVIOUS_SLOT} -> ${TARGET_SLOT} (${SPINDLE_BG_RELEASE_ID})"
  exit 0
fi

# 5. Automatic revert.
if [[ ${SWITCH_OK} -eq 0 ]]; then
  warn "switch command failed; reverting to ${PREVIOUS_SLOT}"
else
  warn "Post-switch health check failed; reverting to ${PREVIOUS_SLOT}"
fi
if [[ ${DRY_RUN} -eq 1 ]]; then
  printf '+ point %s at %s\n' "${SPINDLE_BG_CURRENT_LINK}" "${PREVIOUS_SLOT}"
  if [[ -n ${SPINDLE_BG_SWITCH_COMMAND} ]]; then
    printf '+ bash -c %q\n' "${SPINDLE_BG_SWITCH_COMMAND}"
  fi
  exit 1
fi

point_current_at "${PREVIOUS_SLOT}"
if [[ -n ${SPINDLE_BG_SWITCH_COMMAND} ]]; then
  warn "Re-running switch command to restore ${PREVIOUS_SLOT}"
  if ! bash -c "${SPINDLE_BG_SWITCH_COMMAND}"; then
    die "revert switch command failed; ${PREVIOUS_SLOT} may still be receiving traffic — intervene manually"
  fi
fi

if health_check "${SPINDLE_BG_HEALTH_URL}" "reverted endpoint"; then
  die "deploy of ${TARGET_SLOT} (${SPINDLE_BG_RELEASE_ID}) failed health checks and was reverted to ${PREVIOUS_SLOT}"
fi

die "deploy failed AND the revert to ${PREVIOUS_SLOT} is unhealthy; manual intervention required"
