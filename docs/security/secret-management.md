# Secret management

How Spindle creates, stores, rotates, revokes, and deletes secrets. This is the
reference document; the procedures live in
[`docs/runbooks/secrets-rotation.md`](../runbooks/secrets-rotation.md) and the
design rationale in
[`docs/decisions/0002-secrets-management.md`](../decisions/0002-secrets-management.md).

The short version: **production values live only in Infisical Cloud.** The
image contains no `.env` file, `.dockerignore` excludes `.env*`, and
`scripts/secrets/entrypoint.sh` injects values at container start via
`infisical run`. `src/lib/secrets/catalog.ts` is the single source of truth for
the secret contract.

## Inventory

Every secret variable is listed in `.env.example` (names only, empty values)
and defined in `src/lib/secrets/catalog.ts`. Grouped by purpose:

### Production runtime secrets (injected from Infisical)

These are the values the container entrypoint requires in production
(`NODE_ENV=production`). All are validated by `npm run secrets:check -- --production`
and must never have placeholder values.

| Purpose                       | Variables                                                                                          | Rotation                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Object storage (Backblaze B2) | `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET`, `B2_ENDPOINT` (+ `_PREVIOUS` pair during rotation) | Dual key, 90 days                     |
| Transactional email (Resend)  | `RESEND_API_KEY`                                                                                   | Provider overlap, 180 days            |
| LLM provider                  | `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`                                                         | Provider overlap, 90 days             |
| Database (Postgres)           | `DATABASE_URL`, `DIRECT_URL`                                                                       | Role overlap, 90 days                 |
| Session cookie signing        | `SESSION_SECRET` (+ `SESSION_SECRET_PREVIOUS`)                                                     | Dual key, 30 days                     |
| Edge request signing (HMAC)   | `EDGE_HMAC_SECRET` (+ `EDGE_HMAC_SECRET_PREVIOUS`)                                                 | Dual key, 90 days                     |
| App↔worker bearer token       | `WORKER_SECRET` (+ `WORKER_SECRET_PREVIOUS`)                                                       | Dual key, 90 days                     |
| Contact form delivery         | `CONTACT_TO_EMAIL`, `CONTACT_FROM_EMAIL`                                                           | Provider/config, no stored credential |

Symmetric keys (`SESSION_SECRET`, `EDGE_HMAC_SECRET`, `WORKER_SECRET`) must be
at least 32 characters; generate with `openssl rand -base64 48`.

### Error reporting (Sentry)

| Variable                                       | Scope                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------- |
| `SENTRY_DSN`                                   | Server and edge runtime                                                         |
| `NEXT_PUBLIC_SENTRY_DSN`                       | Browser (public by design — a DSN is not a secret)                              |
| `NEXT_PUBLIC_SENTRY_RELEASE`, `SENTRY_RELEASE` | Release identifiers, not secret                                                 |
| `SENTRY_AUTH_TOKEN`                            | Build-only CI repository secret for source-map upload; never exposed to runtime |

### OAuth provider configuration

| Variable               | Scope                                                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `OAUTH_PROVIDERS_JSON` | JSON map of OAuth providers; per-provider `clientSecret` is optional for public PKCE clients. Leave empty to disable OAuth. |

### Non-secret configuration

Documented in `.env.example` for completeness but **not** secrets:
`NEXT_PUBLIC_SITE_URL`, `CSP_ENFORCE`, `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE`,
`NEXT_PUBLIC_API_MODE`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_MOCK_AUTH`,
`VERCEL_GIT_COMMIT_SHA`, `GITHUB_SHA` (platform-injected).

### Secret-store bootstrap variables

Not in `.env.example` because they are supplied by the host, never the repo:
`INFISICAL_TOKEN` (deploy machine identity), `INFISICAL_PROJECT_ID`,
`SPINDLE_ENV`, `SPINDLE_SECRETS_PATH`. On the origin they come from systemd
credentials or the container runtime's secret mount.

## Lifecycle

### Creation

1. Generate the value at the provider (or with `openssl rand -base64 48` for
   symmetric keys). Scope it narrowly: bucket-scoped B2 application keys,
   sending-only Resend keys, per-environment LLM keys, per-service Postgres
   roles.
2. Set it in Infisical under the correct environment (`dev`, `staging`, `prod`)
   and folder (`/app`, `/worker`, `/edge`, `/deploy`, `/shared` — see ADR 0002
   for the folder map). Never paste a value into a ticket, chat, commit, or
   shell history.
3. For local development, set it in `.env.local` (gitignored) or the `dev`
   Infisical environment.

### Storage

- **Production:** Infisical Cloud only. One project per environment, one folder
  per service. Machine identities (`spindle-prod-app`, `spindle-prod-worker`,
  `spindle-prod-edge`, `spindle-deploy`, `spindle-ci`) have read scopes limited
  to their folders; `spindle-ci` has no `prod` access.
- **Repository:** `.env.example` holds names with empty values.
  `.gitignore` and `.dockerignore` both exclude `.env` / `.env.*`;
  `scripts/secrets/scan.mjs` enforces this on every CI run.
- **Images:** no secret is a build argument; `.dockerignore` excludes `.env*`.
- **Host:** `INFISICAL_TOKEN` arrives via systemd credentials or the container
  runtime secret mount, never the image.

### Injection and validation

`scripts/secrets/entrypoint.sh` runs in production containers: it requires
`INFISICAL_TOKEN`, runs `infisical run` against `INFISICAL_PROJECT_ID` /
`SPINDLE_ENV` / `SPINDLE_SECRETS_PATH`, then executes
`npm run secrets:check -- --production` before `next start`. If the store is
unreachable the host does not start — intentional, so a stale `.env` cannot
reintroduce the problem.

Validation (`scripts/secrets/check.ts` →
`src/lib/secrets/validate.ts`) checks names and shape only and never prints a
value: it reports missing names, placeholder-looking values, symmetric keys
under 32 characters, and `_PREVIOUS` values that equal or lack their current
counterpart.

### Rotation

Two overlap mechanisms, driven by `src/lib/secrets/keyring.ts`:

- **Dual key** (`SESSION_SECRET`, `EDGE_HMAC_SECRET`, `WORKER_SECRET`, and the
  B2 pair): the current value signs, both current and previous verify. Prove
  the overlap with `npm run secrets:verify-rotation` before removing the
  `_PREVIOUS` value. `withB2Credentials` retries once with the previous B2
  pair on a `401`/`403`.
- **Provider overlap** (Resend, LLM, Postgres role): the provider keeps both
  credentials valid while the new one deploys.

Max ages: session 30d; B2, LLM, Postgres, edge, worker 90d; Resend 180d. Rotate
immediately after suspected exposure, laptop loss, staff departure, or a
provider incident.

Tooling:

| Tool                                  | Command                                                                     | Purpose                                                                                                                                                             |
| ------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/secrets/check.ts`            | `npm run secrets:check [-- --production]`                                   | Validate the contract; names and shape only                                                                                                                         |
| `scripts/secrets/verify-rotation.ts`  | `npm run secrets:verify-rotation`                                           | Prove both keys of every dual-key secret verify                                                                                                                     |
| `scripts/secrets/rotation-drill.ts`   | `npm run secrets:drill`                                                     | Offline rehearsal of B2 fallback and edge HMAC overlap                                                                                                              |
| `scripts/secrets/rotation/rotate.mjs` | `node scripts/secrets/rotation/rotate.mjs <inventory\|status\|run\|report>` | Orchestrates the plan in `rotation/rotation-plan.json`; dry-run by default, `--apply` executes runnable steps, `--record` stamps `rotation/state.json` (gitignored) |

