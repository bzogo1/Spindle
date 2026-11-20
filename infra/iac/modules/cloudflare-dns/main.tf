# Cloudflare DNS records for the Spindle hostnames (ADR 0001 §4/§5.3).
#
# Today these records are created by `cloudflared tunnel route dns` commands
# in docs/runbooks/hosting.md §2. This module models the same end state so a
# future cloud move can manage DNS declaratively.
#
# NOTE on provider versioning: the Cloudflare provider v5 renamed
# `cloudflare_record` to `cloudflare_dns_record`. This module pins
# `cloudflare/cloudflare ~> 4.0`; if the project standardises on v5, rename the
# resource and adjust argument names (`name` → `name`, `content` stays, zone_id
# lookup via `cloudflare_zone`).

terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

data "cloudflare_zone" "spindle" {
  name = var.zone_name
}

# Tunnel CNAMEs point at <tunnel-id>.cfargotunnel.com. The tunnel itself and
# its credentials JSON are still created by `cloudflared tunnel create`
# (docs/runbooks/hosting.md §2); Terraform only owns the DNS side.
resource "cloudflare_record" "app" {
  zone_id = data.cloudflare_zone.spindle.id
  name    = var.app_subdomain
  type    = "CNAME"
  content = "${var.tunnel_id}.cfargotunnel.com"
  proxied = true
  ttl     = 1 # automatic when proxied
}

resource "cloudflare_record" "lab" {
  zone_id = data.cloudflare_zone.spindle.id
  name    = var.lab_subdomain
  type    = "CNAME"
  content = "${var.tunnel_id}.cfargotunnel.com"
  proxied = true
  ttl     = 1
}
