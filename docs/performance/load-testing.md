# Load testing

`scripts/perf/load.mjs` is a dependency-free HTTP load generator. It runs N
virtual users against a target URL, picks endpoints by weight, paces requests
to a target rate, and prints a markdown summary — with an optional full JSON
report for offline analysis.

```bash
# smoke test, no external deps
node scripts/perf/load.mjs --demo --duration 5s

# ship a scenario file
node scripts/perf/load.mjs --config scripts/perf/scenarios/homepage.json

# ad-hoc run against any URL
node scripts/perf/load.mjs --target https://staging.spindle.app \
  --endpoints /,/pricing,/api/health --concurrency 20 --duration 60s
```

## CLI

Three modes:

- `--demo` — spins up a local throwaway server (routes `/`, `/api/health`,
  `/api/profile`, `/api/contact` POST, `/slow`, `/assets/app.js`) and runs a
  built-in weighted scenario. Good for verifying the harness works.
- `--config <file>` — run a JSON scenario (schema below).
- ad-hoc — requires `--target <url>` and `--endpoints <comma,list>`; every
  path gets equal weight. GET only.

Options (CLI flags override `--config` values, which override scenario-file
values — see `pickOverrides` in the script):

| flag                 | meaning                                                 | default                                     |
| -------------------- | ------------------------------------------------------- | ------------------------------------------- |
| `--target <url>`     | Base URL (strips trailing `/`)                          | required in ad-hoc; from scenario otherwise |
| `--endpoints <list>` | Comma-separated paths, equal weights                    | ad-hoc only                                 |
| `--concurrency <n>`  | Virtual users / parallel workers                        | 10                                          |
| `--rps <n>`          | Target requests/sec across all users; `0` = unthrottled | 0                                           |
| `--duration <spec>`  | Run length: `30`, `500ms`, `2m`, `1h`                   | `30s`                                       |
| `--ramp <sec>`       | Linearly ramp concurrency to full over N seconds        | 0                                           |
| `--warmup <ms>`      | Samples in this window are discarded                    | 0                                           |
| `--timeout <ms>`     | Per-request timeout; timeout counts as an error         | 10000                                       |
| `--out <file.json>`  | Write full JSON report (every sample + summary)         | —                                           |
| `--name <name>`      | Scenario name in the report                             | ad-hoc/demo                                 |
| `--help`             | Print usage                                             |                                             |

There is **no env-var or `.env` configuration** — everything comes from CLI
flags or the scenario file. To hit production/staging, point `--target` (or
the scenario's `target`) at the deployment URL. The shipped scenarios in
`scripts/perf/scenarios/` already default to `https://staging.spindle.app`.

## Scenario JSON format

```json
{
  "name": "homepage",
  "description": "free text, ignored by the runner",
  "target": "https://staging.spindle.app",
  "concurrency": 20,
  "rps": 0,
  "duration": "60s",
  "rampSec": 10,
  "warmupMs": 3000,
  "timeoutMs": 15000,
  "headers": { "user-agent": "spindle-load/1.0" },
  "endpoints": [
    { "path": "/", "weight": 5 },
    { "path": "/api/auth/session", "expect": [200] },
    {
      "path": "/api/newsletter",
      "method": "POST",
      "weight": 1,
      "expect": [200, 201],
      "headers": { "content-type": "application/json" },
      "body": { "email": "load-test@example.com", "consent": true }
    }
  ]
}
```

- `endpoints[]`: `path` (relative to `target`, or absolute `http(s)://` URL),
  `method` (default GET), `weight` (default 1 — relative pick probability),
  `headers` (merged over scenario-level headers), `body` (object is
  JSON-stringified and gets `content-type: application/json` if unset),
  `expect` (acceptable status codes, default `[200]`).
- Any unexpected status — plus network failures and timeouts — counts as an
  error. List every status you consider success in `expect`, e.g.
  `[200, 401]` for endpoints that legitimately reject anonymous users.
- CLI `--duration 500ms` style values and JSON `"duration": "60s"` share the
  same parser (`ms`/`s`/`m`/`h` units; bare number = seconds).

Shipped scenarios (`scripts/perf/scenarios/`):

- `homepage.json` — anonymous page views on staging.
- `api-read.json` — unauthenticated-safe GETs.
- `api-write.json` — public form POSTs at a low rate (rate-limit aware).
- `static-assets.json` — `/public` files, the CDN/cache-hit path.
- `mixed-traffic.json` — production-shaped mix of pages, API reads, a POST,
  and assets.

## Interpreting results

Stdout gets a markdown report: overall line plus a per-endpoint table.

- **samples / errors / err%** — total requests and failure share. Errors are
  non-`expect` statuses, timeouts, and network failures; the "Error
  breakdown" section groups them by kind (`unexpected status 429`, `timeout`,
  `network: ...`).
