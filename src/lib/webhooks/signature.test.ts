import { describe, expect, it } from "vitest"

import {
  SIGNATURE_TOLERANCE_SECONDS,
  buildGitHubSignatureHeader,
  buildSlackSignatureHeader,
  buildStripeSignatureHeader,
  hmacSha256,
  parseStripeSignatureHeader,
  safeEqual,
  signGeneric,
  signStripePayload,
  slackSigningPayload,
  verifyGenericSignature,
  verifyGitHubSignature,
  verifySlackSignature,
  verifyStripeSignature,
  verifyWebhookSignature,
} from "./signature"

/**
 * Known-answer vectors. Regenerate with node:
 *   node -e 'const c=require("crypto");const b=BODY;const s="whsec_sig_test";const t=1700000000;
 *   console.log(c.createHmac("sha256",s).update(`${t}.${b}`,"utf8").digest("hex"));
 *   console.log(c.createHmac("sha256",s).update(b,"utf8").digest("hex"));
 *   console.log(c.createHmac("sha256",s).update(`v0:${t}:${b}`,"utf8").digest("hex"));
 *   console.log(c.createHmac("sha256",s).update(b,"utf8").digest("base64"));'
 */

const SECRET = "whsec_sig_test"
const OTHER_SECRET = "whsec_sig_test_previous"
const NOW = 1_700_000_000
const BODY = '{"id":"evt_test_1","type":"ping","data":{"ok":true}}'

const KAT_STRIPE = "3619dc9a618f65667e4489cc8d96a4d56b2a81d72a44a753f4e5e18060165f43"
const KAT_GITHUB = "75c0bdb7a97313eae85a8e3d2e20f5669eb25afb8729b5026f4007f31b096b26"
const KAT_SLACK = "466c3d24642466a1b98f341503fadc00b4b459aa20c000ce194865471c492e59"
const KAT_GENERIC_B64 = "dcC9t6lzE+roWo49LiD1Zp6yWvuHKbUCb0AH8xsJayY="

describe("hmacSha256 / safeEqual", () => {
  it("produces pinned digests in each encoding", () => {
    expect(hmacSha256(SECRET, BODY, "hex")).toBe(KAT_GITHUB)
    expect(hmacSha256(SECRET, BODY, "base64")).toBe(KAT_GENERIC_B64)
    expect(hmacSha256(SECRET, BODY, "base64url")).toBe(
      Buffer.from(KAT_GENERIC_B64, "base64").toString("base64url"),
    )
  })

  it("safeEqual is exact-match only", () => {
    expect(safeEqual("abc", "abc")).toBe(true)
    expect(safeEqual("abc", "abd")).toBe(false)
    expect(safeEqual("abc", "abcd")).toBe(false)
    expect(safeEqual("", "")).toBe(true)
  })
})

