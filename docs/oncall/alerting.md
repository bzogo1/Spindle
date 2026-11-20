# Alerting channel wiring

How automated signals reach the on-call human without a paging service. Two
producers exist today; both emit JSON and can POST to a webhook.

## Producers

### Database / infra monitoring — `scripts/db/monitoring/check.mjs`

Evaluates `scripts/db/monitoring/rules.json` and emits a report with
`summary` counts (`ok`/`warning`/`critical`/`skipped`/`error`) and per-rule
`alerts[]` entries carrying `id`, `severity`, `status`, `message`, and
`runbook` anchor. See `docs/runbooks/database-monitoring.md` for the rule
catalog.

Delivery options:

| Mechanism    | Env / flag                                                                             | Behavior                                                               |
| ------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Webhook POST | `--webhook <url>` or `MONITOR_WEBHOOK_URL` (+ optional `MONITOR_WEBHOOK_TOKEN` bearer) | POSTs the full JSON report, 10 s timeout; skipped in `--dry-run`       |
| Console/CI   | `--json`, `--ci`                                                                       | `[monitor]`-prefixed lines + JSON summary for log scraping             |
| Exit code    | —                                                                                      | `1` when any rule is warning/critical/error — usable as a CI/cron gate |

### Deploy notifications — `scripts/deploy/notify.ts`

Sends deploy lifecycle events (`started`, `succeeded`, `failed`,
`rolled-back`) — see `docs/deploy/notifications.md` for the full contract.
Channels: `webhook` (`DEPLOY_NOTIFY_WEBHOOK_URL`, optional
`DEPLOY_NOTIFY_WEBHOOK_TOKEN`), `email` (Resend), `console` fallback.
`--dry-run` resolves and prints without sending.

## Notification path

There is no pager, so the path is: **producer → webhook receiver → alert
channel → on-call human → ack**.

```
check.mjs --webhook ─┐
                     ├─→ webhook receiver ─→ alert channel (ntfy topic /
notify.ts webhook ──┘     (translate JSON)   Slack-compatible webhook /
                                           email list) ─→ L1 on-call acks
```

1. **Pick a receiver.** Any HTTP endpoint that accepts JSON works. Practical
   self-hosted-friendly options:
   - **ntfy** — `MONITOR_WEBHOOK_URL=https://ntfy.example.com/spindle-alerts`;
     the JSON body becomes the message. Subscribe the on-call's phone.
   - **Slack/Discord-compatible incoming webhook** — point both producers at
     it; raw JSON is ugly but readable, or put a 10-line translator in front.
   - **A tiny receiver** — e.g. a container on the `spindle` network that POSTs
     to chat + email; keep it on the same severity→SEV mapping as
     `escalation-policy.md`.
2. **Wire the producers** (env on the host/CI, never committed):

   ```bash
   # cron/systemd timer on the origin or CI job
   MONITOR_WEBHOOK_URL="https://ntfy.example.com/spindle-alerts" \
   MONITOR_WEBHOOK_TOKEN="<token-if-required>" \
     node scripts/db/monitoring/check.mjs --webhook

   DEPLOY_NOTIFY_CHANNELS=webhook \
   DEPLOY_NOTIFY_WEBHOOK_URL="https://ntfy.example.com/spindle-deploys" \
     npx tsx scripts/deploy/notify.ts --event failed --error "..."
   ```

   Suggested split: DB/infra alerts → `spindle-alerts`; deploy events →
   `spindle-deploys` (deploy failures are SEV2+ — route them into the same
   ack flow, see below).

3. **Mention the on-call.** Receivers that support mentions should prefix the
   message with the current L1 from the generated roster
   (`scripts/oncall/.output/*-oncall-*.md`). The rotation script emits the
   roster; a weekly cron can re-post "this week's on-call: @x" to the channel,
   or the receiver can read the latest `.md` file. Keep it simple: even a
   manual weekly "on-call: @x until Mon" message satisfies the ack trail.
4. **Ack = react/reply.** Per `escalation-policy.md`, acknowledgement is an
   explicit reaction or reply naming the alert. Unacked alerts past their SLA
   escalate to L2, then L3 — automation may re-post with the next level
   mentioned.

## Offline / demo verification

```bash
# Producer side, no network needed:
node scripts/db/monitoring/check.mjs --dry-run --json        # demo rule values
node scripts/db/monitoring/check.mjs --dry-run --webhook https://example.invalid/hook
#   → "dry-run: would POST report to ..." on stderr, exit 0

npx tsx scripts/deploy/notify.ts --event failed --error "demo" --dry-run
#   → prints resolved channels + payload, sends nothing

# Rotation side:
node scripts/oncall/rotation.mjs --demo --weeks 4
```

A full end-to-end drill: run `check.mjs` (real mode) against staging with
`MONITOR_WEBHOOK_URL` pointed at a throwaway ntfy topic, confirm the message
lands, have the on-call ack it, then delete the topic. Repeat quarterly and
record it in the handoff notes.
