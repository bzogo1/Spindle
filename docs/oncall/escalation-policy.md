# On-call escalation policy

Applies to the production origin described in `docs/runbooks/hosting.md`
(`app.spindle.app`, `lab.spindle.app`) and its staging counterpart. There is no
external paging service: escalation is a timed ladder over the alert channel,
and "acknowledged" always means an explicit ack in that channel (reaction or
reply naming the alert), not silence.

## Severity matrix

Incident severity is set at triage by the L1 on-call (or by the alert's own
severity when automated). `docs/incidents/` postmortems (when present) use the
same scale.

| Severity | Definition                                                                                     | Examples                                                                                                                     |
| -------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **SEV1** | Full outage, data loss/corruption, security breach, or tunnel/ingress down                     | App unreachable for all users; Postgres down; failed-migration alert firing; secret leak detected                            |
| **SEV2** | Major degradation or a single critical subsystem down; users impacted but service partially up | DB pool saturation ≥ critical; disk ≥ 90%; backup staleness critical; deploy failed and rollback pending                     |
| **SEV3** | Minor degradation, recoverable automatically or with low-touch fix                             | Warning-level monitor alerts (long queries, dead tuples, idle-in-transaction); intermittent 5xx; single lab session failures |
| **SEV4** | No user impact; hygiene, capacity planning, cosmetic                                           | Non-firing warnings, report-only monitors, doc/config drift                                                                  |

Monitor rule severities map onto this scale: a `critical`-status result from
`scripts/db/monitoring/check.mjs` or a failed `notify.ts` deploy event is at
least SEV2 and SEV1 when it matches the examples above; `warning` is SEV3;
`skipped`/`error`-of-the-checker-itself is SEV3 (the monitor being blind is
itself a signal).

## Escalation ladder and SLAs

All times are from alert delivery to the channel (or from incident declaration
for user-reported incidents). Acks are per-severity.

| Level  | Who                                                    | Role                                                                         | Ack SLA                                                                       | Escalate when                                              |
| ------ | ------------------------------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **L1** | On-call primary (weekly rotation, see `README.md`)     | Triage, runbooks, incident drive                                             | SEV1: **15 min** · SEV2: **30 min** · SEV3: **2 h** · SEV4: next business day | No ack within SLA, or cannot resolve within resolve window |
| **L2** | On-call secondary (next in rotation)                   | Backup responder; co-drives SEV1/SEV2                                        | SEV1: **15 min** · SEV2: **30 min** · SEV3: **4 h**                           | No ack within SLA, or SEV1 unresolved after 1 h            |
| **L3** | Engineering lead (constant, in `rotation.config.json`) | Decides SEV1 comms, approves risky mitigations (rollback, restore, failover) | SEV1: **15 min**                                                              | Always informed on SEV1; owns post-incident review         |

Resolve targets (not acks): SEV1 — mitigate within 1 h, fully resolve or
explicitly hand to L3 within 4 h; SEV2 — resolve or hand off within the shift;
SEV3 — ticketed, addressed within 5 business days; SEV4 — backlog.

### Escalation mechanics (no pager)

1. L1 is the rotation's current primary; the alert channel message names them
   (see `alerting.md` for how the roster is wired into notifications).
2. If L1 does not ack within the ack SLA, the sender/automation **re-posts the
   alert mentioning L2** (the rotation's `l2` for that week) — or L2 watches the
   same channel and self-escalates when an unacked alert ages past the SLA.
3. If L2 also misses, **L3 is mentioned directly**. On SEV1, L3 is CC'd from the
   start — do not wait for the ladder.
4. During shift handoff (see `handoff.md`), the outgoing L1 briefs the incoming
   L1; an active SEV1/SEV2 stays with the outgoing L1 until explicitly
   transferred, never silently.

### Who can declare / de-escalate

- **Declare SEV1/SEV2:** any on-call level, or the L3 lead unilaterally.
- **De-escalate:** L3 lead only, or L1 with L3 sign-off for SEV1/SEV2.
- **SEV3/SEV4:** L1 decides; L2 may re-triage.

## Availability expectations

- On-call is a weekly rotation over `scripts/oncall/rotation.config.json`
  members; regenerate the roster before each rotation block runs out
  (`node scripts/oncall/rotation.mjs --weeks 12`).
- Primary and secondary must not be the same person in the same week (the
  config validation enforces ≥2 members; with exactly 2 members L1/L2 swap
  weekly, which is acceptable for a two-person team).
- If the on-call is unreachable (vacation, incident), they **swap shifts in
  the roster config and regenerate** — do not ad-hoc reassign in chat, so the
  ICS/roster stays the source of truth.
- Night/weekend: same ladder applies; SEV1/SEV2 SLAs do not relax off-hours.
  SEV3/SEV4 may be deferred to business hours at L1's discretion.
