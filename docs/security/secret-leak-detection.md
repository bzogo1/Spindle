# Secret leak detection

Runtime and repository scanning for credentials that escaped the secret-store
contract in [`docs/decisions/0002-secrets-management.md`](../decisions/0002-secrets-management.md).
This complements — it does not replace — gitleaks:

- **gitleaks** (`.gitleaks.toml`, `.github/workflows/secrets-scan.yml`) is the
  fast, always-on gate with a curated rule set. See
  `docs/security/secret-scanning-ci.md`.
- **`scripts/secrets/leak-detection/detect.mjs`** is a dependency-free,
  deeper sweep you run on demand: git history, source files, tracked `.env`
  files, high-entropy strings, and a running app's logs.
- **`src/lib/secrets/leak-guard.ts`** is the runtime last line of defence: it
  scrubs credential-looking substrings from error messages, stacks, and log
  text before they leave the process.

## Running the detector

```bash
# Full scan: working tree + git history. Exits 1 on any critical finding.
node scripts/secrets/leak-detection/detect.mjs

# Report only — never fails the build.
node scripts/secrets/leak-detection/detect.mjs --dry-run

# Machine-readable output for CI or dashboards.
node scripts/secrets/leak-detection/detect.mjs --json

# Skip history (fast pass over the working tree only).
node scripts/secrets/leak-detection/detect.mjs --no-history

# Also scan a running app's logs / error dumps.
node scripts/secrets/leak-detection/detect.mjs --logs-dir=/var/log/spindle
# or: --logs-dir var/log/spindle

# Verify the tool itself without touching the repo.
node scripts/secrets/leak-detection/detect.mjs --demo
node scripts/secrets/leak-detection/detect.mjs --demo --json
```

### What it scans

| Source    | Coverage                                                                                                                                                                                                                                                                                                                           |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source`  | Every git-tracked or untracked non-ignored file: known token formats (GitHub, AWS, Slack, Stripe, Google, Linear, OpenAI/Anthropic-style, JWTs, private keys, credentialed connection strings), generic `*_SECRET=`/`*_TOKEN=` assignments, and high-entropy strings (Shannon ≥ 4.2 bits/char, ≥ 3 character classes, ≥ 32 chars). |
| `history` | `git log -p --all` added lines, same rules. Catches secrets committed and later removed.                                                                                                                                                                                                                                           |
| `env`     | Any `.env`/`.env.*` file tracked by git (except `.env.example`, whose values must stay empty — enforced by `scripts/secrets/scan.mjs`).                                                                                                                                                                                            |
| `logs`    | With `--logs-dir`, text log files (`*.log`, `*.txt`, `*.out`, `*.err`, `*.json`, `*.ndjson`) for env dumps and leaked values in error output.                                                                                                                                                                                      |

Lockfiles (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, etc.) are
skipped — their integrity hashes are high-entropy but not secrets. The
detector never scans itself.

### Output

Findings are severity-ranked (`critical` → `low`) with `source`, `location`
(`file:line` or history path), `rule`, and a redacted `excerpt` — values are
never printed in full. `--json` emits `{ meta, counts, findings }` for
pipelines. Exit code is `1` when any `critical` finding exists unless
`--dry-run` is passed.

## Triage

Work findings from highest severity down.

1. **Confirm it is real.** Open the file/commit. Test fixtures, documentation
   examples, RFC vectors, and local-development placeholders (`localhost`,
   `user:pass@`, `*.example.com`) are usually false positives — the detector
   already filters most of these.
2. **If real, treat it as compromised.** Follow
   [`docs/runbooks/secrets-rotation.md`](../runbooks/secrets-rotation.md)
   immediately: rotate the value in the secret store, deploy, then remove the
   old one. A leaked value in git history stays leaked even after the file is
   deleted — rotation is the fix, not deletion.
3. **Mark reviewed false positives** by adding `leak-detection:ignore` to the
   offending line (see `src/lib/auth/pkce.test.ts` for the RFC 7636 vectors).
   Use sparingly — every marker is a reviewed exemption.
4. **Re-run** `node scripts/secrets/leak-detection/detect.mjs --dry-run` until
   clean, then commit the rotation evidence per the runbook.

Known-benign findings in this repo's history (e.g. the unsigned fixture JWT in
`src/lib/logger.test.ts` committed before the ignore marker existed) can be
dismissed after review; the marker prevents recurrence in the working tree.

## Runtime guard

`src/lib/secrets/leak-guard.ts` exports:

- `scrubSecrets(text)` — replaces private-key blocks, known token formats,
  `Authorization: Bearer/Basic …` values, credentialed connection-string
  passwords, and `*_SECRET=`/`*_TOKEN=`/`*_PASSWORD=` assignments with
  `[Redacted]`. Placeholders (`<your-key>`, `${VAR}`, `process.env.X`) are left
  alone.
- `scrubError(error)` — returns a copy of an `Error` with message and stack
  scrubbed; the original is untouched.
- `containsSecret(text)` — boolean check for "did this change anything".

It complements `src/lib/logger.ts` (structured field redaction) for free-text
paths: third-party error messages, `console` fallbacks, Sentry `beforeSend`,
and API error bodies. Wire it at those boundaries; do not log raw upstream
errors.

## CI integration

The gitleaks workflow (created separately; see
`docs/security/secret-scanning-ci.md`) runs on every push/PR. Recommended
layering:

1. **PR/push:** gitleaks only — fast, curated rules, blocks merges.
2. **Scheduled or pre-release:** `node scripts/secrets/leak-detection/detect.mjs --dry-run --json`
   uploaded as an artifact; alert on `critical`/`high` counts. History scans
   are slower, so keep them out of the per-commit hot path.
3. **Deploy pipeline:** keep `npm run secrets:check -- --production` (names and
   shape only) as the gate that values exist; the detector proves none leaked.

Never commit detector output containing real values — excerpts are already
redacted, but treat findings as sensitive until triaged.
