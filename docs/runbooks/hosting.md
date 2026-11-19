# Runbook — provisioning and verifying the origin host

This runbook implements ADR 0001 for DEV-11: one self-managed Hetzner origin runs the app, worker,
Postgres, Valkey, and the session orchestrator. Cloudflare Tunnel is the only ingress. A second,
smaller instance runs staging with its own database, buckets, and keys.

The checked-in assets are:

| Path                                   | Purpose                                                         |
| -------------------------------------- | --------------------------------------------------------------- |
| `infra/host/bootstrap.sh`              | Installs Docker, creates directories/networks, seeds host.env   |
| `infra/origin/compose.yaml`            | App, worker, Postgres, Valkey, socket proxy, and two connectors |
| `infra/origin/cloudflared/config.yml`  | Production ingress for `app.spindle.app` and `lab.spindle.app`  |
| `infra/origin/host.env.example`        | Production host values; copy to `/srv/spindle/host.env`         |
| `infra/staging/cloudflared/config.yml` | Staging ingress for `staging.spindle.app`                       |
| `infra/staging/host.env.example`       | Staging host values; copy to `/srv/spindle-staging/host.env`    |
| `.github/workflows/deploy-staging.yml` | Deploys every push to `main` to staging                         |
| `scripts/hosting/verify-topology.sh`   | Runs the ADR §7 container, WebSocket, and warm-start checks     |

## 1. Host baseline

- **Production:** Hetzner AX42-1 (8C/16T, 64 GB RAM, 2 × 512 GB NVMe RAID1), Ubuntu 24.04 LTS,
  Falkenstein, 1 Gbit/s.
- **Staging:** one smaller instance (CPX31 or AX41) in the same project. It is a separate host,
  not a second stack on production.
- **Admin access:** Cloudflare Access or Tailscale. There is no public 22/80/443 and the tunnel is
  outbound-only.
- **Capacity:** the orchestrator caps lab sessions at 12. A spike queues; it never buys capacity.

Install the OS with the NVMe pair in RAID1 and `/srv` on the array. Do not hand-configure the rest:
run the bootstrap script.

```bash
sudo SPINDLE_APPLY_FIREWALL=1 ./infra/host/bootstrap.sh
```

The firewall step is opt-in because default-deny inbound cuts any SSH session that is not already
tunnelled. Confirm admin access first, then apply it. The script creates the `spindle` user without
a password; install the deploy user's SSH key through Cloudflare Access or Tailscale before the
firewall is enabled. The script never overwrites an existing `host.env` or tunnel credentials file.

`/srv/spindle/projects` is the working set that the sync worker reconciles with B2 (DEV-103).
`/srv/spindle/home` is scratch space for per-session home volumes. Neither is part of the compose
stack's named volumes.

## 2. Cloudflare Tunnel

Create one tunnel per environment from an admin machine with `cloudflared` installed. Keep the
credentials JSON off the repository.

```bash
# Production
cloudflared tunnel login
cloudflared tunnel create spindle-prod
cloudflared tunnel route dns spindle-prod app.spindle.app
cloudflared tunnel route dns spindle-prod lab.spindle.app

# Staging
cloudflared tunnel create spindle-staging
cloudflared tunnel route dns spindle-staging staging.spindle.app
cloudflared tunnel route dns spindle-staging staging-lab.spindle.app
```

Copy the generated `<uuid>.json` to the host with mode `0600`:

```bash
sudo install -d -m 0700 -o spindle -g spindle /srv/spindle/secrets/cloudflared
sudo install -m 0600 -o spindle -g spindle <uuid>.json \
  /srv/spindle/secrets/cloudflared/credentials.json
```

Fill in `/srv/spindle/host.env` from `infra/origin/host.env.example`:

- `SPINDLE_APP_IMAGE` / `SPINDLE_WORKER_IMAGE` — pinned tags published by CI, never `latest`.
- `CLOUDFLARE_TUNNEL_ID` — the UUID of `spindle-prod`.
- `INFISICAL_PROJECT_ID` / `INFISICAL_TOKEN` — the deploy identity scoped to `prod:/app` and
  `prod:/worker` (see `docs/decisions/0002-secrets-management.md`).
- `POSTGRES_PASSWORD` — the same password used by `DATABASE_URL` in Infisical, with hostname
  `postgres`.

`docker compose` reads this file with `--env-file`; it is not baked into an image. The entrypoint
then injects the application secrets from Infisical at container start.

Start the stack:

```bash
cd /srv/spindle
sudo docker compose --env-file host.env pull
sudo docker compose --env-file host.env up -d --wait
sudo docker compose --env-file host.env ps
```

Two `cloudflared` connectors run on the same tunnel. If one connector or edge connection fails,
the other keeps ingress up. They forward `app.spindle.app` to `app:8080` and `lab.spindle.app`
to `lab-proxy:7000` over the internal `spindle` network; nothing is published on a public host
port. The orchestrator, the proxy, and the session containers belong to DEV-102; they attach to
the externally created `spindle`, `spindle-lab`, and `spindle-control` networks and are not part
of this stack. The lab proxy must join both `spindle` and `spindle-lab`.

## 3. Staging

Staging is a separate Hetzner instance with:

- its own Postgres volume and database password;
- its own B2 bucket and Resend/LLM credentials in the Infisical `staging` environment;
- its own tunnel (`spindle-staging`) and credentials;
- the same app and worker images, tagged with the commit SHA.

