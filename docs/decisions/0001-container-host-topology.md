# ADR 0001 — Container host topology

- **Status:** Accepted. The host stack is checked in under `infra/`; the §7 checks have run in a dev sandbox and once on a dev workstation including a quick-tunnel WebSocket leg, and both still need to run on the DEV-11 origin.
- **Date:** 2026-11-19
- **Issues:** DEV-7 (this decision), DEV-11 (production hosting), DEV-102 (lab orchestration driver),
  DEV-103 (workspace sync), DEV-96 (agent sandbox), DEV-15 (backups), DEV-50 (edge lockdown)
- **Deciders:** Engineering

## 1. Context

Spindle runs a Next.js app, a background worker, and short-lived per-session containers for the lab
(JupyterLab, RStudio, VS Code, terminal) and the agent sandbox. The app already claims a specific
path on `/infrastructure`: Cloudflare at the edge, an outbound-only Cloudflare Tunnel to the origin,
and a private Backblaze B2 bucket. Nothing is built behind those claims yet, and DEV-11 has to pick
a real shape before DEV-10, DEV-102, and DEV-103 can be implemented.

The competing impulses are:

- a single server PC running containers, which is cheap and has zero network hops between the app and
  the sessions, but is a home/office machine with residential power, a dynamic address, and no
  out-of-band recovery;
- a serverless app host plus a separately reached container host, which buys managed scaling and
  isolation but adds a network hop and a second moving part to every lab session;
- a managed container platform, which removes host maintenance but replaces the Docker driver and
  bills per running machine.

The topology has to serve long-lived SSE streams, proxy WebSockets for notebooks, terminals, and dev
servers, keep per-project working sets durable, and stay honest about a privacy-first product where
research files are the customer's data.

### Constraints that cannot be designed around

1. **WebSockets are mandatory.** Jupyter kernels, RStudio, code-server, and the terminal all hold a
   WebSocket open. A host that cannot proxy an upgraded connection cannot run the lab.
2. **SSE must outlive a request timeout.** Agent runs, chat, and automation logs stream for minutes.
   Serverless duration caps force reconnect logic and still cut the longest runs.
3. **The Docker API is the orchestration contract** (DEV-102). Whatever wins must expose a usable
   container API or pay for a driver rewrite.
4. **Files are the product.** Project files live in B2, and the lab sees the same tree as the file
   manager with a bounded sync delay (DEV-103).
5. **Small team, beta traffic.** No 24/7 on-call rotation exists; a topology that needs a cluster
   operator is out of scope.

## 2. Decision drivers

| Driver                    | Why it matters here                                                |
| ------------------------- | ------------------------------------------------------------------ |
| App → container latency   | Every notebook keystroke and terminal byte crosses this hop        |
| SSE and WebSocket support | Both are product features, not edge cases                          |
| Docker socket exposure    | The socket is root-equivalent; the public app must not hold it     |
| Persistent volumes        | `/home` and `/project` must survive restarts and idle stops        |
| B2 bandwidth and sync     | B2 is the durable store; egress and round-trips shape file latency |
| Backup and restore        | A single lost NVMe must not lose a customer's project              |
| Failure domains           | Beta can tolerate hours of downtime, not silent data loss          |
| Monthly cost and caps     | Free tier has to survive a fixed budget                            |

## 3. Options considered

### A. Single-tenant origin server (app, worker, and containers on one box)

One dedicated server runs the app, the worker, Postgres, Valkey, the orchestrator, and all lab and
agent containers. Ingress is a Cloudflare Tunnel; the box accepts no inbound ports. Project working
sets sit on local NVMe and are synced to B2 by a sync worker. Backups go to B2 and a second provider.

- App → container is a Docker bridge hop: sub-millisecond, no TLS, no tunnel.
- SSE and WebSockets are plain HTTP/1.1 or HTTP/2 through the tunnel, bounded only by idle timeouts.
- Docker socket stays on the box and is reached only through a restricted socket proxy.
- Volumes are local NVMe, so `/home` survives restarts and `/project` is fast.
- B2 is the durable copy, not the live mount, so reads do not pay an object round-trip.
- One failure domain for app and sessions, but one bill and one thing to rebuild.

