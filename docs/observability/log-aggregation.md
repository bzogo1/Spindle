# Log aggregation

How Spindle's structured logs leave a self-hosted deployment and land in a
queryable store. Application code is unchanged — `src/lib/logger.ts` already
emits one sanitized JSON object per line on stdout, and
`scripts/logging/ship.mjs` is a dependency-free shipper that batches those
lines to a pluggable sink.

## Log format

Every line is a single JSON object produced by pino
(`createLogger()` in `src/lib/logger.ts`):

```json
{
  "level": "info",
  "time": "2026-11-20T05:00:27.033Z",
  "pid": 412,
  "hostname": "spindle-app-1",
  "service": "spindle",
  "event": "api.request",
  "requestId": "req_…",
  "method": "GET",
  "path": "/api/projects",
  "status": 200,
  "durationMs": 12.4,
  "msg": "api request"
}
```

Fields worth knowing:

| Field                              | Meaning                                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| `level`                            | String label (`trace`…`fatal`) — pino `formatters.level` is configured to emit labels, not numbers |
| `time`                             | ISO-8601 timestamp (`pino.stdTimeFunctions.isoTime`)                                               |
| `service`                          | `"spindle"` from the logger `base`                                                                 |
| `hostname`, `pid`                  | Container/host identity                                                                            |
| `event`                            | Optional event name, e.g. `api.request` from `withRequestLogging()`                                |
| `requestId`, `userId`, `projectId` | Request correlation ids set by `request-logging.ts`                                                |
| `msg`                              | Human-readable message                                                                             |

Query strings and credentials never reach the log: `sanitizeForLog()`
redacts sensitive keys, signed-URL parameters, bearer tokens, and JWTs
before pino serialises the line. The shipper preserves lines verbatim — it
does not mutate or re-serialise them except when building a Loki push body.

## Architecture

```
┌──────────────┐   stdout    ┌──────────────────┐   batch    ┌─────────────┐
│  Next.js app │ ──────────► │  ship.mjs        │ ─────────► │  sink       │
│  (pino JSON) │  docker     │  scripts/        │  HTTP/    │  • Loki     │
│              │  logs/json  │  logging/ship.mjs│  file/    │  • Vector   │
│              │  -file or   │                  │  stdout   │  • file     │
│              │  pipe       │                  │           │  • stdout   │
└──────────────┘             └──────────────────┘           └─────────────┘
```

`ship.mjs` is a single dependency-free Node script. It:

- reads lines from **stdin** (default), a **file** (`--file`, with `--follow`
  for tailing that survives rotation/truncation), or a built-in **`--demo`**
  fixture that mirrors real pino output;
- validates each line as JSON and counts valid vs. invalid records
  (non-JSON noise is still shipped, never dropped silently);
- batches up to `--batch-size` records or `--flush-ms`, whichever comes first;
- applies **backpressure**: at most `--max-buffer` records may wait between
  source and sink. When the buffer is full the source is paused until the
  in-flight batch completes, so a slow sink cannot grow memory unboundedly;
- **retries** failed HTTP batches with exponential backoff (`--retry-ms`,
  capped at 30 s) up to `--max-retries`, preserving order. Batches that
  exhaust retries are counted as dropped and reported in the shutdown
  summary on stderr — the shipper never crashes the pipeline over a dead sink.

### Sinks

| Sink     | Flag                                      | Behaviour                                                                                                              |
| -------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `stdout` | `--sink stdout` (default)                 | Echoes raw lines; composable with `tee`, `grep`, or another collector downstream                                       |
| `file`   | `--sink file --out <path>`                | Appends JSONL; rotates at `--rotate-mb` keeping `--rotate-keep` generations                                            |
| `http`   | `--sink http --endpoint <url> --format …` | POSTs each batch; `loki` uses the Loki push API, `ndjson` posts newline-delimited JSON (Vector `http` sink compatible) |

`--format auto` (default) picks `loki` when the endpoint path contains
`/loki/`, otherwise `ndjson`. For the `loki` format the shipper groups
records into streams labelled `{service, level, host}` and converts pino's
ISO `time` to Loki's nanosecond epoch. Non-JSON lines get the `level=unknown`
label and are pushed verbatim, so they remain searchable with `|=` filters.

### Modes

- `--dry-run` — parses and counts records, sends nothing. Use to verify a
  log source before pointing the shipper at production.
- `--demo` — feeds six sample lines (info request, warn, error with an error
  object, debug, and one non-JSON line) through the full pipeline.

## Running it

