# Runbook — agent runs

This runbook covers operating, debugging, and recovering **recorded agent
runs** — the run objects produced by the agent pipeline (prompt, lifecycle
timestamps, ordered steps, stream events, metrics, tags, retention metadata).
It assumes familiarity with the domain types in
`src/lib/agent-runs/ops/types.ts` and the stream contract documented in
`src/lib/agent-log-stream.ts`.

There are two layers:

- **Live runs** — real executions streamed over SSE/WS
  (`src/lib/use-agent-run-stream.ts`, `/api/agent/runs/{id}/stream`).
- **Recorded runs** — immutable snapshots used by ops tooling. All modules
  under `src/lib/agent-runs/ops/` operate on `AgentRunRecord` snapshots and
  are safe to run offline, in tests, or against exported backups.

## 1. Tooling map

| Concern        | Library module       | UI component                                     |
| -------------- | -------------------- | ------------------------------------------------ |
| Templates      | `ops/templates.ts`   | `AgentRunTemplateGallery`                        |
| Sharing        | `ops/share.ts`       | `AgentRunShareDialog`                            |
| Marketplace    | `ops/marketplace.ts` | `AgentRunMarketplace`                            |
| Analytics      | `ops/analytics.ts`   | `AgentRunAnalyticsPanel`                         |
| Debugging      | `ops/debug.ts`       | `AgentRunDebugPanel`                             |
| Profiling      | `ops/profile.ts`     | `AgentRunProfilePanel`                           |
| Optimization   | `ops/optimize.ts`    | `AgentRunOptimizationPanel`                      |
| Security       | `ops/security.ts`    | `AgentRunSecurityPanel`                          |
| Compliance     | `ops/compliance.ts`  | `AgentRunCompliancePanel`                        |
| Audit trail    | `ops/audit.ts`       | `AgentRunAuditPanel`                             |
| Backup/restore | `ops/backup.ts`      | `AgentRunBackupPanel`                            |
| Scheduling     | `ops/schedule.ts`    | `AgentRunSchedulePanel` + `AgentRunScheduleForm` |
| Core adapter   | `ops/adapter.ts`     | —                                                |

All paths are relative to `src/lib/agent-runs/` (lib) and
`src/components/agent-runs/ops/` (UI). Import the barrel
`@/lib/agent-runs/ops` for everything at once.

> **Note on styling:** the ops panels use the shared `app-*`/`fm-btn` class
> vocabulary plus ops-specific hooks (`app-tpl-*`, `app-mkt-*`,
> `app-debug-*`, `app-flame-*`, `app-analytics-*`, `app-opt-*`,
> `app-compliance-*`, `app-share-*`, `app-sched-*`). The ops-specific classes are semantic
> hooks pending a dedicated CSS pass — panels are fully functional but may
> render unstyled until then.

### 1.1 Status mapping (core ↔ ops)

The `core/` subsystem and `ops/` use different status enums. `ops/adapter.ts`
(`coreRunToOpsRecord`) is the canonical bridge:

| core `AgentRunStatus` | ops `AgentRunOpsStatus` |
| --------------------- | ----------------------- |
| `pending`, `queued`   | `queued`                |
| `running`             | `running`               |
| `completed`           | `succeeded`             |
| `failed`              | `failed`                |
| `cancelled`           | `cancelled`             |

Ops-only statuses `waiting_approval` and `rejected` have no core equivalent;
a core run awaiting approval still reports `running`. Never compare raw
status strings across the two enums — always go through the adapter.

## 2. Monitoring runs

### 2.1 Live health

- Active statuses are `queued`, `running`, `waiting_approval`
  (`isActiveOpsRun`). A run stuck in `running` with no new events is the
  primary "stuck run" signal — check the stream panel first.
- `approval_required` events mean the run is blocked on a human decision;
  they are not failures. Resolve or reject via the approvals endpoint.

### 2.2 Post-run analytics

