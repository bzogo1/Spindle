# Secrets scanning in CI

This repository defends against leaked credentials on three layers, each
covering a different failure mode.

## Layers

| Layer                      | Where                                                              | What it catches                                                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| gitleaks                   | `.github/workflows/secrets-scan.yml` (+ `secrets` job in `ci.yml`) | Real secrets committed to git history: keys, tokens, private keys, high-entropy strings                                                                                              |
| `scripts/secrets/scan.mjs` | `npm run secrets:scan`, both workflows                             | Working-tree hygiene: token-shaped strings in files, tracked `.env` files, `.env.example` values that are not empty, missing `.env`/`.env.*` ignores in `.gitignore`/`.dockerignore` |
| `scripts/secrets/check.ts` | `npm run secrets:check` (`--production` via container entrypoint)  | Misconfigured secret store: required env names missing or malformed at runtime; values are never printed                                                                             |

### gitleaks configuration

`.gitleaks.toml` extends the gitleaks default ruleset (`useDefault = true`)
and adds path allowlists for files that legitimately contain token-shaped
text but are not secrets:

- `.env.example` — lists variable names with intentionally empty values
- `legacy/` — vendored reference material, not part of the production build
- `public/`, `.next/`, `node_modules/`, `.node_modules.original/` — build output and dependencies

To suppress a false positive without weakening the ruleset, prefer a narrow
`[[rules.allowlists]]` entry in `.gitleaks.toml` for that specific rule and
path over broad global allowlists.

### `scripts/secrets/scan.mjs`

Runs with plain `node` — no dependencies, no build step — so it works on a
fresh checkout. It scans `git ls-files` output (falling back to a directory
walk outside a git repo) for private-key headers and known token formats
(AWS `AKIA…`, GitHub `gh*_…`, Slack `xox*-…`, Stripe `sk_live_…`, Linear
`lin_api_…`, OpenAI `sk-…`, Google `AIza…`), and enforces that `.env` files
are never tracked and that ignore files cover them.

Invocation:

```bash
node scripts/secrets/scan.mjs   # or: npm run secrets:scan
```

Exit code 1 with a per-file finding list on failure; prints a pass line with
the scanned file count otherwise.

## How CI runs it

`.github/workflows/secrets-scan.yml` triggers on every `push` and
`pull_request`:

1. `actions/checkout@v4` with `fetch-depth: 0` so gitleaks sees full history.
2. `node scripts/secrets/scan.mjs` — fast hygiene gate.
3. `gitleaks/gitleaks-action@v2` with `GITLEAKS_ENABLE_SUMMARY=true`, which
   downloads a pinned gitleaks binary and applies `.gitleaks.toml`.

The job grants `contents: read` plus `security-events: write` so SARIF
results can be uploaded to the repository Security tab if that is wired up
later. The `secrets` job in `ci.yml` runs the same two checks so main-branch
pushes and PRs are gated even if this workflow is disabled.

## Remediation

When gitleaks or the hygiene scan reports a finding:

1. **Assume the secret is compromised.** It is in git history even if the
   commit is later removed.
2. **Rotate it at the provider first** (AWS IAM, GitHub token settings,
   Stripe dashboard, etc.). Deleting the file does not revoke access.
3. **Remove it from the working tree**, then remove it from history with
   `git filter-repo` (or BFG) if it matters, and force-push only on
   branches where that is acceptable.
4. **Add a regression allowlist only if it is a true false positive**, scoped
   to the specific rule and path — never by disabling the whole rule.
5. Re-run `npm run secrets:scan` locally and push; the workflow re-scans.

`.env` files must stay untracked; use `.env.example` (empty values only) for
templates and the secret store / deployment environment for real values.
