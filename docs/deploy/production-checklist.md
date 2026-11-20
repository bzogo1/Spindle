# Production deployment checklist

This checklist covers promoting a commit that has already passed CI
(`.github/workflows/ci.yml`) and the staging deploy
(`.github/workflows/deploy-staging.yml`) to the production origin described in
`docs/runbooks/hosting.md` and ADR `docs/decisions/0001-container-host-topology.md`.

Production promotion is **manual** — no production workflow exists yet (DEV-10).
Run every step on or against the production host `/srv/spindle`, following the
same `docker compose --env-file host.env` flow the staging workflow uses.

Legend: `[ ]` = must do, `[~]` = conditional (note says when).

---

## 0. Prerequisites (once per release, before touching the host)

- [ ] The commit SHA being promoted has green CI: Formatting, Secret scan,
      Unit tests, Storybook build, Database migrations, Build and smoke test,
      and End-to-end (mock auth) jobs in `ci.yml`.
- [ ] The same SHA deployed cleanly to staging via `deploy-staging.yml`
      (staging smoke test curls `https://staging.spindle.app/`).
- [ ] App and worker images for the SHA exist in the registry, tagged by SHA
      (e.g. `ghcr.io/spindle/app:<sha>`, `ghcr.io/spindle/worker:<sha>`).
      Never deploy `latest` — `infra/origin/host.env.example` requires pinned
      tags and `infra/origin/compose.yaml` refuses an unset image variable.
      Note: no workflow in this repo builds or publishes the `ghcr.io`
      images — building and pushing them for the SHA is a manual/external
      step that must happen before this checklist can run.
- [ ] You are on the release-manager/admin path: SSH access to the origin via
      Cloudflare Access or Tailscale (no public 22/80/443), and Infisical
      access scoped to `prod:/app` and `prod:/worker`.
- [ ] If this release rotates a secret, follow `docs/runbooks/secrets-rotation.md`
      **first** — rotations deploy through this same checklist.
- [ ] If this release adds migrations, confirm the migration is backward
      compatible or that a maintenance window is acceptable (see §3.4).

---

## 1. Pre-deploy (on the origin host)

### 1.1 Host and stack state

- [ ] `cd /srv/spindle && sudo docker compose --env-file host.env ps` — all
      services (`app`, `worker`, `postgres`, `valkey`, `docker-socket-proxy`,
      `cloudflared-1`, `cloudflared-2`) are up and healthy before you start.
- [ ] `sudo docker compose --env-file host.env logs --tail=50 app worker`
      shows no recurring errors in the current release.
- [ ] `/srv/spindle/host.env` has the **new** pinned image tags for
      `SPINDLE_APP_IMAGE` and `SPINDLE_WORKER_IMAGE` (format
      `<repo>:<commit-sha>`). Keep the previous values recorded — they are
      your rollback target (§5).
- [ ] `CLOUDFLARE_TUNNEL_ID`, `INFISICAL_PROJECT_ID`, `INFISICAL_TOKEN`,
      `CLOUDFLARE_CREDENTIALS_FILE`, and `POSTGRES_PASSWORD` are unchanged and
      correct. The tunnel credentials file must still be mode `0600`.

### 1.2 Database backup before migrations

- [ ] Take a Postgres backup before any release that includes migrations:
      `sudo docker compose --env-file host.env exec postgres pg_dump -U spindle -Fc spindle > backup-$(date +%Y%m%d-%H%M%S).dump`
      (store the dump off the origin per the backup policy in ADR 0001 /
      DEV-15).
- [ ] Confirm the `postgres-data` volume is on the RAID1 array under `/srv`.

### 1.3 Environment and secret contract

