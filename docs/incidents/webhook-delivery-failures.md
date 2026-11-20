# Playbook — webhook / delivery failures

Outbound and inbound delivery paths failing: transactional email (Resend),
deploy notifications (`scripts/deploy/notify.ts` → webhook/email/console),
monitoring reports (`scripts/db/monitoring/check.mjs --webhook` /
`MONITOR_WEBHOOK_URL`), the B2 workspace-sync worker, and — once implemented —
inbound webhook endpoints under `src/app/api/webhooks/*`.

**Current state:** no inbound webhook endpoints exist yet; the wire contract
and mock receiver live in `scripts/webhooks/contract/` — see
`docs/webhooks/contract-testing.md` ("inbound endpoints not yet implemented").
Outbound webhooks from the app also don't exist yet. This playbook therefore
covers the delivery paths that exist today plus the contract to apply when
inbound endpoints land.

## Severity

**SEV2** when a delivery path users depend on is down — auth email
(password reset, magic link, verification) or deploy/monitor notifications
silently failing during an incident. **SEV3** for non-critical notification
delays or digest/marketing email degradation. If a _security-relevant_
delivery fails (e.g. alert webhooks down while an incident is active), treat
as SEV2 — you are flying blind.

## Detection signals

- Resend API errors in app logs / Sentry (`src/lib/email.ts` throws
  `Resend send failed with status <n>`; `sendEmail` returns `"unconfigured"`
  when `RESEND_API_KEY` is missing).
- `scripts/deploy/notify.ts` exiting 1 — "at least one channel failed"
  (channels: `webhook` via `DEPLOY_NOTIFY_WEBHOOK_URL`, `email` via Resend,
  `console` fallback — env contract in `docs/deploy/notifications.md`).
- `check.mjs --ci` exit 1 with webhook POST failures (stderr shows webhook
  errors; the JSON report still prints).
- Worker sync failures: B2 `401`/`403` recovered via `_PREVIOUS` key or
  repeated failures in worker logs (`infra/origin/compose.yaml` `worker`
  service; `docs/runbooks/secrets-rotation.md` §"B2 application key").
- Future inbound endpoints: signature failures
  (`verifySignatureHeader` reasons in `scripts/webhooks/contract/signing.ts`),
  dedup storms, `webhook-id`/`idempotency-key` mismatches.

## Immediate steps

1. **Identify which delivery path.** Auth/transactional email → step 2.
   Deploy/monitor notifications → step 3. B2 sync → step 4. Inbound webhooks
   (when live) → step 5.

2. **Email (Resend).**
   - `RESEND_API_KEY` valid? Rotate if needed (`docs/runbooks/secrets-rotation.md`
     §"Resend API key" — Resend keeps multiple keys valid; create new, deploy,
     verify a send, revoke old).
   - Resend dashboard: bounce/complaint spikes, domain verification status,
     plan sending limit (`docs/runbooks/hosting.md` §4 — beta quota, no
     auto-upgrade). A quota hit is SEV2 for auth flows.
   - Verify end-to-end: trigger a password-reset request and confirm delivery.
   - Note the app's own resend cooldown (`src/lib/auth/resend-cooldown.ts`)
     and per-route limiters — a 429 storm can look like an outage.

3. **Deploy/monitor notification webhooks.**
   - `DEPLOY_NOTIFY_WEBHOOK_URL` / `MONITOR_WEBHOOK_URL` reachable? Test with a
     dry run first (sends nothing):

     ```bash
     npx tsx scripts/deploy/notify.ts --event failed --error "webhook test" --dry-run
     node scripts/db/monitoring/check.mjs --dry-run --webhook https://example.invalid/hook
     ```

   - If the receiver (ntfy topic, Slack webhook, etc. — wiring in
     `docs/oncall/alerting.md`) is down, notifications are lost silently —
     this is why `console` channel exists; check CI logs for the printed
     payload.
   - Route a failing monitor run through the notify bridge documented in
     `docs/runbooks/database-monitoring.md` §"Via scripts/deploy/notify.ts".

4. **B2 sync worker.** Check `docker compose logs worker` on the host; `401`/
   `403` → B2 key rotation in flight or revoked — follow
   `docs/runbooks/secrets-rotation.md` §"B2 application key" (the
   `withB2Credentials` retry uses `_PREVIOUS`; if both fail, restore the old
   pair from Infisical history). Working-set reads keep serving files from
   local NVMe while sync is down (ADR 0001 §5.2) — degraded, not lost.

5. **Inbound webhooks (when `src/app/api/webhooks/*` lands).** Implement
   against `scripts/webhooks/contract/`: verify `webhook-signature` with
   current+previous secrets via `src/lib/secrets/keyring.ts`, enforce the
   300 s `SIGNATURE_TOLERANCE_SECONDS`, dedupe on `idempotencyKey` /
   `webhook-id`, return 200 on duplicates. Test against the mock receiver:

   ```bash
   npx tsx scripts/webhooks/contract/receiver.ts --port 4100 --secret <current> --secret <previous>
   npx vitest run --config scripts/webhooks/contract/vitest.config.mts
   ```

   Signature-verification outages (e.g. wrong secret after rotation) → rotate
   per the keyring overlap pattern; do **not** disable verification.

6. **Verify.** One real send per fixed path; confirm the alert channel still
   receives a test message (`docs/oncall/handoff.md` pre-shift checklist has
   the "test the alert channel" step).

## Comms template

```text
[SEV2] Delivery degraded — <email | deploy notifications | monitor webhooks |
B2 sync> failing since <time UTC>. Users affected: <auth emails delayed |
none — internal only>. Mitigation: <provider fix | rotation | receiver
restore>. IC: <name>.
```

If alerting itself is broken, say so loudly and ack alerts manually in the
channel until restored — an unmonitored incident is worse than a delayed one.

## Postmortem checklist

- [ ] Which delivery path, failure mode (provider, auth, quota, receiver,
      code), and duration.
- [ ] Were notifications lost during the window? Reconstruct from
      `console`-channel output / CI logs.
- [ ] User impact: auth flows blocked? digest/marketing delayed?
- [ ] If provider-side: quota/billing action taken; if rotation: both current
      and `_PREVIOUS` states verified.
- [ ] Action items: add a canary send for Resend, alert on notify.ts exit 1,
      document the inbound-webhook runbook when endpoints ship.