describe("stripe scheme", () => {
  it("signs and verifies the pinned vector", () => {
    const header = buildStripeSignatureHeader(SECRET, BODY, NOW)
    expect(header).toBe(`t=${NOW},v1=${KAT_STRIPE}`)
    expect(signStripePayload(SECRET, NOW, BODY)).toBe(KAT_STRIPE)

    expect(
      verifyStripeSignature({
        rawBody: BODY,
        signatureHeader: header,
        secrets: [SECRET],
        nowSeconds: NOW,
      }),
    ).toEqual({ ok: true, timestamp: NOW, matchedSecretIndex: 0 })
  })

  it("accepts any v1 signature and any secret during rotation", () => {
    const header = `t=${NOW},v1=${"a".repeat(64)},v1=${KAT_STRIPE}`
    const result = verifyStripeSignature({
      rawBody: BODY,
      signatureHeader: header,
      secrets: [OTHER_SECRET, SECRET],
      nowSeconds: NOW,
    })
    expect(result).toMatchObject({ ok: true, matchedSecretIndex: 1 })
  })

  it("rejects missing, malformed, stale, and wrong-secret signatures", () => {
    const header = buildStripeSignatureHeader(SECRET, BODY, NOW)
    const base = { rawBody: BODY, secrets: [SECRET], nowSeconds: NOW }

    expect(verifyStripeSignature({ ...base, signatureHeader: undefined })).toEqual({
      ok: false,
      reason: "missing_signature",
    })
    expect(verifyStripeSignature({ ...base, signatureHeader: "garbage" })).toEqual({
      ok: false,
      reason: "malformed_header",
    })
    expect(verifyStripeSignature({ ...base, signatureHeader: `t=${NOW}` })).toEqual({
      ok: false,
      reason: "malformed_header",
    })
    expect(
      verifyStripeSignature({
        ...base,
        signatureHeader: header,
        nowSeconds: NOW + SIGNATURE_TOLERANCE_SECONDS + 1,
      }),
    ).toEqual({ ok: false, reason: "timestamp_out_of_tolerance" })
    expect(verifyStripeSignature({ ...base, signatureHeader: header, secrets: ["wrong"] })).toEqual(
      { ok: false, reason: "no_matching_signature" },
    )
  })

  it("detects a tampered body", () => {
    const header = buildStripeSignatureHeader(SECRET, BODY, NOW)
    expect(
      verifyStripeSignature({
        rawBody: BODY + " ",
        signatureHeader: header,
        secrets: [SECRET],
        nowSeconds: NOW,
      }),
    ).toEqual({ ok: false, reason: "no_matching_signature" })
  })

  it("parseStripeSignatureHeader handles unknown keys and bad input", () => {
    expect(parseStripeSignatureHeader(`t=${NOW},v0=ignored,v1=${KAT_STRIPE}`)).toEqual({
      timestamp: NOW,
      signatures: [KAT_STRIPE],
    })
    expect(parseStripeSignatureHeader(`t=abc,v1=${KAT_STRIPE}`)).toBeNull()
    expect(parseStripeSignatureHeader(`t=${NOW},v1=zzzz`)).toBeNull()
    expect(parseStripeSignatureHeader("t=1")).toBeNull()
  })
})

describe("github scheme", () => {
  it("verifies the pinned X-Hub-Signature-256 vector", () => {
    const header = buildGitHubSignatureHeader(SECRET, BODY)
    expect(header).toBe(`sha256=${KAT_GITHUB}`)

    expect(
      verifyGitHubSignature({ rawBody: BODY, signatureHeader: header, secrets: [SECRET] }),
    ).toEqual({ ok: true, matchedSecretIndex: 0 })
  })

  it("accepts a bare hex digest and uppercase hex", () => {
    expect(
      verifyGitHubSignature({
        rawBody: BODY,
        signatureHeader: KAT_GITHUB.toUpperCase(),
        secrets: [SECRET],
      }),
    ).toMatchObject({ ok: true })
  })

  it("rejects malformed and wrong signatures", () => {
    const base = { rawBody: BODY, secrets: [SECRET] }
    expect(verifyGitHubSignature({ ...base, signatureHeader: undefined })).toEqual({
      ok: false,
      reason: "missing_signature",
    })
    expect(verifyGitHubSignature({ ...base, signatureHeader: "sha256=nothex" })).toEqual({
      ok: false,
      reason: "malformed_header",
    })
    expect(verifyGitHubSignature({ ...base, signatureHeader: `sha256=${"0".repeat(64)}` })).toEqual(
      { ok: false, reason: "no_matching_signature" },
    )
  })
})

