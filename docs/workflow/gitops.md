# GitOps assessment

This document evaluates adopting a GitOps model (ArgoCD, Flux, or a
pull-based equivalent) for this repository's deployment pipeline, records the
"git as source of truth" practices already in place, and lays out an adoption
path. It complements `docs/deploy/staging.md` (how deploys run today) and
`docs/runbooks/hosting.md` (host topology).

**Verdict up front: a full GitOps controller is probably overkill today.** The
pipeline is a single push-based deploy to one staging host and a manual
promotion to one production host. GitOps pays off when reconciliation,
drift detection, or multi-environment fan-out become real problems — see
§5 for the triggers that would change this verdict.

## 1. Current deploy flow (push model)

```
push to main
  └─ CI (ci.yml): lint, typecheck, unit, migrations, build, e2e
  └─ deploy-staging.yml
       preflight  validate-config.mjs — repo wiring checks, no secrets
       deploy     scp compose.yaml + cloudflared config + remote-deploy.sh
                  to the host, then ssh remote-deploy.sh <app>:<sha>
                  <worker>:<sha>
       smoke      smoke-test.mjs against https://staging.spindle.app
```

Key properties:

- **Images are built outside this repo's deploy path** and tagged with the
  pushed commit SHA (`github.sha`); tags are immutable (ADR 0001).
- **The host pulls, it does not watch.** `scripts/deploy/remote-deploy.sh`
  runs `docker compose pull` + `up -d --wait` with the image refs exported
  for that run only. Nothing on the host reconciles afterwards.
- **`host.env` on the host is the runtime config**, seeded from
  `infra/*/host.env.example` and never committed (secrets stay in Infisical).
- **Production promotion is manual** (DEV-10): same images, separate host,
  separate runbook steps.
- **Rollback is image-tag based**: re-dispatch the workflow with a previous
  `image_tag`, or use `scripts/deploy/rollback.mjs`, which keeps a release
  store under `<DEPLOY_DIR>/releases/` — flat env files pinning
  `SPINDLE_APP_IMAGE`/`SPINDLE_WORKER_IMAGE` plus a `current` symlink.

## 2. What GitOps would add — and what it would cost

GitOps inverts the flow: a controller on the host (or cluster) watches a git
repo and continuously reconciles the cluster/host state to match it.

What it would buy here:

- **Drift detection and self-healing.** Today, if someone runs
  `docker compose up` by hand on the host or a container is restarted with a
  stale image, nothing notices until the next deploy or a smoke test fails.
  A controller would flag or undo that automatically.
- **Git as the audit log.** "What is deployed?" becomes `git log` on the
  manifest repo rather than SSHing to the host and reading `docker ps`.
- **Rollback as `git revert`.** Instead of remembering SHAs and re-dispatching
  workflows, promotion state lives in git history.
- **Multi-environment fan-out.** If staging and production (and future
  regions/tenants) all reconcile from the same repo with per-env overlays,
  promotion becomes a merge/PR rather than a manual runbook.

What it would cost:

- **A controller to run and secure.** ArgoCD or Flux is another always-on
  service with its own credentials (repo read access, cluster/host access),
  upgrades, and RBAC. On a single self-managed host behind a Cloudflare
  Tunnel with default-deny inbound, that is a new attack surface and a new
  thing to monitor — for one host.
- **A manifests repo or directory.** Compose files are uploaded per-deploy
  today; GitOps wants them versioned in git (they already are, under
  `infra/`), plus rendered per-environment state. Image tags are SHAs
  produced by CI _after_ the commit lands, so something must write the tag
  back to git (Flux image automation, ArgoCD Image Updater, or a CI commit)
  or the controller would redeploy stale tags.
- **Compose is not Kubernetes.** ArgoCD/Flux manage Kubernetes natively.
  Applying them to this stack means either migrating the stack to k8s
  (a large architectural change — see ADR 0001, which deliberately chose a
  compose topology) or running a non-standard integration. This is the
  single biggest honest caveat: **on a docker-compose host, "GitOps" mostly
  means either k8s migration or a lightweight pull-based reconciler, not
  ArgoCD.**
