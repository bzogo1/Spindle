# Runbook automation

The tooling under `scripts/runbooks/` keeps the operational runbooks in
`docs/runbooks/` and `docs/resilience/` honest: it catalogs them, verifies
their references, flags stale reviews, and dry-runs their commands. It is
dependency-free (Node.js stdlib only) and safe to run anywhere — every script
has an offline mode and none of them touch a database, a host, or the network
unless you explicitly ask the executor to run a command that already carries a
`--dry-run`-style flag.

## Pieces

| File                             | Purpose                                                                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `scripts/runbooks/registry.json` | Hand-maintained metadata per runbook: owner, severity, last review, related alerts and scripts.                               |
| `scripts/runbooks/lib.mjs`       | Shared helpers: runbook discovery, git/mtime review dates, markdown reference and command extraction, command classification. |
| `scripts/runbooks/index.mjs`     | Builds the runbook index/registry (this catalog).                                                                             |
| `scripts/runbooks/lint.mjs`      | Validates that referenced paths, scripts, and `npm run` targets exist.                                                        |
| `scripts/runbooks/staleness.mjs` | Flags runbooks not reviewed within N days (via `git log`).                                                                    |
| `scripts/runbooks/execute.mjs`   | Extracts commands from a runbook and dry-runs the safe ones.                                                                  |

## Index / registry

```bash
# Markdown table to stdout
node scripts/runbooks/index.mjs

# JSON for other tooling
node scripts/runbooks/index.mjs --json

# Write the markdown catalog to a file
node scripts/runbooks/index.mjs --out docs/runbooks/index.md

# Offline demo: file mtimes only, no git lookups
node scripts/runbooks/index.mjs --demo
```

The index covers every `docs/runbooks/*.md` and `docs/resilience/*.md` file.
Metadata (owner, severity, `lastReviewed`, `relatedAlerts`, `relatedScripts`,
`tags`) comes from `scripts/runbooks/registry.json`; files missing from the
registry are listed under "Unregistered runbooks". Review dates prefer the
registry's `lastReviewed`, then `git log -1`, then file mtime for untracked
files.

When you add a runbook, add a registry entry — `index.mjs` and `lint.mjs`
(stale-check below) both warn on unregistered files.

## Lint / validator

```bash
node scripts/runbooks/lint.mjs          # human-readable findings
node scripts/runbooks/lint.mjs --json   # machine-readable
node scripts/runbooks/lint.mjs --strict # unregistered runbooks become errors
node scripts/runbooks/lint.mjs --demo   # lint built-in fixtures, always exits 0
```

Checks per runbook:

- an H1 title exists;
- every repo-path reference — markdown link targets like
  `../../scripts/db/migrate.mjs` and backtick-quoted paths like
  `scripts/db/monitoring/rules.json` — resolves to a file that exists;
- every script invoked from a command block exists, and every
  `npm run <name>` is defined in `package.json` (the same
  verify-the-script-exists pattern the DR drill runner applies to its
  scenario commands);
- registry coverage and severity validity.

Exit codes: `0` clean, `1` findings, `2` usage error.

## Staleness checker

```bash
node scripts/runbooks/staleness.mjs              # 90-day default threshold
node scripts/runbooks/staleness.mjs --days 30    # tighter cadence
node scripts/runbooks/staleness.mjs --ci         # exit 1 if anything is stale
node scripts/runbooks/staleness.mjs --json
node scripts/runbooks/staleness.mjs --demo       # mtimes only, fixed clock, exits 0
```

A runbook is stale when its review age exceeds the threshold. The review date
is the registry `lastReviewed` when present, otherwise the last git commit
touching the file; untracked files fall back to mtime and are labelled as such
so they are never silently treated as fresh. Without `--ci` the report is
advisory and always exits `0`; `--ci` turns stale findings into a failure for
CI gates.

## Executor (dry-run by default)

```bash
# Print the execution plan — nothing runs
node scripts/runbooks/execute.mjs docs/runbooks/database-backup.md

# Simulate results offline
node scripts/runbooks/execute.mjs database-backup --demo

# Run ONLY the commands that carry a no-side-effect flag
node scripts/runbooks/execute.mjs database-monitoring --execute \
  --only "check.mjs --dry-run"

node scripts/runbooks/execute.mjs --help   # basename or full path both work
```

The executor extracts commands from fenced `bash`/`sh`/`console` blocks (one
command per line, `\`-continuations joined) and from inline `code` spans that
both start with a known command (`node`, `npx`, `npm`, `bash`, `pg_dump`, …)
and carry invocation evidence (a `scripts/` path, `npm run`, a `.sh` file, or
`node -e`) — so prose mentions like `` `pg_dump` `` are not treated as
commands.

A command is **dry-run safe** only when it invokes a repo script through
`node`/`npx`/`tsx`/`npm` and includes `--dry-run`, `--demo`, `--help`,
`--list`, or `--plan`. In the default mode the tool prints the plan and marks
each command `planned` or `skipped`; `--demo` simulates success; `--execute`
runs the safe commands via `spawnSync` (per-command `--timeout`, default
120s) and skips everything else. This mirrors the drill runner's contract:
automation only ever invokes runbook steps in their plan/dry-run modes — real
deploys, restores, and rotations stay manual.

Exit codes: `0` plan clean / all executed ok / demo, `1` a command failed,
`2` usage error.

## Keeping it current

- After editing a runbook, run `lint.mjs` — it catches dead script references
  immediately.
- Bump `lastReviewed` in `registry.json` when a human re-verifies a runbook;
  the staleness checker measures from there.
- `--demo` on every script exercises the tooling with zero side effects and is
  a good smoke test in CI or on a fresh checkout.
