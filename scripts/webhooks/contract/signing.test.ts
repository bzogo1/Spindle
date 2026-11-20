import { describe, expect, it } from "vitest"

import { createKeyring, hmacSha256, verifyWithKeyring } from "@/lib/secrets/keyring"

import {
  buildSignatureHeader,
  parseSignatureHeader,
  signPayload,
  verifySignatureHeader,
  SIGNATURE_TOLERANCE_SECONDS,
} from "./signing"

/**
 * Signature contract test vectors.
 *
 * The canonical scheme is `t=<unix>,v1=<hex-hmac-sha256>` over
 * `${t}.${rawBody}`. These tests pin the known-answer vector, the failure
 * modes a real endpoint must reject, and rotation semantics.
 */

const SECRET = "whsec_contract_test_secret"
const NOW = 1_700_000_000

// Known-answer vector: fixed secret/timestamp/body → pinned digest.
// Regenerate with: node -e 'console.log(require("crypto").createHmac("sha256","whsec_contract_test_secret").update("1700000000."+BODY).digest("hex"))'
const KAT_BODY =
  '{"id":"evt_test_kat","type":"contact.form.submitted","apiVersion":"2025-01",' +
  '"created":"2023-11-14T22:13:20.000Z","livemode":false,"idempotencyKey":"idem_kat_0001",' +
  '"data":{"object":{"name":"Ada","email":"ada@example.com","topic":"billing",' +
  '"subject":"Hi","message":"Hello there"}}}'
const KAT_SIGNATURE = "03da8923bdfbaa380f24d19ed86c03400a50c8424b97a17cccfd1d830e8f625b"

describe("signPayload / buildSignatureHeader", () => {
  it("matches the pinned known-answer vector", () => {
    expect(signPayload(SECRET, NOW, KAT_BODY)).toBe(KAT_SIGNATURE)
    expect(buildSignatureHeader(SECRET, KAT_BODY, NOW)).toBe(`t=${NOW},v1=${KAT_SIGNATURE}`)
  })

  it("produces a fresh timestamp by default", () => {
    const header = buildSignatureHeader(SECRET, KAT_BODY)
    const parsed = parseSignatureHeader(header)
    expect(parsed).not.toBeNull()
    expect(Math.abs(Date.now() / 1000 - (parsed?.timestamp ?? 0))).toBeLessThan(5)
  })
})

describe("parseSignatureHeader", () => {
  it("parses a single-signature header", () => {
    expect(parseSignatureHeader(`t=${NOW},v1=${KAT_SIGNATURE}`)).toEqual({
      timestamp: NOW,
      signatures: [KAT_SIGNATURE],
    })
  })

  it("parses multiple v1 signatures for rotation", () => {
    const other = "a".repeat(64)
    expect(parseSignatureHeader(`t=${NOW},v1=${other},v1=${KAT_SIGNATURE}`)?.signatures).toEqual([
      other,
      KAT_SIGNATURE,
    ])
  })

  it.each([
    ["empty", ""],
    ["missing t", `v1=${KAT_SIGNATURE}`],
    ["missing v1", `t=${NOW}`],
    ["non-numeric t", `t=abc,v1=${KAT_SIGNATURE}`],
    ["short v1", `t=${NOW},v1=deadbeef`],
    ["non-hex v1", `t=${NOW},v1=${"z".repeat(64)}`],
    ["no equals", `t${NOW}v1${KAT_SIGNATURE}`],
  ])("rejects malformed header: %s", (_label, header) => {
    expect(parseSignatureHeader(header)).toBeNull()
  })
})

