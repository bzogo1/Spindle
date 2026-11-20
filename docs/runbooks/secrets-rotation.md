# Runbook — rotating production secrets

This runbook covers every value in the secret-store contract. The decision and
access model are in [`docs/decisions/0002-secrets-management.md`](../decisions/0002-secrets-management.md).

## Before you start

- You are in the release-manager or admin role and signed in with SSO and 2FA.
- You know which environment you are changing: `staging` first, then `prod`.
- `npm run secrets:check -- --production` passes on the current deployment.
- You have a rollback: the old value is still in Infisical's version history.

Never paste a value into a ticket, a chat, a commit, or a shell history. Set it in the store and let
the entrypoint inject it.

```bash
# Names and shape only; values are never printed.
npm run secrets:check -- --production

# After both keys are in place, before removing the previous one.
npm run secrets:verify-rotation

# Ephemeral rehearsal of the B2 fallback and edge HMAC overlap. It makes no
# secret-store or provider calls.
npm run secrets:drill
```

## Local rehearsal

Run `npm run secrets:drill` before a staging rotation. It uses generated keys and a fake B2 provider
to prove that the previous B2 pair recovers one auth failure, the previous edge signature verifies
during overlap, new signatures use the current key, and the old key is rejected after cleanup. It is
a mechanism check, not proof that the store or providers are configured.

## Live drill evidence

For staging and production, record the environment, timestamp, operator, store path, and identity
names — never values. Capture `npm run secrets:check -- --production`, `npm run
secrets:verify-rotation`, the provider-side objects created and revoked, one B2 upload/download,
one edge-signed request, and the rollback decision. Repeat the drill in staging before touching
production.

## Rotation schedule

| Service      | Variables                                          | Max age  | Strategy         |
| ------------ | -------------------------------------------------- | -------- | ---------------- |
| B2           | `B2_KEY_ID`, `B2_APPLICATION_KEY` (+ `_PREVIOUS`)  | 90 days  | Dual key         |
| Resend       | `RESEND_API_KEY`                                   | 180 days | Provider overlap |
| LLM provider | `LLM_API_KEY`                                      | 90 days  | Provider overlap |
| Postgres     | `DATABASE_URL`, `DIRECT_URL`                       | 90 days  | Role overlap     |
| Session      | `SESSION_SECRET` (+ `SESSION_SECRET_PREVIOUS`)     | 30 days  | Dual key         |
| Edge HMAC    | `EDGE_HMAC_SECRET` (+ `EDGE_HMAC_SECRET_PREVIOUS`) | 90 days  | Dual key         |
| Worker       | `WORKER_SECRET` (+ `WORKER_SECRET_PREVIOUS`)       | 90 days  | Dual key         |

Also rotate immediately after any suspected exposure, a laptop loss, a staff departure, or a
provider incident that could have exposed the value. An emergency rotation accepts downtime if the
provider cannot keep both values valid.

## Session secret

New tokens are signed with `SESSION_SECRET`; `SESSION_SECRET_PREVIOUS` only verifies. Existing
sessions keep working through the overlap.

1. Generate a value of at least 32 characters in the store or with `openssl rand -base64 48`.
2. In Infisical `prod:/app`, copy the current `SESSION_SECRET` into `SESSION_SECRET_PREVIOUS`.
3. Set `SESSION_SECRET` to the new value.
4. Deploy the app. `npm run secrets:verify-rotation` must report `current=ok previous=ok`.
5. Sign in with a new browser profile and confirm an existing session still works.
6. After the session lifetime (7 days by default) plus one deploy, remove `SESSION_SECRET_PREVIOUS`.
7. Run `npm run secrets:verify-rotation` again and confirm `previous=not set`.

Rollback: restore the old value from version history, or swap current and previous, then redeploy.

## Edge HMAC

The edge signs method, path, timestamp, and body hash. The origin accepts the current key and the
previous key, and rejects timestamps outside a five-minute window.

1. Generate a value of at least 32 characters.
2. On the origin, set `EDGE_HMAC_SECRET_PREVIOUS` to the old value and `EDGE_HMAC_SECRET` to the new
   value. Deploy the origin first so it accepts both.
