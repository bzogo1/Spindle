import { afterEach, describe, expect, it, vi } from "vitest"

import type { ClientSession } from "@/lib/auth/auth-client"
import { AuthApiError } from "@/lib/auth/auth-client"
import {
  MockAuthError,
  authSignIn,
  mockCreateWorkspace,
  mockSendEmailLink,
  mockSignIn,
  toMockSession,
  verifyTotpSignIn,
} from "./mock-auth"

const fetchMock = vi.mocked(globalThis.fetch)

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

const clientSession: ClientSession = {
  user: { id: "u1", email: "researcher@lab.edu", name: "Researcher", emailVerified: true },
  workspace: { name: "Lab", slug: "lab" },
  sessionId: "s1",
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
}

afterEach(() => {
  fetchMock.mockReset()
})

describe("toMockSession", () => {
  it("maps a ClientSession and derives a display name when missing", () => {
    const session = toMockSession({
      ...clientSession,
      user: { ...clientSession.user, name: null },
      workspace: null,
    })

    expect(session.user).toEqual({ name: "Researcher", email: "researcher@lab.edu" })
    expect(session.workspace).toEqual({ name: "Personal workspace", slug: "personal" })
    expect(session.signedInAt).toBeTruthy()
  })
})

describe("authSignIn", () => {
  it("returns the real session on success", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, status: "ok", session: clientSession }))

    const result = await authSignIn({ email: "researcher@lab.edu", password: "hunter2" })

    expect(result).toEqual({
      session: expect.objectContaining({
        user: expect.objectContaining({ email: "researcher@lab.edu" }),
      }),
      clientSession,
    })
  })

  it("surfaces the TOTP challenge instead of a session", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: true, status: "totp_required", challenge: "ch-1" }),
    )

    const result = await authSignIn({ email: "researcher@lab.edu", password: "hunter2" })

    expect(result).toEqual({ totpChallenge: "ch-1" })
  })

  it("maps a reachable-server invalid_credentials error to MockAuthError", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: false, code: "invalid_credentials", message: "Invalid." }, 401),
    )

    await expect(
      authSignIn({ email: "researcher@lab.edu", password: "hunter2" }),
    ).rejects.toMatchObject({ name: "MockAuthError", code: "invalid_credentials" })
  })

  it("rethrows unmapped AuthApiErrors (e.g. rate_limited) untouched", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: false, code: "rate_limited", message: "Slow down." }, 429),
    )

    await expect(
      authSignIn({ email: "researcher@lab.edu", password: "hunter2" }),
    ).rejects.toMatchObject({ name: "AuthApiError", code: "rate_limited" })
  })

  it("falls back to the mock sign-in on network failure outside production", async () => {
    fetchMock.mockRejectedValue(new Error("connection refused"))

    const result = await authSignIn({ email: "researcher@lab.edu", password: "hunter2" })

    expect(result).toEqual({
      session: expect.objectContaining({
        user: expect.objectContaining({ email: "researcher@lab.edu" }),
      }),
      clientSession: null,
    })
  }, 5000)

  it("mock fallback still rejects the demo 'incorrect' password", async () => {
    fetchMock.mockRejectedValue(new Error("connection refused"))

    await expect(
      authSignIn({ email: "researcher@lab.edu", password: "incorrect" }),
    ).rejects.toBeInstanceOf(MockAuthError)
  }, 5000)

  it("mockSignIn throws AuthApiError when a TOTP challenge comes back", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: true, status: "totp_required", challenge: "ch-1" }),
    )

    await expect(
      mockSignIn({ email: "researcher@lab.edu", password: "hunter2" }),
    ).rejects.toMatchObject({ name: "AuthApiError", code: "totp_required" })
  })
})

describe("verifyTotpSignIn", () => {
  it("returns the session with the ClientSession bridged through", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, session: clientSession }))

    const result = await verifyTotpSignIn({
      challenge: "ch-1",
      code: "123456",
      remember: false,
    })

    expect(result).toEqual({
      session: expect.objectContaining({
        user: expect.objectContaining({ email: "researcher@lab.edu" }),
      }),
      clientSession,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/2fa/verify-login",
      expect.objectContaining({
        body: JSON.stringify({ challenge: "ch-1", code: "123456", remember: false }),
      }),
    )
  })

  it("propagates totp_invalid errors untouched", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: false, code: "totp_invalid", message: "That code is not valid." }, 400),
    )

    await expect(verifyTotpSignIn({ challenge: "ch-1", code: "000000" })).rejects.toMatchObject({
      name: "AuthApiError",
      code: "totp_invalid",
    })
  })

  it("does not fall back to a mock session on network failure", async () => {
    fetchMock.mockRejectedValue(new Error("connection refused"))

    await expect(verifyTotpSignIn({ challenge: "ch-1", code: "123456" })).rejects.toMatchObject({
      name: "AuthApiError",
      code: "network",
    })
  })
})

describe("mockCreateWorkspace", () => {
  const input = {
    workspaceName: "coastal-resilience",
    email: "researcher@lab.edu",
    password: "hunter2",
  }

  it("returns the real session on success", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, session: clientSession }))

    const result = await mockCreateWorkspace(input)

    expect(result.session.user.email).toBe("researcher@lab.edu")
    expect(result.clientSession).toEqual(clientSession)
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/signup",
      expect.objectContaining({
        body: JSON.stringify({ ...input, remember: true }),
      }),
    )
  })

  it("maps a reachable-server email_taken error to MockAuthError", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: false, code: "email_taken", message: "Taken." }, 409),
    )

    await expect(mockCreateWorkspace(input)).rejects.toMatchObject({
      name: "MockAuthError",
      code: "email_taken",
    })
  })

  it("falls back to the mock workspace on network failure", async () => {
    fetchMock.mockRejectedValue(new Error("connection refused"))

    const result = await mockCreateWorkspace(input)

    expect(result.session.user.email).toBe("researcher@lab.edu")
    expect(result.session.workspace.name).toBe("coastal-resilience")
    expect(result.clientSession).toBeNull()
  }, 5000)

  it("mock fallback rejects the taken demo email", async () => {
    fetchMock.mockRejectedValue(new Error("connection refused"))

    await expect(
      mockCreateWorkspace({ ...input, email: "taken@spindle.dev" }),
    ).rejects.toMatchObject({ name: "MockAuthError", code: "email_taken" })
  }, 5000)
})

describe("mockSendEmailLink", () => {
  it("requests a password reset by default", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))

    await mockSendEmailLink("researcher@lab.edu")

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/password/reset/request",
      expect.objectContaining({ body: JSON.stringify({ email: "researcher@lab.edu" }) }),
    )
  })

  it("requests email verification for the verify-email purpose", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))

    await mockSendEmailLink("researcher@lab.edu", "verify-email")

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/passwordless/request",
      expect.objectContaining({
        body: JSON.stringify({ email: "researcher@lab.edu", purpose: "verify-email" }),
      }),
    )
  })

  it("rethrows API errors instead of simulating success", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: false, code: "rate_limited", message: "Slow down." }, 429),
    )

    await expect(mockSendEmailLink("researcher@lab.edu")).rejects.toBeInstanceOf(AuthApiError)
  })
})
