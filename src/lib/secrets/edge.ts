import { createHash } from "node:crypto"

import { signWithKeyring, verifyWithKeyring, type Keyring } from "./keyring"

/**
 * The edge signs every request it forwards to the origin. The origin verifies
 * with the current key and, during a rotation window, the previous key.
 */
export type EdgeRequest = {
  method: string
  path: string
  body?: string | Uint8Array
  timestamp: number | string
  signature: string
}

export type EdgeVerification =
  | { ok: true; key: "current" | "previous" }
  | { ok: false; reason: "malformed" | "expired" | "invalid-signature" }

const DEFAULT_MAX_SKEW_SECONDS = 5 * 60
const SIGNATURE_PREFIX = "v1="

/** Builds the canonical string that both the edge and the origin sign. */
export function edgeCanonicalRequest(request: {
  method: string
  path: string
  body?: string | Uint8Array
  timestamp: number | string
}): string {
  const method = request.method.toUpperCase()
  const path = request.path.startsWith("/") ? request.path : `/${request.path}`
  const bodyHash = createHash("sha256")
    .update(request.body ?? "")
    .digest("hex")

  return ["v1", method, path, String(request.timestamp), bodyHash].join("\n")
}

export function signEdgeRequest(
  request: {
    method: string
    path: string
    body?: string | Uint8Array
    timestamp?: number
  },
  options: { keyring: Keyring; now?: number },
): { timestamp: string; signature: string } {
  const timestamp = String(request.timestamp ?? options.now ?? Math.floor(Date.now() / 1000))
  const canonical = edgeCanonicalRequest({ ...request, timestamp })

  return {
    timestamp,
    signature: `${SIGNATURE_PREFIX}${signWithKeyring(options.keyring, canonical)}`,
  }
}

export function verifyEdgeRequest(
  request: EdgeRequest,
  options: { keyring: Keyring; now?: number; maxSkewSeconds?: number },
): EdgeVerification {
  const timestamp =
    typeof request.timestamp === "number" ? request.timestamp : Number(request.timestamp)

  if (!Number.isInteger(timestamp) || timestamp <= 0) return { ok: false, reason: "malformed" }
  if (!request.signature.startsWith(SIGNATURE_PREFIX)) return { ok: false, reason: "malformed" }

  const now = options.now ?? Math.floor(Date.now() / 1000)
  const maxSkew = options.maxSkewSeconds ?? DEFAULT_MAX_SKEW_SECONDS

  if (Math.abs(now - timestamp) > maxSkew) return { ok: false, reason: "expired" }

  const canonical = edgeCanonicalRequest({ ...request, timestamp })
  const key = verifyWithKeyring(
    options.keyring,
    canonical,
    request.signature.slice(SIGNATURE_PREFIX.length),
  )

  if (!key) return { ok: false, reason: "invalid-signature" }

  return { ok: true, key }
}
