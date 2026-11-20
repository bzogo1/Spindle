# Infrastructure modules

Reusable Terraform modules under `infra/modules/`. They encode the topology
decided in [ADR 0001](../decisions/0001-container-host-topology.md) and the
operational posture in [hosting.md](../runbooks/hosting.md) so a rebuilt or
second environment does not drift from the checked-in intent.

> **Reference material.** These modules are the canonical _shape_ of the
> infrastructure, not the live deployment path. Provisioning today is still
> done by an operator following `docs/runbooks/hosting.md` §1–§2 and
> `infra/host/bootstrap.sh`. `terraform plan`/`apply` would target the real
> Hetzner project and create billable resources — run it only with a scoped
> `HCLOUD_TOKEN` and an explicit cost review, and treat the outputs (server
> IP, firewall ID) as inputs to the manual bootstrap steps.

## Relationship to `infra/iac/`

A parallel workstream landed higher-level IaC under `infra/iac/` — its own
reference modules (`hetzner-server`, `hetzner-firewall`, `cloudflare-dns`)
plus an `examples/production` root. That tree is **reference material, not
applied** (see `infra/iac/README.md` and `docs/infrastructure/iac.md`), and it
does not currently call the modules here. This directory remains the canonical
_shape_ of the infrastructure:

- `infra/modules/` — **reusable, provider-level building blocks** (network,
  host hardening). Small, reviewable, and safe to `terraform plan` in
  isolation.
- `infra/iac/` — **environment composition**: root modules that wire
  variables, state, and secrets for a concrete environment.

If the IaC tree is ever adopted for real, it should call these modules rather
than duplicate them, e.g.:

```hcl
module "prod_network" {
  source      = "../../modules/network"
  environment = "prod"
  server_type = "ax42"          # AX42-1 per hosting.md §1
  enable_mgmt_ssh = false       # Tailscale / Cloudflare Access only
}
```

Until then, the modules serve as executable documentation: `terraform fmt`
clean, `terraform validate`-able once a provider is configured, and readable
as the source of truth for firewall and network intent.

## Module catalog

### `infra/modules/network`

One Hetzner server per environment plus a private network and an edge
firewall. Provider: `hetznercloud/hcloud`.

| File           | Contents                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| `main.tf`      | `hcloud_network`, `hcloud_network_subnet`, `hcloud_firewall`, `hcloud_server`, `hcloud_server_network` |
| `variables.tf` | environment, location, server type, image, SSH key IDs, CIDRs, `enable_mgmt_ssh`/`mgmt_cidr`           |
| `outputs.tf`   | server ID/IPs, network/firewall IDs, the bootstrap command                                             |

Topology encoded:

- **No public ingress.** The edge firewall has **zero allow rules** for
  22/80/443 by default; `cloudflared` dials _outbound_ to Cloudflare, so the
  tunnel needs zero inbound rules (ADR 0001 §4). There are deliberately **no**
  80/443 rules at all: `hcloud_firewall` rules are allow-only, so any rule
  with `source_ips = ["0.0.0.0/0", "::/0"]` would _open_ the port publicly —
  the opposite of a deny. The default-deny posture already keeps 80/443
  closed, and the explicit `ufw deny 80/443` safety net lives in
  `infra/ddos/ufw-rules.sh` / `infra/host/bootstrap.sh` for the on-host layer.
- **Emergency SSH is opt-in** via `enable_mgmt_ssh` + a single `mgmt_cidr`,
  validated to reject `0.0.0.0/0`. This is the same temporary path
  `ufw-rules.sh` implements on-host.
- **Private network** (`10.42.0.0/16`) exists for future multi-host
  staging/peering; the compose stack does not depend on it today.
- **No `user_data`.** Host config stays in `infra/host/bootstrap.sh` so the
  Terraform apply and the operator bootstrap remain independently reviewable.

### `infra/modules/host-security`

