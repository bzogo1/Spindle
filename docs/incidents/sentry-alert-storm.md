# Playbook — Sentry alert storm

A flood of Sentry issues/alerts — a bad deploy emitting exceptions, a
third-party outage, a bot/scanner hammering an endpoint, or a loop — drowning
the signal and burning the org's event/spend quota. Sentry is configured in
`src/instrumentation.ts` (register + `onRequestError`),
`src/sentry.server.config.ts`, `src/sentry.edge.config.ts`, and
`src/instrumentation-client.ts`.

## Severity

**SEV3** when the storm is noise (quota burn, alert fatigue) but the app is
healthy. **SEV2** if the storm _is_ the symptom of a real outage — a spike of
genuine 5xx-class exceptions means users are impacted; correlate with
`site-down.md` / `database-down.md` before treating it as noise. **SEV1** only
if the underlying cause is itself SEV1.

## Detection signals

- Sentry issue/alert volume spike — filter by `release` (set from
  `SENTRY_RELEASE`/`GITHUB_SHA`/`VERCEL_GIT_COMMIT_SHA` in
  `src/sentry.server.config.ts`) to see if one deploy caused it.
- Event quota / spend: org spend cap is **$20/month** (`docs/runbooks/hosting.md`
  §4) — storm can trip billing alerts before it trips on-call.
- `captureConsoleIntegration({ levels: ["error", "warn"] })` in
  `src/sentry.server.config.ts` means noisy `console.error`/`console.warn`
  calls become Sentry events — a chatty dependency can storm via console
  capture even with few real exceptions.
- Traces: `tracesSampleRate` defaults to **0.1** server-side and client-side
  (`DEFAULT_TRACES_SAMPLE_RATE`), overridable via
  `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` — a misconfigured override to 1.0
  multiplies span volume 10×.
- Client replay/feedback/console capture only activates after consent
  (`src/instrumentation-client.ts`) — consent-gated, so storms there imply
  real user sessions hitting errors.

## Immediate steps

1. **Triage the top issues.** In Sentry, sort by event count; group by
   release and transaction. Identify whether it's: (a) one real bug exploded,
   (b) many distinct issues from one deploy, or (c) external noise (scanner
   traffic, browser extensions).

2. **If it's a bad deploy** — this overlaps `deploy-rollback.md`: confirm
   error rate vs. the previous release, then roll back via
   `scripts/deploy/rollback.mjs` rather than fighting the storm.

3. **If it's a real bug at volume** — fix forward only if faster than
   rollback; otherwise rollback first, fix on a branch. Do **not** try to
   "fix" by deleting Sentry data — you lose the evidence.

4. **If it's noise/quota:**

   - **Mute/archive the noisy issue** in Sentry (issue → archive/mefore until
     escalating). Prefer `until escalating` so a real recurrence re-opens it.
   - **Drop the noise at source if it's ours:** `console.error/warn` calls in
     `src/` feed `captureConsoleIntegration` — find the caller via the event's
     stack/logs and rate-limit or downgrade it. Third-party noise should be
     filtered in `beforeSend` (`src/sentry.server.config.ts` drops dev
     console noise and `src/instrumentation-client.ts` drops generic RSC #441
     duplicates — same pattern applies to prod noise, carefully).
   - **Check the sample-rate override:** if
     `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` was raised recently, trace volume
     (not error events — those are never sampled) may be the quota driver;
     restore 0.1 or lower.
   - **Inbound traffic flood?** Check Cloudflare (edge rate limits/WAF per
     ADR 0001) and the app's own limiters — see `rate-limit-abuse.md`.

5. **Never disable Sentry to stop the storm** during an active incident —
   `src/instrumentation.ts` failing closed is worse than noisy telemetry.
   Only consider a `SENTRY_DSN` removal as a last-resort SEV1 comms decision
   with L3 sign-off.

6. **Verify.** Event rate back to baseline; the one real issue (if any) is
   tracked; quota spend trending normal.

## Comms template

```text
[SEV3] Sentry alert storm — <N> events/hr from <release|issue-class>,
driven by <bad deploy | noisy dependency | traffic flood | sample-rate
misconfig>. App health: <ok | degraded — see <other playbook>>. Action:
<muted issue X | rolling back | filtering beforeSend | rate-limit at edge>.
IC: <name>.
```

## Postmortem checklist

- [ ] Root cause of the storm and whether it masked a real incident.
- [ ] Quota impact: events consumed, spend vs. $20/mo cap
      (`docs/runbooks/hosting.md` §4).
- [ ] Which Sentry mechanism amplified it (console capture, replay, traces
      sample rate, unsampled errors).
- [ ] If deploy-caused: did release filtering make correlation obvious?
- [ ] Action items: `beforeSend` filters for confirmed noise classes,
      alert-rule tuning (volume thresholds), sample-rate review,
      dependency upgrade if a library logs excessively.
