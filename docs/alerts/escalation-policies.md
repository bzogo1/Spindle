# Alert escalation policies

This directory defines how firing alerts become paged incidents, who gets
notified at each level, and how long each level has to acknowledge before the
incident escalates.

| File                                                               | Purpose                                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| [`policies.json`](policies.json)                                   | Escalation chains: L1 on-call → L2 → L3 with per-level ack timeouts/SLAs. |
| [`routing.json`](routing.json)                                     | Maps alert sources (db-monitor, deploy, lighthouse, secrets) to policies. |
| [`scripts/alerts/escalate.mjs`](../../scripts/alerts/escalate.mjs) | Dependency-free engine that runs the state machine.                       |

Everything is plain JSON/JS with no external dependencies — the engine runs on
any Node ≥ 18 (`fetch` is only used for the optional webhook delivery).

## Model

An **incident** is keyed `source:id` (e.g. `db-monitor:disk-usage`,
`deploy:production`). Its lifecycle:

```
trigger ──> open ──> L1 notified ──> (unacked after L1.ackTimeout) ──> L2 notified
   │         │            │                                        │
   │         │            └── ack at any time ──> acked (escalation stops)
   │         │                                                     │
   │         └── resolved event/flag ──> resolved (terminal)        └──> L3 ...
   │                                                                  │
   └── source re-fires while resolved ──> retrigger (level resets to L1)
```

- **`ackTimeoutMinutes`** (per chain level, in `policies.json`) — how long the
  engine waits for an ack at that level before notifying the next one. This is
  the value that drives the state machine.
- **`ackSlaMinutes`** — the promised ack time communicated to responders.
  Should be ≤ `ackTimeoutMinutes`; informational only.
- **`repeatIntervalMinutes`** — on the _final_ level only: if set, the engine
  re-notifies that level every interval while the incident stays unacked.
  If unset, the incident is marked `exhausted` after the final level's ack
  window and goes silent until ack/resolve.
- Acknowledgement does **not** resolve the incident — it stops escalation.
  Only a resolve event/flag closes it.

The engine persists all state (open incidents, level, notification history) in
a single JSON file (`ALERT_STATE_PATH`, `--state`, default
`$TMPDIR/spindle-alert-escalation-state.json`), so it is safe to run on a
cron/tick cadence: each run ingests new events, fires whatever escalations are
due, and exits.

## Routing

`routing.json` has one entry per `source`:

- `defaultPolicy` — used when no `rules` entry matches.
- `rules` — maps the source's own alert/rule id to a policy name. Use `"*"`
  for a per-source wildcard. A value may be a string (policy name) or an
  object `{"policy": "...", "bySeverity": {"critical": "...", "warning": "..."}}`
  to pick a policy by firing severity.
- `events` — deploy-only: maps `notify.ts` event names to a policy,
  `"__resolve__"`, or `"__ignore__"`.

Unmatched critical/warning severities fall back to `generic-critical` /
`generic-warning` via `defaults.policyBySeverity`.

### Source contracts

**`db-monitor`** — feed it the JSON report from
`node scripts/db/monitoring/check.mjs --json` (optionally via `--webhook` to a
small receiver, or save to a file and pass `--file`). Each entry in
`report.alerts` with status `warning`/`critical`/`error` is a firing alert;
`ok` resolves the incident; `skipped` is ignored. Rule ids come from
`rules.json` and map through `routing.sources.db-monitor.rules`.

**`deploy`** — feed it the `DeployNotification` payload produced by
`scripts/deploy/notify.ts` (its `webhook` channel can POST this exact JSON to
the escalation receiver). `failed`/`rolled-back` open an incident per
environment; `succeeded` resolves it; `started` is ignored.

**`lighthouse`** — emit normalized alerts, e.g. from CI after
`scripts/lighthouse/summarize.mjs --check` exits 1:

```json
{
  "source": "lighthouse",
  "alerts": [
    {
      "id": "http://localhost:3000/:largest-contentful-paint",
      "severity": "critical",
      "status": "firing",
      "message": "LCP 2400ms exceeds budget 2000ms"
    }
  ]
}
```

**`secrets`** — same normalized shape. Suggested ids:
`secret-store-validation` (from `scripts/secrets/check.ts` failure),
`repo-secret-scan` (from `scripts/secrets/scan.mjs` findings),
`rotation-overdue`, `rotation-drill-failed`.

### Normalized event shape

Any source can also emit the generic form directly:

```json
{
  "source": "<source-name>",
  "id": "<stable-alert-id>",
  "severity": "critical | warning | info",
  "status": "firing | resolved",
  "title": "human title",
  "message": "details",
  "runbook": "docs/runbooks/....md#anchor",
  "at": "2025-01-01T00:00:00Z"
}
```

`info` severity is logged but never creates an incident.

Control events (single object or inside a batch array):

```json
{ "type": "ack",     "key": "db-monitor:disk-usage", "actor": "oncall-bogdan" }
{ "type": "resolve", "key": "db-monitor:disk-usage", "actor": "ci" }
```

`key` may also be given as `source` + `id`.

## Usage

```bash
# Ingest events from stdin / file, fire due escalations, persist state
node scripts/db/monitoring/check.mjs --json \
  | node scripts/alerts/escalate.mjs --stdin

node scripts/alerts/escalate.mjs --file report.json

# Cron tick — no new events, just evaluate due escalations
*/1 * * * * node scripts/alerts/escalate.mjs --tick

# Acknowledge / resolve from the CLI or a tiny ack endpoint
node scripts/alerts/escalate.mjs --tick --ack db-monitor:disk-usage --actor bogdan
node scripts/alerts/escalate.mjs --tick --resolve deploy:production

# Offline demo of the whole state machine
node scripts/alerts/escalate.mjs --demo

# Preview without touching state or webhooks
node scripts/alerts/escalate.mjs --file report.json --dry-run
```

Exit codes: `0` clean (or dry-run/demo), `1` at least one incident is still
open/acked/exhausted afterwards, `2` usage error.

Useful flags: `--now <iso>` (deterministic time for testing), `--json`
(machine report), `--state <path>` / `ALERT_STATE_PATH`, `--policies` /
`--routing` (alternate config), `--webhook <url>` /
`ALERT_NOTIFY_WEBHOOK_URL` (+ `ALERT_NOTIFY_WEBHOOK_TOKEN` bearer).

## Delivery / integration

The engine does not know about Slack, PagerDuty, or email — it computes
**actions** (`trigger`, `notify`, `escalate`, `repeat`, `ack`, `resolve`,
`exhausted`) and, unless `--dry-run`, POSTs the batch as one JSON payload to
the configured webhook:

```json
{ "type": "alert-escalation", "generatedAt": "...", "actions": [ ... ] }
```

Point `ALERT_NOTIFY_WEBHOOK_URL` at any receiver that understands this shape
(a small HTTP function, an alertmanager webhook adapter, ntfy, etc.). The
`notify` hints inside each action (`webhook`, `email`, `page`) tell the
receiver which channels the policy intends for that level.

### Relationship to `scripts/deploy/notify.ts`

`notify.ts` is a _producer_, not a receiver: it sends deploy events outward.
Two integration patterns, neither requiring changes to `notify.ts`:

1. **Deploy events → escalation.** Set `DEPLOY_NOTIFY_WEBHOOK_URL` to a tiny
   receiver that appends the payload to a file/queue, then feed it to
   `escalate.mjs --file` (or pipe to `--stdin`). `failed`/`rolled-back`
   become `deploy-critical` incidents; `succeeded` auto-resolves.
2. **Escalation → notifications.** Point `ALERT_NOTIFY_WEBHOOK_URL` at the
   same generic webhook endpoint used for deploy notifications, or at a
   dedicated receiver. The engine's payload is self-describing; a ~30-line
   shim can forward `actions[]` entries to Slack/PagerDuty/Resend as needed.
   This mirrors the pattern documented in
   `docs/runbooks/database-monitoring.md` (monitor report → webhook).

### Suggested cron wiring

```cron
# ingest monitor report every 5 min (matches check.mjs cadence)
*/5 * * * * cd /srv/spindle && node scripts/db/monitoring/check.mjs --json \
  | node scripts/alerts/escalate.mjs --stdin

# escalation tick every minute so timeouts fire promptly
* * * * * cd /srv/spindle && node scripts/alerts/escalate.mjs --tick
```

## Tuning

- Per-rule policy overrides live in `routing.json → sources.db-monitor.rules`;
  those ids map straight to a policy, so `rules.json` severity only matters for
  ids without an explicit rule (they fall back to `defaultPolicy`).
- Chain depth/timeouts are per-policy in `policies.json`. Warning policies use
  longer windows and no paging; `secrets-critical` is deliberately fast
  (5-minute L1 ack) because it may be an active exposure.
- `ackSlaMinutes` is what you promise responders; keep it ≤
  `ackTimeoutMinutes` so the SLA never exceeds the escalation deadline.
