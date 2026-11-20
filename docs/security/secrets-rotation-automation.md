# Secrets rotation automation

This document describes the rotation orchestrator under `scripts/secrets/rotation/`.
It sits on top of the existing secret infrastructure — it does not replace any of
it:

- [`scripts/secrets/check.ts`](../../scripts/secrets/check.ts) validates the
  runtime secret contract (`npm run secrets:check`).
- [`scripts/secrets/verify-rotation.ts`](../../scripts/secrets/verify-rotation.ts)
  proves the current and previous values are both accepted during an overlap
  (`npm run secrets:verify-rotation`).
- [`scripts/secrets/rotation-drill.ts`](../../scripts/secrets/rotation-drill.ts)
  rehearses the dual-key mechanisms with ephemeral keys (`npm run secrets:drill`).
- [`scripts/secrets/scan.mjs`](../../scripts/secrets/scan.mjs) is the repository
  hygiene scan (`npm run secrets:scan`).
- The operator procedure for every secret lives in
  [`docs/runbooks/secrets-rotation.md`](../runbooks/secrets-rotation.md); the
  schedule mirrors `src/lib/secrets/catalog.ts`.

The orchestrator's job is bookkeeping and sequencing: it inventories variable
names, tracks when each secret was last rotated, walks the plan steps in order,
and delegates verification to the scripts above.

## Files

| File                                          | Purpose                                                                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/secrets/rotation/rotate.mjs`         | Orchestrator CLI (plain Node, no dependencies).                                                                                                        |
| `scripts/secrets/rotation/rotation-plan.json` | Rotation plan: per-secret variables, max age, strategy, and ordered steps. JSON by default; a `.yaml`/`.yml` plan is accepted when `js-yaml` resolves. |
| `scripts/secrets/rotation/state.json`         | Local rotation state (last-rotated timestamps, run history). **Gitignored** via `scripts/secrets/rotation/.gitignore`; never commit it.                |
| `scripts/secrets/rotation/.gitignore`         | Ignores `state.json` and `*.report.md` inside this directory.                                                                                          |

## Commands

Run from the repository root:

```bash
# Names-only inventory: every variable in .env.example plus plan variables,
# annotated with the secret that owns it. Values are never read.
node scripts/secrets/rotation/rotate.mjs inventory
node scripts/secrets/rotation/rotate.mjs inventory --json

# Rotation age vs maxAgeDays for every planned secret.
node scripts/secrets/rotation/rotate.mjs status
node scripts/secrets/rotation/rotate.mjs status --json

# Walk the rotation steps for one secret, or all of them.
node scripts/secrets/rotation/rotate.mjs run session
node scripts/secrets/rotation/rotate.mjs run all

