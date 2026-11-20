"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ShieldCheck } from "lucide-react"

import { useLanguage } from "@/components/i18n/language-provider"

/**
 * Auto-solving proof-of-work CAPTCHA widget.
 *
 * On mount it fetches a challenge from `GET /api/auth/captcha`, brute-forces a
 * nonce such that `sha256(prefix + nonce)` has `difficulty` leading zero bits
 * (chunked async loop so the UI stays responsive), then exchanges the
 * solution at `POST /api/auth/captcha/verify` for a short-lived captcha token
 * handed to `onToken`.
 *
 * The solver uses a small pure-JS SHA-256 (single/double-block fast path) so
 * it works everywhere — no WebCrypto, no worker, no external service. If
 * anything fails the widget shows a retry button instead of blocking the
 * form; callers decide whether a missing token blocks submission.
 */

// ---------------------------------------------------------------------------
// Minimal SHA-256 (public-domain style constants, compact implementation)
// ---------------------------------------------------------------------------

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))

/** Compresses one or more 64-byte blocks starting at `offset` into `state`. */
function sha256Compress(state: Uint32Array, data: Uint8Array, offset: number, blocks: number) {
  const w = new Uint32Array(64)
  for (let block = 0; block < blocks; block++) {
    const base = offset + block * 64
    for (let i = 0; i < 16; i++) {
      const j = base + i * 4
      w[i] = ((data[j] << 24) | (data[j + 1] << 16) | (data[j + 2] << 8) | data[j + 3]) >>> 0
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }

    let [a, b, c, d, e, f, g, h] = state as unknown as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ]
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + s1 + ch + SHA256_K[i] + w[i]) >>> 0
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (s0 + maj) >>> 0
      h = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    state[0] = (state[0] + a) >>> 0
    state[1] = (state[1] + b) >>> 0
    state[2] = (state[2] + c) >>> 0
    state[3] = (state[3] + d) >>> 0
    state[4] = (state[4] + e) >>> 0
    state[5] = (state[5] + f) >>> 0
    state[6] = (state[6] + g) >>> 0
    state[7] = (state[7] + h) >>> 0
  }
}

const INITIAL_STATE = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
])

/**
 * SHA-256 over `message`, returned as the raw 32-byte digest. `scratch` is a
 * reusable padded-message buffer (must be >= message length + 72 bytes).
 */
function sha256Digest(message: Uint8Array, scratch: Uint8Array): Uint8Array {
  const bitLengthHi = Math.floor(message.length / 0x20000000)
  const bitLengthLo = (message.length << 3) >>> 0
  const paddedLength = (((message.length + 8) >> 6) + 1) << 6
  scratch.set(message)
  scratch[message.length] = 0x80
  scratch.fill(0, message.length + 1, paddedLength - 8)
  // 64-bit big-endian bit length (messages here are far below 2^32 bits).
  scratch[paddedLength - 8] = (bitLengthHi >>> 24) & 0xff
  scratch[paddedLength - 7] = (bitLengthHi >>> 16) & 0xff
  scratch[paddedLength - 6] = (bitLengthHi >>> 8) & 0xff
  scratch[paddedLength - 5] = bitLengthHi & 0xff
  scratch[paddedLength - 4] = (bitLengthLo >>> 24) & 0xff
  scratch[paddedLength - 3] = (bitLengthLo >>> 16) & 0xff
  scratch[paddedLength - 2] = (bitLengthLo >>> 8) & 0xff
  scratch[paddedLength - 1] = bitLengthLo & 0xff

  const state = Uint32Array.from(INITIAL_STATE)
  sha256Compress(state, scratch, 0, paddedLength / 64)
  const digest = new Uint8Array(32)
  for (let i = 0; i < 8; i++) {
    digest[i * 4] = (state[i] >>> 24) & 0xff
    digest[i * 4 + 1] = (state[i] >>> 16) & 0xff
    digest[i * 4 + 2] = (state[i] >>> 8) & 0xff
    digest[i * 4 + 3] = state[i] & 0xff
  }
  return digest
}

/** True when `digest` starts with at least `bits` zero bits. Early-exits. */
function hasLeadingZeroBits(digest: Uint8Array, bits: number): boolean {
  let remaining = bits
  for (const byte of digest) {
    if (remaining <= 0) return true
    if (byte === 0) {
      remaining -= 8
      continue
    }
    for (let mask = 0x80; mask !== 0 && remaining > 0; mask >>= 1) {
      if (byte & mask) return false
      remaining -= 1
    }
    return remaining <= 0
  }
  return remaining <= 0
}

// ---------------------------------------------------------------------------
// Solver
// ---------------------------------------------------------------------------

const YIELD_EVERY = 4096

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Hard ceiling on accepted difficulty. The server issues ~20 bits; anything
 * above 28 bits would take minutes even on fast hardware, so treat it as a
 * malformed/malicious challenge rather than solving it.
 */
export const MAX_CAPTCHA_DIFFICULTY = 28

/**
 * Finds `nonce` (decimal string) such that sha256(prefix + nonce) has at
 * least `difficulty` leading zero bits. Calls `onProgress(attempts)` at most
 * once per yield chunk so callers can show liveness without re-render spam.
 * Throws when `deadlineMs` (epoch ms) passes before a solution is found.
 */
