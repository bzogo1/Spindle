#!/usr/bin/env node
/**
 * Webhook replay CLI.
 *
 * Re-delivers webhook payloads recorded in a JSONL export (DLQ dump, receiver
 * log export, `/_deliveries` capture) to a webhook endpoint.
 *
 * Usage:
 *   node scripts/webhooks/replay/replay.mjs list   --file deliveries.jsonl
 *   node scripts/webhooks/replay/replay.mjs replay --file deliveries.jsonl --endpoint https://example.com/hooks
 *   node scripts/webhooks/replay/replay.mjs dry-run --file deliveries.jsonl --endpoint https://example.com/hooks
 *   node scripts/webhooks/replay/replay.mjs replay --demo [--secret whsec_demo]
 *
 * JSONL record format (one JSON object per line):
 *   {"rawBody":"<exact original request body>",
 *    "headers":{"webhook-id":"evt_…","idempotency-key":"idem_…","webhook-signature":"t=…,v1=…"},
 *    "endpoint":"https://…","recordedAt":"2025-01-01T00:00:00.000Z",
 *    "payload":{…},"eventId":"evt_…","idempotencyKey":"idem_…","type":"…","source":"dlq"}
 * `rawBody` (or `body`, or `payload` which gets serialized) is required;
 * `endpoint` may be supplied per-record or via --endpoint.
 *
 * Core logic lives in src/lib/webhooks/replay.ts; this file is a thin CLI
 * plus a self-contained demo receiver for `--demo`.
 */

import { Buffer } from "node:buffer"
import { readFileSync } from "node:fs"
import { createServer } from "node:http"
import { pathToFileURL } from "node:url"

import {
  parseReplayJsonl,
  replayDeliveries,
  summarizeReplayResults,
} from "../../../src/lib/webhooks/replay.ts"
import { buildSignatureHeader, verifySignatureHeader } from "../contract/signing.ts"

/* ------------------------------------------------------------------ */
/* Args                                                                 */
/* ------------------------------------------------------------------ */

const USAGE = `webhook replay — re-deliver recorded webhook payloads

Commands:
  list     Summarize records in a JSONL file (no network).
  replay   Deliver records to their endpoint.
  dry-run  Prepare deliveries (resolve endpoint, idempotency, signing)
           and print what would be sent — no network.

Input (required unless --demo):
  --file <path>          JSONL export of stored webhook deliveries.

Target:
  --endpoint <url>       Endpoint override (else per-record "endpoint").
  --demo                 Use built-in sample records; with 'replay' also
                         starts a local demo receiver when --endpoint is
                         not given.

Delivery control:
  --idempotency <mode>   original (default) | new  — reuse or mint keys.
  --order <mode>         sequential (default) | parallel.
  --concurrency <n>      Workers for --order parallel (default 4).
  --sort <mode>          none (default) | recordedAt.
  --delay-ms <n>         Delay between deliveries per worker (default 0).
  --timeout-ms <n>       Per-request timeout (default 30000).
  --retries <n>          Extra attempts on network errors / 5xx (default 0).
  --limit <n>            Only replay the first n records.
  --offset <n>           Skip the first n records.

Signing:
  --secret <value>       Re-sign each delivery with this HMAC secret
                         (sets a fresh webhook-signature header).

Common:
  --json                 Emit machine-readable JSON instead of tables.
  -h, --help             Show this help.
`

