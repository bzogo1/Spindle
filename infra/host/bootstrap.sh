#!/usr/bin/env bash
# Bootstrap a fresh Hetzner AX42 origin (Ubuntu 24.04 LTS) for the stack in
# infra/origin/compose.yaml. Re-running it is safe: packages are upgraded,
# directories are created only when missing, and existing host.env and tunnel
# credentials are never overwritten.
#
# Usage, as root on the new host:
#
#   SPINDLE_APPLY_FIREWALL=1 ./infra/host/bootstrap.sh
#
# The firewall step is opt-in because enabling default-deny inbound cuts any
# SSH session that is not tunnelled through Tailscale or Cloudflare Access.
# Admin access is expected to be provisioned before this runs (ADR 0001 §4).
#
# Disk layout (RAID1, mount points, backups) is an install-time decision and is
# covered by docs/runbooks/hosting.md, not by this script.

set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this as root." >&2
  exit 1
fi

SPINDLE_ROOT=${SPINDLE_ROOT:-/srv/spindle}
SPINDLE_USER=${SPINDLE_USER:-spindle}
SPINDLE_APPLY_FIREWALL=${SPINDLE_APPLY_FIREWALL:-0}
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "${SCRIPT_DIR}/../.." && pwd)

if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  if [[ ${ID:-} != "ubuntu" || ${VERSION_ID:-} != "24.04" ]]; then
    echo "This script targets Ubuntu 24.04; found ${PRETTY_NAME:-unknown}." >&2
    echo "Continue only after reviewing the commands for this release." >&2
    exit 1
  fi
fi

echo "==> Installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates \
  chrony \
  curl \
  gnupg \
  jq \
  ufw \
  unattended-upgrades

echo "==> Installing Docker Engine and the Compose plugin"
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
cat >/etc/apt/sources.list.d/docker.list <<EOF
deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable
EOF
apt-get update
apt-get install -y --no-install-recommends \
  containerd.io \
  docker-buildx-plugin \
  docker-ce \
  docker-ce-cli \
  docker-compose-plugin

echo "==> Configuring the Docker daemon"
install -d -m 0755 /etc/docker
DAEMON_CONFIG=$(mktemp)
cat >"${DAEMON_CONFIG}" <<'EOF'
{
  "live-restore": true,
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "20m",
    "max-file": "5"
  }
}
EOF
if ! cmp -s "${DAEMON_CONFIG}" /etc/docker/daemon.json; then
  install -m 0644 "${DAEMON_CONFIG}" /etc/docker/daemon.json
  DAEMON_CHANGED=1
fi
rm -f "${DAEMON_CONFIG}"
systemctl enable --now docker
if [[ "${DAEMON_CHANGED:-0}" == "1" ]]; then
  systemctl restart docker
fi

echo "==> Creating the service user and host directories"
if ! id "${SPINDLE_USER}" >/dev/null 2>&1; then
  # Password login stays disabled; access is by SSH key through the admin path.
  useradd --create-home --shell /bin/bash "${SPINDLE_USER}"
fi
usermod -aG docker "${SPINDLE_USER}"

install -d -m 0750 -o "${SPINDLE_USER}" -g "${SPINDLE_USER}" \
  "${SPINDLE_ROOT}" \
  "${SPINDLE_ROOT}/projects" \
  "${SPINDLE_ROOT}/cloudflared"
install -d -m 0700 -o "${SPINDLE_USER}" -g "${SPINDLE_USER}" \
  "${SPINDLE_ROOT}/home" \
  "${SPINDLE_ROOT}/secrets" \
  "${SPINDLE_ROOT}/secrets/cloudflared"

echo "==> Applying kernel limits for file sync and Valkey"
install -d -m 0755 /etc/sysctl.d
cat >/etc/sysctl.d/90-spindle.conf <<'EOF'
# Workspace sync watches every project tree (DEV-103).
fs.inotify.max_user_watches = 524288
fs.inotify.max_user_instances = 8192
# Valkey forks for persistence; the default heuristic occasionally refuses.
vm.overcommit_memory = 1
EOF
sysctl --system >/dev/null

echo "==> Creating Docker networks"
docker network inspect spindle >/dev/null 2>&1 || docker network create spindle
docker network inspect spindle-lab >/dev/null 2>&1 || docker network create spindle-lab
docker network inspect spindle-control >/dev/null 2>&1 ||
  docker network create --internal spindle-control

echo "==> Seeding host configuration without overwriting it"
if [[ ! -f "${SPINDLE_ROOT}/host.env" ]]; then
  install -m 0600 -o "${SPINDLE_USER}" -g "${SPINDLE_USER}" \
    "${REPO_ROOT}/infra/origin/host.env.example" "${SPINDLE_ROOT}/host.env"
  echo "Created ${SPINDLE_ROOT}/host.env from the example; fill it in before starting."
else
  echo "Keeping existing ${SPINDLE_ROOT}/host.env."
fi

if [[ ! -f "${SPINDLE_ROOT}/cloudflared/config.yml" ]]; then
  install -m 0644 -o "${SPINDLE_USER}" -g "${SPINDLE_USER}" \
    "${REPO_ROOT}/infra/origin/cloudflared/config.yml" "${SPINDLE_ROOT}/cloudflared/config.yml"
  echo "Installed the tunnel ingress at ${SPINDLE_ROOT}/cloudflared/config.yml."
fi

echo "==> Enabling unattended security upgrades and time sync"
systemctl enable --now chrony
systemctl enable --now unattended-upgrades

if [[ "${SPINDLE_APPLY_FIREWALL}" == "1" ]]; then
  echo "==> Enabling the default-deny inbound firewall"
  ufw default deny incoming
  ufw default allow outgoing
  ufw --force enable
  ufw status verbose
else
  echo "==> Firewall not changed (set SPINDLE_APPLY_FIREWALL=1 to apply)"
  cat <<'EOF'
Expected policy, once admin access is confirmed:
  ufw default deny incoming
  ufw default allow outgoing
  ufw enable
No inbound rule is added: the tunnel is outbound-only and there is no public
22/80/443. Use Cloudflare Access or Tailscale for administration.
EOF
fi

cat <<EOF

Bootstrap complete. Next steps (docs/runbooks/hosting.md):
  1. Fill in ${SPINDLE_ROOT}/host.env and create the tunnel credentials.
  2. Confirm the firewall policy and that admin access still works.
  3. Run the staging deploy, then verify the origin with
     scripts/hosting/verify-topology.sh.
EOF