### B. Managed app host plus a separately reached container host

The app and worker run on a managed platform (Vercel or similar); containers run on a dedicated host
reached over a private network or a tunnel.

- Adds 20–60 ms and a tunnel/private-link handshake to every app → container call.
- The managed app host cannot proxy a WebSocket, so a separate proxy tier on the container host is
  still required; the lab path bypasses the app entirely.
- Two failure domains, two deploy pipelines, two sets of secrets, and a control-plane call that has
  to be authenticated across the network.
- File downloads through the managed host are billed per GB, which is the wrong shape for a file
  manager.
- Managed platform duration caps still bound SSE; long runs need a reconnect story.

### C. Managed container platform (for example Fly Machines)

App, worker, and per-session containers all run on a managed container platform with private
networking and per-second billing.

- Best isolation and failure-domain story of the three, and no host to patch.
- Requires replacing the Docker driver with the platform's Machines API, which changes DEV-102's
  scope and image-publishing assumptions from DEV-9.
- Persistent volumes are tied to a machine and region; per-session volumes plus a project cache
  multiply storage cost.
- Per-machine RAM at list price dominates the bill once a dozen sessions stay warm.
- Cold starts and image pulls are outside our control, which puts the 20-second session target at
  risk.

## 4. Decision

**Choose option A: one self-managed, single-tenant origin server, with Cloudflare Tunnel ingress and
B2 as the durable store.** The "server PC" variant is explicitly rejected for production; it is
acceptable as a development box behind Tailscale, not as the origin.

### Host and layout

- **Host:** Hetzner AX42-1 (8C/16T Ryzen 7 PRO, 64 GB RAM, 2 × 512 GB NVMe in RAID1, 1 Gbit/s
  unmetered) in Falkenstein, Ubuntu 24.04 LTS. One box, rebuilt from an Ansible/bootstrap script,
  not hand-configured.
- **Ingress:** `cloudflared` in two replicas, outbound only. In the checked-in stack the replicas
  are containers on the internal `spindle` network. Firewall default-deny inbound; no public
  22/80/443. Admin access through Cloudflare Access or Tailscale, not a public port.
- **Networks:**
  - `spindle` — app, worker, Postgres, Valkey, orchestrator.
  - `spindle-lab` — session containers, the lab proxy, and the orchestrator's session-facing
    interface. No published host ports.
  - `spindle-control` — orchestrator and Docker socket proxy only.
- **Docker socket:** never mounted into the app or worker. A dedicated orchestrator service talks to
  `tecnativa/docker-socket-proxy` with `CONTAINERS=1`, `IMAGES=1`, `NETWORKS=1`, `VOLUMES=1`,
  `POST=1`, and `EXEC=0`, `BUILD=0`, `SWARM=0`, `SYSTEM=0`, `AUTH=0`. The proxy is reachable only on
  `spindle-control`; the app authenticates to the orchestrator over the internal network.