- **Secrets still live outside git.** `host.env` and Infisical-injected
  secrets would remain host-side regardless; GitOps does not remove that
  boundary, it only manages the non-secret desired state.

## 3. "Git as source of truth" practices already present

The repo is already closer to GitOps than a typical push deploy:

| Practice                           | Where                                                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Infrastructure as code in the repo | `infra/` — `origin/compose.yaml`, cloudflared configs, `host.env.example`, bootstrap, WAF/TLS/ddos rules |
| Immutable, git-derived image tags  | `github.sha` tags; never `latest`                                                                        |
| Declared desired state on the host | `releases/*.env` + `releases/current` symlink (`scripts/deploy/rollback.mjs`)                            |
| Preflight drift checks             | `scripts/deploy/validate-config.mjs` in CI before any host contact                                       |
| Serialized, observable deploys     | `concurrency.group: deploy-staging`, step summaries, smoke tests                                         |
| Documented rollback                | `docs/deploy/staging.md` §Rolling back, `rollback.mjs`                                                   |
| Secrets kept out of git            | Infisical + `host.env` on host only (ADR 0002)                                                           |

The missing piece versus GitOps is **continuous reconciliation**: nothing
verifies after the deploy job exits that the host still matches git. That gap
is small enough to close without a controller — see §4.

## 4. The lightweight middle ground (recommended now)

`scripts/gitops/sync-check.mjs` provides the drift-detection half of GitOps
without the controller:

```bash
# Live check: does the staging host match origin/main?
DEPLOY_HOST=deploy@staging.spindle.app node scripts/gitops/sync-check.mjs

# Preview without touching anything:
node scripts/gitops/sync-check.mjs --dry-run

# Fully offline self-test (CI-safe, no network):
node scripts/gitops/sync-check.mjs --demo
```

It compares the image tags recorded in the host's release store
(`releases/current.env`) **and** the running container images (compose
labels) against `git rev-parse origin/main` (or `--ref`/`--sha`). Exit 1 on
drift. Suggested wiring, all optional and outside this change:

- Run it manually after suspect deploys, or add it as a step in
  `deploy-staging.yml`'s smoke job (a different owner would make that edit).
- Run `rollback.mjs --record` after each deploy so the release store — and
  therefore this check — reflects reality.

A scheduled drift check can also be a cron entry on the host or a
`workflow_dispatch`/`schedule:` workflow; neither requires new infrastructure.

## 5. Adoption path

**Phase 0 — now (this document + sync-check).** Keep the push deploy.
Treat `infra/` as the canonical desired state (it already is). Use
`sync-check.mjs` to catch drift. Cost: near zero.

**Phase 1 — pull-based reconcile (if manual hotfixes on the host become a
pattern).** A tiny host-side reconciler: a systemd timer that `git fetch`es a
small gitops repo (or a directory of this repo), diffs the pinned image tag
against `releases/current`, and invokes `remote-deploy.sh` on change. This is
"GitOps-lite": git remains source of truth, the host pulls, no controller.
Add it only after an actual drift incident — do not build it speculatively.

**Phase 2 — real GitOps (when the triggers below fire).** Options in
increasing order of weight:

1. **Flux or ArgoCD on Kubernetes** — only if the stack migrates to k8s.
   Flux is the lighter fit (GitOps Toolkit, no UI server); ArgoCD if a UI
   and RBAC matter. Either way this is an ADR-level decision, not a workflow
   tweak.
2. **ArgoCD in "app-of-apps" mode against compose** — possible via community
   compose support but fragile; not recommended without a spike.
3. **Image-updater automation** — whichever controller is chosen still needs
   CI to write the deployed SHA back to git (Flux image-reflection or a CI
   bot commit). Budget for this; it is the piece people forget.

**Triggers that would justify Phase 2:** a second production host or region;
frequent out-of-band host changes causing drift incidents; a compliance or
audit requirement for "what is deployed, provably, from git"; or a team
growth that makes manual promotion a bottleneck.

**Explicit non-goals:** do not adopt GitOps to make deploys "more modern" —
the current pipeline already has immutable tags, preflight validation,
serialized deploys, smoke tests, and release-based rollback. Revisit this
document when one of the §5 triggers occurs or when ADR 0001's topology
decision is revisited.
