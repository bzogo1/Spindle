import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { pathToFileURL } from "node:url"

import { webhookPayloadSchema, webhookHeadersSchema } from "./schemas"
import { verifySignatureHeader, SIGNATURE_TOLERANCE_SECONDS } from "./signing"

/**
 * Mock webhook receiver.
 *
 * Two uses:
 *  1. Standalone script — point a sender (or the contract delivery test) at
 *     it and inspect what arrived:
 *       npx tsx scripts/webhooks/contract/receiver.ts --port 4100 --secret whsec_test
 *       curl localhost:4100/_deliveries
 *  2. In-process — `createWebhookReceiver()` returns a handle the vitest
 *     suite starts on an ephemeral port (see delivery.test.ts).
 *
 * Behaviour mirrors the contract a real `src/app/api/webhooks/*` endpoint
 * must implement: verify signature → parse/validate payload → dedupe on
 * Idempotency-Key / event id → 200.
 */

export type RecordedDelivery = {
  receivedAt: string
  remoteAddress: string | undefined
  headers: Record<string, string | string[] | undefined>
  rawBody: string
  payload?: unknown
  idempotencyKey?: string
  signatureTimestamp?: number
  /** `true` when the Idempotency-Key was already seen for this receiver. */
  duplicate: boolean
}

export type WebhookReceiverOptions = {
  /** Secrets accepted for signature verification; first is "current". */
  secrets: readonly string[]
  /** Signature timestamp tolerance; defaults to the contract value (300s). */
  toleranceSeconds?: number
  /** Max raw body bytes; defaults to 256 KiB. */
  maxBodyBytes?: number
}

export type WebhookReceiver = {
  server: Server
  deliveries: RecordedDelivery[]
  url: string
  start: () => Promise<string>
  stop: () => Promise<void>
  reset: () => void
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(new Error("payload_too_large"))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const raw = JSON.stringify(body)
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(raw),
  })
  res.end(raw)
}

export function createWebhookReceiver(options: WebhookReceiverOptions): WebhookReceiver {
  const {
    secrets,
    toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS,
    maxBodyBytes = 256 * 1024,
  } = options
  const deliveries: RecordedDelivery[] = []
  const seenIdempotencyKeys = new Set<string>()

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost")

    // Inspection/reset endpoints for tests and manual debugging.
    if (req.method === "GET" && url.pathname === "/_deliveries") {
      sendJson(res, 200, { deliveries })
      return
    }
    if (req.method === "POST" && url.pathname === "/_reset") {
      deliveries.length = 0
      seenIdempotencyKeys.clear()
      sendJson(res, 200, { reset: true })
      return
    }
    if (req.method === "GET" && url.pathname === "/healthz") {
      sendJson(res, 200, { ok: true })
      return
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" })
      return
    }

    let rawBody: string
    try {
      rawBody = await readBody(req, maxBodyBytes)
    } catch {
      sendJson(res, 413, { error: "payload_too_large" })
      return
    }

    const headers = req.headers as Record<string, string | string[] | undefined>

    // 1. Signature verification against the raw bytes.
    const signatureHeader =
      typeof headers["webhook-signature"] === "string" ? headers["webhook-signature"] : undefined
    const verification = verifySignatureHeader({
      rawBody,
      signatureHeader,
      secrets,
      toleranceSeconds,
    })
    if (!verification.ok) {
      sendJson(res, 400, { error: "invalid_signature", reason: verification.reason })
      return
    }

    // 2. Header contract.
    const headerCheck = webhookHeadersSchema.safeParse({
      "webhook-id": headers["webhook-id"],
      "webhook-signature": signatureHeader,
      "idempotency-key": headers["idempotency-key"],
      "content-type": headers["content-type"],
    })
    if (!headerCheck.success) {
      sendJson(res, 400, { error: "invalid_headers" })
      return
    }

    // 3. Payload contract.
    let json: unknown
    try {
      json = JSON.parse(rawBody)
    } catch {
      sendJson(res, 400, { error: "invalid_json" })
      return
    }
    const payloadCheck = webhookPayloadSchema.safeParse(json)
    if (!payloadCheck.success) {
      sendJson(res, 400, { error: "invalid_payload" })
      return
    }

    // webhook-id header (when present as a string) must match payload.id.
    const webhookId = headers["webhook-id"]
    if (typeof webhookId === "string" && webhookId !== payloadCheck.data.id) {
      sendJson(res, 400, { error: "event_id_mismatch" })
      return
    }

    // 4. Idempotency: same key (header or payload) → acknowledge, don't reprocess.
    const idempotencyKey =
      (typeof headers["idempotency-key"] === "string" ? headers["idempotency-key"] : undefined) ??
      payloadCheck.data.idempotencyKey
    const duplicate = seenIdempotencyKeys.has(idempotencyKey)
    seenIdempotencyKeys.add(idempotencyKey)

    deliveries.push({
      receivedAt: new Date().toISOString(),
      remoteAddress: req.socket.remoteAddress,
      headers,
      rawBody,
      payload: payloadCheck.data,
      idempotencyKey,
      signatureTimestamp: verification.timestamp,
      duplicate,
    })

    sendJson(res, 200, {
      received: true,
      duplicate,
      eventId: payloadCheck.data.id,
      deliveries: deliveries.length,
    })
  })

  const receiver: WebhookReceiver = {
    server,
    deliveries,
    url: "",
    start: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject)
        server.listen(0, "127.0.0.1", () => {
          const { port } = server.address() as AddressInfo
          receiver.url = `http://127.0.0.1:${port}`
          resolve(receiver.url)
        })
      }),
    stop: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
    reset: () => {
      deliveries.length = 0
      seenIdempotencyKeys.clear()
    },
  }

  return receiver
}

/* ------------------------------------------------------------------ */
/* CLI entrypoint                                                      */
/* ------------------------------------------------------------------ */

function parseArgs(argv: string[]): { port: number; secrets: string[] } {
  let port = 4100
  const secrets: string[] = []

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--port" && argv[i + 1]) {
      port = Number.parseInt(argv[i + 1], 10)
      i += 1
    } else if (argv[i] === "--secret" && argv[i + 1]) {
      secrets.push(argv[i + 1])
      i += 1
    }
  }

  if (secrets.length === 0) {
    throw new Error(
      "No secrets configured. Pass one or more --secret <value> arguments " +
        "(repeat for rotation: --secret new --secret old).",
    )
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port: ${port}`)
  }
  return { port, secrets }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const { port, secrets } = parseArgs(process.argv.slice(2))
  const receiver = createWebhookReceiver({ secrets })
  receiver.server.listen(port, "0.0.0.0", () => {
    console.log(
      `[webhook-receiver] listening on http://0.0.0.0:${port} ` +
        `(accepting ${secrets.length} secret(s); GET /_deliveries to inspect)`,
    )
  })
  process.on("SIGINT", () => receiver.stop().then(() => process.exit(0)))
  process.on("SIGTERM", () => receiver.stop().then(() => process.exit(0)))
}