- **Lab proxy:** a small reverse proxy (Caddy or the orchestrator's Go handler) attached to
  `spindle` and `spindle-lab`, reachable by the connectors as `lab-proxy:7000`, and never
  published on a host port. It is exposed only through the tunnel. The proxy verifies a
  short-lived signed session token minted by the app, strips client headers, and upgrades
  WebSockets. Notebook tokens are disabled inside the container because the container has no
  reachable port without the proxy.
- **Session containers:** non-root, `no-new-privileges`, default seccomp, no `--privileged`, no host
  mounts except `/srv/spindle/projects/<project-id>` → `/project`, read-only root with tmpfs `/tmp`,
  writable `/home` volume, `--cpus 1`, `--memory 2g`, `--pids-limit 512`. Agent containers additionally
  get no network (DEV-96).
- **Data:** Postgres 17 and Valkey on the `spindle` network, data on NVMe, WAL archived to B2
  (RPO ≤ 5 min). Nightly restic snapshot of volumes and config to B2 and a Hetzner Storage Box
  (RTO ≈ 2 h, restore test monthly per DEV-15).
- **B2:** project objects are canonical in `b2://spindle-projects/<project-id>/…`; the host keeps a
  working set under `/srv/spindle/projects/<project-id>` and a sync worker reconciles the two
  (details in §5.2). Host backups go to a separate bucket so a project restore cannot overwrite a
  backup.

```
browser
  │ HTTPS / WSS
  ▼
Cloudflare edge (WAF, Turnstile, rate limits)
  │ outbound-only tunnel
  ▼
cloudflared (origin, 2 replicas)
  ├─ app.spindle.app  → app:8080 ────── Next.js app ─┐
  └─ lab.spindle.app  → lab-proxy:7000 ─ lab proxy ───┤
                                                      ├─ spindle      (app, worker, pg, valkey, orchestrator)
                                                      └─ spindle-lab  (session containers, no host ports)
                                                              │
                                                    /srv/spindle/projects  ──sync worker──▶ B2
```

### Capacity and scaling

Launch cap is **12 concurrent lab sessions** per 64 GB box (2 GB each), leaving room for the app,
worker, Postgres, and page cache. Sessions are limited by the orchestrator; the 13th request queues.
When sustained use passes 12 for a week, resize to AX102-1 (128 GB) before splitting the host.
Vertical scaling is the plan until a second host is justified by uptime, not by RAM.

## 5. Networking assumptions handed to other issues

### 5.1 Lab orchestration (DEV-102)

- The app never addresses a container by host port. The orchestrator joins `spindle-lab`, resolves
  the container's DNS name there (for example `lab-<session-id>:8888`), and returns the proxy URL
  `/lab/<session-id>/…` to the browser.
- The lab proxy joins both `spindle` (so the connectors reach `lab-proxy:7000`) and `spindle-lab`
  (so it reaches `lab-<session-id>:8888`). It publishes no host port.
- The proxy must forward `Upgrade`/`Connection` headers, disable response buffering, and allow at
  least one hour of connection lifetime. Jupyter heartbeats every 30 s; the proxy sends its own
  ping every 30 s so Cloudflare's 100 s idle limit is never reached.
- Session start: create container with deterministic labels, attach to `spindle-lab`, wait for the
  image health endpoint, mint a proxy token, return the endpoint. Warm start target is 20 s; images
  are pre-pulled by a nightly job, so a warm start is create + health, not pull.
- Orphan sweep runs on boot and hourly; idle stop after 30 min with no WebSocket and no kernel
  activity, with a five-minute warning in the UI.
- The Docker socket is never reachable from a session container. `DOCKER-USER` rules block session
  traffic to `169.254.169.254`, the host's private addresses, Postgres, Valkey, and the socket proxy.
  Session egress to the internet stays open for package installs, with DNS through the host resolver.

### 5.2 Workspace sync (DEV-103)

- Canonical copy is B2. Working set is `/srv/spindle/projects/<project-id>` on NVMe.
- File-manager writes go to B2 first, then the sync worker pulls the object to the working set;
  container writes are caught by inotify, debounced 1 s, and uploaded. A file created in Jupyter
  is expected in the file manager in 1–3 s, inside the five-second target.
- Conflict policy is last-write-wins with a version entry in the sync log and a lab banner, backed by
  B2 object versioning (DEV-49).
- `/home` is a per-session volume on NVMe, retained seven days after the session ends, then removed;
  it is not synced to B2.
- Quota is enforced by the sync worker before upload, and the file manager finalize path rejects
  writes over quota. Container writes that would exceed quota are allowed to land locally, then
  flagged and refused on flush; the UI shows the over-quota state rather than silently truncating.
- B2 reads are served from the working set, so typical egress stays well inside the 3× free
  allowance; a cold project hydration is the only large read.
- There is no rclone FUSE mount of B2 in the session container. The FUSE path was rejected because a
  network stall becomes a hung notebook and because per-object round-trips break the five-second
  target.

### 5.3 Hosting (DEV-11)

- The tunnel is the only ingress; there is no origin IP to lock down beyond the firewall.
- Staging is a second, smaller Hetzner instance (CPX31 or AX41) with its own database, buckets, and
  keys, reached at `staging.spindle.app` through the same tunnel account.
- Spending caps: Hetzner project budget alert, B2 bucket cap alerts, and Cloudflare notifications;
  no autoscaling means no surprise compute bill.
- Session capacity is a hard limit in the orchestrator, so a traffic spike degrades to a queue, not
  an invoice.

## 6. Consequences

### Positive

- One hop between app and sessions; the 20 s session target is achievable without tuning a network.
- WebSockets and SSE work without a serverless duration or upgrade workaround.
- One host to patch, back up, and rebuild, which is realistic for the current team.
- Local NVMe for working sets keeps the file manager fast and B2 egress low.
- The topology matches the public `/infrastructure` story instead of contradicting it.

### Negative

- App and lab share a failure domain; a host or Docker daemon failure takes both down.
- We own kernel, Docker, Postgres, and backup maintenance. There is no managed control plane.
- Vertical scaling has a ceiling; multi-host isolation is future work.
- The Docker socket remains a high-value target, mitigated but not eliminated by the proxy.

### Known single points of failure

| Single point                      | Impact                    | Mitigation                                                      | Accepted for beta |
| --------------------------------- | ------------------------- | --------------------------------------------------------------- | ----------------- |
| The host (power, network, kernel) | Full outage               | Rebuild script, B2 + Storage Box restore, external uptime alert | Yes, RTO ≈ 2 h    |
| Docker daemon                     | App and all sessions stop | `restart: unless-stopped`, systemd watchdog, boot sweep         | Yes               |
| Postgres primary                  | Writes fail               | WAL archive to B2, PITR, monthly restore test                   | Yes, RPO ≤ 5 min  |
| `cloudflared`                     | Ingress fails             | Two replicas, Cloudflare health checks                          | Yes               |
| B2 region                         | File reads and sync fail  | Retry with backoff, working set serves reads                    | Yes               |
| Deploy pipeline                   | Bad release               | Immutable images, health-gated rollback (DEV-10)                | Yes               |
| Provider account                  | Total loss                | Hardware 2FA, scoped keys, off-provider backups (DEV-8)         | Yes               |

### Cost model (list prices, checked 2026-11-19, excluding VAT/tax)

| Line                              | Option A                                    | Option B                                      | Option C                                                  |
| --------------------------------- | ------------------------------------------- | --------------------------------------------- | --------------------------------------------------------- |
| Compute                           | €99/mo AX42-1 incl. IPv4 ($117) + €49 setup | $60 Vercel Pro (3 seats) + €99 container host | $27 app + $13 worker + $38 managed Postgres + ~$10 Valkey |
| Sessions                          | included in host                            | included in container host                    | 20 × 2 GB shared-cpu ≈ $268 always-on, ≈ $134 at 12 h/day |
| Volumes                           | included (RAID1 NVMe)                       | included                                      | 200 GB × $0.15 ≈ $30                                      |
| B2 (2 TB, egress within 3×)       | ≈ $14                                       | ≈ $14                                         | ≈ $14                                                     |
| Cloudflare Pro                    | $20 (annual)                                | $20                                           | $20                                                       |
| Off-box backup (1 TB Storage Box) | ≈ €4                                        | ≈ €4                                          | ≈ €4                                                      |
| **Approximate monthly**           | **$155–185**                                | **$215–245 plus per-GB egress**               | **$275–400**                                              |

Option C removes host maintenance but roughly doubles the bill at beta concurrency and requires a
driver rewrite. Option B costs more than A for a slower app → container path and two failure domains.
Option A leaves budget for a staging box and still fits the free-tier economics.

Sources: Hetzner price adjustment notice and AX42 product page (June 2026 prices), Fly.io Machines
pricing (October 2026 update), Cloudflare plans page, Backblaze B2 pricing ($6.95/TB-month, free
egress up to 3× stored, then $0.01/GB).

## 7. Verification

Run on the DEV-11 origin before calling the topology done. `scripts/hosting/verify-topology.sh`
automates the container-network half; the tunnel leg still needs a signed session token.

The container-network half ran on 2026-11-19 against a rootless Docker Engine 29.10.0 in a development
sandbox, not on the origin: the probe container started on `spindle-lab` with no published port,
Caddy upgraded a WebSocket and echoed a frame, an orchestrator-like container resolved `ws-probe`
over the network, and warm start to first byte was 1.0–1.9 s across runs (target < 20 s).

The run also showed that `host.docker.internal` resolves to the Docker bridge gateway on Linux and
cannot reach a service bound to `127.0.0.1`, so a host-loopback lab proxy would be unreachable
from a connector container. The route is therefore `lab-proxy:7000` on the internal `spindle`
network. The checked-in script now runs that route directly: the proxy and a connector-side client
share `spindle`, and a session-like container with no published port sits on `spindle-lab`.

A second run on 2026-11-19 exercised the tunnel leg end-to-end on a development workstation
(rootless Docker Engine 29.10.0, the same version as the sandbox run) behind a Cloudflare quick
tunnel (`cloudflared tunnel --url`, which needs no account). The connector ran as a container on
`spindle` pointed at `ws-probe-proxy:7000`, matching the production route:

- `GET /lab/probe/health` through `https://<random>.trycloudflare.com`: HTTP 200.
- WebSocket upgrade and echo through `wss://<random>.trycloudflare.com/lab/probe/ws`: PASS via
  `scripts/hosting/ws-probe.mjs`. `wscat` produced no output in that environment, so the repo's
  own probe client was the authoritative check.
- Warm start to first byte: 1.2 s.
- Idle lifetime: a WebSocket with no traffic was closed by the edge at ~125 s (code 1006),
  consistent with Cloudflare's ~100 s idle limit; the same socket with a 30 s ping stayed open
  past 150 s. This confirms the lab proxy must send its own ping every 30 s as specified in §5.1.

This validates the edge → tunnel → proxy → session-container path, but it is not the DEV-11
origin: the host is a workstation, the tunnel is an ephemeral quick tunnel rather than the named
`tunnel run` with DNS routes, and the proxy is the §7 probe Caddyfile, not the DEV-102 lab proxy
with token verification. The leg still has to be repeated on the Hetzner origin.

```bash
# 1. Start a container with no published port on the lab network.
docker network create spindle 2>/dev/null || true
docker network create spindle-lab 2>/dev/null || true
docker run -d --name ws-probe --network spindle-lab \
  --read-only --tmpfs /tmp --memory 512m --cpus 0.5 \
  --label spindle.session=probe jmalloc/echo-server

# 2. Start the probe proxy on the ingress network, attach it to the lab
#    network, then upgrade a WebSocket from a container on `spindle`.
#    (Caddy: reverse_proxy /lab/probe/* ws-probe:8080, header_up Connection {http.header.Connection})
docker run -d --name ws-probe-proxy --network spindle \
  --read-only --tmpfs /tmp --tmpfs /config --tmpfs /data \
  -v "$PWD/infra/verify/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine
docker network connect spindle-lab ws-probe-proxy
docker run --rm --network spindle \
  -v "$PWD/scripts/hosting:/probe:ro" node:22-alpine \
  node /probe/ws-probe.mjs ws://ws-probe-proxy:7000/lab/probe/ws
# expect: PASS: WebSocket upgrade and echo

# 3. Repeat through the tunnel with a signed session token.
cloudflared tunnel run
wscat -c wss://lab.spindle.app/lab/probe/ws -H "Authorization: Bearer $SPINDLE_SESSION_TOKEN"
# expect: connected, echo, and no buffering of partial frames

# 4. Measure warm start to first byte (the script reports it) and orchestrator → container RTT.
docker run --rm --network spindle curlimages/curl:latest \
  -fsS http://ws-probe-proxy:7000/lab/probe/health
docker exec orchestrator getent hosts ws-probe
```

Record the results on DEV-11. If the proxy cannot hold a WebSocket open for an hour through
Cloudflare, revisit option B before building DEV-102 on top of this.

## 8. Revisit triggers

Reopen this decision if any of these becomes true:

- The product needs a 99.95% availability commitment, which one host cannot offer.
- Sustained lab concurrency passes 12 and a resize to 128 GB no longer leaves headroom.
- A compliance requirement forbids running customer data on self-managed hardware.
- Cloudflare's tunnel or idle limits break long sessions in a way the proxy cannot work around.
