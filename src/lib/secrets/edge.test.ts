import { describe, expect, it } from "vitest"

import { edgeCanonicalRequest, signEdgeRequest, verifyEdgeRequest } from "./edge"
import { createKeyring } from "./keyring"

const current = "edge-current-".padEnd(40, "a")
const previous = "edge-previous-".padEnd(40, "b")
const now = 1_800_000_000

describe("edge HMAC", () => {
  it("signs and verifies a request with the current key", () => {
    const keyring = createKeyring(current, undefined, "EDGE_HMAC_SECRET")
    const signed = signEdgeRequest(
      { method: "post", path: "/api/health", body: '{"ok":true}' },
      { keyring, now },
    )

    const result = verifyEdgeRequest(
      {
        method: "POST",
        path: "/api/health",
        body: '{"ok":true}',
        timestamp: signed.timestamp,
        signature: signed.signature,
      },
      { keyring, now },
    )

    expect(result).toEqual({ ok: true, key: "current" })
  })

  it("accepts the previous key during rotation", () => {
    const oldKeyring = createKeyring(previous, undefined, "EDGE_HMAC_SECRET")
    const newKeyring = createKeyring(current, previous, "EDGE_HMAC_SECRET")
    const signed = signEdgeRequest(
      { method: "GET", path: "/api/health" },
      { keyring: oldKeyring, now },
    )

    const result = verifyEdgeRequest(
      {
        method: "GET",
        path: "/api/health",
        timestamp: signed.timestamp,
        signature: signed.signature,
      },
      { keyring: newKeyring, now },
    )

    expect(result).toEqual({ ok: true, key: "previous" })
  })

  it("rejects a body that changed after signing", () => {
    const keyring = createKeyring(current, undefined, "EDGE_HMAC_SECRET")
    const signed = signEdgeRequest(
      { method: "POST", path: "/api/health", body: "original" },
      { keyring, now },
    )

    expect(
      verifyEdgeRequest(
        {
          method: "POST",
          path: "/api/health",
          body: "tampered",
          timestamp: signed.timestamp,
          signature: signed.signature,
        },
        { keyring, now },
      ),
    ).toEqual({ ok: false, reason: "invalid-signature" })
  })

  it("rejects a timestamp outside the skew window", () => {
    const keyring = createKeyring(current, undefined, "EDGE_HMAC_SECRET")
    const signed = signEdgeRequest({ method: "GET", path: "/api/health" }, { keyring, now })

    expect(
      verifyEdgeRequest(
        {
          method: "GET",
          path: "/api/health",
          timestamp: signed.timestamp,
          signature: signed.signature,
        },
        { keyring, now: now + 301 },
      ),
    ).toEqual({ ok: false, reason: "expired" })
  })

  it("rejects a malformed timestamp or signature prefix", () => {
    const keyring = createKeyring(current, undefined, "EDGE_HMAC_SECRET")
    const signed = signEdgeRequest({ method: "GET", path: "/api/health" }, { keyring, now })

    expect(
      verifyEdgeRequest(
        {
          method: "GET",
          path: "/api/health",
          timestamp: "not-a-number",
          signature: signed.signature,
        },
        { keyring, now },
      ),
    ).toEqual({ ok: false, reason: "malformed" })

    expect(
      verifyEdgeRequest(
        {
          method: "GET",
          path: "/api/health",
          timestamp: signed.timestamp,
          signature: signed.signature.replace("v1=", ""),
        },
        { keyring, now },
      ),
    ).toEqual({ ok: false, reason: "malformed" })
  })

  it("canonicalizes the method, path, and body hash", () => {
    const canonical = edgeCanonicalRequest({
      method: "get",
      path: "api/health",
      body: "body",
      timestamp: 1,
    })

    expect(canonical.startsWith("v1\nGET\n/api/health\n1\n")).toBe(true)
    expect(canonical).toHaveLength("v1\nGET\n/api/health\n1\n".length + 64)
  })
})