- [ ] Copy `.env.example` to a scratch file and diff it against what production
      actually needs. Required in production:
  - `NEXT_PUBLIC_SITE_URL` — must be the canonical production origin (e.g.
    `https://spindle.app`); the app refuses to boot in production without it
    (`src/lib/env.server.ts`).
  - `DATABASE_URL` / `DIRECT_URL` — pooled and direct Postgres URLs; the app
    connects as the `spindle` role on host `postgres` (compose network), not
    localhost.
  - `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` — leave empty to disable; otherwise
    set both.
  - `SENTRY_RELEASE` — optional; falls back to the deploy commit SHA
    (`GITHUB_SHA` / `VERCEL_GIT_COMMIT_SHA`), then `spindle@1.0.0`.
  - `SENTRY_AUTH_TOKEN` — **build-only**; never needed at runtime.
  - `CSP_ENFORCE` — keep empty until the
    `Content-Security-Policy-Report-Only` policy has been clean in production.
    It is a **runtime** server env read per request in
    `src/lib/security-headers.ts` (via `getServerEnv()`), so flipping it only
    requires setting `CSP_ENFORCE=1` in Infisical and redeploying — no image
    rebuild is needed. It is optional in env validation, so the image builds
    and starts fine without it.
  - All production secrets live in Infisical and are injected by
    `scripts/secrets/entrypoint.sh` at container start — they are **not** in
    `host.env` and must not be. Exact names: `B2_KEY_ID`,
    `B2_APPLICATION_KEY`, `B2_BUCKET`, `B2_ENDPOINT` (plus
    `B2_KEY_ID_PREVIOUS`/`B2_APPLICATION_KEY_PREVIOUS` only during a B2
    rotation), `RESEND_API_KEY`, `CONTACT_TO_EMAIL`, `CONTACT_FROM_EMAIL`,
    `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, `SESSION_SECRET`,
    `EDGE_HMAC_SECRET`, `WORKER_SECRET` (each with a `*_PREVIOUS` overlap key
    during rotation), and `OAUTH_PROVIDERS_JSON` if OAuth is enabled.
  - `NEXT_PUBLIC_*` variables are **build-time** inlined into the client
    bundle — runtime injection by the entrypoint cannot change them. Set
    `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SENTRY_DSN`,
    `NEXT_PUBLIC_SENTRY_RELEASE`, `NEXT_PUBLIC_API_MODE`, and
    `NEXT_PUBLIC_API_URL` correctly **before** the image is built; rebuild the
    image if any of them must change.
  - `NEXT_PUBLIC_API_MODE` — **must be set to `http` explicitly** in
    production. Leaving it unset defaults to `"mock"` (`src/lib/env.ts`),
    which serves fixture data through the mock API adapter — a silent
    breakage, not same-origin `/api`. `NEXT_PUBLIC_API_URL` — leave empty for
    same-origin `/api`; set it only if the backend lives on a different
    origin.
  - `NEXT_PUBLIC_MOCK_AUTH` — must be unset/empty in production; it enables a
    fake session cookie under `/app`.
- [ ] Verify the secret store contract without printing values. On a running
      production container (or from CI against `prod:/app`):
      `npm run secrets:check -- --production`.
- [ ] If any `*_PREVIOUS` overlap key is set from an in-flight rotation, run
      `npm run secrets:verify-rotation` and confirm it reports `current=ok`
      and `previous=ok` for that key.
- [ ] `[~]` If rotating secrets: run `npm run secrets:drill` locally first and
      follow the per-secret procedure in `docs/runbooks/secrets-rotation.md`
      (dual-key pattern for `SESSION_SECRET`, `EDGE_HMAC_SECRET`,
      `WORKER_SECRET`, `B2_*`).
- [ ] Run the repo secret-hygiene scan: `npm run secrets:scan` — confirms no
      `.env*` values or credentials are committed (`.dockerignore` must still
      exclude `.env*`).

### 1.4 Local verification of the release candidate

Run these in order on the release candidate checkout (CI already ran them,
this is the deployer's confirmation):

- [ ] `npm run lint`
- [ ] `npm run format:check`
- [ ] `npm run typecheck`
- [ ] `npm run test` (vitest unit suite; `npm run test:coverage` if the
      release touches critical paths)
- [ ] `npm run build` — note that `prebuild` runs `npm run docs:build`
      (`scripts/build-docs-content.mjs`) and `postbuild` runs
      `npm run check:client-bundle` (`scripts/check-client-bundle.mjs`); both
      must pass. `NEXT_PUBLIC_SITE_URL` must be set to the production origin
      for this build so canonical/OG metadata is correct.
- [ ] `npm run env:check` (`scripts/validate-env.ts`) — validates the env
      schema; add `--production` against production-shaped env if desired.
- [ ] `[~]` `npm run test:e2e` / `npm run test:e2e:a11y` /
      `npm run test:lighthouse` if the release touches public routes or
      performance-sensitive code.

---

## 2. Deploy

Mirror the staging workflow's deploy steps (`deploy-staging.yml`), pointed at
`/srv/spindle`:

- [ ] On the origin:
      `cd /srv/spindle`
- [ ] `sudo docker compose --env-file host.env pull app worker`
- [ ] `sudo docker compose --env-file host.env up -d --remove-orphans --wait`
      — `--wait` blocks until every healthcheck passes, including the app
      healthcheck (`GET http://127.0.0.1:8080/` inside the container; there is
      no dedicated `/health` route — the root page is the probe).
