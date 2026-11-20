# Container image scanning

This document covers how container images are scanned for vulnerabilities and
how image _references_ are kept pinned. It complements
[supply-chain security](./supply-chain.md) (which owns dependency/action/compose
pinning hygiene) — this doc owns vulnerability scanning of image contents and
the pinning posture of the images themselves.

## Where images come from

There are **no Dockerfiles in this repository**. The supply-chain audit
confirmed the repo is build-free on the container side:

- `app` and `worker` images are built and pushed by an external pipeline
  (DEV-9/DEV-10) to `ghcr.io/spindle/{app,worker}`, tagged with the commit SHA.
- The host never builds; `infra/origin/compose.yaml` pulls
  `${SPINDLE_APP_IMAGE}` / `${SPINDLE_WORKER_IMAGE}` from `host.env`, and the
  file header states "`latest` is never used" — enforced by convention.
- Third-party images in compose (`postgres:17-alpine`, `valkey/valkey:8-alpine`,
  `tecnativa/docker-socket-proxy:v0.5.0`, `cloudflare/cloudflared`) are
  mutable tags without digests today.

Because the build happens outside this repo, scanning splits into two layers:

1. **Reference audit (offline, always runnable).** Verify that every image
   reference the repo and deploy configs point at is digest-pinned or at least
   an immutable tag, and that env-var indirections are documented. This is
   `scripts/security/image-scan/check.mjs` — pure file inspection, no registry
   access, no scanner binary required.
2. **Vulnerability scan (needs registry access).** Pull the actual image and
   scan its filesystem/layers for CVEs. This requires credentials for the
   registry (`ghcr.io` for app/worker; Docker Hub for the third-party images)
   and a scanner — trivy, grype, or Docker Scout. It cannot run fully offline
   and is wired into CI only where those credentials exist.

## The checker

`scripts/security/image-scan/check.mjs` is dependency-free node (like
`scripts/security/supply-chain/check.mjs`) and runs before `npm ci`.

```bash
node scripts/security/image-scan/check.mjs                          # compose files in repo + infra/
node scripts/security/image-scan/check.mjs --env-file infra/origin/host.env.example
node scripts/security/image-scan/check.mjs --image repo/app:tag --image repo/app@sha256:...
node scripts/security/image-scan/check.mjs --demo                   # fixtures, always exits 1
node scripts/security/image-scan/check.mjs --json                   # machine-readable
node scripts/security/image-scan/check.mjs --ci                     # GitHub Actions annotations
node scripts/security/image-scan/check.mjs --strict                 # any finding fails
node scripts/security/image-scan/check.mjs --scanner auto           # also run trivy/grype if installed
```

Inputs: positional refs, `--image` (repeatable, comma-separated), `--compose`
(repeatable; defaults to `compose*.yml`/`docker-compose*.yml` in the repo root
and `infra/`), and `--env-file` (repeatable `KEY=VALUE` files; `*_IMAGE` vars
are checked as refs and `${VAR}`/`${VAR:-default}` compose indirections are
resolved through them).

Severity model:

- **error** — `:latest` tag, or no tag at all (implicit `latest`), or
  `>0` CRITICAL vulnerabilities reported by an optional scanner.
- **warning** — any other mutable tag without `@sha256:` digest, unparseable
  refs, `>0` HIGH vulnerabilities, scanner runtime errors.
- **info** — `${VAR}` env-var indirections (the pipeline owns the real value),
  scanner requested but not installed.

Exit codes: `0` = no errors (warnings/info advisory unless `--strict`);
`1` = errors present or `--strict` with any finding; `2` = usage error.

### Optional vulnerability scanner

`--scanner trivy|grype|auto` shells out to an installed scanner per concrete
image ref: `trivy image --format json` or `grype -o json`, counting HIGH and
CRITICAL findings. If no scanner is installed the check reports an info
finding and continues — the pinning audit never depends on scanner
availability. Scanning is skipped for `--demo` fixtures. Note that scanning a
mutable tag scans whatever the tag currently points at; scanning a digest-pinned
ref (`repo:tag@sha256:...`) is reproducible and preferred.

## Scanning strategy

### Layer 1 — pinning audit (this repo, offline)

Run the checker in CI on every PR/push and weekly (see
`.github/workflows/image-scan.yml`). It catches:

- mutable tags creeping into compose files or env examples,
- `latest`/untagged references,
- malformed digests,
- unresolved `${VAR}` indirections once an env file is supplied.