`aggregateRunAnalytics(runs)` produces counts by status/model, success rate
(terminal runs only), duration percentiles (p50/p90/p99, nearest-rank), and
token/cost totals. Use it for:

- **Success-rate regression** — compare `successRate` week over week; a drop
  below ~0.9 on `succeeded/(succeeded+failed+cancelled+rejected)` warrants
  investigating `failed` runs' last events.
- **Latency regressions** — watch `durationMs.p90`/`p99`; correlate spikes
  with `byModel` to isolate a slow model.
- **Cost drift** — `totals.costUsd` and `totals.totalTokens` grow with run
  volume; sudden jumps usually mean context bloat (see §4.3) or retry storms
  (see §4.2).

Render the panel with `<AgentRunAnalyticsPanel runs={runs} />`.

### 2.3 Audit trail integrity

The audit log (`ops/audit.ts`) is append-only with a SHA-256 hash chain
(WebCrypto; FNV-1a fallback). Periodically verify:

```ts
import { loadAuditLog, verifyAuditChain, saveAuditLog } from "@/lib/agent-runs/ops/audit"

const log = loadAuditLog()
const result = await verifyAuditChain(log)
// result.ok === false → result.brokenAt is the first tampered seq
```

`verifyAuditChain` reports `prevHash mismatch` (an entry was inserted,
deleted, or reordered), `hash mismatch` (an entry's fields were edited), or
`seq gap` (a middle entry was removed). The `<AgentRunAuditPanel />`
verifies on mount and on demand.

**Integrity caveat:** the chain detects corruption and naive tampering, not
a determined attacker. Truncating entries off the _tail_ leaves a valid,
shorter chain — the remaining last entry still verifies. Someone with write
access can also recompute hashes for a forged suffix. Treat `ok` as "no
detected inconsistency" and keep periodic JSON backups (§6) as the real
tamper anchor; compare `entriesChecked`/latest `seq` against expectations.

### 2.4 Scheduled runs

`ops/schedule.ts` manages timers that instantiate queued runs from
templates (or a bare prompt). Kinds: `once` (ISO `at`), `cron` (five-field,
local time via `nextCronRuns`), and `interval` (`intervalMs`, min 1s).
Schedules persist to `spindle.agent-runs.schedules.v1`; statuses are
`active` → `paused` / `completed` / `cancelled`.

- `<AgentRunSchedulePanel />` lists schedules with next/last fire times and
  exposes run-now, pause/resume, cancel, and delete; `<AgentRunScheduleForm />`
  creates them (validates through `validateScheduleInput`).
- `dueAgentRunSchedules(schedules, now)` selects active schedules whose
  `nextRunAt` has passed; `fireDueAgentRunSchedules` fires them all. There is
  no built-in ticker — drive it from a cron/interval of your choice, or use
  the panel's "Fire due" button.
- `fireAgentRunSchedule` produces a normal `queued` `AgentRunRecord` via
  `instantiateRunFromTemplate`; one-shots and `maxRuns`-exhausted schedules
  transition to `completed`. Paused schedules can still be fired manually —
  "run now" is an operator action, not a scheduled fire.

## 3. Debugging a recorded run

### 3.1 Step-through

`<AgentRunDebugPanel run={run} />` drives a cursor through `run.events`:

- **Controls**: first / prev / play-pause (400 ms tick) / next / last /
  "To breakpoint".
- **Breakpoints**: toggle event kinds (`log`, `chunk`, `approval_required`,
  `status`, `done`, `error`). Playback auto-pauses on a matching entry.
- **Inspector**: shows kind, level, source, timestamp, payload size, and
  pretty-printed `data`.
- **Filter**: `searchRunEvents(run, query)` narrows the list by
  message/source/kind/id.

Programmatic equivalents live in `ops/debug.ts`:
`createAgentRunDebugState`, `stepDebugCursor`, `advanceDebugPlayback`,
`jumpToDebugBreakpoint`, `describeDebugEvent`.

### 3.2 Reading a failed run

1. Open the run; check `status` and `finishedAt`.
2. In the debug panel, jump to the last `error` event — its `data` usually
   carries the failure reason.
3. Check for `approval_required` events that were never resolved.
4. Cross-reference steps: a `failed` step followed by a same-title retry is
   retry waste (`ops/optimize.ts` flags it).

## 4. Performance work

### 4.1 Profiling

`buildRunProfile(run)` converts steps into offsets relative to run start;
`flameBarRows` yields `{leftPct, widthPct}` for the flame-bar UI;
`detectBottlenecks` flags steps ≥25% of total and ≥500 ms (tunable via
`BottleneckOptions`). `<AgentRunProfilePanel />` renders both.

### 4.2 Optimization report

`analyzeRunOptimization(run)` detects:

- **Redundant steps** — ≥2 consecutive steps with identical kind+title.
- **Retry waste** — failed/cancelled attempts later re-run (wasted ms summed).
- **Context bloat** — >64 KB of step/event payloads or >500 events; oversized
  single payloads (>16 KB) are listed individually.
- **Serial tool chains** — ≥4 consecutive `tool_call` steps with no reasoning
  step between them (parallelization hint).

Each `OptimizationFinding` carries `wastedMs`, severity, and a `hint`.
`estimatedWasteMs` is an upper bound (findings can overlap).

### 4.3 Common fixes

- Retries: add backoff+jitter; make retried calls idempotent.
- Bloat: truncate/summarize large tool outputs before they enter context;
  store raw payloads out-of-band and reference by id.
- Serial chains: run independent tool calls in parallel; interleave a plan
  step to confirm ordering.

## 5. Security & compliance

### 5.1 Secret/PII scanning

`scanRunForSecrets(run)` walks step titles/details/payloads and event
messages/sources/data against detectors for private keys, API keys (sk-,
ghp_, AKIA, AIza, xox*, glpat, github_pat_), JWTs, bearer tokens, secret-looking
assignments (`api_key=…`, `password: …`), and emails. Findings include
**redacted samples only**.

`redactRun(run)` returns a sanitized deep copy — use it before any external
share or backup leaves the machine. `<AgentRunSecurityPanel />` renders the
report and a "Copy redacted run" action.

**Rule**: if a run trips the `api_key`/`private_key` detectors, treat the
credential as compromised — rotate it; recorded secrets cannot be un-seen.

### 5.2 Compliance

`evaluateRunCompliance(run, policy)` checks required fields, mandatory tags,
retention windows, model provenance, summaries on terminal runs, forbidden
statuses, and empty-step warnings. Presets: `policy.standard`,
`policy.strict`, `policy.retention` (`COMPLIANCE_POLICIES`).

For audit exports use `policy.retention` (retention mandatory, `rejected`
runs forbidden). A run failing `field:*` checks usually means an import
truncated the record — re-export from source rather than patching by hand.

## 6. Backup & restore

### 6.1 Export

```ts
import { buildRunBackup, serializeRunBackup, downloadRunBackup } from "@/lib/agent-runs/ops/backup"

const doc = buildRunBackup(runs) // { manifest, runs }
downloadRunBackup(runs) // browser file download (JSON)
```

The manifest records `version`, `runCount`, `runIds`, and `createdAt`.
`<AgentRunBackupPanel runs={runs} onImport={fn} />` wires download, file
import, and auto-backup in one UI.

### 6.2 Restore

`parseRunBackup(text)` accepts a full backup document, a bare run object, or
an array of runs; it returns `{ ok, runs, manifest, error }` instead of
throwing. Validate `ok` before merging `runs` into the store. Imported runs
keep their ids — dedupe on `run.id` if the target store may already contain
them.

### 6.3 Auto-backup

`saveRunsAutoBackup(runs)` snapshots up to `AUTO_BACKUP_MAX_RUNS` (100)
newest runs to `localStorage["spindle.agent-runs.autobackup.v1"]`.
`loadRunsAutoBackup()` returns `{ savedAt, runs } | null`. This is a
convenience snapshot, **not** disaster recovery — it lives in one browser
profile and is wiped with site data. For real backups use §6.1 exports off
the machine.

## 7. Templates & marketplace

- `instantiateRunFromTemplate(template, opts)` creates a `queued`
  `AgentRunRecord` seeded with the template's model/tags/retention.
- The marketplace (`ops/marketplace.ts`) is a **local** catalog: the remote
  side is the static `MARKETPLACE_LISTINGS` mock. `installMarketplaceListing`
  persists to `localStorage["spindle.agent-runs.marketplace.v1"]` and
  registers the template; uninstall reverses both. Treat installed templates
  as untrusted input — they only set prompt/config, but review before use.

## 8. Incident playbooks

### 8.1 Suspected tampered audit log

1. `verifyAuditChain(loadAuditLog())` — note `brokenAt`.
2. Entries after `brokenAt` are untrustworthy; treat everything before it as
   the last known-good state.
3. Check who/what had write access to the audit store (localStorage on the
   operator's machine, or the DB column if persisted server-side).
4. Do **not** "repair" the chain by recomputing hashes — that destroys the
   evidence. Export the log as-is for forensics, then start a fresh log.

### 8.2 Run records look corrupted after import

1. `parseRunBackup` already rejected malformed entries — if it returned
   `ok:false`, the file is bad; re-export from the source.
2. If entries parsed but content looks wrong, run `scanRunForSecrets` and
   `evaluateRunCompliance` before trusting the data.
3. Restore from the previous auto-backup (`loadRunsAutoBackup`) or the last
   known-good JSON export.

### 8.3 Secrets leaked into a shared run

1. Do not delete the evidence — keep the raw run for the incident record.
2. Rotate every credential matching the detectors (§5.1).
3. Re-share only `redactRun(run)` output; verify with
   `scanRunForSecrets(redactRun(run)).totalMatches === 0`.
4. Add a pre-share scan step to whatever pipeline produced the share link.

### 8.4 Run stuck in `running`/`waiting_approval`

1. Confirm via the live stream whether events are still arriving.
2. `waiting_approval` → resolve/reject the pending approval; the run resumes
   or terminates.
3. `running` with a silent stream → the worker likely died; cancel via
   `POST /api/agent/runs/{id}/cancel` and mark the record `failed` with a
   `run.finished` audit entry noting the manual intervention.

### 8.5 Rollback

Ops tooling is client-side and stateless apart from localStorage keys
(`spindle.agent-runs.*`). Rolling back a bad ops change means:

1. Revert the offending commit/module — records themselves are unaffected
   (they are data, not code).
2. Clear stale localStorage keys if a schema version bumped:
   `marketplace.v1`, `audit.v1`, `autobackup.v1`.
3. Re-import the last JSON backup (§6.1) if local snapshots were corrupted.

There are no database migrations in this subsystem; the backup document
`version` field is the only compatibility gate (`RUN_BACKUP_VERSION = 1`).

## 9. Quick reference — storage keys

| Key                                 | Contents                           |
| ----------------------------------- | ---------------------------------- |
| `spindle.agent-runs.marketplace.v1` | Installed marketplace template ids |
| `spindle.agent-runs.audit.v1`       | Append-only hash-chained audit log |
| `spindle.agent-runs.autobackup.v1`  | Latest auto-backup snapshot (≤100) |

All keys are written through `ops/storage.ts`, which is SSR-safe and
swallows quota/permission errors — a `false` return means "not persisted",
not "crashed".

## 10. Testing

```bash
npx vitest run src/lib/agent-runs src/components/agent-runs
```

Covers all ops modules and panels. `ops/fixtures.ts` (`buildOpsRun`,
`buildOpsStep`, `buildOpsEvent`) provides deterministic records for new
tests — prefer it over hand-rolled objects.<|end_message|><|message_model|>edit<|content_invoke_tool_json|>{
