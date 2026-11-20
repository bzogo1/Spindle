# On-call handoff

Weekly rotation shifts run Monday 00:00 UTC → Monday 00:00 UTC. Handoff happens
in the last hour of the outgoing shift (Sunday 23:00–24:00 UTC) and the first
hour of the incoming shift (Monday 00:00–01:00 UTC). Active SEV1/SEV2 incidents
are transferred explicitly, never left implicit.

## Pre-shift checklist (incoming on-call, first 30 min)

- [ ] **Confirm you are L1 this week** — check the generated roster
      (`scripts/oncall/.output/*-oncall-*.md` or the published copy) for the
      current week; verify against `scripts/oncall/rotation.config.json`.
- [ ] **Check open alerts** — review the alert channel history since your last
      shift for unacked or recurring warnings. Anything unacked older than its
      severity SLA gets acked now or escalated per `escalation-policy.md`.
- [ ] **Check dashboards** — glance at the deploy metrics page
      (`docs/dashboards/deploy-metrics.md`) and, when reachable, container
      health: `docker compose --env-file /srv/spindle/host.env ps` on the origin
      (access via Cloudflare Access/Tailscale per `docs/runbooks/hosting.md`).
- [ ] **Verify runbook access** — confirm you can open
      `docs/runbooks/hosting.md`, `docs/runbooks/database-monitoring.md`,
      `docs/runbooks/rollback.md`, and `docs/runbooks/database-restore-test.md`
      from your machine. If any are unreachable, fix access before anything else.
- [ ] **Test the alert channel** — send a test message to the alert channel
      (the same webhook target used by `check.mjs --webhook` /
      `MONITOR_WEBHOOK_URL`; see `alerting.md`) and confirm it renders and that
      you can react/ack in it. A channel you cannot ack in is a SEV3.
- [ ] **Check the monitor itself** — run
      `node scripts/db/monitoring/check.mjs --dry-run --json` locally to confirm
      the checker works; note that `--dry-run` uses demo values.
- [ ] **Review pending changes** — any scheduled deploys, migrations
      (`docs/runbooks/database-migrations.md`), or secrets rotations
      (`docs/runbooks/secrets-rotation.md`) landing during your shift.
- [ ] **Announce presence** — post "on-call" in the team channel with your shift
      end time.

## Handoff template

Post in the team channel (or incident channel for active incidents) at shift
change. Fill every field; write "none" rather than omitting.

```markdown
## On-call handoff — <date> → <date>

**Outgoing:** <name/handle> **Incoming:** <name/handle>
**Shift window:** Mon 00:00 UTC → Mon 00:00 UTC

### Active incidents

| SEV | ID/alert | Status | Next action | Owner |
| --- | -------- | ------ | ----------- | ----- |
|     |          |        |             |       |

### Open alerts (unacked or recurring)

- <alert id> — <status>, last seen <time>, runbook link

### Watch items (not incidents yet)

- <e.g. backup staleness trending up, deploy queued, capacity note>

### Pending ops this shift

- <deploys, migrations, secret rotations, drills>

### Notes for incoming

- <context, access quirks, "page me if X" requests>
```

Rules:

- An active SEV1/SEV2 must have an explicit "transferred to <incoming>" line —
  the outgoing on-call stays attached until the incoming confirms.
- Unacked alerts older than their SLA are escalated _before_ handoff, not
  carried silently.
- The handoff message is the ack trail; keep it in the channel, don't DM it.

## Post-incident note (SEV1/SEV2 only)

Within 5 business days of resolution, the L1 (or L3 for SEV1) adds a short note
to `docs/incidents/` when that directory exists, covering: timeline, root
cause, what the runbooks got right/wrong, and one concrete follow-up. Link it
from the alert channel thread.
