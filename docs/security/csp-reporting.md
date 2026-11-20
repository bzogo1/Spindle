# CSP violation reporting

How CSP violations are collected, stored, and triaged during the
report-only → enforce rollout described in `src/lib/security-headers.ts`
(issue 051).

## Components

| Piece                | Path                                      | Role                                                                                                                                                             |
| -------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Policy source        | `src/lib/security-headers.ts`             | Emits `Content-Security-Policy` (safe subset) and `Content-Security-Policy-Report-Only` (full policy).                                                           |
| In-app collector     | `src/app/api/csp-report/route.ts`         | `POST /api/csp-report` — accepts both report formats, emits one structured `csp.violation` log event per report.                                                 |
| Parsing/analysis lib | `src/lib/csp-report.ts`                   | `parseCspReports()` normalises legacy + Reporting API payloads; `summarizeCspViolations()` groups by directive/blocked URI. Unit-tested in `csp-report.test.ts`. |
| Standalone collector | `scripts/security/csp-report/collect.mjs` | Dependency-free HTTP sink that appends reports to JSONL, plus `--analyze` and `--demo` modes. Use it for self-hosted sinks or offline replay of log output.      |

## Wire formats accepted

Browsers send two shapes; both are handled everywhere:

1. **`report-uri` (legacy)** — `POST /api/csp-report` with
   `Content-Type: application/csp-report`, body `{"csp-report": {...}}`
   (snake_case fields: `violated-directive`, `blocked-uri`, `document-uri`,
   `script-sample`, …). Supported by all CSP-reporting browsers.
2. **`report-to` (Reporting API)** — `POST /api/csp-report` with
   `Content-Type: application/reports+json`, body is usually an **array** of
   `{type: "csp-violation", url, user_agent, age, body: {...}}` (camelCase
   fields: `violatedDirective`, `blockedURL`, `documentURL`, `sample`, …).

Bare objects in either field naming are also accepted defensively.
Unparseable bodies get `204` — browsers must never see an error.

## Enabling reporting

The report-only header currently carries **no report directive**. To send
violations to the collector, the CSP strings in
`src/lib/security-headers.ts` need (owner: headers maintainer — not part of
this change):

```ts
// append to REPORT_ONLY_CSP:
"; report-uri /api/csp-report; report-to csp-endpoint"
```

plus a `Reporting-Endpoints` response header naming the endpoint:

```
Reporting-Endpoints: csp-endpoint="/api/csp-report"
```

`report-uri` alone is sufficient for broad browser coverage; `report-to`
gives structured batches in Chromium/Firefox. Both can coexist — dedupe by
`(documentUri, directive, blockedUri, lineNumber)` during analysis.

Until then, violations are visible in devtools → Issues/console.

## Data flow

```
browser ──POST──> /api/csp-report ──> pino logger ──> stdout/JSON logs
                                                  └─> log shipper ──> JSONL

or, self-hosted:
browser ──report-uri──> collect.mjs :8787 ──> csp-reports.jsonl
```

The in-app endpoint does **not** write files or touch the DB (app code may
not read `process.env` for a log path, and per-instance files would not
survive deploys). Persistence is the log pipeline's job; the standalone
collector covers deployments without one.

## Standalone collector

```bash
# Sink mode — append every accepted report as JSONL.
node scripts/security/csp-report/collect.mjs --port 8787 --out csp-reports.jsonl
# point report-uri at http://<host>:8787/csp-report

# Offline analysis of any JSONL (collector output or scraped logs).
node scripts/security/csp-report/collect.mjs --analyze csp-reports.jsonl

# Sample payloads + grouped analysis, no files needed.
node scripts/security/csp-report/collect.mjs --demo
```

`--path` changes the accepted route (default `/csp-report`); bodies over
256 KiB are dropped; responses are always `204`.

## Analysis workflow

1. Collect for a representative window (aim: ≥1 week, all major routes:
   `/`, `/docs`, `/changelog`, `/lab`, auth flows — matching the clean
   report-only window required before `CSP_ENFORCE=1`).
2. Group:
   ```bash
   node scripts/security/csp-report/collect.mjs --analyze reports.jsonl
   ```
   or programmatically via `summarizeCspViolations()` in
   `src/lib/csp-report.ts`.
3. Sort attention by `disposition`: `enforce` violations are live breakage
   under the safe subset; `report` violations are candidates that will break
   when the full policy is enforced.

## Triage runbook

For each `(directive, blockedUri)` group, top-down:

| Symptom                                                                       | Likely cause                                           | Action                                                                                                                                                                                         |
| ----------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `script-src` / `script-src-elem` ← `inline` with `sample`/`sourceFile`        | Pre-paint theme script or Next bootstrap not covered   | Expected while `'unsafe-inline'` is in the policy — verify the sample is ours, then ignore; removing `'unsafe-inline'` requires nonce/hash plumbing (tracked future work).                     |
| `script-src` ← `https://…` third-party                                        | Browser extension, embedded widget, or injected script | Check `documentUri` diversity: one page → app bug; many pages/users → extension noise. Extensions typically report `blocked-uri: chrome-extension://…` / `moz-extension://…` — safe to filter. |
| `connect-src` ← analytics/telemetry origin                                    | New third-party call not yet allowlisted               | Add origin to `connect-src` in `REPORT_ONLY_CSP` **before** enforcing (issue 028 note in `security-headers.ts`).                                                                               |
| `img-src`/`media-src`/`frame-src` ← `https://…`                               | User-content preview (file drawer, PDF iframe)         | Expected — policy intentionally allows `https:`; no action.                                                                                                                                    |
| `font-src`/`style-src` ← `https://fonts.gstatic.com` / `fonts.googleapis.com` | Google Fonts                                           | Already allowlisted; a report means the URL form differs (e.g. `fonts.gstatic.com` subpath) — widen only if the origin genuinely differs.                                                      |
| `worker-src` ← `blob:`                                                        | Sentry replay compression worker                       | Already allowed; report indicates the policy copy drifted — re-check `REPORT_ONLY_CSP`.                                                                                                        |
| `object-src` / `base-uri` / `frame-ancestors`                                 | Rare; usually extension or plugin                      | Investigate — these are the enforced safe-subset directives, so a violation here means real breakage.                                                                                          |

Rules of thumb:

- **Filter noise first**: extension schemes (`chrome-extension://`,
  `moz-extension://`, `safari-web-extension://`), `about:`, `data:` in
  `script-src` are almost never actionable.
- **`blockedUri: "inline"`/`"eval"`** → look at `sample` and `sourceFile`;
  inline bootstrap is expected, eval is not (policy has no `'unsafe-eval'`).
- A group is **done** when every member is explained (expected-by-design or
  allowlisted). Only unexplained `enforce`-disposition groups block the
  `CSP_ENFORCE=1` flip.
- Keep the raw JSONL; summaries are lossy. Re-run `--analyze` after policy
  edits to measure deltas.

## Security notes

- The endpoint is unauthenticated by design (browsers send reports without
  credentials). It only logs — no state changes — so abuse impact is log
  volume. The 256 KiB cap and 50-violations-per-request log cap bound it;
  put a WAF/rate limit in front if reports get noisy.
- Report bodies can contain page URLs and inline `sample` snippets — treat
  JSONL/log exports as potentially sensitive and restrict access accordingly.
  The logger's recursive redaction (`src/lib/logger.ts`) scrubs
  token/cookie-shaped keys regardless.
