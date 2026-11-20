# Hetzner Cloud Firewall mirroring the UFW posture in
# infra/host/bootstrap.sh and infra/ddos/ufw-rules.sh.
#
# Default posture: deny all inbound, allow all outbound. No allow rules are
# created by default — ingress is the outbound-only Cloudflare Tunnel and admin
# access is Tailscale/Cloudflare Access, neither of which needs a public port.
#
# The optional SSH allow rule exists only for the emergency case described in
# infra/ddos/ufw-rules.sh: SSH reachable on a public interface restricted to a
# management CIDR. Leave management_cidr null in normal operation.

terraform {
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 2.0"
    }
  }
}

resource "hcloud_firewall" "origin" {
  name = var.name

  # Explicit deny rules document intent; Hetzner Cloud Firewalls are
  # default-deny for inbound and default-allow for outbound, so these are
  # belt-and-suspenders rather than strictly required.
  dynamic "rule" {
    for_each = var.management_cidr == null ? [] : [var.management_cidr]
    content {
      direction   = "in"
      protocol    = "tcp"
      port        = "22"
      source_ips  = [rule.value]
      description = "Emergency SSH, management CIDR only (normally absent)"
    }
  }

  rule {
    direction  = "in"
    protocol   = "icmp"
    source_ips = ["0.0.0.0/0", "::/0"]
    description = "ICMP for path MTU / diagnostics"
  }

  rule {
    direction  = "out"
    protocol   = "tcp"
    port       = "any"
    destination_ips = ["0.0.0.0/0", "::/0"]
    description = "All outbound TCP (tunnel, image pulls, B2, package updates)"
  }

  rule {
    direction  = "out"
    protocol   = "udp"
    port       = "any"
    destination_ips = ["0.0.0.0/0", "::/0"]
    description = "All outbound UDP"
  }

  rule {
    direction  = "out"
    protocol   = "icmp"
    destination_ips = ["0.0.0.0/0", "::/0"]
    description = "Outbound ICMP"
  }

  apply_to {
    label_selector = "spindle.dev/role=origin"
  }
}
