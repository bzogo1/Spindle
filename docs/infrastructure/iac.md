# Infrastructure as code — current state and adoption path

Status of infrastructure codification for the Spindle origin (ADR 0001, DEV-11).
This document is the honest assessment; the Terraform under `infra/iac/` is a
**reference example**, not applied configuration.

## 1. What exists today

The host stack is checked in under `infra/`, but it is **bash bootstrap +
Compose + cloudflared configs**, not IaC in the Terraform/Ansible sense:

| Asset                                                                | Kind                    | Codified?                                                                                         |
| -------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------- |
| `infra/host/bootstrap.sh`                                            | Bash script, idempotent | Partially — packages, Docker daemon JSON, sysctl limits, Docker networks, `/srv` tree, UFW policy |
| `infra/origin/compose.yaml`                                          | Docker Compose          | Yes — app/worker/Postgres/Valkey/socket-proxy service definitions                                 |
| `infra/origin/cloudflared/config.yml`                                | Tunnel ingress config   | Yes — ingress routing rules                                                                       |
| `infra/origin/host.env.example`                                      | Env template            | Yes — values filled by hand on host                                                               |
| `infra/staging/*`                                                    | Same for staging        | Same                                                                                              |
| `infra/ddos/ufw-rules.sh`                                            | Bash script             | Optional emergency SSH rules only                                                                 |
| `infra/verify/Caddyfile`                                             | Proxy config            | Yes                                                                                               |
| `infra/waf/*`, `infra/edge/*`, `infra/tls/*`, `infra/certificates/*` | JSON/Markdown configs   | Yes — edge rulesets, rate limits, docs                                                            |
| `scripts/hosting/verify-topology.sh`                                 | Verification script     | Yes — ADR §7 checks                                                                               |

### What is codified

- **Application workload shape** — every container's image pinning, hardening
  (`no-new-privileges`, `cap_drop ALL`, read-only root, tmpfs), health checks,
  logging limits, and loopback-only port bindings live in `compose.yaml`.
- **Network segmentation** — the `spindle`, `spindle-lab`, and
  `--internal spindle-control` Docker networks are created by bootstrap and
  referenced by name.
- **Host baseline** — bootstrap.sh installs Ubuntu 24.04 packages, Docker
  Engine + Compose plugin, `daemon.json` (`live-restore`, json-file log caps),
  `90-spindle.conf` sysctl limits (inotify watches for DEV-103 sync, Valkey
  overcommit), the passwordless `spindle` user in the `docker` group, the
  `/srv/spindle/{projects,home,secrets}` tree, and default-deny UFW when
  `SPINDLE_APPLY_FIREWALL=1`.
- **Ingress** — cloudflared ingress YAML maps `app.spindle.app` → `app:8080`
  and `lab.spindle.app` → `lab-proxy:7000`; tunnel credentials stay off-repo.

### What is still manual

- **VM provisioning itself.** Nothing creates the Hetzner AX42-1 (prod) or the
  staging instance. `docs/runbooks/hosting.md` §6 lists "provision the
  production AX42-1" as an unchecked human action; OS install (including RAID1
  layout) is an install-time decision outside bootstrap.sh.
- **Cloudflare account objects.** `cloudflared tunnel create`,
  `tunnel route dns`, tunnel credentials JSON placement (mode `0600`), and the
  Access/Tailscale admin path are all runbook commands run by hand.
- **Secrets.** Infisical project/env population, deploy identities, GitHub
  environment secrets — runbook steps, not code.
- **Provider controls.** Hetzner budget alerts, B2 caps, Cloudflare
  notifications, Sentry spend cap — dashboard settings documented in
  `hosting.md` §4.
- **Backups.** Restic/B2/Storage Box scheduling (DEV-15) and B2 sync (DEV-103)
  are separate issues; not in this tree yet.
- **Drift detection.** Nothing compares the running host against
  bootstrap.sh/compose.yaml; there is no config-management agent.

## 2. Gap analysis

| Gap                       | Risk                                                                              | Mitigation today                                         | IaC candidate                                                        |
| ------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------- |
| No VM-as-code             | Rebuild depends on a human following a runbook; AX42 is dedicated hardware anyway | Runbook + bootstrap script; ADR 0001 §6 accepts ~2 h RTO | Terraform (cloud types) or Hetzner Robot API / Ansible for dedicated |
| No guest-config-as-code   | bootstrap.sh is imperative bash; partial reruns are safe but ordering is tribal   | Script is idempotent and commented                       | Ansible playbook wrapping bootstrap.sh                               |
| DNS/tunnel records manual | `cloudflared route dns` commands are easy to mistype; staging/prod drift possible | Runbook is explicit; tunnel IDs in host.env              | `infra/iac/modules/cloudflare-dns` (reference)                       |
| Firewall duplicated       | UFW policy in bootstrap + ufw-rules.sh; a cloud firewall would be a third copy    | Default-deny with zero allow rules is simple             | `infra/iac/modules/hetzner-firewall` (reference)                     |
| State/secrets split       | host.env + Infisical + GitHub envs have no single inventory                       | Documented per-runbook                                   | Terraform state would add a new secret to protect — see §4           |

