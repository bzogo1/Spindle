# Service mesh evaluation

- **Status:** Evaluated — no mesh deployed. Revisit triggers in §6.
- **Date:** 2026-11-19
- **Related:** ADR 0001 (`docs/decisions/0001-container-host-topology.md`),
  `infra/origin/compose.yaml`, `infra/origin/cloudflared/config.yml`,
  `docs/runbooks/hosting.md`, `docs/decisions/0002-secrets-management.md`
- **Scope:** Whether Spindle should run a service mesh (Istio, Linkerd, Cilium
  Service Mesh) or an equivalent for mTLS, service discovery, or traffic
  policy. Reference-only example configs live in `infra/mesh/`; nothing there
  is deployed.

## 1. Current topology

One self-managed Hetzner AX42-1 (64 GB RAM, 2 × 512 GB NVMe RAID1) runs the
whole production stack as Docker Compose services
(`infra/origin/compose.yaml`):

| Service                  | Role                                                          | Networks joined          |
| ------------------------ | ------------------------------------------------------------- | ------------------------ |
| `app`                    | Next.js app, `app:8080`, only loopback-published host port    | `spindle`                |
| `worker`                 | Background worker (B2 sync reconciliation, DEV-103)           | `spindle`                |
| `postgres`               | Postgres 17, `POSTGRES_PASSWORD` from env, healthy-gated      | `spindle`                |
| `valkey`                 | Valkey 8 cache/queue, AOF, 512 MB cap                         | `spindle`                |
| `docker-socket-proxy`    | Scoped Docker API for the orchestrator (DEV-102), no `EXEC`   | `spindle-control`        |
| `cloudflared-1/2`        | Two tunnel connectors, sole ingress to `app` and `lab-proxy`  | `spindle`                |
| session containers (lab) | JupyterLab/RStudio/VS Code/terminal, created on `spindle-lab` | `spindle-lab` only       |
| `lab-proxy` (DEV-102)    | WebSocket/SSE proxy, joins `spindle` + `spindle-lab`          | `spindle`, `spindle-lab` |

Networks (created by `infra/host/bootstrap.sh`, consumed as `external` in
compose):

- `spindle` — app, worker, postgres, valkey, connectors, lab-proxy, orchestrator.
- `spindle-lab` — session containers and the lab proxy only; a session can
  never resolve Postgres, Valkey, the app, or the socket proxy.
- `spindle-control` — `--internal`, only the orchestrator and socket proxy.

There is no Kubernetes, no multi-node cluster, and no public inbound port of
any kind: the only ingress is the outbound-only Cloudflare Tunnel, and admin
access is Cloudflare Access or Tailscale
(`docs/runbooks/hosting.md` §1).

## 2. Inter-service communication surface

This is the decisive input for the mesh question. Enumerating every
service-to-service path that exists or is specified today:

| Path                                            | Protocol  | Auth today                                                                                              | Source of truth                                         |
| ----------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| browser → `cloudflared` → `app`                 | HTTPS/WSS | Cloudflare edge (WAF, Turnstile, rate limit)                                                            | `infra/origin/cloudflared/config.yml`                   |
| browser → `cloudflared` → `lab-proxy` → session | HTTPS/WSS | edge + per-session proxy token (DEV-102)                                                                | ADR 0001 §5.1                                           |
| `app` → `postgres`                              | TCP 5432  | password in `DATABASE_URL`, TLS via `sslmode` if configured                                             | `src/lib/db/pool.ts`, `src/lib/database-url.ts`         |
| `app` → `worker`                                | HTTP      | `WORKER_SECRET` shared bearer (`WORKER_SECRET_PREVIOUS` for rotation) — specified, no `src/` caller yet | `src/lib/secrets/catalog.ts` lines ~130–145             |
| `app`/`worker` → `valkey`                       | TCP 6379  | none (network isolation only)                                                                           | compose `valkey` service; no app code references it yet |
| `app` → B2, Resend, LLM APIs                    | HTTPS     | provider credentials via Infisical                                                                      | `src/lib/secrets/catalog.ts`                            |
| orchestrator → Docker API                       | TCP       | socket-proxy scoping (`EXEC=0`, etc.)                                                                   | compose `docker-socket-proxy` env                       |
| session → `lab-proxy`                           | HTTP/WS   | proxy token                                                                                             | ADR 0001 §5.1                                           |

Notably absent:

- **No service-to-service mesh-style calls.** The only internal HTTP call is
  the specified app → worker path, which is already designed to carry a
  dedicated rotating bearer secret (no `src/` code calls `worker` yet).
- **No dynamic discovery problem.** Every upstream is a stable Compose DNS
  name (`app`, `worker`, `postgres`, `valkey`) on a single host. There is no
  replica set, no autoscaler, and no second host to route to.
- **No east-west traffic between sessions.** `spindle-lab` is deliberately
  isolated so sessions cannot reach each other or the control plane — a mesh
  would add nothing here; the requirement is the opposite (deny-by-default).

## 3. What a mesh would actually buy

