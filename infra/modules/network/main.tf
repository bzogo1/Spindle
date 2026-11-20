# network — single-VPS private network and edge firewall for a Spindle origin.
#
# Mirrors docs/decisions/0001-container-host-topology.md: one Hetzner host per
# environment, ingress only through an outbound cloudflared tunnel. This module
# deliberately creates NO public ingress rule: 22/80/443 stay closed at the
# provider firewall. Admin access is via Cloudflare Access or Tailscale, which
# arrive over existing outbound connections.
#
# Provider note: written for the Hetzner Cloud provider (hcloud), matching the
# AX42-1 / CPX31 hosts in docs/runbooks/hosting.md. The module is intentionally
# small; swap the hcloud_* resources for another provider's equivalents if the
# host ever moves.

terraform {
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.45"
    }
  }
}

locals {
  network_name  = coalesce(var.network_name, "spindle-${var.environment}")
  firewall_name = coalesce(var.firewall_name, "spindle-${var.environment}-fw")
  server_name   = coalesce(var.server_name, "spindle-${var.environment}-origin")
}

# ---------------------------------------------------------------------------
# Private network
# ---------------------------------------------------------------------------
# Hetzner Cloud private networks matter only when a second host joins
# (e.g. a future staging box or a Storage-Box-adjacent VM). The tunnel and the
# compose stack do not need it; it is created so the server attachment below
# is a no-op-safe reference and so a second environment can peer later.

resource "hcloud_network" "spindle" {
  name     = local.network_name
  ip_range = var.network_cidr
}

resource "hcloud_network_subnet" "spindle" {
  network_id   = hcloud_network.spindle.id
  type         = "cloud"
  network_zone = var.network_zone
  ip_range     = var.subnet_cidr
}

# ---------------------------------------------------------------------------
# Edge firewall — mirrors infra/ddos/ufw-rules.sh intent at the provider layer
# ---------------------------------------------------------------------------
# The host still runs ufw (bootstrap.sh / host-security module) for the
# emergency-SQL path; this cloud firewall is the outer net. Keeping both
# layers is deliberate: Docker-published ports bypass ufw via iptables, but
# they cannot bypass the Hetzner edge firewall.

resource "hcloud_firewall" "spindle" {
  name = local.firewall_name

  # Default posture: nothing inbound. cloudflared dials OUT to Cloudflare's
  # edge, so the tunnel needs no inbound rule at all.

  dynamic "rule" {
    for_each = var.enable_mgmt_ssh ? [1] : []
    content {
      direction   = "in"
      protocol    = "tcp"
      port        = "22"
      source_ips  = [var.mgmt_cidr]
      description = "Emergency SSH from the management CIDR only (see infra/ddos/ufw-rules.sh)"
    }
  }

  # No rules for public 80/443 — and none may ever be added. hcloud_firewall
  # rules are ALLOW-ONLY: a rule with source_ips 0.0.0.0/0 / ::/0 would OPEN
  # the port to the internet, not deny it (Hetzner has no deny-rule
  # semantics). Default-deny already covers 80/443, which is the intended
  # posture: Cloudflare edge only, mirroring infra/ddos/ufw-rules.sh. The
  # on-host ufw still carries the explicit `ufw deny 80/443` safety net.
}

# ---------------------------------------------------------------------------
# The origin server
# ---------------------------------------------------------------------------

resource "hcloud_server" "origin" {
  name        = local.server_name
  server_type = var.server_type
  image       = var.image
  location    = var.location
  ssh_keys    = var.ssh_key_ids

  firewall_ids = [hcloud_firewall.spindle.id]
  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
  }

  # The private-network attachment is managed by hcloud_server_network below
  # (the inline `network` block on hcloud_server is deprecated upstream).

  # No user_data here: host configuration (Docker, ufw, compose stack) is
  # infra/host/bootstrap.sh's job, applied by an operator per
  # docs/runbooks/hosting.md §1. Keeping provisioning in the script means the
  # Terraform apply and the bootstrap stay independently reviewable.

  labels = {
    environment = var.environment
    role        = "origin"
  }
}

resource "hcloud_server_network" "origin" {
  server_id  = hcloud_server.origin.id
  network_id = hcloud_network.spindle.id
  ip         = var.server_private_ip
}