Renders a `#cloud-config` user-data payload implementing the host firewall
posture. No cloud resources — it outputs the payload for another module or an
operator to attach.

| File                    | Contents                                                                     |
| ----------------------- | ---------------------------------------------------------------------------- |
| `main.tf`               | `templatefile` render into `local.user_data`                                 |
| `variables.tf`          | `enable_mgmt_ssh`, `mgmt_cidr`, `ssh_port`, `apply_firewall`, `spindle_root` |
| `cloud-init.yaml.tftpl` | The payload itself                                                           |
| `outputs.tf`            | `user_data`, effective posture flags                                         |

Parity with existing scripts:

- `ufw default deny incoming` / `default allow outgoing` — same as
  `bootstrap.sh`'s `SPINDLE_APPLY_FIREWALL=1` path.
- Optional `ufw allow from <mgmt_cidr> to any port 22` — same intent as
  `infra/ddos/ufw-rules.sh --apply`, including the "temporary" comment.
- Explicit `ufw deny 80/tcp` / `443/tcp` — the safety net from
  `ufw-rules.sh`, with the same caveat that Docker-published ports bypass ufw
  and must be audited via `docker ps` (see `docs/security/ddos-protection.md`).
- `apply_firewall=false` mirrors the bootstrap's opt-in: default-deny cuts
  SSH sessions that are not already tunnelled, so it stays off until admin
  access (Tailscale/Cloudflare Access) is confirmed.

The payload deliberately stops at hardening: Docker install, `/srv/spindle`
layout, `host.env`, tunnel credentials, and the compose stack remain
operator steps — cloud-init must never carry secrets.

## Usage examples

### Plan a production origin (reference only)

```hcl
# environments/prod/main.tf — illustrative root module
terraform {
  required_providers {
    hcloud = { source = "hetznercloud/hcloud", version = "~> 1.45" }
  }
}

provider "hcloud" {
  token = var.hcloud_token # scoped project token, from env/secret store
}

module "origin" {
  source         = "../../modules/network"
  environment    = "prod"
  server_type    = "ax42"     # AX42-1: 8C/16T, 64 GB, 2×512 GB NVMe RAID1
  location       = "fsn1"     # Falkenstein per ADR 0001
  ssh_key_ids    = [var.deploy_ssh_key_id]
  enable_mgmt_ssh = false     # Tailscale / Cloudflare Access only
}

module "hardening" {
  source         = "../../modules/host-security"
  apply_firewall = true
  # enable_mgmt_ssh stays false in steady state.
}
```

```bash
export HCLOUD_TOKEN=...   # never commit; scope to the project
terraform init
terraform plan            # review: 1 server, 1 network, 1 firewall, 0 inbound allows
terraform apply           # billable — confirm cost review first
```

After apply, follow `docs/runbooks/hosting.md` §1–§2 on the new host:
`bootstrap.sh`, tunnel creation, `host.env`, `docker compose up`. The
`user_data` output of `host-security` can be passed as `hcloud_server.user_data`
by a composing root module to bake the ufw posture into first boot.

### Emergency SSH (temporary)

```hcl
module "origin" {
  source          = "../../modules/network"
  environment     = "prod"
  enable_mgmt_ssh = true
  mgmt_cidr       = "203.0.113.0/24"   # your admin CIDR — never 0.0.0.0/0
}
```

Revert (`enable_mgmt_ssh = false`, apply) as soon as the emergency ends — the
same lifecycle `infra/ddos/ufw-rules.sh` documents for the on-host rule.

### Staging

Same modules, different inputs: `environment = "staging"`,
`server_type = "cpx31"` (or `ax41`), its own tunnel, buckets, and keys per
hosting.md §3. Staging is a separate host, never a second stack on prod.

## Validation

`terraform fmt -check -recursive infra/modules` should report clean. Modules
are written to pass `terraform validate` once an `hcloud` provider is
configured; no `terraform.tfstate` or `.terraform/` directories are committed.
