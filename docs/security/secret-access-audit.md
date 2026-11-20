# Secret access audit log

The secret-store contract (`docs/decisions/0002-secrets-management.md`,
`docs/runbooks/secrets-rotation.md`) says who may read which secret. This log
is the application-side record of those reads: one JSON object per line
(JSONL) recording **who** accessed **which named secret**, **when**, **from
where**, and **whether the attempt was allowed**.

It complements — does not replace — the secret store's own audit log. The
store records fetches by machine identity; this log records what the
application did with the value afterwards (a `read` for a signing operation,
a `verify` during rotation overlap, a denied attempt).

## What gets logged

Every event is a `SecretAccessEvent` from `src/lib/secrets/audit.ts`:

| Field         | Meaning                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | Unique event id (`saa_…`)                                                                                                                                           |
| `timestamp`   | ISO-8601 time of the access                                                                                                                                         |
| `actor`       | `{ id, kind, name }` — user, service, system, deploy-identity, or unknown                                                                                           |
| `secretName`  | The environment-variable name, e.g. `SESSION_SECRET`. **Never the value** — names must match `[A-Z][A-Z0-9_]{0,127}`, so a value cannot be smuggled into this field |
| `action`      | `read`, `verify`, `list`, `check`, `rotate`, or `inject`                                                                                                            |
| `service`     | Catalog service resolved from `secretCatalog` (`session`, `edge`, `b2`, …)                                                                                          |
| `source`      | Script or module that performed the access                                                                                                                          |
| `environment` | `prod`, `staging`, …                                                                                                                                                |
| `allowed`     | `false` marks a denied or failed attempt                                                                                                                            |
| `reason`      | Why a denied/failed attempt happened                                                                                                                                |
| `requestId`   | Correlation id for tracing                                                                                                                                          |

### The never-a-value rule

There is no field for a secret value and none may be added. Free-text fields
(`reason`, `source`, `requestId`, actor labels) still pass through the shared
log sanitiser (`sanitizeForLog` in `src/lib/logger.ts`), which redacts bearer
tokens, JWTs, and credentials embedded in URLs — but callers must not put
values into them in the first place. If you are unsure whether a string is a
secret, do not log it.

## Where the log lives

Default path: `<cwd>/.spindle/secret-access-audit.jsonl`, created on first
write. Override per call with `options.path` (library) or `--log <path>`
(report script). In containers, mount a volume or ship the file to your log
pipeline; treat it as operational data, not source.

## Recording access

`src/lib/secrets/audit.ts` is server-side only. Two integration points:

```ts
import { recordSecretAccess, withSecretAccessAudit } from "@/lib/secrets/audit"

// Point access — you already hold the value.
recordSecretAccess({
  actor: { kind: "system", name: "secrets-check" },
  secretName: "SESSION_SECRET",
  action: "check",
  source: "scripts/secrets/check.ts",
  environment: "prod",
})

// Wrapped access — logs allowed on success, denied + reason on throw,
// then rethrows the original error.
const key = await withSecretAccessAudit("RESEND_API_KEY", () => readResendKey(), {
  actor: { kind: "service", name: "app-runtime" },
  source: "src/lib/email.ts",
})
```

`recordSecretAccess(input, { dryRun: true })` builds and returns the event
without touching disk — use it for drills and tests. Write failures throw
`SecretAuditError`; catch it only where crashing the caller is worse than a
gap in the audit trail, and log the failure through the normal logger.

## Reporting

`scripts/secrets/audit-access.ts` summarises the log. No build step needed —
it runs under `tsx` like the other `scripts/secrets/*` tools:

```bash
# Human-readable summary: top secrets, top actors, per-day counts, anomalies
npx tsx scripts/secrets/audit-access.ts

# Machine-readable
npx tsx scripts/secrets/audit-access.ts --json

# Different file or window
npx tsx scripts/secrets/audit-access.ts --log /var/log/spindle/secrets.jsonl --since 2025-01-01

# Exercise the pipeline locally without writing
npx tsx scripts/secrets/audit-access.ts --emit SESSION_SECRET --dry-run
npx tsx scripts/secrets/audit-access.ts --emit SESSION_SECRET   # writes a real event

# CI/cron gate: exit 1 when anomalies exist
npx tsx scripts/secrets/audit-access.ts --fail-on-anomaly
```

Anomalies flagged by `summarizeSecretAccess`:

- **denied-access** — `allowed: false` events (failed fetches, rejected tokens)
- **unknown-secret** — names not in `secretCatalog`; either a typo or an
  undeclared variable worth reviewing
- **high-volume** — more than 50 accesses to one secret in a UTC day
  (override with the `highVolumePerDay` option)

## Retention

- Keep at least **90 days** locally — the longest rotation max-age in
  `docs/runbooks/secrets-rotation.md` — so every rotation window is covered.
- Ship the file to your central log store (or export it quarterly alongside
  the store's audit export, per the runbook's quarterly review). Once shipped,
  local copies may be rotated aggressively; the shipped copy is the record.
- The file contains names and actors only, but treat it as sensitive
  operational data: restrict read access to the same people who can read the
  secret store's audit log.

Rotation suggestion for the local file:

```bash
# Keep 90 days, compress the rest
find .spindle -name 'secret-access-audit.jsonl*' -mtime +90 -exec gzip {} \;
```

## Alerting hooks

The report script is the alerting surface; wire it into cron, CI, or your log
pipeline:

- **Denied attempts** — run hourly with `--fail-on-anomaly` (or parse `--json`
  and alert on `anomalies[].type === "denied-access"`). A denied access is the
  earliest signal of a leaked or mis-scoped credential.
- **Unknown secrets** — any `unknown-secret` anomaly means code touched a
  variable outside the contract; check for typosquatted or ad-hoc env vars.
- **High volume** — sustained `high-volume` anomalies on `SESSION_SECRET` or
  `WORKER_SECRET` suggest token-guessing or a runaway retry loop.
- **Correlate with the store** — when the store's audit log shows an identity
  fetching a secret at time T, grep this log for the same window:
  `jq -r 'select(.timestamp >= "2025-01-01T00:00:00Z")' secret-access-audit.jsonl`
  (or `grep '"secretName":"SESSION_SECRET"'` for a quick look).

During a suspected leak, follow the "Leaked secret" section of
`docs/runbooks/secrets-rotation.md`: revoke at the provider first, then use
this log's `actor`/`source`/`timestamp` fields to bound what the application
did with the value before rotation.
