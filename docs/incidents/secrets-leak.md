# Playbook — secret leak / exposure

A credential escaped the secret-store contract (ADR
`docs/decisions/0002-secrets-management.md`): committed to git, printed in a
log, pasted into chat/ticket, or exposed by a provider incident. Treat every
confirmed exposure as compromised — rotation is the fix, not deletion.

## Severity

**SEV1** for any production secret (`prod:/app`, `prod:/worker`,
`prod:/edge`, `prod:/deploy` values: B2 keys, `RESEND_API_KEY`,
`LLM_API_KEY`, `DATABASE_URL`/`DIRECT_URL`, `SESSION_SECRET`,
`EDGE_HMAC_SECRET`, `WORKER_SECRET`, Infisical tokens). **SEV2** for
staging/dev exposures or `_PREVIOUS` rotation leftovers. **SEV3** for
near-misses (a redacted log line, a test fixture).

## Detection signals

- `node scripts/secrets/leak-detection/detect.mjs` — deep sweep of working
  tree, git history, tracked `.env` files, high-entropy strings, and app logs
  (`--logs-dir`). Exits 1 on critical findings; `--json` for machines
  (`docs/security/secret-leak-detection.md`).
- `npm run secrets:scan` (`scripts/secrets/scan.mjs`) — fast repo hygiene
  patterns; gitleaks CI gate per `docs/security/secret-scanning-ci.md`.
- Runtime guard `src/lib/secrets/leak-guard.ts` scrubs credentials from
  errors/logs/Sentry `beforeSend` — if you saw a raw secret anywhere, that
  boundary leaked; find where.
- Secret-access audit: `npx tsx scripts/secrets/audit-access.ts --json`
  summarizes reads/writes from `.spindle/secret-access-audit.jsonl`
  (`docs/security/secret-access-audit.md`).
- Provider-side signals: unexpected usage on B2/Resend/LLM dashboards,
  Infisical audit-log reads by an unexpected identity.
- Sentry events containing credential-looking strings (check `beforeSend`
  scrubbing held — `src/sentry.server.config.ts`).

## Immediate steps

1. **Confirm scope without re-exposing.** Identify _which_ secret and _where_
   it leaked. Do not paste the value anywhere — quote locations only
   (`file:line`, commit SHA, log timestamp, provider event).

2. **Revoke at the provider first.** Do not wait for a deploy — follow
   `docs/security/secret-management.md` §"Incident response — leaked secret"
   and `docs/runbooks/secrets-rotation.md` §"Leaked secret":

   - Provider credentials (B2, Resend, LLM, Postgres role): revoke/create-new
     at the provider console **now**.
   - Store-managed values (`SESSION_SECRET`, `EDGE_HMAC_SECRET`,
     `WORKER_SECRET`): rotate via the dual-key procedure — old value to
     `_PREVIOUS`, new value current, deploy, verify with
     `npm run secrets:verify-rotation`, then remove `_PREVIOUS`
     (`docs/runbooks/secrets-rotation.md` per-secret sections). Note: a leaked
     `_PREVIOUS` value is still live until removed — revoke it too.
   - Infisical machine-identity token: revoke the identity, create a new one,
     update the host's secret mount.

3. **Hunt for use of the leaked value.**

   ```bash
   npx tsx scripts/secrets/audit-access.ts --since <exposure-time> --json
   node scripts/secrets/leak-detection/detect.mjs --logs-dir=<app log dir>
   ```

   Check provider audit logs (B2 key usage, Resend sends, LLM requests,
   Infisical reads) since the exposure window. Check app logs for the affected
   service.

4. **Assess blast radius.** Did the leaked value grant read access to user
   data (B2 project files, DB)? That determines whether this is SEV1 with a
   customer-data notification obligation — escalate to L3/CISO per
   `docs/alerts/policies.json` `secrets-critical` chain and involve whoever
   owns legal/comms.

5. **Deploy the rotation.** New values propagate at container start via
   `scripts/secrets/entrypoint.sh` (Infisical injection,
   `docs/decisions/0002-secrets-management.md` §"Runtime injection").
   Verify: `npm run secrets:check -- --production` and
   `npm run secrets:verify-rotation` inside the container env; run one real
   operation per affected provider (B2 upload/download, one auth email, one
   LLM call).

6. **Close the hole.** If it was a commit: the value stays in git history —
   rotation already happened, so history is now harmless; still, mark reviewed
   false positives with `leak-detection:ignore` and re-run the detector until
   clean (`docs/security/secret-leak-detection.md` §"Triage").

## Comms template

```text
[SEV1] Suspected secret exposure — <provider/service>, value exposed via
<location class only, no value>. Revocation/rotation in progress under
<runbook>. Audit-log review window: <start>–<end>. IC: <name>; security
lead CC'd.
```

Do not name the secret value or paste evidence containing it. Legal/comms
notification decision belongs to L3 — flag early if user data was reachable.

## Postmortem checklist

- [ ] Which secret, exposure vector, and exposure window (audit logs).
- [ ] Rotation completed for current **and** `_PREVIOUS` values; provider-side
      old credential revoked (evidence: timestamps).
- [ ] Usage review: any unauthorized reads/writes by the leaked credential.
- [ ] Whether customer-data notification is required (L3 decision, recorded).
- [ ] Why the leak-guard / CI scan didn't catch it; action items to close the
      gap (wire `leak-detection/detect.mjs` into pre-release per
      `docs/security/secret-leak-detection.md` §"CI integration").
- [ ] Quarterly audit-log export updated per `docs/runbooks/secrets-rotation.md`
      §"Quarterly review".