```bash
# Smoke test — prints parsed lines and a stats summary to stderr
node scripts/logging/ship.mjs --demo --batch-size 2 --flush-ms 100

# Pipe live container logs into Loki
 docker logs -f --tail 0 spindle-app 2>&1 \
  | node scripts/logging/ship.mjs --stdin \
      --sink http --endpoint http://loki:3100/loki/api/v1/push --format loki

# Or tail the Docker json-file log directly
node scripts/logging/ship.mjs --file /var/lib/docker/containers/<id>/<id>-json.log \
  --follow --sink file --out /var/log/spindle/ship.jsonl
```

Environment variables prefixed `SHIP_` mirror the CLI flags
(`SHIP_SINK`, `SHIP_ENDPOINT`, `SHIP_FORMAT`, `SHIP_OUT`, `SHIP_BATCH_SIZE`,
`SHIP_FLUSH_MS`, `SHIP_MAX_BUFFER`, `SHIP_MAX_RETRIES`, `SHIP_ROTATE_MB`,
`SHIP_HOST`); CLI flags take precedence. `SHIP_HOST` overrides the `host`
stream label — set it to the compose project name when several deployments
ship to one Loki.

On `SIGINT`/`SIGTERM` the shipper stops reading, drains queued batches, and
prints a one-line summary (`read`, `valid`, `invalid`, `batches`, `retried`,
`dropped`, `recordsDropped`, `bytes`) — wire this into your service manager's
log if you need per-shipper metrics.

## Retention

Retention is a property of the **store**, not the shipper. The shipper keeps
no state: it does not track offsets, does not replay history, and loses
records only when a sink is unreachable for longer than the retry budget.

| Layer                     | What to configure                            | Suggested starting point                         |
| ------------------------- | -------------------------------------------- | ------------------------------------------------ |
| Docker `json-file` driver | `max-size` / `max-file` per container        | `10m` × 3 files per service                      |
| ship.mjs `file` sink      | `--rotate-mb` × `--rotate-keep`              | 100 MB × 3 ≈ 300 MB per shipper                  |
| Loki                      | `limits_config.retention_period` + compactor | 14 days hot, then object-store tier if available |
| Vector disk buffer        | `buffer.type = "disk"` `max_size`            | 1 GB per sink; persists across restarts          |

If you need guaranteed delivery across shipper restarts, put a disk buffer
in front of the HTTP endpoint (Vector `disk` buffer, see below) or use the
`file` sink as a spool and replay it later. For a single-node self-hosted
deployment, Loki's 14-day default plus the json-file rotation above is
usually sufficient — the shipper's retry budget (~1 min worst case per batch,
counting request timeouts)
covers short outages, and the shutdown summary tells you exactly what was
dropped.

## Example: Loki

`loki-config.yaml` (local filesystem storage, single binary):

```yaml
# Minimal single-binary Loki for a self-hosted Spindle deployment.
auth_enabled: false

server:
  http_listen_port: 3100

common:
  instance_addr: 127.0.0.1
  path_prefix: /loki
  storage:
    filesystem:
      chunks_directory: /loki/chunks
      rules_directory: /loki/rules
  replication_factor: 1
  ring:
    kvstore:
      store: inmemory

schema_config:
  configs:
    - from: 2024-01-01
      store: tsdb
      object_store: filesystem
      schema: v13
      index:
        prefix: index_
        period: 24h

limits_config:
  retention_period: 336h # 14 days
  ingestion_rate_mb: 8
  ingestion_burst_size_mb: 16

compactor:
  working_directory: /loki/compactor
  retention_enabled: true
  delete_request_store: filesystem
```

Run it next to the app and push with the shipper:

```bash
docker run -d --name loki -p 3100:3100 \
  -v $(pwd)/loki-config.yaml:/etc/loki/local-config.yaml \
  -v spindle-loki:/loki \
  grafana/loki:3.4.2 -config.file=/etc/loki/local-config.yaml

node scripts/logging/ship.mjs --demo \
  --sink http --endpoint http://localhost:3100/loki/api/v1/push --format loki
```

## Example: Vector

Vector accepts newline-delimited JSON on its `http` sink source and can
fan out to Loki, disk buffers, or a file — useful when you want buffering
or multiple destinations.

`vector.toml`:

```toml
[sources.spindle_logs]
type = "http_server"
address = "0.0.0.0:8686"
path = "/ingest"
method = "POST"

# Optional: decode the NDJSON body into structured events.
# [transforms.parse]
# inputs = ["spindle_logs"]
# type = "remap"
# source = '''
# . = parse_json!(.message)
# '''

[sinks.loki]
type = "loki"
inputs = ["spindle_logs"]
endpoint = "http://loki:3100/loki/api/v1/push"
encoding.codec = "json"

  [sinks.loki.labels]
  service = "{{ service }}"
  level   = "{{ level }}"
  host    = "{{ hostname }}"

# Durable buffer: survives Vector restarts and Loki outages.
[sinks.loki.buffer]
type = "disk"
max_size = 1073741824 # 1 GiB
when_full = "block"

[sinks.archive]
type = "file"
inputs = ["spindle_logs"]
path = "/var/log/spindle/archive-%Y-%m-%d.jsonl"
encoding.codec = "json"
```

