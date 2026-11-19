# ADR 0002 — Secrets management and rotation

- **Status:** Accepted.
- **Date:** 2026-11-19
- **Issues:** DEV-8 (this decision), DEV-9 (images), DEV-10 (deploy), DEV-11 (hosting), DEV-15 (backups)
- **Deciders:** Engineering

## 1. Context

Spindle needs credentials for Backblaze B2, Resend, the LLM provider, Postgres, the session cookie,
the edge HMAC, and the worker. Until now the only documented values were the Sentry DSNs and the
database URLs, and the deployment checklist put them in a hosting dashboard. That does not answer:

- where the production values live;
- who can read or change them;
- how a key is rotated without breaking a running request;
- how a new environment is built without copying a `.env` file from someone's laptop.

The host is a single Hetzner origin behind a Cloudflare Tunnel (ADR 0001). There is no cloud
provider secret manager to inherit and no 24/7 operations team. The store has to be usable by a
small team, expose an audit trail, and inject values into containers at runtime.

## 2. Decision drivers

| Driver                    | Why it matters                                                     |
| ------------------------- | ------------------------------------------------------------------ |
| No secrets in images      | An image is copied to a registry and to every host that pulls it.  |
| Per-service credentials   | A leaked worker key must not read the B2 bucket or send email.     |
| Rotation without downtime | Sessions and edge requests cannot fail during a key change.        |
| Access control            | Only the deploy identity reads production; humans use audited SSO. |
| Audit trail               | "Who changed the B2 key?" must have an answer.                     |
| Bootstrap from the store  | A rebuilt host needs one credential, not a folder of `.env` files. |
| Small-team operation      | No Vault cluster and no on-call rotation.                          |

## 3. Options considered

### A. SOPS with age keys

Encrypted files in the repository, decrypted at deploy time. Cheap and transparent, but access is
"whoever holds an age key", there is no per-service read scope, no audit log, and a leaked key
decrypts every file. It also keeps production ciphertext in the repository, which is easy to confuse
with a safe secret store.

### B. Self-hosted HashiCorp Vault

Strongest audit and policy model, but it is another stateful service to run, unseal, back up, and
upgrade. At beta traffic and a small team, the operational cost is larger than the risk it removes.

### C. Managed secret store (Infisical Cloud)

Hosted store with environments, folders, machine identities, version history, point-in-time
recovery, and an audit log. The runtime gets a read-only machine identity; humans use SSO with 2FA.
No new stateful service to operate. The trade-off is a vendor in the trust path, mitigated by
scoping identities per service and keeping the values out of the app's build.

### D. Doppler or a cloud KMS

Doppler is a close equivalent to C. A cloud KMS would require putting the origin in a cloud account,
which contradicts ADR 0001 and adds a network dependency to every boot. Neither is a better fit
today.

## 4. Decision

**Use Infisical Cloud as the production secret store, with one project per environment and one
folder per service.** The application never calls the store at request time: the container
entrypoint injects the values into the process environment, and `src/lib/env.server.ts` validates the
resulting shape.

### Environments and folders

| Environment | Purpose                  | Who writes                       |
| ----------- | ------------------------ | -------------------------------- |
| `dev`       | Local development        | Engineers                        |
| `staging`   | Pre-production rehearsal | Deploy identity, release manager |
| `prod`      | Production               | Deploy identity, release manager |

Folders inside each environment:

- `/app` — B2, Resend, LLM, session, edge, worker values used by the web process.
- `/worker` — the worker's own copy of the worker and B2 values.
- `/edge` — only the edge HMAC.
- `/deploy` — database URLs used by migrations.
- `/shared` — non-secret configuration such as `B2_BUCKET`, `B2_ENDPOINT`, `LLM_BASE_URL`, and
  `LLM_MODEL` that still differs per environment.

### Identities

