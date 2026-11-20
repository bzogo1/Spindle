# On-call rotation

Self-hosted, single-host deployment (see `docs/runbooks/hosting.md` and ADR
`docs/decisions/0001-container-host-topology.md`) with **no external paging
service**. Alerts reach humans through webhook/email channels wired to the
rotation roster; this directory defines who is on, how they escalate, and how
they hand off.

## Contents

| File                   | Purpose                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| `escalation-policy.md` | Severity matrix, L1 → L2 → L3 response SLAs, escalation triggers                                |
| `handoff.md`           | Pre-shift checklist, shift-change handoff template, post-incident notes                         |
| `alerting.md`          | How `scripts/db/monitoring/check.mjs` and `scripts/deploy/notify.ts` feed the notification path |

## Generating the schedule

`scripts/oncall/rotation.mjs` expands a weekly rotation from
`scripts/oncall/rotation.config.json` into an ICS calendar file and a markdown
roster. It is dependency-free and fully offline.

```bash
# Real config (edit members/startDate first — placeholders are committed)
node scripts/oncall/rotation.mjs --weeks 12

# Demo: built-in placeholder members, next-Monday start, no config read
node scripts/oncall/rotation.mjs --demo --weeks 4
```

Outputs land in `scripts/oncall/.output/` (gitignored) unless `--out <dir>` is
given. Import the `.ics` into any calendar app, or publish the `.md` roster to
the team wiki/channel topic.

### Config (`scripts/oncall/rotation.config.json`)

| Field                            | Meaning                                                                                |
| -------------------------------- | -------------------------------------------------------------------------------------- |
| `service`                        | Slug used in file names and calendar names, e.g. `spindle-production`                  |
| `startDate`                      | First Monday of the rotation, `YYYY-MM-DD` (must be a Monday, UTC)                     |
| `weeks`                          | Default number of weeks to generate (CLI `--weeks` overrides)                          |
| `timezoneNote`                   | Free-text timezone label carried into the ICS `X-WR-TIMEZONE`                          |
| `members[]`                      | Ordered list; `name` required, `handle`/`email` optional. Order defines rotation order |
| `rotation.l1Offset` / `l2Offset` | Index offsets into `members` for L1 primary / L2 secondary (defaults 0 / 1)            |
| `escalationLead`                 | Constant L3 — the engineering lead, repeated on every roster row                       |

With `members` in config order, week _w_ assigns:

- **L1 primary** = `members[(w + l1Offset) % n]`
- **L2 secondary** = `members[(w + l2Offset) % n]`
- **L3 lead** = `escalationLead` (constant)

Only `weekly` rotation is supported today. The placeholder member names and
`example.invalid` emails in the committed config **must be replaced** with the
real on-call roster before the schedule is used for paging.

## Model summary

- **L1 on-call** — owns the shift: triage, runbooks, incident drive. Page target #1.
- **L2 secondary** — next person in rotation order; paged when L1 misses the ack SLA.
- **L3 eng lead** — constant escalation point; owns SEV1 decisions and comms.

There is deliberately no paging SaaS. "Paging" = a message in the alert channel
with an explicit ack step (see `alerting.md`). Acknowledgement is a reaction or
reply in that channel — see `escalation-policy.md` for what counts and the SLAs.