```bash
docker run -d --name vector -p 8686:8686 \
  -v $(pwd)/vector.toml:/etc/vector/vector.toml \
  -v spindle-vector-buffer:/var/lib/vector \
  timberio/vector:0.43.1-alpine \
  --config /etc/vector/vector.toml

node scripts/logging/ship.mjs --file /var/log/spindle/app.log --follow \
  --sink http --endpoint http://localhost:8686/ingest --format ndjson
```

`when_full = "block"` gives you Vector-side backpressure; the shipper's own
`--max-buffer`/`--max-retries` still apply on top.

## Docker Compose snippet

The repo's `compose.yaml` is intentionally minimal; add services like these
when self-hosting logs. They are **not** part of the checked-in compose file.

```yaml
services:
  loki:
    image: grafana/loki:3.4.2
    restart: unless-stopped
    command: -config.file=/etc/loki/local-config.yaml
    volumes:
      - ./loki-config.yaml:/etc/loki/local-config.yaml:ro
      - spindle-loki:/loki
    ports:
      - "3100:3100"

  # Optional query UI. Datasource provisioning is shown below.
  grafana:
    image: grafana/grafana:11.6.0
    restart: unless-stopped
    environment:
      GF_AUTH_ANONYMOUS_ENABLED: "true"
      GF_AUTH_ANONYMOUS_ORG_ROLE: Admin
    volumes:
      - ./grafana-datasources.yaml:/etc/grafana/provisioning/datasources/loki.yaml:ro
      - spindle-grafana:/var/lib/grafana
    ports:
      - "3001:3000"
    depends_on:
      - loki

  # Shipper sidecar for the app: tail the app's stdout via the Docker
  # json-file log, batch, and push to Loki. Mount the docker socket
  # read-only if you prefer `docker logs -f` driven by a wrapper script.
  log-shipper:
    image: node:24-alpine
    restart: unless-stopped
    working_dir: /app
    volumes:
      - ./scripts/logging:/app/scripts/logging:ro
      - ./logs:/app/logs
    command: >
      sh -c "node scripts/logging/ship.mjs --demo --sink file --out /app/logs/ship.jsonl"
    # In production, replace --demo with a mounted log file or pipe:
    #   command: node scripts/logging/ship.mjs --file /logs/app.log --follow \
    #     --sink http --endpoint http://loki:3100/loki/api/v1/push --format loki
    environment:
      SHIP_ENDPOINT: http://loki:3100/loki/api/v1/push
      SHIP_FORMAT: loki
      SHIP_HOST: ${COMPOSE_PROJECT_NAME:-spindle}

volumes:
  spindle-loki:
  spindle-grafana:
```

`grafana-datasources.yaml`:

```yaml
apiVersion: 1
datasources:
  - name: Loki
    type: loki
    access: proxy
    url: http://loki:3100
    isDefault: true
```

## Query examples

In Grafana (Explore → Loki) or `logcli`:

```logql
# All errors from the app in the last hour
{service="spindle", level="error"}

# A single request end-to-end (request-logging.ts sets requestId on every line)
{service="spindle"} |= "req_01JXYZ"

# 5xx API responses with their latency
{service="spindle", event="api.request"} | json | status >= 500

# Slow requests (> 500 ms)
{service="spindle", event="api.request"} | json | durationMs > 500

# Error rate by path over 5 minutes
sum by (path) (count_over_time({service="spindle", event="api.request"} | json | status >= 500 [5m]))

# Top error messages
topk(10, sum by (msg) (count_over_time({service="spindle", level="error"} [1h])))
```

`| json` parsing works because every line is a flat-ish JSON object; nested
fields like `error.message` are addressable as `error_message` after the
parser flattens them, or via `| json error="error.message"` label extraction.

## Operational notes

- **Ordering**: retries preserve order within a shipper; multiple shippers or
  restarted shippers may interleave. Loki sorts by timestamp anyway.
- **Duplicates**: at-least-once semantics — a batch that times out after the
  sink committed it can be resent. Loki deduplicates identical
  `(timestamp, line)` pairs within the same stream, so exact duplicates are
  harmless.
- **Clock skew**: Loki rejects entries older than its `reject_old_samples`
  window (default 1w) or too far in the future. If the app host clock drifts,
  prefer `--format ndjson` → Vector with a `reduce`/`filter` transform that
  clamps timestamps.
- **Verify before trusting**: `--dry-run` against a live log file confirms
  parse rates; the stderr summary (`valid`/`invalid`) is the health signal.
  Alert on `recordsDropped > 0` or a missing `[ship] done` line after a
  scheduled restart.
