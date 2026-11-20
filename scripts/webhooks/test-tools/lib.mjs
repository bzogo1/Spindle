import { Buffer } from "node:buffer"
import { createHmac, timingSafeEqual } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Shared helpers for the webhook testing tools. Plain .mjs on purpose — the
 * tools must run offline with `node` alone (no tsx, no deps). The signature
 * scheme here is a byte-for-byte mirror of
 * scripts/webhooks/contract/signing.ts; if that contract changes, update
 * both. Contract schema/payload truth lives in scripts/webhooks/contract/.
 */

export const SIGNATURE_TOLERANCE_SECONDS = 300

const here = dirname(fileURLToPath(import.meta.url))
export const FIXTURES_DIR = join(here, "fixtures")

/** HMAC-SHA256 hex of `${timestamp}.${rawBody}` — mirrors contract signing.ts. */
export function signPayload(secret, timestampSeconds, rawBody) {
  return createHmac("sha256", secret).update(`${timestampSeconds}.${rawBody}`, "utf8").digest("hex")
}

export function buildSignatureHeader(
  secret,
  rawBody,
  timestampSeconds = Math.floor(Date.now() / 1000),
) {
  return `t=${timestampSeconds},v1=${signPayload(secret, timestampSeconds, rawBody)}`
}

/** Header carrying two v1 signatures (current + decoy) — rotation tolerance test. */
export function buildRotationSignatureHeader(
  secret,
  rawBody,
  timestampSeconds = Math.floor(Date.now() / 1000),
) {
  const good = signPayload(secret, timestampSeconds, rawBody)
  const decoy = signPayload("whsec_previous_decoy", timestampSeconds, rawBody)
  return `t=${timestampSeconds},v1=${decoy},v1=${good}`
}

/**
 * Minimal mirror of contract verifySignatureHeader — enough for the local
 * receiver to label deliveries accepted/rejected like a real endpoint.
 */
export function verifySignatureHeader({
  rawBody,
  signatureHeader,
  secrets,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS,
}) {
  if (!signatureHeader) return { ok: false, reason: "missing_signature" }

  let timestamp = null
  const signatures = []
  for (const part of signatureHeader.split(",")) {
    const eq = part.indexOf("=")
    if (eq === -1) return { ok: false, reason: "malformed_header" }
    const key = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (key === "t") {
      if (!/^\d+$/.test(value)) return { ok: false, reason: "malformed_header" }
      timestamp = Number.parseInt(value, 10)
    } else if (key === "v1") {
      if (!/^[0-9a-f]{64}$/i.test(value)) return { ok: false, reason: "malformed_header" }
      signatures.push(value.toLowerCase())
    }
  }
  if (timestamp === null || signatures.length === 0)
    return { ok: false, reason: "malformed_header" }
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds)
    return { ok: false, reason: "timestamp_out_of_tolerance" }

  for (const secret of secrets) {
    const expected = signPayload(secret, timestamp, rawBody)
    if (signatures.some((candidate) => safeEqual(candidate, expected))) {
      return { ok: true, timestamp }
    }
  }
  return { ok: false, reason: "no_matching_signature" }
}

function safeEqual(left, right) {
  const a = Buffer.from(left, "utf8")
  const b = Buffer.from(right, "utf8")
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Lists fixture basenames (without .json) in fixtures/. */
export function listFixtures() {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .sort()
}

/** Loads a fixture by event type or basename; throws with the known list. */
export function loadFixture(name) {
  const file = join(FIXTURES_DIR, `${name}.json`)
  try {
    return JSON.parse(readFileSync(file, "utf8"))
  } catch {
    throw new Error(`Unknown fixture "${name}". Available:\n  ${listFixtures().join("\n  ")}`)
  }
}

/**
 * Regenerates the replay-sensitive envelope fields so repeated sends of the
 * same fixture are not flagged as duplicates: new `id`, `idempotencyKey`,
 * fresh `created`. Returns a new object; the fixture file is untouched.
 */
export function freshenPayload(payload) {
  const rand = (n) =>
    Math.random()
      .toString(36)
      .slice(2, 2 + n)
  return {
    ...payload,
    id: `evt_test_${Date.now().toString(36)}${rand(8)}`,
    created: new Date().toISOString(),
    idempotencyKey: `idem_${Date.now().toString(36)}_${rand(10)}`,
  }
}

/** Minimal `--flag value` / `--flag` arg parser shared by the CLIs. */
export function parseArgs(argv, { booleanFlags = [], repeatableFlags = [] } = {}) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg.startsWith("--")) {
      const key = arg.slice(2)
      if (booleanFlags.includes(key)) {
        out[key] = true
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        const value = argv[i + 1]
        i += 1
        if (repeatableFlags.includes(key)) {
          ;(out[key] ??= []).push(value)
        } else {
          out[key] = value
        }
      } else {
        out[key] = true
      }
    } else {
      out._.push(arg)
    }
  }
  return out
}
