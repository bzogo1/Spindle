# infra/iac — reference infrastructure-as-code

**Status: reference example, not applied.** Nothing under `infra/iac/` is run by
CI, the deploy workflow, or `infra/host/bootstrap.sh`. It exists to answer "what
would need IaC if the host moves to cloud-managed provisioning, or if the bare
metal is replaced?" — see `docs/infrastructure/iac.md` for the current-state
assessment, gap analysis, and adoption path.

## Layout

| Path                        | Purpose                                                         |
| --------------------------- | --------------------------------------------------------------- |
| `modules/hetzner-server/`   | Hetzner Cloud VM: type, image, location, SSH keys, labels       |
| `modules/hetzner-firewall/` | Hetzner Cloud Firewall mirroring the UFW default-deny posture   |
| `modules/cloudflare-dns/`   | Cloudflare DNS records for app/lab hostnames                    |
| `examples/production/`      | Wires the modules together for the production origin (ADR 0001) |

## Providers

- `hetznercloud/hcloud` — the Hetzner Cloud API. Covers cloud VM types
  (CX/CPX/CCX) equivalent to the dedicated AX42-class machine the production
  runbook specifies (`infra/host/bootstrap.sh`, `docs/runbooks/hosting.md`);
  AX-class SKUs are Hetzner Robot products outside hcloud's scope.
- `cloudflare/cloudflare` — DNS for `app.spindle.app`, `lab.spindle.app`, and
  staging equivalents. Tunnel resources are intentionally **not** modelled here;
  `cloudflared tunnel create` still produces the credentials JSON that must live
  at `/srv/spindle/secrets/cloudflared/credentials.json` with mode `0600`.

## What is deliberately not here

- **The application stack.** `infra/origin/compose.yaml`, `cloudflared/config.yml`,
  and `host.env` stay in compose + env-file form; containers are not IaC.
- **In-guest configuration.** Docker daemon JSON, sysctl limits, the `spindle`
  user, `/srv` directory tree, Docker networks, and UFW policy are applied by
  `infra/host/bootstrap.sh` on the host. Ansible would be the natural next step
  if guest config needs codifying — Terraform cannot reach inside the VM.
- **Cloudflare Tunnel.** Creating tunnels via the provider stores the token in
  Terraform state, which is a secret-management regression versus the current
  on-host credentials file. Kept manual for now.
- **Backups, restic, B2 sync.** Covered by other runbooks (DEV-15, DEV-103).

## Trying it out

```bash
cd infra/iac/examples/production
cp terraform.tfvars.example terraform.tfvars   # fill in real values
terraform init
terraform plan   # review; do not apply blindly — see docs/infrastructure/iac.md
```

Secrets (Hetzner API token, Cloudflare API token) go in environment variables
(`HCLOUD_TOKEN`, `CLOUDFLARE_API_TOKEN`), never in `terraform.tfvars` or state
files committed to git.