- [ ] `sudo docker compose --env-file host.env ps` — confirm `app` and
      `worker` report `healthy`/`running`, and `cloudflared-1`/`cloudflared-2`
      both stay up.
- [ ] `sudo docker compose --env-file host.env logs --tail=100 app`
      — confirm the entrypoint ran `infisical run` and
      `npm run secrets:check -- --production` succeeded (any missing secret
      name fails the container start).
- [ ] `[~]` If the release includes Prisma migrations: apply them **before**
      or immediately after the app starts, depending on compatibility:
      `sudo docker compose --env-file host.env exec app npx prisma migrate deploy`
      or run `npm run db:deploy` (`prisma migrate deploy`, uses `DIRECT_URL`)
      from a host with DB access. Confirm `prisma/migrations/` in the deployed
      SHA matches what was applied; CI's migrations job already verifies the
      schema diff is clean.

---

## 3. Post-deploy verification

### 3.1 Smoke checks

- [ ] From the host (loopback only — nothing is publicly exposed):
      `curl -sf http://127.0.0.1:8080/` returns 200.
- [ ] Through the tunnel from outside:
      `curl --fail --silent --show-error --retry 10 --retry-delay 3 --retry-all-errors https://app.spindle.app/`
      (same pattern as the staging smoke test).
- [ ] `https://lab.spindle.app` responds (lab proxy path) if the release
      touches it.
- [ ] `/infrastructure` page loads — it renders the request trace and should
      agree with the deployed topology (Cloudflare edge → tunnel → origin →
      private lab network).
- [ ] Contact form and newsletter endpoints respond:
      `POST /api/contact`, `POST /api/newsletter` — submissions are logged
      even when Resend is unconfigured; verify a real send if Resend is live.

### 3.2 Application-level checks

- [ ] Sign in / session flow works end to end (email/password, magic link,
      or OAuth per `OAUTH_PROVIDERS_JSON` if enabled).
- [ ] Auth API routes respond: `/api/auth/session` returns the expected
      session state for an authenticated browser.
- [ ] File upload/download through B2 works (upload a small file, download
      it back) — exercises `B2_*` secrets injected by the entrypoint.
- [ ] One worker-processed job completes (worker claims via `WORKER_SECRET`;
      check `docker compose logs worker`).
- [ ] Sentry: confirm the release appears — `SENTRY_RELEASE` should equal the
      deployed commit SHA. Trigger or wait for a test event only if policy
      allows; at minimum verify the DSN env reached the container via
      `secrets:check` (names only, never values).
- [ ] `npm run secrets:check -- --production` inside the running app
      container reports every required name present.
- [ ] Error rates: check Sentry and Cloudflare notifications for a spike in
      5xx during the first 15 minutes.

### 3.3 Infra verification

- [ ] Re-run the topology proof if the release touched networking or the
      lab proxy: `sudo ./scripts/hosting/verify-topology.sh` (optionally with
      `SPINDLE_LAB_URL=wss://lab.spindle.app` and
      `SPINDLE_SESSION_TOKEN=...` for the tunnel leg; see
      `docs/runbooks/hosting.md` §5).
- [ ] `sudo docker stats` / host disk: confirm `/srv` usage is sane; B2 sync
      worker is reconciling `/srv/spindle/projects` without errors.

### 3.4 Migration-specific verification

- [ ] `prisma migrate status` (or `npx prisma migrate status` with
      `DIRECT_URL`) shows all migrations applied.
- [ ] `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`
      exits 0 — same check CI runs.
- [ ] Spot-check the feature that motivated the migration (read + write one
      row through the app).

---

## 4. Soak period

- [ ] Watch Sentry error rate, Cloudflare 5xx notifications, container
      restarts (`docker compose ps` restart counts), and worker queue depth
      for at least 30–60 minutes before declaring the deploy done.
- [ ] Confirm both `cloudflared` connectors remain connected (logs show
      `Registered tunnel connection`).
