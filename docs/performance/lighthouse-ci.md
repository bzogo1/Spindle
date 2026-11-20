# Lighthouse CI

`.github/workflows/lighthouse.yml` runs [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci)
(`@lhci/cli`, pinned in `package.json`) against a **production build** of the
public marketing pages and enforces the budgets in `lighthouserc.json`.

## What runs where

The workflow triggers on:

- pushes to `main`
- PRs that touch `src/**`, `public/**`, `content/**`, `next.config.ts`,
  `package.json`, `package-lock.json`, `lighthouserc.json`, or the workflow
  itself
- `workflow_dispatch` (manual run from the Actions tab)

A single job, `Lighthouse budgets`, does:

1. `npm ci` → `npm run build` (same production build as `ci.yml`, including
   the `prebuild` docs step and `postbuild` client-bundle check).
2. Installs Chrome via `browser-actions/setup-chrome`, resolves the binary,
   and exports `CHROME_PATH` so `chrome-launcher` always finds it.
3. Starts `npm start` (`next start`) detached with `nohup` + pidfile — each
   workflow step runs in its own shell, so the server is started in one step
   and stopped by an `if: always()` cleanup step.
4. Waits up to 60s for `http://127.0.0.1:3000/` to return 200, then runs
   `npx lhci autorun`.
5. Uploads `.lighthouseci/` (HTML reports, `lhr-*.json`,
   `assertion-results.json`) as the `lighthouse-reports` artifact for 14 days,
   even on failure.

`lhci autorun` performs collect → assert → upload in one shot:

- **collect**: `desktop` preset, 3 runs per URL (LHCI asserts on the median),
  against `http://localhost:3000/{/,pricing,referral,contact}`.
- **assert**: see budgets below.
- **upload**: `temporary-public-storage` — LHCI prints shareable report URLs
  in the step log. No secrets required; reports expire with the storage
  service.

## Audited pages and budgets

`lighthouserc.json` audits four marketing routes:

| URL         | Why                                         |
| ----------- | ------------------------------------------- |
| `/`         | Homepage — heaviest client payload          |
| `/pricing`  | Conversion page with interactive components |
| `/referral` | Referral flow page                          |
| `/contact`  | Form page                                   |

Assertions (medians across the 3 runs):

| Assertion                   | Level | Budget   | Rationale                            |
| --------------------------- | ----- | -------- | ------------------------------------ |
| `categories:performance`    | warn  | ≥ 0.80   | Trend signal, not a hard gate        |
| `categories:accessibility`  | warn  | ≥ 0.90   | Paired with the axe-core e2e suite   |
| `categories:best-practices` | warn  | ≥ 0.90   | —                                    |
| `categories:seo`            | warn  | ≥ 0.90   | —                                    |
| `largest-contentful-paint`  | error | ≤ 2500ms | "Good" LCP threshold, desktop preset |
| `cumulative-layout-shift`   | error | ≤ 0.10   | "Good" CLS threshold                 |
| `total-blocking-time`       | error | ≤ 200ms  | Lab proxy for interactivity          |

**INP is intentionally not asserted.** Lighthouse cannot measure
`interaction-to-next-paint` without scripted user interactions — the audit
never runs and the assertion permanently warns (`auditRan` failures in
`.lighthouseci/assertion-results.json`). TBT is the lab-mode proxy; real INP
needs field data (e.g. Sentry/RUM) or a custom `puppeteerScript` scenario.

Budgets are aligned with `scripts/perf/benchmarks/budgets.json` (the static
build-output gate in `benchmarks.md`). Asset-size budgets are deliberately
**not** duplicated here — `npm run analyze` /
`scripts/perf/benchmarks/compare.mjs check` already gate bundle growth.

## Local runs

`npm run test:lighthouse` (`lhci autorun`) works locally **only if you have
Chrome and a running production server**:

```bash
npm run build
npm start &                       # port 3000
npm run test:lighthouse
```

Without Chrome, `lhci collect` fails — that is expected; CI provides Chrome
via `setup-chrome`. Playwright's bundled Chromium is not used because it is
not on `chrome-launcher`'s default search path.

## Inspecting results

```bash
# Markdown table of per-URL medians (LCP/FCP/TBT/CLS/SI/TTI/TTFB + categories)
node scripts/lighthouse/summarize.mjs

# Same, plus re-evaluate lighthouserc.json assertions; exit 1 on error-level breach
node scripts/lighthouse/summarize.mjs --check

# Machine-readable output, synthetic offline data, or a different report dir
node scripts/lighthouse/summarize.mjs --json
node scripts/lighthouse/summarize.mjs --demo --check
node scripts/lighthouse/summarize.mjs --dir /path/to/.lighthouseci
```

In CI, open the `lighthouse-reports` artifact for the full HTML reports and
`assertion-results.json` (per-audit pass/fail detail).

## Updating budgets and baselines

Budgets live in `lighthouserc.json`; there is no stored baseline to re-record
— assertions are absolute thresholds, not diffs.

- **Tighten/loosen a threshold**: edit the `maxNumericValue` /
  `minScore` in `lighthouserc.json`. PRs touching that file re-run the
  workflow.
- **Add a page**: add its URL to `ci.collect.url`.
- **Add/remove an audit**: add an `"audit-id": ["error"|"warn"|"off", {...}]`
  entry under `ci.assert.assertions`. Prefer `warn` first and promote to
  `error` once the metric is stable — a single cold cache or CI-runner CPU
  spike can push one run over a hard threshold.
- **Calibrate against reality**: run `node scripts/lighthouse/summarize.mjs`
  on the `.lighthouseci/` output (locally or from the CI artifact) and set
  budgets a comfortable margin above observed medians. Observed medians on
  the current build are roughly LCP ~350–390ms, TBT ~70–110ms, CLS < 0.03 —
  the 2500/200/0.10 budgets have ~6–25× headroom for runner noise.
- **Static bundle budgets** are separate: see `docs/performance/benchmarks.md`
  for `scripts/perf/benchmarks/baselines/` regeneration.

## Known limitations

- Lab numbers come from one desktop Chrome on a shared CI runner; treat them
  as regression gates, not field performance. Field metrics belong in RUM.
- CLS/TBT can spike on a single run (fonts, hydration); median-of-3 plus the
  headroom above keeps flakiness rare, but an occasional red run is possible
  — re-run the job before assuming a real regression.
- `temporary-public-storage` URLs are public-by-obscurity and expire; do not
  rely on them for anything sensitive. The artifact upload is the durable
  record.