describe("slack scheme", () => {
  it("verifies the pinned v0 vector with timestamp", () => {
    const ts = String(NOW)
    expect(slackSigningPayload(ts, BODY)).toBe(`v0:${ts}:${BODY}`)
    const sig = buildSlackSignatureHeader(SECRET, BODY, NOW)
    expect(sig).toBe(`v0=${KAT_SLACK}`)

    expect(
      verifySlackSignature({
        rawBody: BODY,
        signatureHeader: sig,
        timestampHeader: ts,
        secrets: [SECRET],
        nowSeconds: NOW,
      }),
    ).toEqual({ ok: true, timestamp: NOW, matchedSecretIndex: 0 })
  })

  it("rejects missing timestamp, stale timestamp, and bad signature", () => {
    const sig = buildSlackSignatureHeader(SECRET, BODY, NOW)
    const base = {
      rawBody: BODY,
      signatureHeader: sig,
      timestampHeader: String(NOW),
      secrets: [SECRET],
      nowSeconds: NOW,
    }

    expect(verifySlackSignature({ ...base, timestampHeader: undefined })).toEqual({
      ok: false,
      reason: "missing_timestamp",
    })
    expect(verifySlackSignature({ ...base, timestampHeader: "abc" })).toEqual({
      ok: false,
      reason: "missing_timestamp",
    })
    expect(
      verifySlackSignature({
        ...base,
        nowSeconds: NOW + SIGNATURE_TOLERANCE_SECONDS + 1,
      }),
    ).toEqual({ ok: false, reason: "timestamp_out_of_tolerance" })
    expect(verifySlackSignature({ ...base, signatureHeader: "v0=" + "0".repeat(64) })).toEqual({
      ok: false,
      reason: "no_matching_signature",
    })
  })
})

describe("generic scheme", () => {
  it("verifies hex, base64, and prefixed signatures", () => {
    expect(signGeneric(SECRET, BODY)).toBe(KAT_GITHUB)
    expect(signGeneric(SECRET, BODY, { encoding: "base64" })).toBe(KAT_GENERIC_B64)
    expect(signGeneric(SECRET, BODY, { prefix: "sha256=" })).toBe(`sha256=${KAT_GITHUB}`)

    expect(
      verifyGenericSignature({
        rawBody: BODY,
        signature: KAT_GENERIC_B64,
        secrets: [SECRET],
        encoding: "base64",
      }),
    ).toMatchObject({ ok: true })
    expect(
      verifyGenericSignature({
        rawBody: BODY,
        signature: `sha256=${KAT_GITHUB}`,
        secrets: [SECRET],
        prefix: "sha256=",
      }),
    ).toMatchObject({ ok: true })
  })

  it("rejects wrong prefix, wrong secret, and empty signature", () => {
    const base = { rawBody: BODY, secrets: [SECRET] }
    expect(
      verifyGenericSignature({
        ...base,
        signature: `sha1=${KAT_GITHUB}`,
        prefix: "sha256=",
      }),
    ).toEqual({ ok: false, reason: "malformed_header" })
    expect(verifyGenericSignature({ ...base, signature: KAT_GITHUB, secrets: ["nope"] })).toEqual({
      ok: false,
      reason: "no_matching_signature",
    })
    expect(verifyGenericSignature({ ...base, signature: undefined })).toEqual({
      ok: false,
      reason: "missing_signature",
    })
  })

  it("accepts Buffer bodies", () => {
    const body = Buffer.from(BODY, "utf8")
    expect(
      verifyGenericSignature({ rawBody: body, signature: KAT_GITHUB, secrets: [SECRET] }),
    ).toMatchObject({ ok: true })
  })
})

describe("verifyWebhookSignature dispatcher", () => {
  it("routes each scheme to its verifier", () => {
    expect(
      verifyWebhookSignature({
        scheme: "stripe",
        rawBody: BODY,
        signatureHeader: buildStripeSignatureHeader(SECRET, BODY, NOW),
        secrets: [SECRET],
        nowSeconds: NOW,
      }),
    ).toMatchObject({ ok: true })

    expect(
      verifyWebhookSignature({
        scheme: "github",
        rawBody: BODY,
        signatureHeader: buildGitHubSignatureHeader(SECRET, BODY),
        secrets: [SECRET],
      }),
    ).toMatchObject({ ok: true })

    expect(
      verifyWebhookSignature({
        scheme: "slack",
        rawBody: BODY,
        signatureHeader: buildSlackSignatureHeader(SECRET, BODY, NOW),
        timestampHeader: String(NOW),
        secrets: [SECRET],
        nowSeconds: NOW,
      }),
    ).toMatchObject({ ok: true })

    expect(
      verifyWebhookSignature({
        scheme: "generic",
        rawBody: BODY,
        signatureHeader: KAT_GITHUB,
        secrets: [SECRET],
      }),
    ).toMatchObject({ ok: true })
  })
})