Current known state (warnings, not yet digest-pinned): `postgres:17-alpine`,
`valkey/valkey:8-alpine`, `tecnativa/docker-socket-proxy:v0.5.0`,
`cloudflare/cloudflared:${CLOUDFLARE_IMAGE_TAG:-2026.11.1}`, and the
`SPINDLE_*_IMAGE` placeholders in `infra/origin/host.env.example`.

### Layer 2 — vulnerability scanning (needs registry access)

Pick one scanner; all produce comparable HIGH/CRITICAL signals:

| Tool         | Invocation                                                     | Notes                                                       |
| ------------ | -------------------------------------------------------------- | ----------------------------------------------------------- |
| trivy        | `trivy image [--severity HIGH,CRITICAL] repo/image@sha256:...` | Aqua; DB download needs network; `--exit-code 1` for gating |
| grype        | `grype repo/image@sha256:... -o json`                          | Anchore; needs its vulnerability DB                         |
| docker scout | `docker scout cves repo/image@sha256:...`                      | Docker Desktop / Hub integration; SaaS-backed               |

Recommended posture:

- **Scan digest-pinned refs**, not tags — a tag scan is not reproducible.
- **App/worker images**: scan in the image pipeline (DEV-9/DEV-10) where the
  build and push happen, and/or in a CI job that has `packages: read` on
  `ghcr.io`. The deploy-staging workflow deliberately does _not_ build or
  scan images; it only pulls tags produced upstream.
- **Third-party images**: scan the exact digests recorded in compose. Until
  compose pins digests (see below), scan the resolved tag and record the
  digest in the run output for audit.
- **On-host option**: after `docker compose pull`, `trivy image` can scan the
  local daemon images without registry credentials — useful for the staging
  rehearsal host, but it scans whatever was pulled that day.

### CI integration points

- `.github/workflows/image-scan.yml` — the offline pinning audit plus an
  optional vulnerability-scan job that only runs when registry access is
  configured (`vars.IMAGE_SCAN_APP_IMAGE`, `vars.IMAGE_SCAN_WORKER_IMAGE`,
  and a `GHCR` token secret). It skips gracefully otherwise — the honest
  state today is that app/worker images are built outside this repo's CI, so
  content scanning belongs to that pipeline until registry credentials are
  granted here.
- The existing `supply-chain.yml` already flags non-digest `image:` lines in
  compose files as warnings; `image-scan.yml` is the dedicated, deeper check
  (env-file resolution, CLI refs, optional scanner).

## Base-image and tag pinning guidance

The Dockerfiles are not in this repo, so pinning guidance applies to the
external image build and to this repo's references:

1. **In the image build (external)**: pin base images by digest
   (`FROM node:22-alpine@sha256:...`), not by tag; enable build provenance /
   attestation (`actions/attest-build-provenance`, cosign) so consumers can
   verify the image was built from the tagged source — flagged as future
   hardening in `supply-chain.md`.
2. **In deploy config (this repo)**: prefer
   `SPINDLE_APP_IMAGE=ghcr.io/spindle/app:<sha-tag>@sha256:<digest>` in
   `host.env` so a retagged or replaced image cannot change what runs on the
   host. The compose file already rejects unset values; extend the convention
   from "no `latest`" to "tag **and** digest".
3. **Third-party images**: record `@sha256:` digests in compose files (or via
   env vars with digest defaults) for `postgres`, `valkey`,
   `docker-socket-proxy`, and `cloudflared`. Renovate/Dependabot can keep
   digest pins updated.
4. **SBOM**: `scripts/sbom/generate.mjs` produces a CycloneDX SBOM of npm
   dependencies. A container-image SBOM (`trivy image --format cyclonedx`,
   `syft`) is a natural extension once images are scannable in CI.

## Running the checker

```bash
node scripts/security/image-scan/check.mjs            # human-readable report
node scripts/security/image-scan/check.mjs --json     # machine-readable
node scripts/security/image-scan/check.mjs --demo     # fixtures (always exits 1)
node scripts/security/image-scan/check.mjs --ci       # same + GitHub annotations
node scripts/security/image-scan/check.mjs --strict   # warnings also fail (exit 1)
node scripts/security/image-scan/check.mjs --scanner auto --image repo/app:tag
```

Exit codes: `0` = no error-severity findings; `1` = errors present (or any
finding under `--strict`); `2` = usage error.