function parseArgs(argv) {
  const args = {
    command: argv[0],
    file: undefined,
    endpoint: undefined,
    demo: false,
    idempotency: "original",
    order: "sequential",
    concurrency: 4,
    sort: "none",
    delayMs: 0,
    timeoutMs: 30_000,
    retries: 0,
    limit: undefined,
    offset: 0,
    secret: undefined,
    json: false,
  }
  const int = (name, value) => {
    const n = Number.parseInt(value, 10)
    if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid ${name}: ${value}`)
    return n
  }
  for (let i = 1; i < argv.length; i += 1) {
    const a = argv[i]
    const next = () => {
      i += 1
      if (i >= argv.length) throw new Error(`Missing value for ${a}`)
      return argv[i]
    }
    switch (a) {
      case "--file":
        args.file = next()
        break
      case "--endpoint":
        args.endpoint = next()
        break
      case "--demo":
        args.demo = true
        break
      case "--idempotency":
        args.idempotency = next()
        break
      case "--order":
        args.order = next()
        break
      case "--concurrency":
        args.concurrency = int(a, next())
        break
      case "--sort":
        args.sort = next()
        break
      case "--delay-ms":
        args.delayMs = int(a, next())
        break
      case "--timeout-ms":
        args.timeoutMs = int(a, next())
        break
      case "--retries":
        args.retries = int(a, next())
        break
      case "--limit":
        args.limit = int(a, next())
        break
      case "--offset":
        args.offset = int(a, next())
        break
      case "--secret":
        args.secret = next()
        break
      case "--json":
        args.json = true
        break
      case "-h":
      case "--help":
        args.help = true
        break
      default:
        throw new Error(`Unknown argument: ${a}`)
    }
  }
  return args
}

function validate(args) {
  if (!["list", "replay", "dry-run"].includes(args.command)) {
    throw new Error(`Unknown command: ${args.command ?? "(none)"}\n\n${USAGE}`)
  }
  if (args.idempotency !== "original" && args.idempotency !== "new") {
    throw new Error(`--idempotency must be original|new, got: ${args.idempotency}`)
  }
  if (args.order !== "sequential" && args.order !== "parallel") {
    throw new Error(`--order must be sequential|parallel, got: ${args.order}`)
  }
  if (args.sort !== "none" && args.sort !== "recordedAt") {
    throw new Error(`--sort must be none|recordedAt, got: ${args.sort}`)
  }
  if (!args.demo && !args.file) {
    throw new Error("Provide --file <path> or --demo.\n\n" + USAGE)
  }
}

/* ------------------------------------------------------------------ */
/* Input                                                                */
/* ------------------------------------------------------------------ */

function loadRecords(args) {
  if (args.demo) return { records: demoRecords(), source: "demo" }
  return { records: null, source: args.file }
}

function applyWindow(records, args) {
  const sliced = records.slice(
    args.offset,
    args.limit === undefined ? undefined : args.offset + args.limit,
  )
  return sliced
}

/* ------------------------------------------------------------------ */
/* Demo fixtures + receiver                                             */
/* ------------------------------------------------------------------ */

const DEMO_SECRET = "whsec_demo_secret"
let demoCounter = 0

function demoEventId() {
  demoCounter += 1
  return `evt_demo_${Date.now().toString(36)}${demoCounter}`
}

function demoPayload(type, object) {
  return {
    id: demoEventId(),
    type,
    apiVersion: "2025-01",
    created: new Date().toISOString(),
    livemode: false,
    idempotencyKey: `idem_demo_${demoCounter}_${Math.random().toString(36).slice(2, 10)}`,
    data: { object },
  }
}

/** Sample records exercising both rawBody and payload-only forms. */
function demoRecords() {
  const contact = demoPayload("contact.form.submitted", {
    name: "Demo User",
    email: "demo@example.com",
    topic: "billing",
    subject: "Demo replay",
    message: "This delivery was produced by `replay.mjs --demo`.",
  })
  const newsletter = demoPayload("newsletter.subscribed", {
    email: "demo+news@example.com",
    source: "demo",
    consent: true,
  })
  const feedback = demoPayload("feedback.submitted", {
    category: "bug",
    message: "Demo feedback event for replay testing.",
  })
  return [
    {
      // Full-fidelity record: exact bytes + recorded headers.
      rawBody: JSON.stringify(contact),
      headers: {
        "webhook-id": contact.id,
        "idempotency-key": contact.idempotencyKey,
        "content-type": "application/json",
      },
      recordedAt: new Date(Date.now() - 60_000).toISOString(),
      type: contact.type,
      source: "demo",
    },
    {
      // Payload-only record: the engine serializes it.
      payload: newsletter,
      endpoint: undefined, // resolved by --endpoint / demo receiver
      recordedAt: new Date(Date.now() - 30_000).toISOString(),
      type: newsletter.type,
      source: "demo",
    },
    {
      // Second run of the same event → exercises duplicate detection when
      // replayed with --idempotency original.
      rawBody: JSON.stringify(contact),
      headers: {
        "webhook-id": contact.id,
        "idempotency-key": contact.idempotencyKey,
        "content-type": "application/json",
      },
      recordedAt: new Date().toISOString(),
      type: contact.type,
      source: "demo",
    },
    {
      payload: feedback,
      recordedAt: new Date().toISOString(),
      type: feedback.type,
      source: "demo",
    },
  ]
}

/**
 * Minimal in-process receiver for --demo: verifies signatures (when a secret
 * is configured), dedupes on Idempotency-Key, and records deliveries.
 */
function startDemoReceiver({ secret, toleranceSeconds = 300 } = {}) {
  const deliveries = []
  const seenKeys = new Set()
  const server = createServer(async (req, res) => {
    const send = (status, body) => {
      const raw = JSON.stringify(body)
      res.writeHead(status, { "content-type": "application/json" })
      res.end(raw)
    }
    if (req.method === "GET" && req.url === "/healthz") return send(200, { ok: true })
    if (req.method !== "POST" || !req.url?.startsWith("/webhooks")) {
      return send(404, { error: "not_found" })
    }
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const rawBody = Buffer.concat(chunks).toString("utf8")

    if (secret) {
      const verification = verifySignatureHeader({
        rawBody,
        signatureHeader: req.headers["webhook-signature"],
        secrets: [secret],
        toleranceSeconds,
      })
      if (!verification.ok) {
        return send(400, { error: "invalid_signature", reason: verification.reason })
      }
    }

    let payload
    try {
      payload = JSON.parse(rawBody)
    } catch {
      return send(400, { error: "invalid_json" })
    }
    const key = req.headers["idempotency-key"] ?? payload?.idempotencyKey ?? payload?.id
    const duplicate = seenKeys.has(key)
    seenKeys.add(key)
    deliveries.push({ receivedAt: new Date().toISOString(), idempotencyKey: key, payload })
    return send(200, { received: true, duplicate, eventId: payload?.id })
  })

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address()
      resolve({
        url: `http://127.0.0.1:${port}/webhooks/inbound`,
        deliveries,
        close: () => new Promise((r) => server.close(r)),
      })
    })
  })
}