| Identity              | Scope                                | Use                                     |
| --------------------- | ------------------------------------ | --------------------------------------- |
| `spindle-prod-app`    | read `prod:/app`, `prod:/shared`     | Web container at boot                   |
| `spindle-prod-worker` | read `prod:/worker`, `prod:/shared`  | Worker container at boot                |
| `spindle-prod-edge`   | read `prod:/edge`                    | Edge signer configuration               |
| `spindle-deploy`      | read `prod:/deploy`, write `staging` | Migrations and releases                 |
| `spindle-ci`          | no `prod` access                     | CI builds; build-time Sentry token only |

Humans do not log in with a shared identity. Access is through SSO with 2FA and an admin role, and
every read and write is recorded in the Infisical audit log. A break-glass credential is stored
offline, is not on the origin, and is rotated after every use.

### Runtime injection

The image contains no `.env` file. `.dockerignore` excludes `.env` and `.env.*`, and the build does
not accept secrets as build arguments. `scripts/secrets/entrypoint.sh` runs in production:

```bash
infisical run \
  --projectId="$INFISICAL_PROJECT_ID" \
  --env="${SPINDLE_ENV:-prod}" \
  --path="${SPINDLE_SECRETS_PATH:-/app}" \
  -- npm start
```

`INFISICAL_TOKEN` is the deploy identity token. On the origin it is supplied by systemd credentials
or the container runtime's secret mount, never by the image or the repository. `npm run
secrets:check -- --production` runs before the app starts and names every missing variable without
printing a value.

### Rotation

The code supports two kinds of overlap:

- **Dual-key** (`SESSION_SECRET`, `EDGE_HMAC_SECRET`, `WORKER_SECRET`): new values are signed with
  the current key, and both current and previous keys verify. `src/lib/secrets/keyring.ts` holds the
  contract, and `npm run secrets:verify-rotation` proves both keys work before the previous value is
  removed.
- **Provider overlap** (B2, Resend, LLM, Postgres): the provider keeps both credentials valid while
  the new one is deployed. B2 additionally retries once with the previous key on an auth error
  (`withB2Credentials`), so a long-lived process survives the cutover.

The per-secret procedure, overlap window, and rollback are in
[`docs/runbooks/secrets-rotation.md`](../runbooks/secrets-rotation.md).

### Bootstrap

A new environment is created from the store alone:

1. Create the Infisical project and the `dev`, `staging`, and `prod` environments.
2. Create the machine identities and grant the scopes in the table above.
3. Populate `/shared` and each service folder from the provider consoles. No value is copied from
   a repository file.
4. On the host, provide `INFISICAL_TOKEN`, `INFISICAL_PROJECT_ID`, and `SPINDLE_ENV`.
5. Run `npm run secrets:check -- --production` and then `npm start`.

If the store is unavailable, the host does not start. That is intentional: a cached `.env` would
reintroduce the problem this decision removes.

## 5. Consequences

### Positive

- No production value exists in the repository, an image layer, or a build artifact.
- A leaked worker or edge identity cannot read B2 or the database.
- Session, edge, and worker rotation is a two-value change with no downtime.
- A rebuilt host needs one deploy identity, not a hand-copied environment file.
- The audit log answers who read or changed a production value.

### Negative

- The store is a boot dependency; an outage delays a cold start.
- The team has another account to secure with 2FA and review quarterly.
- Infisical audit retention depends on the plan, so the review procedure must export or inspect it
  on a schedule.
- A compromised deploy identity can read every production value it is scoped to. Rotation and
  alerting are the mitigation, not prevention.

## 6. Verification

- `npm run secrets:scan` passes and `.dockerignore` excludes `.env*`.
- `npm run secrets:check -- --production` names every missing variable and prints no values.
- `npm run secrets:verify-rotation` reports `current=ok previous=ok` for every dual-key secret.
- A build with no secret-store values still succeeds in development and fails clearly in production.
- `docs/runbooks/secrets-rotation.md` has a procedure for all seven services.

## 7. Revisit triggers

- A compliance requirement forbids a third-party store in the trust path.
- The team grows enough that per-service identities need a policy engine beyond folders.
- Infisical pricing or availability makes the boot dependency unacceptable.
- The origin moves into a cloud account with a native secret manager that removes the vendor.
