#!/usr/bin/env bash
# Optional explicit ufw rules for the Spindle origin (docs/security/ddos-protection.md).
#
# DEFAULT POSTURE NEEDS NO RULES: bootstrap.sh enables "default deny incoming /
# default allow outgoing" with zero allow rules, and admin access is via
# Tailscale or Cloudflare Access (docs/runbooks/hosting.md §1).
#
# Use this script ONLY if SSH must be reachable on a public interface — e.g.
# the admin path is down and you need emergency console access. It restricts
# SSH to a management CIDR and nothing else. Revert to the default posture
# (delete the SSH allow rule) as soon as the emergency is over.
#
# Usage (on the host, as root):
#
#   MGMT_CIDR=203.0.113.0/24 ./ufw-rules.sh            # dry run: print commands
#   MGMT_CIDR=203.0.113.0/24 ./ufw-rules.sh --apply    # apply them
#   ./ufw-rules.sh --check                             # verify current policy
#
# MGMT_CIDR is required for --apply and must be a single IPv4/IPv6 CIDR or IP.
# Never pass "anywhere" — that re-opens SSH to the internet.

set -euo pipefail

MGMT_CIDR=${MGMT_CIDR:-}
MODE=${1:---dry-run}

SSH_PORT=22

run() {
  if [[ ${MODE} == "--apply" ]]; then
    echo "+ $*"
    "$@"
  else
    echo "would run: $*"
  fi
}

case ${MODE} in
  --check)
    echo "== ufw status =="
    ufw status verbose || true
    echo
    echo "== published docker ports (should be only 127.0.0.1:8080->8080/tcp) =="
    docker ps --format '{{.Names}} {{.Ports}}' || true
    echo
    echo "== listening sockets =="
    ss -tlnp || true
    exit 0
    ;;
  --apply | --dry-run) ;;
  *)
    echo "usage: MGMT_CIDR=<cidr> $0 [--dry-run|--apply|--check]" >&2
    exit 2
    ;;
esac

if [[ -z ${MGMT_CIDR} ]]; then
  echo "MGMT_CIDR is required (e.g. MGMT_CIDR=203.0.113.10 or 203.0.113.0/24)." >&2
  exit 2
fi

# Refuse wide-open input.
case ${MGMT_CIDR} in
  ""|*" "*|*"/0"|anywhere)
    echo "refusing unsafe MGMT_CIDR='${MGMT_CIDR}'" >&2
    exit 2
    ;;
esac

echo "==> Ensuring default-deny inbound / allow-outgoing"
run ufw default deny incoming
run ufw default allow outgoing

echo "==> Allowing SSH only from ${MGMT_CIDR} (port ${SSH_PORT})"
run ufw allow from "${MGMT_CIDR}" to any port "${SSH_PORT}" proto tcp comment 'spindle admin ssh (temporary)'

echo "==> Denying common web ports from the world (safety net if a container publishes 0.0.0.0)"
# Docker's iptables rules bypass ufw for PUBLISHED ports, so these denies are
# not a substitute for auditing 'docker ps' — they only cover host services
# and the edge case of a future publish rule that ufw can still see.
run ufw deny 80/tcp comment 'no public http — Cloudflare edge only'
run ufw deny 443/tcp comment 'no public https — Cloudflare edge only'

echo "==> Enabling ufw"
run ufw --force enable
run ufw status verbose

cat <<'EOF'

Done. Remember:
  - SSH is now reachable ONLY from MGMT_CIDR. Everything else inbound is denied.
  - There is still no public 80/443 — the tunnel is outbound-only.
  - Audit published ports regularly: docker ps --format '{{.Names}} {{.Ports}}'
    must show only 127.0.0.1 bindings (see docs/security/ddos-protection.md).
  - Remove the SSH allow rule (ufw delete allow from <cidr> to any port 22)
    and return to Tailscale/Cloudflare Access when the emergency ends.
EOF