/* ------------------------------------------------------------------ */
/* Commands                                                             */
/* ------------------------------------------------------------------ */

function printUsageAndExit() {
  console.log(USAGE)
  process.exit(0)
}

async function cmdList(args, records, source) {
  if (args.json) {
    console.log(
      JSON.stringify(
        records.map((r, i) => ({
          index: i,
          eventId: r.eventId ?? extractId(r),
          type: r.type ?? extractType(r),
          idempotencyKey: r.idempotencyKey ?? extractIdem(r),
          recordedAt: r.recordedAt,
          endpoint: r.endpoint,
          source: r.source,
        })),
        null,
        2,
      ),
    )
    return 0
  }
  console.log(`\n${records.length} record(s)${source ? ` from ${source}` : ""}\n`)
  console.log(
    [
      "idx".padEnd(5),
      "recordedAt".padEnd(26),
      "eventId".padEnd(24),
      "type".padEnd(30),
      "idempotencyKey".padEnd(24),
      "endpoint",
    ].join("  "),
  )
  records.forEach((r, i) => {
    console.log(
      [
        String(i).padEnd(5),
        String(r.recordedAt ?? "-").padEnd(26),
        String(r.eventId ?? extractId(r) ?? "-").padEnd(24),
        String(r.type ?? extractType(r) ?? "-").padEnd(30),
        String(r.idempotencyKey ?? extractIdem(r) ?? "-").padEnd(24),
        r.endpoint ?? "(per-record none)",
      ].join("  "),
    )
  })
  console.log("")
  return 0
}

function extractField(record, field) {
  const body = record.rawBody ?? record.body
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body)
      if (parsed && typeof parsed === "object" && typeof parsed[field] === "string") {
        return parsed[field]
      }
    } catch {
      /* ignore */
    }
  }
  if (record.payload && typeof record.payload === "object") {
    const v = record.payload[field]
    if (typeof v === "string") return v
  }
  return undefined
}
const extractId = (r) => r.eventId ?? extractField(r, "id")
const extractType = (r) => r.type ?? extractField(r, "type")
const extractIdem = (r) => r.idempotencyKey ?? extractField(r, "idempotencyKey")