Per-secret steps and rollback: [`docs/runbooks/secrets-rotation.md`](../runbooks/secrets-rotation.md).
The orchestrator's commands, state file, and plan format are documented in
[`secrets-rotation-automation.md`](secrets-rotation-automation.md).

### Revocation

Revoke at the provider first — deleting the store entry does not revoke
access. For machine identities, disable or delete the identity in Infisical
and update the host's secret mount. For deploy-identity compromise, revoke the
identity, create a new one, and update the host before rotating every value it
could read.

### Deletion

- Remove `_PREVIOUS` variables from the store after the overlap window closes.
- Keep provider-side version history only as long as retention policy requires
  (see the Resend and LLM sections of the rotation runbook).
- Rotate break-glass credentials after every use; the sealed offline copy is
  never stored on the origin.

## Access control

- **Humans:** SSO with 2FA and an admin role in Infisical; every read and write
  is in the audit log. No shared human identity.
- **Machines:** the five identities above, each scoped to the folders it needs
  (`spindle-deploy` is the only writer to `staging`; nothing writes `prod`
  except release-manager/admin actions).
- **Break-glass:** one sealed offline credential, not on the origin, rotated
  after every use.
- **Quarterly:** verify every value is younger than its max age, identities
  still have the narrowest scope, export the audit log for the quarter, and
  confirm the break-glass credential is sealed and current.

## Incident response — leaked secret

If a value is exposed (commit, log, chat paste, provider incident):

1. **Revoke at the provider immediately.** Do not wait for a deploy.
2. **Rotate** using the procedure in
   [`docs/runbooks/secrets-rotation.md`](../runbooks/secrets-rotation.md#leaked-secret),
   creating a fresh provider credential rather than reusing the exposed one.
3. **Search for exposure:** gitleaks/`npm run secrets:scan` for repository
   commits (see [`secret-scanning-ci.md`](secret-scanning-ci.md)), provider
   audit logs for reads since exposure, and application logs for the affected
   service.
4. **Contain blast radius:** a leaked `_PREVIOUS` value is still a live
   credential until removed — revoke it too. If a deploy identity token leaked,
   revoke the identity and update the host's secret mount.
5. **Record** the incident, rotation time, and audit-log window.

A committed secret is compromised even if the commit is later deleted — it
remains in git history.

## Onboarding checklist — adding a new secret

1. **Name it** `SERVICE_PURPOSE` style and add it to `.env.example` with an
   empty value and a comment explaining scope.
2. **Add it to the contract** in `src/lib/secrets/catalog.ts` (kind, required
   flag, rotation strategy, consumers) so `secrets:check` and
   `secrets:verify-rotation` cover it.
3. **Choose its Infisical home:** existing folder if it matches the consumer,
   or a new folder + machine-identity scope in ADR 0002's model.
4. **Store it:** set the value in `dev`, `staging`, and `prod` in Infisical —
   never in the repo, an image build arg, or a hosting dashboard.
5. **Inject it:** confirm `scripts/secrets/entrypoint.sh` picks it up for the
   right `SPINDLE_SECRETS_PATH`; add the variable to the consuming service's
   env schema (`src/lib/env.server.ts` or equivalent) so validation catches a
   missing value at boot.
6. **Plan rotation:** pick a strategy (`dual-key` if the runtime can verify
   both values, `provider-overlap` otherwise), set `maxAgeDays`, and add steps
   to `scripts/secrets/rotation/rotation-plan.json` plus a section in
   `docs/runbooks/secrets-rotation.md`.
7. **Verify locally:** `npm run secrets:scan`, `npm run secrets:check`, and
   `npm run secrets:drill` if the rotation path is new.
8. **Document access:** update the access-control and inventory sections of
   this file and the README secrets table if the variable is operator-facing.