export async function solveProofOfWork(
  prefix: string,
  difficulty: number,
  onProgress?: (attempts: number) => void,
  deadlineMs?: number,
): Promise<string> {
  const prefixBytes = new TextEncoder().encode(prefix)
  // prefix + nonce(<=15 digits) + padding stays well under 2 blocks.
  const scratch = new Uint8Array(256)
  const message = new Uint8Array(128)
  scratch.set(prefixBytes)

  let nonce = 0
  for (;;) {
    const digits = String(nonce)
    const msgLen = prefixBytes.length + digits.length
    // No need to clear `message`: only `subarray(0, msgLen)` is hashed and the
    // padding region inside `scratch` is rewritten every iteration.
    message.set(prefixBytes)
    for (let i = 0; i < digits.length; i++) message[prefixBytes.length + i] = digits.charCodeAt(i)
    // sha256Digest pads `message` itself; pass the exact slice length.
    const digest = sha256Digest(message.subarray(0, msgLen), scratch)
    if (hasLeadingZeroBits(digest, difficulty)) return digits

    nonce += 1
    if (nonce % YIELD_EVERY === 0) {
      onProgress?.(nonce)
      if (deadlineMs !== undefined && Date.now() > deadlineMs) {
        throw new Error("Captcha challenge expired before it could be solved.")
      }
      await yieldToUi()
    }
  }
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

type CaptchaChallengeResponse = {
  challengeId?: string
  prefix?: string
  difficulty?: number
  expiresAt?: string
}

type CaptchaStatus = "solving" | "verified" | "error"

export type CaptchaWidgetProps = {
  /** Called with the minted token once the challenge is solved + verified. */
  onToken: (token: string | null) => void
  /** Optional status callback so parents can gate submit buttons. */
  onStatusChange?: (status: CaptchaStatus) => void
}

async function fetchJson(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  })
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok || payload.ok === false) {
    throw new Error(typeof payload.message === "string" ? payload.message : "captcha failed")
  }
  return payload
}

export function CaptchaWidget({ onToken, onStatusChange }: CaptchaWidgetProps) {
  const { t } = useLanguage()
  const [status, setStatus] = useState<CaptchaStatus>("solving")
  const [attempts, setAttempts] = useState(0)
  const [runId, setRunId] = useState(0)
  const onTokenRef = useRef(onToken)
  const onStatusRef = useRef(onStatusChange)
  onTokenRef.current = onToken
  onStatusRef.current = onStatusChange

  const setStatusBoth = useCallback((next: CaptchaStatus) => {
    setStatus(next)
    onStatusRef.current?.(next)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function run() {
      setStatusBoth("solving")
      onTokenRef.current(null)
      try {
        const challenge = (await fetchJson("/api/auth/captcha", {
          method: "GET",
        })) as CaptchaChallengeResponse
        if (typeof challenge.challengeId !== "string" || typeof challenge.prefix !== "string") {
          throw new Error("Malformed captcha challenge.")
        }
        const difficulty = challenge.difficulty
        if (
          typeof difficulty !== "number" ||
          !Number.isInteger(difficulty) ||
          difficulty < 1 ||
          difficulty > MAX_CAPTCHA_DIFFICULTY
        ) {
          throw new Error("Unsupported captcha difficulty.")
        }

        // Stop solving before the challenge itself expires — leave a buffer
        // for the verify round-trip. Missing/invalid expiresAt falls back to
        // a conservative 4-minute budget.
        const expiresMs = Date.parse(challenge.expiresAt ?? "")
        const deadlineMs = Number.isFinite(expiresMs)
          ? expiresMs - 10_000
          : Date.now() + 4 * 60 * 1000
        if (Date.now() > deadlineMs) {
          throw new Error("Captcha challenge already expired.")
        }

        const nonce = await solveProofOfWork(
          challenge.prefix,
          difficulty,
          (count) => {
            if (!cancelled) setAttempts(count)
          },
          deadlineMs,
        )
        if (cancelled) return
        if (Date.now() > deadlineMs) {
          throw new Error("Captcha challenge expired before it could be solved.")
        }

        const verified = await fetchJson("/api/auth/captcha/verify", {
          method: "POST",
          body: JSON.stringify({ challengeId: challenge.challengeId, nonce }),
        })
        if (cancelled) return
        if (typeof verified.token !== "string") throw new Error("Missing captcha token.")

        onTokenRef.current(verified.token)
        setStatusBoth("verified")
      } catch {
        if (!cancelled) {
          onTokenRef.current(null)
          setStatusBoth("error")
        }
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [runId, setStatusBoth])

  if (status === "verified") {
    return (
      <p className="ui-inline-note" role="status">
        <ShieldCheck className="size-3.5" aria-hidden="true" /> {t("auth.captcha.passed")}
      </p>
    )
  }

  if (status === "error") {
    return (
      <div className="ui-inline-note" role="alert">
        <span>{t("auth.captcha.failed")}</span>{" "}
        <button
          type="button"
          className="auth-link-button"
          onClick={() => {
            setAttempts(0)
            setRunId((id) => id + 1)
          }}
        >
          {t("auth.captcha.retry")}
        </button>
      </div>
    )
  }

  return (
    <p className="ui-inline-note" role="status" aria-live="polite">
      <span className="auth-spinner" aria-hidden="true" /> {t("auth.captcha.verifying")}
      {attempts > 0 ? ` (${attempts.toLocaleString()})` : ""}
    </p>
  )
}
