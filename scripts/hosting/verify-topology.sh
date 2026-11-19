#!/usr/bin/env bash
# Verify the claims ADR 0001 §7 makes about the origin host:
#
#   1. A session-like container starts on spindle-lab with no published port.
#   2. A probe proxy on the internal `spindle` network, attached to both
#      `spindle` and `spindle-lab`, upgrades a WebSocket from a
#      connector-side container and echoes frames.
#   3. A tunnel WebSocket works, when SPINDLE_LAB_URL and a token are provided.
#   4. Warm start to first byte stays under 20 s, and the orchestrator can
#      resolve the container over the private network when it is pointed at.
#
# Run on the origin. It creates throwaway containers labelled
# spindle.session=probe and removes them on exit.

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
NETWORK=${SPINDLE_NETWORK:-spindle}
LAB_NETWORK=${SPINDLE_LAB_NETWORK:-spindle-lab}
RUNTIME_CONTAINER=${SPINDLE_RUNTIME_CONTAINER:-}
PROBE_NAME=ws-probe
PROXY_NAME=ws-probe-proxy
ECHO_SERVER_IMAGE=${ECHO_SERVER_IMAGE:-jmalloc/echo-server}
CADDY_IMAGE=${CADDY_IMAGE:-caddy:2-alpine}
NODE_IMAGE=${NODE_IMAGE:-node:22-alpine}
CREATED_NETWORK=0
CREATED_LAB_NETWORK=0

if ! command -v docker >/dev/null 2>&1; then
  echo "FAIL: docker is not installed on this host." >&2
  exit 1
fi

cleanup() {
  docker rm -f "${PROXY_NAME}" "${PROBE_NAME}" >/dev/null 2>&1 || true
  if [[ "${CREATED_LAB_NETWORK}" == "1" ]]; then
    docker network rm "${LAB_NETWORK}" >/dev/null 2>&1 || true
  fi
  if [[ "${CREATED_NETWORK}" == "1" ]]; then
    docker network rm "${NETWORK}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if ! docker network inspect "${NETWORK}" >/dev/null 2>&1; then
  echo "Creating ${NETWORK} for the probe."
  docker network create "${NETWORK}" >/dev/null
  CREATED_NETWORK=1
fi

if ! docker network inspect "${LAB_NETWORK}" >/dev/null 2>&1; then
  echo "Creating ${LAB_NETWORK} for the probe."
  docker network create "${LAB_NETWORK}" >/dev/null
  CREATED_LAB_NETWORK=1
fi

echo "==> Pulling probe images so the warm-start measurement excludes the pull"
docker pull "${ECHO_SERVER_IMAGE}" >/dev/null
docker pull "${CADDY_IMAGE}" >/dev/null
docker pull "${NODE_IMAGE}" >/dev/null

echo "==> 1/4 Starting a container with no published port"
PROBE_START_TS=$(date +%s%N)
docker run -d --name "${PROBE_NAME}" --network "${LAB_NETWORK}" \
  --read-only --tmpfs /tmp --memory 512m --cpus 0.5 \
  --label spindle.session=probe \
  "${ECHO_SERVER_IMAGE}" >/dev/null

PORT_MAPPINGS=$(docker port "${PROBE_NAME}" || true)
if [[ -n "${PORT_MAPPINGS}" ]]; then
  echo "FAIL: probe container published a port:" >&2
  echo "${PORT_MAPPINGS}" >&2
  exit 1
fi
echo "PASS: probe container has no published port"

echo "==> 2/4 Proxying a WebSocket over the internal network"
docker run -d --name "${PROXY_NAME}" --network "${NETWORK}" \
  --read-only --tmpfs /tmp --tmpfs /config --tmpfs /data \
  -v "${ROOT}/infra/verify/Caddyfile:/etc/caddy/Caddyfile:ro" \
  "${CADDY_IMAGE}" >/dev/null

# Attach the proxy to the lab network so it can resolve the probe. Session
# containers are never published, so this is the only path to them.
docker network connect "${LAB_NETWORK}" "${PROXY_NAME}"

PROXY_PORT_MAPPINGS=$(docker port "${PROXY_NAME}" || true)
if [[ -n "${PROXY_PORT_MAPPINGS}" ]]; then
  echo "FAIL: probe proxy published a port:" >&2
  echo "${PROXY_PORT_MAPPINGS}" >&2
  exit 1
fi

# Wait for the proxy from a container on `spindle`, which is the same side of
# the topology as cloudflared.
if ! docker run --rm --network "${NETWORK}" "${NODE_IMAGE}" node -e '
const deadline = Date.now() + 30000;
function poll() {
  fetch("http://ws-probe-proxy:7000/lab/probe/health")
    .then((response) => {
      if (response.ok) process.exit(0);
      throw new Error(String(response.status));
    })
    .catch(() => {
      if (Date.now() > deadline) {
        console.error("FAIL: probe proxy did not become healthy");
        process.exit(1);
      }
      setTimeout(poll, 500);
    });
}
poll();
'; then
  echo "FAIL: probe proxy did not become ready on ${NETWORK}" >&2
  docker logs "${PROXY_NAME}" >&2 || true
  exit 1
fi

WARM_START_MS=$((($(date +%s%N) - PROBE_START_TS) / 1000000))

docker run --rm --network "${NETWORK}" \
  -v "${ROOT}/scripts/hosting:/probe:ro" \
  "${NODE_IMAGE}" \
  node /probe/ws-probe.mjs "ws://${PROXY_NAME}:7000/lab/probe/ws"

echo "==> 3/4 Checking the tunnel path"
if [[ -z "${SPINDLE_LAB_URL:-}" || -z "${SPINDLE_SESSION_TOKEN:-}" ]]; then
  echo "SKIP: set SPINDLE_LAB_URL and SPINDLE_SESSION_TOKEN to test wss:// through the tunnel."
elif command -v wscat >/dev/null 2>&1; then
  wscat -c "${SPINDLE_LAB_URL%/}/lab/probe/ws" \
    -H "Authorization: Bearer ${SPINDLE_SESSION_TOKEN}" \
    -x '{"type":"echo","payload":"spindle-probe"}' -w 10
  echo "PASS: tunnel WebSocket accepted the signed request"
else
  echo "SKIP: wscat is not installed; install it on an admin machine to run the tunnel leg."
fi

echo "==> 4/4 Measuring warm start and orchestrator-to-container reachability"
echo "Warm start to first byte: ${WARM_START_MS} ms (target < 20000 ms)"
if ((WARM_START_MS >= 20000)); then
  echo "FAIL: warm start exceeded 20 s" >&2
  exit 1
fi

if [[ -n "${RUNTIME_CONTAINER}" ]] && docker inspect "${RUNTIME_CONTAINER}" >/dev/null 2>&1; then
  if docker exec "${RUNTIME_CONTAINER}" getent hosts "${PROBE_NAME}" >/dev/null 2>&1; then
    echo "PASS: ${RUNTIME_CONTAINER} resolves ${PROBE_NAME} over ${LAB_NETWORK}"
  else
    echo "FAIL: ${RUNTIME_CONTAINER} could not resolve ${PROBE_NAME} over ${LAB_NETWORK}" >&2
    exit 1
  fi
else
  echo "SKIP: set SPINDLE_RUNTIME_CONTAINER to the orchestrator container to check DNS reachability."
fi

echo "Topology verification complete."
