# Deploy notifications

`scripts/deploy/notify.ts` sends structured deploy events (`started`,
`succeeded`, `failed`, `rolled-back`) to one or more notification channels.
It is a plain tsx script with no new dependencies — safe to call from any CI
step (GitHub Actions, Vercel build commands, a container entrypoint, etc.).

```bash
npx tsx scripts/deploy/notify.ts --event succeeded
npx tsx scripts/deploy/notify.ts --event failed --error "build exited 1" --dry-run
```

## CLI

| Flag                   | Purpose                                                               |
| ---------------------- | --------------------------------------------------------------------- |
| `--event <name>`       | **Required.** One of `started`, `succeeded`, `failed`, `rolled-back`. |
| `--environment <name>` | Deployment environment; overrides `DEPLOY_ENVIRONMENT`.               |
| `--revision <sha>`     | Commit SHA; overrides `DEPLOY_REVISION`.                              |
| `--url <url>`          | Deployment URL; overrides `DEPLOY_URL`.                               |
| `--error <message>`    | Failure detail for `failed` / `rolled-back` events.                   |
| `--actor <name>`       | Who/what triggered the deploy; overrides `DEPLOY_ACTOR`.              |
| `--channels <list>`    | Comma-separated channel override (see below).                         |
| `--dry-run`            | Resolve channels and print the payload without sending.               |

**Exit codes:** `0` — delivered (or dry-run); `1` — at least one channel
failed; `2` — usage error. A failed channel does not stop the others.

## Channels

Channels are selected by `DEPLOY_NOTIFY_CHANNELS` (comma-separated subset of
`webhook`, `email`, `console`; unrecognized names are ignored). When unset —
or when every name is unrecognized — the script auto-selects:

- `webhook` if `DEPLOY_NOTIFY_WEBHOOK_URL` is set,
- `email` if `RESEND_API_KEY` is set,
- `console` only when nothing else is configured (guaranteed fallback so the
  step never goes silent).

`console` always prints a one-line summary plus the full JSON payload to
stdout — useful in CI logs even alongside other channels.

### webhook

Generic HTTP `POST` of the JSON payload with `Content-Type: application/json`
and a 10s timeout. Works with Slack/Discord-style incoming webhooks, Zapier,
ntfy, or any endpoint that accepts a JSON body.

| Variable                      | Purpose                                            |
| ----------------------------- | -------------------------------------------------- |
| `DEPLOY_NOTIFY_WEBHOOK_URL`   | Target URL. Required for the `webhook` channel.    |
| `DEPLOY_NOTIFY_WEBHOOK_TOKEN` | Optional; sent as `Authorization: Bearer <token>`. |

### email

Reuses the app's Resend integration (`src/lib/email.ts`) — no SMTP, no new
dependencies. Only the Resend-related variables are read; unrelated app env
validation is bypassed.

| Variable              | Purpose                                                               |
| --------------------- | --------------------------------------------------------------------- |
| `RESEND_API_KEY`      | Resend API key (same one the app uses for contact mail).              |
| `CONTACT_FROM_EMAIL`  | Verified Resend sender address.                                       |
| `DEPLOY_NOTIFY_EMAIL` | Recipient for deploy notifications. Falls back to `CONTACT_TO_EMAIL`. |

If neither `DEPLOY_NOTIFY_EMAIL` nor `CONTACT_TO_EMAIL` is set, the email
channel reports `unconfigured` and is skipped.

## Payload

Every channel receives the same JSON object:

```json
{
  "event": "succeeded",
  "environment": "production",
  "revision": "abc123…",
  "url": "https://app.example.com",
  "actor": "ci-bot",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "ci": {
    "system": "github-actions",
    "runId": "123456",
    "repository": "org/repo",
    "runUrl": "https://github.com/org/repo/actions/runs/123456"
  }
}
```

Unset optional fields (`revision`, `url`, `actor`, `error`, `ci`) are omitted
from the JSON entirely — `JSON.stringify` drops `undefined` values.

`ci` is auto-detected from `GITHUB_ACTIONS`/`GITHUB_*` or `VERCEL`/`VERCEL_*`
variables; omit the keys you don't need when wiring a webhook.

## Context variables (auto-detected, all optional)

| Variable             | Fallback chain                                                       |
| -------------------- | -------------------------------------------------------------------- |
| `DEPLOY_ENVIRONMENT` | → `VERCEL_ENV` → `APP_ENV` → `NODE_ENV` (`production`/`development`) |
| `DEPLOY_REVISION`    | → `VERCEL_GIT_COMMIT_SHA` → `GITHUB_SHA` → `CI_COMMIT_SHA`           |
| `DEPLOY_URL`         | → `VERCEL_URL` (https:// prefixed)                                   |
| `DEPLOY_ACTOR`       | → `GITHUB_ACTOR`                                                     |

CLI flags override all of the above. These variables are intentionally **not**
in `.env.example` — they are CI/deploy-pipeline settings, not app runtime
config. Set them as repository/CI secrets or in the deploy platform's
environment, not in the app's `.env`.

## CI examples

GitHub Actions:

```yaml
- name: Notify deploy started
  if: always()
  run: npx tsx scripts/deploy/notify.ts --event started
  env:
    DEPLOY_NOTIFY_WEBHOOK_URL: ${{ secrets.DEPLOY_NOTIFY_WEBHOOK_URL }}
    DEPLOY_NOTIFY_WEBHOOK_TOKEN: ${{ secrets.DEPLOY_NOTIFY_WEBHOOK_TOKEN }}
```

Vercel (in `vercel.json` build command or a wrapper script): call the script
after `npm run build` with `--event succeeded`, and in the failure path with
`--event failed --error "$?"` semantics of your pipeline.
