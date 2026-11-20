# Production origin — reference Terraform root.
#
# This example mirrors ADR 0001 §4 / docs/runbooks/hosting.md for the
# production host. It is NOT wired into CI or bootstrap; applying it is a
# deliberate operator action (see docs/infrastructure/iac.md).
#
# Important: the runbook specifies a Hetzner AX42-1 dedicated server. AX-class
# machines are provisioned through the Hetzner Robot API
# (hetzner-robot/robot provider), not hcloud — Hetzner Cloud offers CX/CPX/CCX
# types only. This example uses hcloud with an AX42-class-equivalent cloud
# type as a placeholder; if the decision stays on dedicated hardware, swap the
# server module for a robot_server resource or keep bootstrap.sh as the
# provisioning path and use Terraform only for DNS/firewall-adjacent state.

terraform {
  required_version = ">= 1.6"

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 2.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }

  # State backend: see docs/infrastructure/iac.md §state. Uncomment and point
  # at an encrypted remote backend before any real use — local state on a
  # laptop is not acceptable for anything but `terraform plan` dry runs.
  # backend "s3" {
  #   bucket = "spindle-terraform-state"
  #   key    = "prod/origin.tfstate"
  #   region = "fsn1"
  # }
}

provider "hcloud" {
  # Reads HCLOUD_TOKEN from the environment.
}

provider "cloudflare" {
  # Reads CLOUDFLARE_API_TOKEN from the environment. Scope it to Zone.DNS
  # edit on spindle.app only.
}

locals {
  environment = "prod"
}

module "firewall" {
  source = "../../modules/hetzner-firewall"

  name = "spindle-prod-fw"
  # management_cidr left null: no SSH allow rule. Admin access is
  # Tailscale/Cloudflare Access. Set only for the documented emergency path
  # (infra/ddos/ufw-rules.sh).
}

module "origin" {
  source = "../../modules/hetzner-server"

  name           = "spindle-prod"
  environment    = local.environment
  server_type    = var.server_type
  image          = var.image
  location       = var.location
  deploy_public_key = var.deploy_public_key
  firewall_ids   = [module.firewall.firewall_id]
  prevent_destroy = true

  labels = {
    "spindle.dev/managed-by" = "terraform-reference"
  }
}

module "dns" {
  source = "../../modules/cloudflare-dns"

  zone_name     = var.zone_name
  tunnel_id     = var.tunnel_id
  app_subdomain = "app"
  lab_subdomain = "lab"
}