- [ ] If `CSP_ENFORCE` was flipped, watch `Content-Security-Policy` violation
      reports before enforcing — keep it report-only until clean.
- [ ] Record the release: deployed commit SHA, image tags/digests, deployer,
      deploy timestamp, and any migrations applied — this is the audit trail
      §5 rollback relies on.

---

## 5. Rollback

The stack is designed for fast rollback: images are pinned by SHA and Postgres
is a persistent volume.

### 5.1 Application rollback (no migration changes)

- [ ] Edit `/srv/spindle/host.env`: set `SPINDLE_APP_IMAGE` and
      `SPINDLE_WORKER_IMAGE` back to the **previous** commit-SHA tags recorded
      in §1.1.
- [ ] `cd /srv/spindle && sudo docker compose --env-file host.env pull app worker`
- [ ] `sudo docker compose --env-file host.env up -d --remove-orphans --wait`
- [ ] Re-run §3.1 smoke checks. Verify the Sentry release tag shows the old SHA.

### 5.2 Rollback with migrations

- [ ] If the release added **only additive** migrations (new tables/columns),
      rolling the app image back is usually safe — leave the schema in place.
- [ ] If the release **dropped or renamed** columns/tables the old image needs,
      restore the pre-deploy `pg_dump` backup from §1.2 **before** rolling the
      image back:
      `sudo docker compose --env-file host.env exec -T postgres pg_restore -U spindle -d spindle --clean < backup-<timestamp>.dump`
      (quiesce the app first: `up -d` only `postgres`, or scale app/worker to
      0 via `docker compose stop app worker`).
- [ ] Never run `prisma migrate reset` or hand-edit `_prisma_migrations`
      against production — restore from backup instead.

### 5.3 Secret rollback

- [ ] Follow the per-secret rollback notes in
      `docs/runbooks/secrets-rotation.md` — typically restore the old value in
      Infisical (or swap `*_CURRENT`/`*_PREVIOUS` for dual-key secrets) and
      redeploy so the entrypoint re-injects it.
- [ ] For Postgres credential rotation, restore the old `DATABASE_URL` /
      `DIRECT_URL` in Infisical and redeploy; keep the old role until traffic
      has fully moved off it.

### 5.4 Post-rollback

- [ ] Record the incident: what shipped, when it was detected, rollback time,
      and whether data written by the bad release needs cleanup.
- [ ] Open a follow-up issue; do not re-promote the same SHA without a fix.

---

## Quick reference — commands used above

| Purpose                 | Command                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| Stack status            | `sudo docker compose --env-file host.env ps`                                                 |
| Deploy new images       | `sudo docker compose --env-file host.env pull app worker`                                    |
| Rolling update          | `sudo docker compose --env-file host.env up -d --remove-orphans --wait`                      |
| Logs                    | `sudo docker compose --env-file host.env logs --tail=100 app worker`                         |
| Apply migrations        | `npm run db:deploy` (=`prisma migrate deploy`, uses `DIRECT_URL`)                            |
| Secret contract (names) | `npm run secrets:check -- --production`                                                      |
| Rotation overlap check  | `npm run secrets:verify-rotation`                                                            |
| Rotation rehearsal      | `npm run secrets:drill`                                                                      |
| Repo secret hygiene     | `npm run secrets:scan`                                                                       |
| Env schema validation   | `npm run env:check` (`--production` for prod shape)                                          |
| Build verification      | `npm run lint && npm run format:check && npm run typecheck && npm run test && npm run build` |
| Topology proof          | `sudo ./scripts/hosting/verify-topology.sh`                                                  |
| Public smoke            | `curl --fail --retry 10 --retry-delay 3 --retry-all-errors https://app.spindle.app/`         |
| Loopback app health     | `curl -sf http://127.0.0.1:8080/` (host-side; container healthcheck target)                  |

## Related docs

- `docs/runbooks/hosting.md` — host provisioning, tunnel setup, staging deploy
- `docs/runbooks/secrets-rotation.md` — per-secret rotation/rollback procedures
- `docs/decisions/0001-container-host-topology.md` — why the origin looks like this
- `docs/decisions/0002-secrets-management.md` — Infisical access model
- `infra/origin/compose.yaml`, `infra/origin/host.env.example` — the actual stack
- `.env.example` — full env var contract
- `.github/workflows/deploy-staging.yml` — the deploy flow this checklist mirrors