Bootstrap it with its own root, then copy `infra/staging/host.env.example` to
`/srv/spindle-staging/host.env` and fill in the staging tunnel ID, credentials path, and image
repositories. The deploy workflow uploads the staging tunnel ingress, so the origin config that the
bootstrap seeds is replaced on the first deploy.

```bash
sudo SPINDLE_ROOT=/srv/spindle-staging SPINDLE_APPLY_FIREWALL=1 ./infra/host/bootstrap.sh
```

The workflow `.github/workflows/deploy-staging.yml` runs on every push to `main`:

1. Uploads `infra/origin/compose.yaml` and `infra/staging/cloudflared/config.yml` to the host.
2. Pulls the app and worker images tagged with `$GITHUB_SHA`.
3. Runs `docker compose up -d --wait`.
4. Fetches `https://staging.spindle.app/` and fails the run when it does not answer.

Configure the `staging` GitHub environment:

| Kind     | Name                   | Value                                               |
| -------- | ---------------------- | --------------------------------------------------- |
| Secret   | `STAGING_HOST`         | Staging host name or address                        |
| Secret   | `STAGING_USER`         | Deploy user with Docker access                      |
| Secret   | `STAGING_SSH_KEY`      | Private key for that user                           |
| Secret   | `STAGING_KNOWN_HOSTS`  | Pinned `known_hosts` line for the host              |
| Variable | `STAGING_APP_IMAGE`    | Image repository, without the tag                   |
| Variable | `STAGING_WORKER_IMAGE` | Worker image repository, without the tag            |
| Variable | `STAGING_URL`          | Optional; defaults to `https://staging.spindle.app` |

The workflow does not build images. It expects the commit's images to exist from the image
pipeline (DEV-9) and the release job (DEV-10). Production promotion is deliberately separate and
manual.

## 4. Spending caps

The origin is a fixed-cost box with no autoscaling, so a traffic spike degrades to a queue instead
of a larger bill. The beta estimate is $155–185/month for the AX42-1, B2 (~2 TB), Cloudflare Pro,
and the off-box backup, plus Sentry; staging is a smaller instance on top. Set both a provider cap
where one exists and an alert where one does not.

| Provider   | Control                             | Setting                                                             |
| ---------- | ----------------------------------- | ------------------------------------------------------------------- |
| Hetzner    | Project budget alert                | Alert at €200/month; resize only after a documented capacity review |
| Hetzner    | Lab concurrency ceiling             | 12 concurrent sessions in the orchestrator; the 13th queues         |
| Backblaze  | Caps & Alerts on the project bucket | Hard cap at 3 TB stored; alert at 2.5 TB; object versioning on      |
| Cloudflare | Notifications                       | Tunnel unhealthy, 5xx rate, and bandwidth alerts on the Pro plan    |
| Sentry     | Organization spend cap              | $20/month; source maps still upload from CI                         |
| Resend     | Plan sending limit                  | Beta quota only; no automatic upgrade                               |
| LLM        | Provider project budget             | $100/month hard limit on the production key                         |

Hetzner does not expose a hard spend cap, so the compute cap is structural: one fixed host, no
autoscaling, and a hard session ceiling in the orchestrator. Backblaze is the only provider where a
hard stored-byte cap is enforced by the vendor.

## 5. Verification

Run the ADR §7 proof on the origin after the stack is up:

```bash
sudo ./scripts/hosting/verify-topology.sh
```

It checks that:

1. A probe container starts on `spindle-lab` with no published port.
2. The proxy on `spindle`, attached to both networks, upgrades a WebSocket from a
   connector-side container and echoes a frame without publishing a port.
3. The orchestrator resolves the probe over the private network, when
   `SPINDLE_RUNTIME_CONTAINER` names its container.
4. Warm start to first byte stays under 20 seconds.

The container-network half was executed on 2026-11-19 against Docker 29.10.0: no published probe
port, a WebSocket upgrade and echo through the proxy on `spindle`, DNS resolution over
`spindle-lab`, and a 1.0–1.9 s warm start across runs. The tunnel leg needs a signed session token and `wscat`, and is skipped unless both
are present:

```bash
SPINDLE_LAB_URL=wss://lab.spindle.app \
SPINDLE_SESSION_TOKEN="<signed-session-token>" \
sudo -E ./scripts/hosting/verify-topology.sh
```

Record the measured values on DEV-11. If the proxy cannot hold a WebSocket open for an hour through
Cloudflare, revisit option B in ADR 0001 before building DEV-102 on top of this.

The `/infrastructure` page's request trace should agree with the deployed topology: Cloudflare edge,
outbound tunnel, origin, and the private lab network.

## 6. Remaining host actions

The repository side of DEV-11 is complete, but these are physical-account actions and are tracked
on the issue:

- [ ] Provision the production AX42-1 and the staging instance, then run the bootstrap.
- [ ] Create both tunnels and DNS routes; install the credentials with mode `0600`.
- [ ] Populate the Infisical `prod` and `staging` environments and scope the deploy identities.
- [ ] Create the staging GitHub environment and its secrets/variables.
- [ ] Set the provider caps and alerts in §4.
- [ ] Run `scripts/hosting/verify-topology.sh` on the origin and record the numbers.

Backups, restore tests, migration policy, and the deploy pipeline are DEV-15, DEV-12, and DEV-10;
this runbook only covers where the services run and how staging is reached.
