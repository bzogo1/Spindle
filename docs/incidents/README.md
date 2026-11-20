# Incident response playbooks

This directory holds the incident playbooks for Spindle. Each playbook covers
one incident type that this stack can actually produce: what it looks like, who
responds, the first actions, the comms template, and the postmortem checklist.

## Index

| Playbook                                                     | Incident                                                                                        | Typical severity |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ---------------- |
| [site-down.md](site-down.md)                                 | `app.spindle.app` / `lab.spindle.app` unreachable — app, compose stack, tunnel, or host failure | SEV1             |
| [database-down.md](database-down.md)                         | Postgres unreachable, refusing connections, or saturated                                        | SEV1–SEV2        |
| [migration-failure.md](migration-failure.md)                 | `migrate deploy` fails or a migration is left unfinished                                        | SEV1–SEV2        |
| [auth-session-outage.md](auth-session-outage.md)             | Sign-in, sessions, or auth email broken for all or many users                                   | SEV2             |
| [secrets-leak.md](secrets-leak.md)                           | A credential escaped the secret store — repo, log, chat, provider                               | SEV1             |
| [webhook-delivery-failures.md](webhook-delivery-failures.md) | Email, deploy-notification, monitor-webhook, or (future) inbound webhook delivery failing       | SEV2–SEV3        |
| [backup-failure.md](backup-failure.md)                       | Backup job failing or artifacts stale/unrestorable                                              | SEV2             |
| [deploy-rollback.md](deploy-rollback.md)                     | A release is bad and must be rolled back                                                        | SEV2             |
| [sentry-alert-storm.md](sentry-alert-storm.md)               | Sentry issue/alert flood masking real errors or burning quota                                   | SEV3             |
| [rate-limit-abuse.md](rate-limit-abuse.md)                   | Auth-form or public-endpoint abuse, credential stuffing, quota burn                             | SEV2–SEV3        |

## Severity matrix

The authoritative severity definitions and the L1/L2/L3 escalation ladder are in
[`docs/oncall/escalation-policy.md`](../oncall/escalation-policy.md). Summary:

| Severity | Definition                                                       | Ack SLA (L1)      | Examples from these playbooks                                                                           |
| -------- | ---------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------- |
| **SEV1** | Full outage, data loss/corruption, security breach, ingress down | 15 min            | site-down, database-down, secrets-leak, failed-migrations critical                                      |
| **SEV2** | Major degradation or a critical subsystem down; partial service  | 30 min            | migration-failure, auth-session-outage, backup-failure, deploy-rollback, webhook/delivery pipeline down |
| **SEV3** | Minor degradation, self-healing or low-touch fix                 | 2 h               | sentry-alert-storm, rate-limit/abuse at low volume, warning-level monitor rules                         |
| **SEV4** | No user impact; hygiene, capacity, cosmetic                      | next business day | stale docs, non-firing warnings, report-only monitors                                                   |

Monitor rule severities map onto this scale exactly as described in
`docs/oncall/escalation-policy.md` §"Severity matrix": a `critical` result from
`scripts/db/monitoring/check.mjs` is at least SEV2, SEV1 when it matches the
examples there (Postgres down, failed migration, secret leak, tunnel down).

Alert routing to escalation policies is configured in
[`docs/alerts/routing.json`](../alerts/routing.json) →
[`docs/alerts/policies.json`](../alerts/policies.json). The channel wiring
(producers → webhook → human) is in
[`docs/oncall/alerting.md`](../oncall/alerting.md).

## How to use a playbook

1. **Triage** — set severity per the matrix; declare SEV1/SEV2 in the alert
   channel per `docs/oncall/escalation-policy.md` §"Who can declare".
2. **Follow the playbook top to bottom.** Steps reference real scripts and runbooks
   in this repo; every path cited exists. If a step says "on the host", that is the
   Hetzner origin (`/srv/spindle` prod, `/srv/spindle-staging` staging) reached via
   Cloudflare Access/Tailscale — see `docs/runbooks/hosting.md`.
3. **Communicate** using the playbook's template in the alert channel; keep one
   thread per incident.
4. **Resolve** — confirm the detection signals are green, then post the resolve
   message and start the postmortem checklist.

## Ground rules that apply to every incident

- **Never paste secret values** into tickets, chat, commits, or shell history —
  see `docs/runbooks/secrets-rotation.md` and `docs/security/secret-management.md`.
- **Staging first.** Rehearse risky mitigations (rollback, restore, rotation) on
  `https://staging.spindle.app` before touching prod when time allows;
  `docs/resilience/disaster-recovery.md` defines the drill program.
- **Migrations are forward-only.** App rollback never reverses schema — keep
  schema changes backward compatible (`docs/runbooks/rollback.md` §6).
- **Record everything.** Postmortem checklist at the bottom of each playbook;
  append lessons-learned entries per `docs/resilience/disaster-recovery.md`
  §"Lessons-learned log format".

## Related documentation

- Runbooks (mechanics): `docs/runbooks/` — hosting, rollback, database-*,
  secrets-rotation, migration-rollback.
- DR plan and RPO/RTO: `docs/resilience/disaster-recovery.md`.
- Security docs: `docs/security/` — secret management, leak detection,
  rotation automation, access audit.
- On-call: `docs/oncall/` — README, alerting, escalation-policy, handoff.
- ADRs: `docs/decisions/0001-container-host-topology.md`,
  `docs/decisions/0002-secrets-management.md`.