| Capability                     | Would it help here? | Why                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| mTLS between services          | Marginal            | Traffic never leaves one Docker bridge network on one host. The realistic threats are a compromised container sniffing plaintext on the bridge, or lateral movement — both better addressed by network segmentation (§5) and by Postgres/Valkey auth, which already exist or are trivial to add. mTLS adds certificate lifecycle (issuance, rotation, revocation) for ~5 long-lived peers. |
| Service discovery              | None                | Compose DNS already resolves every name; there is one replica per service.                                                                                                                                                                                                                                                                                                                 |
| Traffic policy / RBAC          | Marginal            | L7 authorization policies are interesting, but the equivalent is three Docker networks that already exist and are enforced by the kernel, not a sidecar.                                                                                                                                                                                                                                   |
| Observability (golden signals) | Some                | Mesh metrics are nice, but the app already has tracing/logging (`src/lib/tracing`, `src/lib/logging`), and `docker stats`/container metrics cover the host. Not worth a control plane.                                                                                                                                                                                                     |
| Zero-trust identity            | Overkill            | The threat model is a single trusted operator team on one box; "who is calling" is answered by which container, which Compose networks already constrain.                                                                                                                                                                                                                                  |

## 4. Candidate evaluation

### Istio

- Requires Kubernetes (or a very painful ambient-mode Docker setup that is not
  supported). Our stack is Compose on a single host — adopting Istio means
  adopting K8s first, i.e. migrating the entire topology away from ADR 0001's
  "one host, one compose file" simplicity.
- Sidecar per pod doubles the container count and memory footprint for zero
  gain at this scale. **Rejected.**

### Linkerd

- Also Kubernetes-first (Rust micro-proxy sidecars, `linkerd` CLI + Helm).
  Same disqualifier: no K8s, no mesh. Even its "automatic mTLS" is
  cluster-scoped identity — meaningless with four containers.
- Its reference values are kept in `infra/mesh/linkerd-values.yaml` only so
  the shape is documented if the platform ever moves to K8s. **Rejected for
  now.**

### Cilium Service Mesh

- Cilium is the most plausible fit _if_ the host ever runs Kubernetes, because
  eBPF gives service mesh capabilities (mTLS, L7 policy, Hubble observability)
  without per-pod sidecars, and `cilium install` can replace the Docker
  networking layer entirely.
- But on today's Compose topology there is no Cilium datapath — containers use
  the standard Docker bridge. You cannot "add Cilium" to a Compose stack
  without converting it to a Cilium CNI/Kubernetes setup.
- If we ever outgrow one host, Cilium (or its `clustermesh`) is the mesh to
  evaluate first, precisely because it avoids sidecars on resource-constrained
  session hosts. Reference values: `infra/mesh/cilium-values.yaml`. **Deferred.**

### Verdict

**No mesh.** Every candidate presumes either Kubernetes or a multi-host
cluster we deliberately do not run. The cost is a control plane, per-service
proxies or an eBPF dataplane, certificate plumbing, and a second operational
model — for a topology whose entire east-west surface is four containers on
one bridge network. This matches ADR 0001's negative consequence ("we own
maintenance; no managed control plane") and its revisit triggers (§8 there).

## 5. What we do instead (already in place or cheap)

The security goals a mesh would serve are already covered:

1. **Network segmentation** — the three-network split (`spindle`,
   `spindle-lab`, `spindle-control`) is enforced by the kernel and already
   prevents sessions from reaching Postgres/Valkey/app/socket-proxy
   (ADR 0001 §5.1, compose `networks:` block). `spindle-control` is
   `--internal` so it has no egress at all.
2. **Ingress is already zero-trust-ish** — Cloudflare is the only path in;
   the origin publishes only `127.0.0.1:8080` for health checks. Adding
   Cloudflare Access policies in front of `app.spindle.app` / `lab.spindle.app`
   (the runbook already recommends Access for admin) is the highest-value
   "edge auth" upgrade and costs nothing at the origin.
3. **App-layer auth on internal calls** — `WORKER_SECRET` with dual-key
   rotation (`src/lib/secrets/catalog.ts`) is the app→worker equivalent of
   service identity. Postgres uses password auth over the private network;
   enabling `sslmode=require` in `DATABASE_URL` adds transport encryption
   without any mesh.
4. **Socket-proxy scoping** — the Docker API surface is already reduced to
   the minimum (`EXEC=0`, `BUILD=0`, `SYSTEM=0`), which is a better control
   than any mesh policy.
5. **Docker networks segmentation is sufficient** — if a future need arises
   (e.g. isolate `postgres`/`valkey` onto a `spindle-data` network reachable
   only by `app` and `worker`), the fix is a compose network change, not a
   mesh. This is the recommended escalation path.

## 6. When to revisit

A mesh (Cilium first, Linkerd second, Istio only with K8s) becomes worth
re-evaluating when **any** of these becomes true — consistent with ADR 0001
§8 but sharper:

- The platform moves to Kubernetes or a second host joins the compose fleet;
  east-west traffic then crosses a real network boundary where mTLS and L7
  policy stop being free.
- A compliance requirement (SOC 2, HIPAA-adjacent customer contract) demands
  cryptographic service identity or mTLS on all internal traffic.
- Session containers or third-party images must call internal services
  directly, breaking the current "sessions reach only `lab-proxy`" rule —
  per-identity policy would then be needed at L7.
- The internal call surface grows past ~5 authenticated peers such that
  per-service bearer secrets become an unmanageable rotation matrix.
- Postgres/Valkey need to be reachable from more than `app`+`worker` and
  password-only auth is deemed insufficient.

Until then, the honest answer is: the mesh solves a multi-host, dynamic
routing problem we do not have, on hardware we fully control, behind an edge
that already terminates and authenticates all ingress.

## 7. Reference configs

`infra/mesh/` contains Helm values sketches for Linkerd and Cilium, marked
**non-deployed reference only**. They exist so the "if we ever go K8s" shape
is a 30-minute decision instead of a fresh evaluation. Do not apply them to
any environment.
