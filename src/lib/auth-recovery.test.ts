import { afterEach, describe, expect, it, vi } from "vitest"

import { AuthApiError } from "@/lib/auth/auth-client"
import {
  completeAccountRecovery,
  getRecoveryStatus,
  getTokenState,
  markRecoveryEmailVerified,
  requestAccountRecovery,
  resetRecoveryPassword,
  RESEND_COOLDOWN_SECONDS,
  verifyRecoveryToken,
} from "@/lib/auth-recovery"

describe("getTokenState", () => {
  it("treats missing and explicit invalid tokens as invalid", () => {
    expect(getTokenState(undefined)).toBe("invalid")
    expect(getTokenState(null)).toBe("invalid")
    expect(getTokenState("")).toBe("invalid")
    expect(getTokenState("invalid")).toBe("invalid")
    expect(getTokenState("bad-token")).toBe("invalid")
  })

  it("detects expired and used token prefixes case-insensitively", () => {
    expect(getTokenState("expired-token")).toBe("expired")
    expect(getTokenState("EXPIRED-abc")).toBe("expired")
    expect(getTokenState("used-token")).toBe("used")
    expect(getTokenState("Used-abc")).toBe("used")
  })

  it("treats every other token as valid", () => {
    expect(getTokenState("demo-token")).toBe("valid")
    expect(getTokenState("  a8f3c2  ")).toBe("valid")
  })

  it("exports a positive resend cooldown", () => {
    expect(RESEND_COOLDOWN_SECONDS).toBeGreaterThan(0)
  })
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

afterEach(() => {
  vi.mocked(globalThis.fetch).mockReset()
})

describe("account recovery client", () => {
  it("requests a recovery email via POST /api/auth/recovery/request", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(jsonResponse({ ok: true, sent: true }))
    await expect(requestAccountRecovery("ada@lab.edu")).resolves.toBeUndefined()
    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(url).toBe("/api/auth/recovery/request")
    expect(init?.method).toBe("POST")
    expect(JSON.parse(String(init?.body))).toEqual({ email: "ada@lab.edu" })
  })

  it("exchanges a token for a recovery session", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        sessionToken: "sess",
        sessionExpiresAt: "2030-01-01T00:00:00.000Z",
        email: "ada@lab.edu",
      }),
    )
    const session = await verifyRecoveryToken("tok")
    expect(session).toEqual({
      sessionToken: "sess",
      sessionExpiresAt: "2030-01-01T00:00:00.000Z",
      email: "ada@lab.edu",
    })
  })

  it("surfaces the server's failure reason for dead links", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonResponse(
        { ok: false, code: "invalid_token", message: "expired", reason: "expired" },
        401,
      ),
    )
    const error = await verifyRecoveryToken("tok").catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AuthApiError)
    expect((error as AuthApiError).code).toBe("invalid_token")
    expect((error as AuthApiError).data.reason).toBe("expired")
  })

  it("fetches status, marks steps, and completes with the session token", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          phase: "verified",
          email: "ada@lab.edu",
          sessionExpiresAt: null,
          actions: { passwordResetAt: null, emailVerifiedAt: null },
          events: [{ timestamp: "2030-01-01T00:00:00.000Z", type: "signin.success" }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true, reset: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, verified: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, completed: true }))

    const status = await getRecoveryStatus("sess")
    expect(status.phase).toBe("verified")
    expect(status.events).toHaveLength(1)

    await resetRecoveryPassword({ sessionToken: "sess", password: "new-password-1" })
    await markRecoveryEmailVerified("sess")
    await completeAccountRecovery("sess")

    const bodies = vi
      .mocked(globalThis.fetch)
      .mock.calls.slice(1)
      .map(([, init]) => JSON.parse(String(init?.body)))
    expect(bodies[0]).toEqual({ sessionToken: "sess", password: "new-password-1" })
    expect(bodies[1]).toEqual({ sessionToken: "sess" })
    expect(bodies[2]).toEqual({ sessionToken: "sess" })
  })

  it("throws a network AuthApiError when fetch rejects", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error("offline"))
    await expect(requestAccountRecovery("ada@lab.edu")).rejects.toMatchObject({
      code: "network",
    })
  })
})