3. Update the edge signer (Cloudflare Worker or tunnel configuration) to sign with the new value.
4. Verify with `npm run secrets:verify-rotation` and one real request through the edge. A signed
   request from the old edge build must still be accepted while the new edge rolls out.
5. After the edge rollout is complete, remove `EDGE_HMAC_SECRET_PREVIOUS`.
6. Confirm an unsigned request is still rejected with `401`.

Rollback: point the edge signer back at the old value, or swap current and previous on the origin.

## B2 application key

`withB2Credentials` retries once with the previous pair on a `401`/`403`, so a process that holds
both keys survives the cutover.

1. In Backblaze, create a second application key scoped to the project bucket only.
2. In `prod:/app`, set `B2_KEY_ID_PREVIOUS` and `B2_APPLICATION_KEY_PREVIOUS` to the old pair.
3. Set `B2_KEY_ID` and `B2_APPLICATION_KEY` to the new pair.
4. Deploy the app and worker.
5. Upload a small file and download it through the app. Check the worker sync log for a `401` that
   recovered on the previous key.
6. Revoke the old application key in Backblaze.
7. Remove the `_PREVIOUS` values from the store.
8. Repeat the upload and download; a revoked key must not be needed.

Rollback: keep the old key valid and restore the old pair; do not revoke it until step 6.

## Resend API key

Resend keeps multiple keys valid at once.

1. Create a new sending key in Resend.
2. Set `RESEND_API_KEY` in `prod:/app` and deploy.
3. Send a password-reset or verification email and confirm delivery in Resend.
4. Revoke the old key.
5. Remove the old key from the store's version history only after the retention period your policy
   requires.

Rollback: keep the old key valid until step 4.

## LLM provider key

1. Create a new key in the provider console, scoped to the production project.
2. Set `LLM_API_KEY` in `prod:/app` and deploy.
3. Run one agent or automation completion and check the provider dashboard for the new key.
4. Revoke the old key.

Rollback: keep the old key valid until step 4.

## Postgres credentials

Use a second role rather than changing the password of the role that is serving traffic.

1. Create `spindle_app_next` with the same grants as `spindle_app`.
2. Build the new pooled and direct URLs with the new role and password.
3. Set `DATABASE_URL` and `DIRECT_URL` in `prod:/app` and `prod:/deploy`.
4. Deploy. Run `npm run db:deploy` and one read/write smoke test.
5. Watch the connection count on the old role until it reaches zero.
6. Drop the old role and revoke its password.
7. Remove the old values from the store.

Rollback: restore the old URLs and redeploy; keep the old role until step 6.

## Worker secret

1. Generate a value of at least 32 characters.
2. Move the old `WORKER_SECRET` to `WORKER_SECRET_PREVIOUS` in both `prod:/app` and `prod:/worker`.
3. Set `WORKER_SECRET` to the new value.
4. Deploy the worker and the app. The worker accepts either key through `verifyWorkerToken`.
5. Run one queued job and confirm it is claimed and completed.
6. Remove `WORKER_SECRET_PREVIOUS` after the overlap window.
7. Run `npm run secrets:verify-rotation` and confirm `previous=not set`.

Rollback: swap current and previous, then redeploy both sides.

## Leaked secret

1. Revoke the value at the provider first. Do not wait for a deploy.
2. Rotate the value with the procedure above, using a new provider credential.
3. Search the audit log for reads and writes by the affected identity since the exposure.
4. Review application logs for the affected service and check for unexpected usage.
5. If a deploy identity token leaked, revoke the identity, create a new one, and update the host's
   secret mount.
6. Record the incident, the rotation time, and the audit-log window.

## Quarterly review

- Confirm every value is younger than its max age.
- Confirm the machine identities still have the narrowest scope that works.
- Export or screenshot the audit log for the quarter and store it with the incident records.
- Confirm the break-glass credential is sealed, current, and not on the origin.
- Run `npm run secrets:scan` and confirm `.dockerignore` still excludes `.env*`.
