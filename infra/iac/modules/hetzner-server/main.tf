# Hetzner Cloud server for the Spindle origin (ADR 0001 §4).
#
# Reference module: models the VM the runbook provisions by hand. In-guest
# configuration (Docker, sysctl, UFW, /srv tree) is still applied by
# infra/host/bootstrap.sh after the VM exists — Terraform only creates the VM.

terraform {
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 2.0"
    }
  }
}

resource "hcloud_ssh_key" "deploy" {
  name       = "${var.name}-deploy"
  public_key = var.deploy_public_key
}

resource "hcloud_server" "origin" {
  name        = var.name
  server_type = var.server_type
  image       = var.image
  location    = var.location

  ssh_keys = [hcloud_ssh_key.deploy.id]

  # No public inbound is required: ingress is the outbound-only Cloudflare
  # Tunnel and admin access is Tailscale/Cloudflare Access. The Hetzner
  # Cloud Firewall (modules/hetzner-firewall) enforces the same default-deny
  # posture at the provider edge.
  firewall_ids = var.firewall_ids

  labels = merge(var.labels, {
    "spindle.dev/environment" = var.environment
    "spindle.dev/role"        = "origin"
  })

  # Protect against accidental destroy of the production box.
  lifecycle {
    prevent_destroy = var.prevent_destroy
  }
}
