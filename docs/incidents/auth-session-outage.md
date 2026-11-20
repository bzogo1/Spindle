# Playbook — auth / session outage

Sign-in, sign-up, session refresh, or auth email is broken for all or many
users. Auth is cookie-based: `spindle_at` access JWT + `spindle_rt` refresh
token (`src/lib/auth/http.ts`), with `SESSION_SECRET` (+ `_PREVIOUS`) signing
the JWTs via the dual-key keyring (`src/lib/secrets/keyring.ts`,
`src/lib/secrets/session.ts`).

## Severity

**SEV1** if no user can sign in or all sessions are invalidated
(e.g. `SESSION_SECRET` misconfigured so every token fails verification).
**SEV2** for partial breakage — passwordless/magic-link email not arriving,
refresh failing for a subset, OAuth provider down.

## Detection signals

- Sentry errors on `/api/auth/*` routes (`src/app/api/auth/` — errors are
  unsampled in `src/sentry.server.config.ts`).
- `npm run secrets:check -- --production` reporting missing/malformed
  `SESSION_SECRET`, `SESSION_SECRET_PREVIOUS`, `EDGE_HMAC_SECRET`,
  `WORKER_SECRET` (contract in `src/lib/secrets/catalog.ts`).
- `npm run secrets:verify-rotation` not reporting `current=ok previous=ok`
  during a rotation window.
- User reports of "signed out everywhere" or magic links never arriving.
- Resend dashboard showing failures/rejections for auth emails
  (`src/lib/email.ts` posts to `https://api.resend.com/emails`).

## Immediate steps

1. **Determine blast radius.** Try a sign-in yourself on
   `https://app.spindle.app/sign-in`. Check `/api/auth/session` returns
   expected shape. Check whether existing sessions still work (access cookie
   `spindle_at` is session-scoped; refresh `spindle_rt` is rotated on every
   use — `src/lib/auth/http.ts`).

2. **Secret-store problem.** If the app recently deployed or rotated:

   ```bash
   npm run secrets:check -- --production
   npm run secrets:verify-rotation
   ```

   inside the container env on the host (`docs/decisions/0002-secrets-management.md`
   — the entrypoint `scripts/secrets/entrypoint.sh` injects from Infisical at
   container start; if Infisical is unreachable the host does not start —
   intentional). If `SESSION_SECRET` is missing/malformed, restore it from
   Infisical version history and redeploy — procedure in
   `docs/runbooks/secrets-rotation.md` §"Session secret".

3. **Bad `SESSION_SECRET` rotation.** If sessions broke right after a
   rotation: verify overlap is correct — old value must be in
   `SESSION_SECRET_PREVIOUS`, new in `SESSION_SECRET`. Rollback = swap
   current/previous or restore the old value from version history, then
   redeploy (`docs/runbooks/secrets-rotation.md` §"Session secret" →
   "Rollback"). `npm run secrets:drill` rehearses the dual-key mechanism
   offline.

4. **Auth email not arriving** (password reset, magic link, verify email):
   check `RESEND_API_KEY` validity and Resend dashboard bounces; the sender
   domain must be verified in Resend (`docs/runbooks/secrets-rotation.md`
   §"Resend API key"). Rate limits: `/api/auth/passwordless/request`,
   `/api/auth/password/reset/request`, `/api/auth/verify-email/resend` are
   limited (5 per 10 min) and resend has its own cooldown
   (`src/lib/auth/resend-cooldown.ts`) — a user hammering resend gets 429 +
   `retryAfter`, which is correct behavior, not an outage.

5. **DB-backed session/user lookups failing.** If sign-in reaches the DB and
   fails, this is `database-down.md` — auth tables live in Postgres.

6. **Edge HMAC rejecting requests.** If _all_ API calls 401 at the edge but
   the app is healthy, suspect `EDGE_HMAC_SECRET` rotation mid-flight — the
   origin accepts current + previous for a five-minute timestamp window
   (`docs/runbooks/secrets-rotation.md` §"Edge HMAC"). Confirm unsigned
   requests still get 401 and signed ones pass after both sides deploy.

7. **Verify.** Sign in fresh (new browser profile), confirm an existing
   session still works through the overlap, send one auth email end-to-end.

## Comms template

```text
[SEV2] Auth degraded — <sign-in failing | sessions dropped | auth email
delayed> since <time UTC>. Root cause under investigation (<secret rotation |
Resend | DB>). Workaround: <none | re-login required>. IC: <name>.
```

If a secret rotated and sessions must be re-established, say so explicitly —
users will otherwise think it's a bug.

## Postmortem checklist

- [ ] Which component failed (JWT verify, refresh rotation, email send, DB).
- [ ] Was a rotation in flight? Did `verify-rotation` pass beforehand?
- [ ] Blast radius: how many users/sessions affected; any lockouts needing
      manual unlock (`src/lib/auth/backup-codes.ts`, audit routes).
- [ ] If email: Resend delivery stats for the window; domain/DNS check.
- [ ] Action items: rotation runbook gap, monitoring for auth-error rate,
      session-invalidation comms template.
