#!/usr/bin/env node
import { Buffer } from "node:buffer"
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

import {
  buildRotationSignatureHeader,
  buildSignatureHeader,
  freshenPayload,
  listFixtures,
  loadFixture,
  parseArgs,
} from "./lib.mjs"

/**
 * Webhook event sender — fires contract-shaped deliveries at any endpoint.
 *
 *   node scripts/webhooks/test-tools/send.mjs \
 *     --url http://localhost:4100/api/webhooks/test \
 *     --secret whsec_test \
 *     --event newsletter.subscribed
 *
 * Options:
 *   --url <url>        target endpoint (required)
 *   --secret <value>   signing secret (required unless --mode missing/malformed/raw)
 *   --event <name>     fixture name = event type, e.g. contact.form.submitted
 *   --fixture <name>   alias for --event (any file in fixtures/, incl. *.bad-*)
 *   --mode <mode>      valid | wrong-secret | stale | tampered | malformed |
 *                      missing | rotation | raw   (default: valid)
 *   --raw <file|->     send a literal body instead of a fixture (--mode raw only;
 *                      "-" reads stdin)
 *   --repeat <n>       send n times (default 1)
 *   --delay <ms>       pause between repeats
 *   --exact            do not freshen id/idempotencyKey/created (replays fixture verbatim)
 *   --header K=V       extra header, repeatable
 *   --list             print available fixtures and exit
 *
 * Modes exercise the rejection paths a real endpoint must implement:
 *   wrong-secret  signed with a different secret          → no_matching_signature
 *   stale         timestamp 1h old                        → timestamp_out_of_tolerance
 *   tampered      signed body, then body mutated          → no_matching_signature
 *   malformed     Webhook-Signature: not-a-signature-header → malformed_header
 *   missing       no signature header at all              → missing_signature
 *   rotation      two v1 signatures, one bogus             → still accepted
 *   raw           literal body, unsigned unless --secret given (then signed)
 */

const MODES = [
  "valid",
  "wrong-secret",
  "stale",
  "tampered",
  "malformed",
  "missing",
  "rotation",
  "raw",
]

function usage(exitCode = 0) {
  console.log(`Usage: node scripts/webhooks/test-tools/send.mjs --url <url> [options]

  --event <name>     fixture/event type (see --list)
  --secret <value>   signing secret
  --mode <mode>      ${MODES.join(" | ")} (default: valid)
  --repeat <n>       send n times (default 1)
  --delay <ms>       pause between repeats
  --exact            replay fixture verbatim (keeps id + idempotencyKey → duplicate)
  --raw <file|->     literal body instead of a fixture
  --header K=V       extra header (repeatable)
  --list             list fixtures
`)
  process.exit(exitCode)
}

async function main() {
  const args = parseArgs(process.argv.slice(2), {
    booleanFlags: ["exact", "list"],
    repeatableFlags: ["secret", "header"],
  })

  if (args.list || args.help || args.h) {
    console.log("Available fixtures (fixtures/*.json):")
    for (const f of listFixtures()) console.log(`  ${f}`)
    process.exit(0)
  }
  if (!args.url) {
    console.error("Missing --url <target endpoint>\n")
    usage(1)
  }

  const mode = args.mode ?? "valid"
  if (!MODES.includes(mode)) {
    console.error(`Unknown --mode "${mode}". Valid: ${MODES.join(", ")}`)
    process.exit(1)
  }

  // Resolve body: fixture payload or raw literal.
  let rawBody
  let payload
  if (args.raw) {
    const source = args.raw === "-" ? await readStdin() : readFileSync(args.raw, "utf8")
    rawBody = source
    try {
      payload = JSON.parse(rawBody)
    } catch {
      payload = undefined
    }
  } else {
    const name = args.fixture ?? args.event ?? args._[0]
    if (!name) {
      console.error(
        "Missing --event <fixture name> (or --raw <file>). Use --list to see fixtures.\n",
      )
      usage(1)
    }
    payload = loadFixture(name)
    if (mode === "raw") {
      console.error("--mode raw requires --raw <file|->; use --event for fixture modes.")
      process.exit(1)
    }
  }

  const repeat = Math.max(1, Number.parseInt(args.repeat ?? "1", 10) || 1)
  const delayMs = Number.parseInt(args.delay ?? "0", 10) || 0
  const exact = Boolean(args.exact)
  const secrets = args.secret ?? []
  const secret = secrets[0]

  if (["valid", "stale", "tampered", "rotation"].includes(mode) && !secret) {
    console.error(`Mode "${mode}" needs --secret <value> to sign with.`)
    process.exit(1)
  }

  const extraHeaders = {}
  for (const h of args.header ?? []) {
    const eq = h.indexOf("=")
    if (eq === -1) {
      console.error(`Bad --header "${h}" (expected K=V)`)
      process.exit(1)
    }
    extraHeaders[h.slice(0, eq)] = h.slice(eq + 1)
  }

  let failures = 0
  for (let i = 0; i < repeat; i += 1) {
    const current = exact || mode === "raw" ? payload : freshenPayload(payload)
    const bodyForSign = JSON.stringify(current)
    let rawBody = bodyForSign
    const now = Math.floor(Date.now() / 1000)

    let signatureHeader
    switch (mode) {
      case "valid":
        signatureHeader = buildSignatureHeader(secret, rawBody)
        break
      case "rotation":
        signatureHeader = buildRotationSignatureHeader(secret, rawBody)
        break
      case "wrong-secret":
        signatureHeader = buildSignatureHeader("whsec_definitely_wrong", rawBody)
        break
      case "stale":
        signatureHeader = buildSignatureHeader(secret, rawBody, now - 3600)
        break
      case "tampered":
        signatureHeader = buildSignatureHeader(secret, rawBody)
        rawBody = rawBody.replace(/"consent":\s*true/, '"consent":false')
        if (rawBody === bodyForSign) rawBody = `${rawBody} `
        break
      case "malformed":
        signatureHeader = "not-a-signature-header"
        break
      case "missing":
        signatureHeader = undefined
        break
      case "raw":
        signatureHeader = secret ? buildSignatureHeader(secret, rawBody) : undefined
        break
    }

    const headers = { "content-type": "application/json", ...extraHeaders }
    if (signatureHeader !== undefined) headers["webhook-signature"] = signatureHeader
    if (current?.id) headers["webhook-id"] = current.id
    if (current?.idempotencyKey) headers["idempotency-key"] = current.idempotencyKey

    const res = await fetch(args.url, { method: "POST", headers, body: rawBody })
    const text = await res.text()
    const tag = res.ok ? "ok  " : "FAIL"
    if (!res.ok) failures += 1
    console.log(
      `${tag} [${i + 1}/${repeat}] ${mode} ${args.fixture ?? args.event ?? "raw"} → HTTP ${res.status} ${text.slice(0, 200)}`,
    )

    if (delayMs > 0 && i + 1 < repeat) await new Promise((r) => setTimeout(r, delayMs))
  }

  if (failures > 0 && ["valid", "rotation"].includes(mode)) {
    // valid/rotation are expected to succeed; anything else is informational.
    console.error(`\n${failures} delivery(ies) rejected — check the receiver's accepted secrets.`)
    process.exit(2)
  }
  process.exit(0)
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = []
    process.stdin.on("data", (c) => chunks.push(c))
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    process.stdin.on("error", reject)
  })
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main().catch((err) => {
    console.error(err?.message ?? err)
    process.exit(1)
  })
}