describe("verifySignatureHeader", () => {
  const validHeader = buildSignatureHeader(SECRET, KAT_BODY, NOW)
  const base = { rawBody: KAT_BODY, nowSeconds: NOW, secrets: [SECRET] as const }

  it("accepts a valid signature", () => {
    expect(verifySignatureHeader({ ...base, signatureHeader: validHeader })).toEqual({
      ok: true,
      timestamp: NOW,
    })
  })

  it("rejects a missing signature header", () => {
    const result = verifySignatureHeader({ ...base, signatureHeader: undefined })
    expect(result).toEqual({ ok: false, reason: "missing_signature" })
  })

  it("rejects a malformed signature header", () => {
    const result = verifySignatureHeader({ ...base, signatureHeader: "garbage" })
    expect(result).toEqual({ ok: false, reason: "malformed_header" })
  })

  it("rejects a signature made with the wrong secret", () => {
    const forged = buildSignatureHeader("whsec_wrong_secret", KAT_BODY, NOW)
    const result = verifySignatureHeader({ ...base, signatureHeader: forged })
    expect(result).toEqual({ ok: false, reason: "no_matching_signature" })
  })

  it("rejects a tampered body", () => {
    const tampered = KAT_BODY.replace('"Ada"', '"Mallory"')
    const result = verifySignatureHeader({
      ...base,
      rawBody: tampered,
      signatureHeader: validHeader,
    })
    expect(result).toEqual({ ok: false, reason: "no_matching_signature" })
  })

  it("rejects a tampered timestamp in the header", () => {
    const result = verifySignatureHeader({
      ...base,
      signatureHeader: `t=${NOW + 1},v1=${KAT_SIGNATURE}`,
    })
    expect(result).toEqual({ ok: false, reason: "no_matching_signature" })
  })

  it("rejects an expired timestamp (replay window)", () => {
    const stale = NOW - SIGNATURE_TOLERANCE_SECONDS - 1
    const staleHeader = buildSignatureHeader(SECRET, KAT_BODY, stale)
    const result = verifySignatureHeader({
      ...base,
      signatureHeader: staleHeader,
      nowSeconds: NOW,
    })
    expect(result).toEqual({ ok: false, reason: "timestamp_out_of_tolerance" })
  })

  it("rejects a timestamp too far in the future", () => {
    const future = NOW + SIGNATURE_TOLERANCE_SECONDS + 1
    const futureHeader = buildSignatureHeader(SECRET, KAT_BODY, future)
    const result = verifySignatureHeader({
      ...base,
      signatureHeader: futureHeader,
      nowSeconds: NOW,
    })
    expect(result).toEqual({ ok: false, reason: "timestamp_out_of_tolerance" })
  })

  it("accepts a timestamp exactly at the tolerance boundary", () => {
    const edge = NOW - SIGNATURE_TOLERANCE_SECONDS
    const edgeHeader = buildSignatureHeader(SECRET, KAT_BODY, edge)
    const result = verifySignatureHeader({
      ...base,
      signatureHeader: edgeHeader,
      nowSeconds: NOW,
    })
    expect(result.ok).toBe(true)
  })

  it("accepts when any secret in the rotation set matches", () => {
    const oldSecret = "whsec_previous_secret"
    const rotated = buildSignatureHeader(oldSecret, KAT_BODY, NOW)
    const result = verifySignatureHeader({
      ...base,
      secrets: [SECRET, oldSecret],
      signatureHeader: rotated,
    })
    expect(result.ok).toBe(true)
  })

  it("rejects when no secret in the rotation set matches", () => {
    const rotated = buildSignatureHeader("whsec_other", KAT_BODY, NOW)
    const result = verifySignatureHeader({
      ...base,
      secrets: [SECRET, "whsec_previous_secret"],
      signatureHeader: rotated,
    })
    expect(result).toEqual({ ok: false, reason: "no_matching_signature" })
  })

  it("accepts multi-v1 headers where one signature matches", () => {
    const sigA = signPayload("whsec_a", NOW, KAT_BODY)
    const sigB = signPayload(SECRET, NOW, KAT_BODY)
    const header = `t=${NOW},v1=${sigA},v1=${sigB}`
    expect(verifySignatureHeader({ ...base, signatureHeader: header }).ok).toBe(true)
  })
})

describe("interop with src/lib/secrets/keyring", () => {
  // The contract signs `${t}.${body}` with hex HMAC-SHA256; the platform
  // keyring signs arbitrary payloads with base64url HMAC-SHA256 — the same
  // primitive under a different encoding. These tests prove a real endpoint
  // can reuse the keyring helpers by signing/verifying `${t}.${rawBody}`.
  it("keyring digest equals the contract digest modulo encoding", () => {
    const signedContent = `${NOW}.${KAT_BODY}`
    const contractHex = signPayload(SECRET, NOW, KAT_BODY)
    const keyringB64 = hmacSha256(SECRET, signedContent)
    // hex → base64url round-trip must reproduce the keyring signature.
    const asB64Url = Buffer.from(contractHex, "hex").toString("base64url")
    expect(asB64Url).toBe(keyringB64)
  })

  it("verifyWithKeyring accepts current and previous secrets", () => {
    const signedContent = `${NOW}.${KAT_BODY}`
    const keyring = createKeyring(SECRET, "whsec_previous_secret", "WEBHOOK_SECRET")

    const currentSig = hmacSha256(SECRET, signedContent)
    expect(verifyWithKeyring(keyring, signedContent, currentSig)).toBe("current")

    const previousSig = hmacSha256("whsec_previous_secret", signedContent)
    expect(verifyWithKeyring(keyring, signedContent, previousSig)).toBe("previous")

    const forgedSig = hmacSha256("whsec_wrong", signedContent)
    expect(verifyWithKeyring(keyring, signedContent, forgedSig)).toBeNull()
  })
})