The architecture deliberately keeps the Docker socket behind
`tecnativa/docker-socket-proxy` and has no public ports, which means **most of
the risk that IaC usually mitigates (exposed services, ingress config drift)
is already small**. The genuine IaC gap is host provisioning and guest config.

## 3. Reference Terraform under `infra/iac/`

New files only; nothing existing was modified. Layout:

```
infra/iac/
  README.md                      — overview, provider notes, what's excluded
  .gitignore                     — tfstate/tfvars/lock exclusions
  modules/
    hetzner-server/              — hcloud_server + SSH key + labels
    hetzner-firewall/            — hcloud_firewall, default-deny, optional mgmt-CIDR SSH
    cloudflare-dns/              — CNAMEs for app/lab → <tunnel>.cfargotunnel.com
  examples/production/           — root module wiring all three
```

Providers: `hetznercloud/hcloud ~> 2.0`, `cloudflare/cloudflare ~> 4.0`.

### Honest limitations

- **The production host is a Hetzner AX42-1 dedicated server.** AX-class machines
  are Robot (dedicated) products, not Hetzner Cloud — `hcloud_server` cannot
  create one. The example uses a cloud type (`ccx33`) as a placeholder and
  documents the mismatch in `examples/production/main.tf`. If the host stays
  dedicated, IaC for it means the `hetzner-robot/robot` provider or Ansible,
  not this module.
- **Terraform cannot configure the guest.** Docker, sysctl, UFW, users, and
  `/srv` layout stay in bootstrap.sh regardless; a real adoption would pair
  Terraform (VM + DNS + firewall) with Ansible (guest config).
- **Cloudflare Tunnel is intentionally not modelled.** Provider-managed tunnel
  resources would put the tunnel token in Terraform state; the current
  credentials-file model is arguably better for a single host.
- **`cloudflare_record` vs `cloudflare_dns_record`:** provider v5 renamed the
  resource; the module pins v4 and notes the migration.

## 4. Recommended adoption path

1. **Keep Compose for the application.** `compose.yaml` is already the
   declarative workload definition and is reviewed in CI diffs. Do not move
   containers into Terraform; there is no benefit at one host.
2. **Do not adopt Terraform for the current dedicated host yet.** The AX42 is
   Robot-managed; the `infra/iac/` modules become relevant only if hosting moves
   to Hetzner Cloud (CX/CPX/CCX) or another cloud VPS. At that point:
   - Terraform/OpenTofu owns: VM, SSH keys, cloud firewall, DNS records.
   - Ansible (or a rewritten bootstrap) owns: packages, Docker, sysctl, UFW,
     users, `/srv` tree, network creation.
   - Compose stays unchanged — it runs inside the guest either way.
3. **If a second environment appears** (staging is already planned), copy
   `examples/production/` to `examples/staging/` with `environment = "staging"`,
   `server_type` for a CPX31-class cloud type (note AX41 is also a Robot
   dedicated SKU, not available via hcloud), and staging tunnel ID/subdomains
   (`staging`, `staging-lab`). This is the cheapest moment to justify IaC —
   two hosts is where hand-provisioning starts to drift.
4. **State management, if adopted:**
   - Remote encrypted backend (S3-compatible or Terraform Cloud/HCP Terraform
     free tier). Local state is unacceptable once real resources exist.
   - Locking via the backend; never share state files.
   - Secrets via env vars (`HCLOUD_TOKEN`, `CLOUDFLARE_API_TOKEN`), never in
     `terraform.tfvars` or committed files.
   - `prevent_destroy = true` on the production server module (already set in
     the example).
   - Treat `terraform.tfvars` and `*.tfstate` as secrets; `infra/iac/.gitignore`
     excludes them.
5. **Cheaper intermediate step:** if guest-config drift is the concern before
   any cloud move, convert `bootstrap.sh` into an Ansible playbook rather than
   adopting Terraform — Ansible reaches inside the VM, Terraform does not.

## 5. Validation status

- `terraform` and `tofu` are **not installed** in the environment this was
  authored in, and Docker is unavailable, so `terraform fmt -check` and
  `terraform validate` could not be run.
- The HCL was written to standard formatting (two-space indent, aligned `=`)
  and reviewed by hand. Before any real use, run:

  ```bash
  cd infra/iac/examples/production
  terraform fmt -check -recursive ../../infra/iac   # from repo root: terraform fmt -check infra/iac
  terraform init -backend=false
  terraform validate
  ```

  `terraform init` will need network access to fetch providers; `validate`
  works without credentials. Expect possible minor fixes (provider argument
  names drift between hcloud/cloudflare versions).
