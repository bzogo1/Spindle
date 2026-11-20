# Dependency vulnerability scanning

How known-vulnerability (CVE/GHSA) findings in `package-lock.json` and in CI
actions are detected, reported, and gated. This complements
[supply-chain security](supply-chain.md) (pinning, lockfile integrity,
provenance) and [secret scanning](secret-scanning-ci.md) — this doc owns the
_advisory_ layer: `npm audit`, Dependabot, and the scheduled audit workflow.

## Layers

| Layer           | Tool                                                                 | Trigger                                                                           | Blocking?                               |
| --------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------- |
| Version updates | Dependabot (`.github/dependabot.yml`)                                | Weekly PRs for npm + github-actions                                               | No — PRs reviewed by humans             |
| Advisory gate   | `npm audit --audit-level=high` in `.github/workflows/deps-audit.yml` | Weekly schedule, PRs touching `package.json`/`package-lock.json`, manual dispatch | **Yes** — fails on high/critical        |
| Report          | `scripts/security/deps-audit/report.mjs`                             | Same workflow; also runnable locally                                              | No — produces the summary               |
| Signature check | `npm audit signatures`                                               | Same workflow, advisory step                                                      | No — `continue-on-error`, informational |
| Secret scanning | gitleaks / `secrets-scan.yml`                                        | Every push/PR                                                                     | Yes                                     |

## CI behaviour (`deps-audit.yml`)

- `npm audit` reads `package-lock.json` directly; no `npm ci` is required, so
  the job audits exactly the locked tree.
- The JSON report is always produced (`npm audit --json`, `|| true`) and
  rendered by `report.mjs` into both `audit-summary.md` and the GitHub job
  summary; the raw JSON + markdown are uploaded as the `npm-audit-report`
  artifact (90-day retention) even when the gate fails.
- The gate is `npm audit --audit-level=high`: moderate/low findings are
  reported but do not fail the build. Tighten to `moderate` once the current
  backlog is clean.
- `npm audit signatures` verifies registry signatures/attestations. Many
  legitimate packages are unsigned, so it runs advisory-only.
- On `pull_request` the job only runs when `package.json` or
  `package-lock.json` changes, so ordinary PRs are unaffected.

## Local usage

```bash
# Full audit against the lockfile (no install needed)
npm audit --json > /tmp/audit.json
node scripts/security/deps-audit/report.mjs --file /tmp/audit.json

# Piped input, capped advisory list
npm audit --json | node scripts/security/deps-audit/report.mjs --max-advisories 20

# Offline smoke test of the reporter
node scripts/security/deps-audit/report.mjs --demo
```

`report.mjs` exits non-zero only on malformed input; severity gating lives in
the `npm audit --audit-level` flag, not the script.

## Dependabot policy

`.github/dependabot.yml` configures:

- **npm** (`/`): weekly Monday updates, minor+patch grouped into one PR,
  limit 5 open PRs. Major bumps arrive as individual PRs for deliberate
  review.
- **github-actions** (`/`): weekly Monday updates, limit 3 — keeps
  `actions/*` pins fresh.

Dependabot _security_ updates (opened immediately on new advisories) are
enabled at the repository level and are not governed by this file's schedule.

## Severity thresholds and triage

| Severity        | CI behaviour       | Expected response                                                                             |
| --------------- | ------------------ | --------------------------------------------------------------------------------------------- |
| critical / high | Fails `deps-audit` | Fix or pin before merge; if no fix exists, document an exception in the PR and track an issue |
| moderate        | Reported only      | Fix in the next Dependabot batch or when touching the dep                                     |
| low / info      | Reported only      | Opportunistic                                                                                 |

When a high/critical finding has no upstream fix, options in order:
`npm audit fix` (non-breaking), targeted override in `package.json`
`overrides`, or a documented, time-boxed exception reviewed by a maintainer.
Do not silence the audit with `--omit` flags in CI.

## Gaps / follow-ups

- `npm audit` covers npm advisories only; it does not check GitHub Actions
  for CVEs — Dependabot's github-actions ecosystem plus manual review of
  action pins is the current control.
- No SBOM generation yet (tracked separately); `report.mjs --json` can feed
  one later.
- If the moderate backlog grows, add a `moderate`-level scheduled job that
  reports without gating, so regressions are visible before they become
  high-severity.