- **achieved req/s vs rps target** — compare the two. If achieved is far
  below target, the target (or the generator host) is saturated.
- **p50 / p95 / p99 / max** — latency percentiles of successful _and_
  failed samples (latency is recorded for every request). p50 is the typical
  user experience; p95/p99 expose tail latency from GC, cold routes, and
  contention; max is usually a timeout or one-off outlier. Per-endpoint rows
  show which route is slow.
- **`--out report.json`** — writes `{ version, scenario, target, config,
elapsedMs, summary, samples }` where `samples` is every request
  (`{ ep, status, ms, ok, error }`). Use it for custom analysis or diffing
  runs.
- **Exit code** — the run exits 1 only when _every_ request failed
  (`errorRate >= 1`), so CI can gate on total breakage without flaking on a
  few errors.

## Baseline workflow

`load.mjs` measures live latency/error behaviour; it complements — not
replaces — the build-output benchmarks in
[`benchmarks.md`](./benchmarks.md) (JS/CSS bytes, per-route payload, runtime
LCP/TBT budgets). Suggested flow:

1. Establish build budgets with `compare.mjs baseline` (see
   [`benchmarks.md`](./benchmarks.md)).
2. Run `load.mjs` against staging after deploys or on a schedule:

   ```bash
   node scripts/perf/load.mjs --config scripts/perf/scenarios/mixed-traffic.json \
     --out reports/load-$(date +%F).json
   ```

3. Keep the JSON reports; diff `summary.overall.p95Ms`, `errorRate`, and
   per-endpoint rows across runs to spot regressions. There is no built-in
   compare step yet — track baselines in your own notes/CI artifacts.

## Caveats

- **Rate pacing is approximate.** `--rps` spaces request _starts_ per worker
  (`activeWorkers / rps` interval), so achieved rate drifts when latency
  approaches the interval, and `setTimeout` granularity adds jitter. Treat
  achieved req/s in the report as truth, not the target.
- **Concurrency ≠ browser users.** Each virtual user is one in-flight
  request loop with no connection pooling limits, cookies, or TLS session
  reuse beyond `fetch` defaults — real-browser load will differ.
- **Localhost vs network.** `--demo` and localhost targets have no WAN RTT,
  DNS, TLS handshake amortization, or CDN; numbers will be far better than
  staging/prod. Only compare runs against the same target.
- **One machine, one IP.** All traffic shares a source IP — per-IP rate
  limiters (e.g. newsletter 10/hour) will 429 under sustained writes. Check
  the error breakdown; a wall of 429s is the limiter working, not a bug.
  Distribute generators or expect lower rates for write scenarios.
- **Weighting is probabilistic.** Endpoint mix is seeded per run
  (`mulberry32`) but proportions converge over time; short runs may skew.
- **Full-body fetch.** Every response body is downloaded (`arrayBuffer`)
  before timing ends, so latency includes transfer time of the whole
  payload — correct for "time to full response" but different from TTFB.
