# Supply chain security

This document covers how dependencies, CI actions, container images, and
secrets flow into this repository, where the weak points are, and which
controls exist today versus which are planned. It complements
[secret scanning in CI](./secret-scanning-ci.md) (credentials) and the
deps-audit / SBOM / license work tracked separately — this doc is the
holistic map; those tasks own their specific tooling.

The automated gate is `scripts/security/supply-chain/check.mjs`, run by
`.github/workflows/supply-chain.yml` on every PR, push to `main`, and weekly
via schedule. See [Running the checker](#running-the-checker) at the end.

## Dependency pinning and audit

`package.json` declares 67 dependency specifiers across `dependencies` and
`devDependencies`. **66 use mutable ranges** (`^x.y.z`); only `recharts`
(`3.11.0`) is an exact pin. There are no git, URL, `file:`, `link:`, or
`workspace:` specifiers — every package resolves through the npm registry.

What this means in practice:

- `^` ranges are re-resolved only when the lockfile is regenerated; day-to-day
  installs are locked (see below). The risk is a _future_ `npm install`
  silently pulling a new minor/patch, and a compromised release entering via
  a routine dependency bump.
- Exact-pinning everything would freeze security patches; the accepted
  posture is ranges + lockfile + audit, not literal pins.

Controls and gaps:

| Control                                          | Status                                                          |
| ------------------------------------------------ | --------------------------------------------------------------- |
| Lockfile committed (`package-lock.json`)         | Present                                                         |
| `npm ci` in CI (lockfile-authoritative installs) | All workflows use `npm ci`; several jobs add `--ignore-scripts` |
| `npm audit` / Dependabot alerts                  | Owned by the deps-audit task; see that doc when it lands        |
| Exact pins                                       | Not adopted (1 of 67); ranges accepted by policy                |
| `.npmrc` registry overrides                      | No `.npmrc` in repo — default npm registry only                 |

## Lockfile integrity

`package-lock.json` (lockfileVersion 3) is committed and every CI job that
installs dependencies uses `npm ci`, which fails if `package.json` and the
lockfile disagree and never mutates the lockfile. `npm ci` also verifies the
`integrity` hashes recorded per tarball, so a tampered registry artifact is
detected at install time.

Two caveats worth knowing:

- `package.json` has a `postinstall` script (`prisma generate`). Most CI jobs
  run plain `npm ci`, so that script executes; lint/typecheck jobs use
  `npm ci --ignore-scripts`. Lifecycle scripts are the standard vector for
  install-time malware, which is why the checker reports them (info) and why
  `--ignore-scripts` is preferred for jobs that don't need codegen.
- Dependabot/dependency-update PRs regenerate the lockfile; reviewers should
  check that lockfile diffs only touch the intended package subtree.

## Provenance and build attestation

- **npm provenance / SLSA for packages**: this repo is `"private": true` and
  publishes no npm packages, so `npm publish --provenance` does not apply.
  If a package is ever published, enable provenance (`--provenance` flag or
  `publishConfig.provenance`) so consumers can verify the tarball was built
  by CI from the tagged source.
- **Container image provenance**: app/worker images are built and pushed by
  CI (see `infra/origin/compose.yaml` header — DEV-9/DEV-10) and pulled by
  pinned tags on the host. There is currently **no SLSA provenance
  attestation or signature verification** (e.g. `actions/attest-build-
provenance`, cosign) on those images — a future hardening item. The
  compose file already forbids `latest`; extend that to digest pins.
- **GitHub Actions provenance**: third-party actions execute with the
  workflow's token. See the pinning section — tags are mutable.

## GitHub Actions pinning

**Current state: 0 of 47 `uses:` references are SHA-pinned.** Every action is
pinned to a mutable major tag (`actions/checkout@v4`,
`actions/setup-node@v4`, `gitleaks/gitleaks-action@v2`,
`browser-actions/setup-chrome@v1`, `actions/upload-artifact@v4`,
`actions/cache@v4`). Tags can be moved by the action maintainer (or an
attacker who compromises the repo) and the next run picks up whatever the tag
points at.

Recommended remediation (not yet applied — owned by CI hardening):

1. Pin every action to a full commit SHA with a version comment, e.g.
   `uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4`.
   Dependabot's `github-actions` ecosystem can keep SHA pins updated.
2. Until then, the weekly scheduled run of `supply-chain.yml` re-reports the
   exposure so it cannot silently grow.

The checker flags any `uses:` ref that is not a 40-hex SHA as a warning
(`actions-pinned`), so the count is continuously visible in PR annotations.

## Container image pinning

Compose files reference images in three ways:

| File                        | Image                                                                                  | Pinning                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `compose.yaml`              | `postgres:17-alpine`                                                                   | Mutable tag — **no digest**                                                                                    |
| `infra/origin/compose.yaml` | `postgres:17-alpine`, `valkey/valkey:8-alpine`, `tecnativa/docker-socket-proxy:v0.5.0` | Mutable tags — **no digests**                                                                                  |
| `infra/origin/compose.yaml` | `cloudflare/cloudflared:${CLOUDFLARE_IMAGE_TAG:-2026.11.1}`                            | Versioned via env var with default; still tag-mutable                                                          |
| `infra/origin/compose.yaml` | `${SPINDLE_APP_IMAGE}` / `${SPINDLE_WORKER_IMAGE}`                                     | Required env vars; header documents "pinned tags; `latest` is never used" — enforced by convention, not digest |

The origin stack has no Dockerfiles in this repo — images are built by CI and
pulled by tag. Recommended hardening:

- Record `@sha256:<digest>` alongside tags in compose files (or set the env
  vars to `repo/image:tag@sha256:...`), so a retagged upstream image cannot
  change what runs on the host.
- Extend the "no `latest`" convention to "no mutable tag without digest" for
  third-party images (`postgres`, `valkey`, `docker-socket-proxy`,
  `cloudflared`).

The checker reports every non-digest `image:` as a warning
(`container-images`); env-var-indirect pins are reported as info since the
pipeline controls the actual value.

## Secrets in CI

Secrets handling is covered in depth by
[secret management](./secret-management.md),
[secret scanning in CI](./secret-scanning-ci.md), and the rotation docs.
Supply-chain-specific hygiene:

- Workflows request minimal permissions (`contents: read` is the baseline;
  `security-events: write` only where SARIF upload needs it). No workflow
  uses `pull_request_target` with checkout of PR code — PR workflows only
  read the checked-out merge commit.
- gitleaks runs on every push/PR (`secrets-scan.yml`, plus the `secrets` job
  in `ci.yml`) against full history; `scripts/secrets/scan.mjs` adds
  working-tree hygiene.
- Dependency install scripts are the main secrets-adjacent risk: a malicious
  package's `postinstall` runs inside CI where secrets may be present in the
  environment. Jobs that don't need codegen should prefer
  `npm ci --ignore-scripts`; jobs that do (build/test) should avoid mounting
  production secrets — staging deploys use environment-scoped secrets only.
- `check.mjs` itself needs no secrets and no token — it is pure file
  inspection, so its workflow needs only `contents: read`.

## Running the checker

```bash
node scripts/security/supply-chain/check.mjs            # human-readable report
node scripts/security/supply-chain/check.mjs --json     # machine-readable
node scripts/security/supply-chain/check.mjs --demo     # run against fixtures (always exits 1)
node scripts/security/supply-chain/check.mjs --ci       # same + GitHub Actions annotations
node scripts/security/supply-chain/check.mjs --strict   # warnings also fail (exit 1)
```

Exit codes: `0` = no error-severity findings; `1` = errors present (or any
finding under `--strict`); `2` = usage error.

Severity model:

- **error** — missing/corrupt lockfile, non-registry dependency specifier.
  These break reproducibility or bypass registry integrity; they fail CI.
- **warning** — mutable action tags, `^`/`~` range specifiers, mutable
  container image tags, `npm install` in workflows, custom `.npmrc`
  registries. Advisory today; flip the workflow to `--strict` once the
  backlog is burned down.
- **info** — lifecycle scripts present, env-var-indirect image pins.

Checks performed: `actions-pinned`, `dependency-pinning`, `lockfile`,
`container-images`, `npmrc`, `lifecycle-scripts`.