async function cmdReplay(args, records, parseErrors, source) {
  const isDryRun = args.command === "dry-run"
  let demoReceiver = null

  // --demo without --endpoint: stand up the local receiver so deliveries
  // (and dry-run endpoint resolution) have a real target.
  if (args.demo && !args.endpoint) {
    demoReceiver = await startDemoReceiver({ secret: args.secret ?? DEMO_SECRET })
    args.endpoint = demoReceiver.url
    args.secret = args.secret ?? DEMO_SECRET
    console.error(`[demo] receiver listening at ${demoReceiver.url}`)
    console.error(`[demo] signing with secret ${args.secret}`)
  }

  const options = {
    endpoint: args.endpoint,
    idempotency: args.idempotency,
    order: args.order,
    concurrency: args.concurrency,
    sort: args.sort,
    delayMs: args.delayMs,
    timeoutMs: args.timeoutMs,
    retries: args.retries,
    dryRun: isDryRun,
    signer: args.secret
      ? (rawBody) => ({ "webhook-signature": buildSignatureHeader(args.secret, rawBody) })
      : undefined,
  }

  const started = Date.now()
  const results = await replayDeliveries(records, {
    ...options,
    onProgress: args.json
      ? undefined
      : (r, i, total) => {
          const tag = r.status.toUpperCase().padEnd(9)
          console.error(
            `[${String(i + 1).padStart(String(total).length)}] ${tag} ${r.eventId ?? "-"} ${r.error ?? ""}`,
          )
        },
  })
  const elapsed = Date.now() - started
  const summary = summarizeReplayResults(results)

  if (args.json) {
    console.log(
      JSON.stringify({ source, dryRun: isDryRun, elapsedMs: elapsed, summary, results }, null, 2),
    )
  } else {
    console.log(
      `\n${isDryRun ? "Dry run" : "Replay"} complete in ${elapsed}ms — ${records.length} record(s) from ${source}`,
    )
    console.log(
      `  delivered: ${summary.delivered}  duplicate: ${summary.duplicate}  failed: ${summary.failed}  skipped: ${summary.skipped}  dry-run: ${summary["dry-run"]}`,
    )
    if (isDryRun) console.log("  (no requests were sent — re-run without dry-run to deliver)")
    if (parseErrors.length > 0) {
      console.log(`  parse errors: ${parseErrors.length} malformed line(s) skipped`)
    }
    const failures = results.filter((r) => r.status === "failed" || r.status === "skipped")
    if (failures.length > 0 && !args.json) {
      console.log("\nFailures:")
      for (const f of failures) {
        console.log(
          `  [${f.index}] ${f.status} ${f.eventId ?? "-"} ${f.error ?? ""} ${f.endpoint ?? ""}`,
        )
      }
    }
    if (demoReceiver && !isDryRun) {
      console.log(`\nDemo receiver recorded ${demoReceiver.deliveries.length} deliveries:`)
      for (const d of demoReceiver.deliveries) {
        console.log(`  ${d.receivedAt}  key=${d.idempotencyKey}  type=${d.payload?.type ?? "?"}`)
      }
    }
    console.log("")
  }

  if (demoReceiver) await demoReceiver.close()
  return summary.failed > 0 || parseErrors.length > 0 ? 1 : 0
}

/* ------------------------------------------------------------------ */
/* Main                                                                 */
/* ------------------------------------------------------------------ */

async function main() {
  const argv = process.argv.slice(2)
  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    printUsageAndExit()
  }
  const args = parseArgs(argv)
  validate(args)

  const { records: demo, source: demoSource } = loadRecords(args)
  let records = demo
  let source = demoSource
  let parseErrors = []

  if (!args.demo) {
    const text = readFileSync(args.file, "utf8")
    const parsed = parseReplayJsonl(text)
    records = parsed.records
    parseErrors = parsed.errors
    if (parseErrors.length > 0) {
      console.error(`Warning: ${parseErrors.length} malformed line(s) skipped:`)
      for (const e of parseErrors.slice(0, 10)) console.error(`  line ${e.line}: ${e.message}`)
    }
  }

  records = applyWindow(records, args)

  if (args.command === "list") {
    process.exitCode = await cmdList(args, records, source)
    return
  }
  process.exitCode = await cmdReplay(args, records, parseErrors, source)
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main().catch((err) => {
    console.error(`error: ${err instanceof Error ? err.message : err}`)
    process.exit(2)
  })
}