# Emit a markdown report (stdout, or --report <file>).
node scripts/secrets/rotation/rotate.mjs report --report rotation.report.md
```

### Dry run (default, fully offline)

`run` is a dry run unless `--apply` is passed (an explicit `--dry-run` flag is
also accepted). In dry-run mode the orchestrator prints every step, lists the
verification commands it _would_ run, executes nothing, and never writes
`state.json`. No network access, secret-store access, or environment variables
are required.

### Apply mode

`--apply` executes runnable steps:

- `manual` and `store` steps are always printed as operator instructions — the
  orchestrator cannot click through a provider console, and it never handles
  secret values.
- `command` steps run through the shell (none are defined in the shipped plan;
  use them only for safe, idempotent local checks).
- `verify` steps spawn the existing scripts (`check`, `verify-rotation`) through
  `tsx` with the ambient environment, exactly as `npm run secrets:*` would. The
  allowlist of verifiable scripts is enforced in `rotate.mjs`, so a plan cannot
  point the orchestrator at an arbitrary entrypoint.

`--record` (requires `--apply`) stamps `lastRotated` in `state.json` after a
successful run. Manual and store steps still require operator attestation — the
state entry records that note explicitly. If any step fails, the run stops,
nothing is recorded, and the exit code is 1.

## Rotation plan format

`rotation-plan.json` is the source of truth for scheduling. Each entry:

```jsonc
{
  "id": "session", // unique slug; also the state key
  "label": "Session secret",
  "variables": ["SESSION_SECRET"], // current-value names (names only)
  "previousVariables": ["SESSION_SECRET_PREVIOUS"], // optional overlap names
  "maxAgeDays": 30, // from the runbook schedule
  "strategy": "dual-key", // dual-key | provider-overlap | role-overlap
  "runbook": "docs/runbooks/secrets-rotation.md#session-secret",
  "steps": [
    { "id": "overlap", "type": "store", "title": "..." },
    { "id": "verify", "type": "verify", "script": "verify-rotation", "title": "..." },
  ],
}
```

Step types:

- `manual` — printed instruction for the operator (provider consoles, deploys, smoke tests).
- `store` — printed instruction for the secret store (Infisical paths, `_PREVIOUS` overlap moves).
- `command` — shell command, executed only under `--apply`.
- `verify` — runs `scripts/secrets/<script>.ts` under `tsx`; `script` must be
  `check` or `verify-rotation`. `verify-rotation` accepts
  `"expectPreviousRemoved": true` on the step, which passes
  `--expect-previous-removed` and fails the run if any `*_PREVIOUS` value is
  still set — use it on post-cleanup verification steps.

When the plan and `src/lib/secrets/catalog.ts` disagree on `maxAgeDays`, treat
the catalog as authoritative and fix the plan — the catalog is what the runtime
contract tests enforce.

## State file

`state.json` records, per secret id: `lastRotated`, `lastRun`, `lastMode`, an
operator-attestation note, and a capped `history` (20 entries). It contains only
timestamps and identifiers — never values — but it is still local-only state and
is gitignored. Delete it to reset all rotation ages to `never`.

`status` derives three states: `never` (no recorded rotation), `ok`,
`due-soon` (within 20% of max age), and `due` (at or past max age).

## Recommended workflow

1. **Quarterly / scheduled:** `node scripts/secrets/rotation/rotate.mjs status`
   to see which secrets are `due` or `due-soon`.
2. **Before rotating:** `npm run secrets:drill` for a mechanism rehearsal, then
   `node scripts/secrets/rotation/rotate.mjs run <id> --dry-run` to walk the plan.
3. **Rotate:** follow the runbook section linked from each step. Store and manual
   steps are operator actions.
4. **Verify overlap:** the plan's `verify` steps run `secrets:verify-rotation`
   under `--apply`; equivalently run `npm run secrets:verify-rotation` by hand.
5. **Record:** after the rotation is confirmed complete (previous value removed
   where applicable), run `node scripts/secrets/rotation/rotate.mjs run <id>
--apply --record`, or simply edit `state.json` — it is a local bookkeeping
   file.
6. **Report:** `node scripts/secrets/rotation/rotate.mjs report --report
out.md` for a markdown summary suitable for audit records. Record environment,
   timestamp, operator, and store path — never values.

## Relationship to existing scripts

The orchestrator deliberately does not reimplement rotation logic:

- Contract validation stays in `check.ts`; the plan can invoke it via
  `{ "type": "verify", "script": "check" }`.
- Dual-key overlap proof stays in `verify-rotation.ts`; dual-key secrets in the
  plan end with `verify` steps pointing at it.
- The ephemeral mechanism rehearsal stays in `rotation-drill.ts`; run it before
  staging rotations per the runbook.
- Provider-side work (Backblaze keys, Resend keys, Postgres roles) remains manual
  by design — automating credential creation against providers is out of scope
  and would require credentials the orchestrator must not hold.

## Safety properties

- Values are never read, printed, or stored. The inventory parses `.env.example`
  for `KEY=` names only; `.env.example` requires empty values (enforced by
  `secrets:scan`).
- Dry run is the default and performs zero I/O beyond reading the plan,
  `.env.example`, and `state.json`.
- `state.json` is gitignored; `*.report.md` outputs inside the rotation
  directory are ignored too. Write reports outside the repo or review them
  before committing elsewhere.
- Verify steps are restricted to the `check`/`verify-rotation` allowlist.
