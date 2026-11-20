import { expect, request as playwrightRequest, test } from "playwright/test"

import {
  authAuditSchema,
  authFailSchema,
  authOkEnvelope,
  refreshOkSchema,
  resendOkSchema,
  sentOkSchema,
  sessionLookupSchema,
  signUpOkSchema,
} from "./contract"
import { jsonBody } from "./helpers"

/**
 * Contract specs for the public `/api/auth/*` surface plus the happy-path
 * session lifecycle (signup → session → refresh → logout).
 *
 * The dev server runs the in-memory auth backend (`getAuthBackend()`), so
 * sign-up/sign-in exercise the real route handlers end to end. Rate limits
 * are per-IP and in-memory: sign-in allows 10/minute, sign-up 5/hour — this
 * file stays well under both by using unique emails and few attempts.
 */

function uniqueEmail(tag: string): string {
  return `contract-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
}

const VALID_PASSWORD = "contract-passw0rd!"

test.describe("POST /api/auth/signin", () => {
  test("rejects a malformed body", async ({ request }) => {
    const response = await request.post("/api/auth/signin", { data: { email: "x" } })
    expect(response.status()).toBe(400)
    const body = authFailSchema.parse(await jsonBody(response))
    expect(body.code).toBe("invalid_request")
  })

  test("rejects unknown credentials with invalid_credentials", async ({ request }) => {
    const response = await request.post("/api/auth/signin", {
      data: { email: uniqueEmail("signin"), password: VALID_PASSWORD },
    })
    expect(response.status()).toBe(401)
    const body = authFailSchema.parse(await jsonBody(response))
    expect(body.code).toBe("invalid_credentials")
  })
})

test.describe("POST /api/auth/signup", () => {
  test("rejects a malformed body", async ({ request }) => {
    const response = await request.post("/api/auth/signup", {
      data: { email: "not-an-email", password: "short" },
    })
    expect(response.status()).toBe(400)
    const body = authFailSchema.parse(await jsonBody(response))
    expect(body.code).toBe("invalid_request")
  })
})

test.describe("session lifecycle", () => {
  // The `request` fixture is per-test, so cookie state cannot cross test
  // boundaries — the whole lifecycle runs in one test on a dedicated
  // APIRequestContext whose cookie jar persists across the steps.
  const email = uniqueEmail("lifecycle")

  test("signup → session → audit → refresh → logout", async ({ baseURL }) => {
    const ctx = await playwrightRequest.newContext({
      baseURL: baseURL ?? "http://localhost:3000",
    })
    try {
      const signup = await ctx.post("/api/auth/signup", {
        data: {
          workspaceName: "Contract Workspace",
          email,
          password: VALID_PASSWORD,
        },
      })
      expect(signup.status()).toBe(200)

      const signupBody = signUpOkSchema.parse(await jsonBody(signup))
      expect(signupBody.status).toBe("ok")
      expect(signupBody.session.user.email).toBe(email)
      expect(signupBody.session.user.emailVerified).toBe(false)

      const setCookie = signup.headers()["set-cookie"] ?? ""
      expect(setCookie).toContain("spindle_at=")
      expect(setCookie).toContain("spindle_rt=")

      const session = await ctx.get("/api/auth/session")
      expect(session.status()).toBe(200)
      const sessionBody = sessionLookupSchema.parse(await jsonBody(session))
      expect(sessionBody.session?.user.email).toBe(email)
      expect(sessionBody.session?.sessionId).toBeTruthy()

      const audit = await ctx.get("/api/auth/audit?limit=10")
      expect(audit.status()).toBe(200)
      const auditBody = authAuditSchema.parse(await jsonBody(audit))
      expect(auditBody.limit).toBe(10)
      expect(Array.isArray(auditBody.events)).toBe(true)

      const refresh = await ctx.post("/api/auth/refresh")
      expect(refresh.status()).toBe(200)
      const refreshBody = refreshOkSchema.parse(await jsonBody(refresh))
      expect(refreshBody.session.user.email).toBe(email)

      const logout = await ctx.post("/api/auth/logout")
      expect(logout.status()).toBe(200)
      authOkEnvelope.parse(await jsonBody(logout))

      const afterLogout = await ctx.get("/api/auth/session")
      const afterLogoutBody = sessionLookupSchema.parse(await jsonBody(afterLogout))
      expect(afterLogoutBody.session).toBeNull()
    } finally {
      await ctx.dispose()
    }
  })
})

test.describe("anonymous session endpoints", () => {
  test("GET /api/auth/session returns a null session without cookies", async ({ request }) => {
    const response = await request.get("/api/auth/session")
    expect(response.status()).toBe(200)

    const body = sessionLookupSchema.parse(await jsonBody(response))
    expect(body.ok).toBe(true)
    expect(body.session).toBeNull()
  })

  test("POST /api/auth/refresh without a refresh cookie is 401", async ({ request }) => {
    const response = await request.post("/api/auth/refresh")
    expect(response.status()).toBe(401)
    const body = authFailSchema.parse(await jsonBody(response))
    expect(body.code).toBe("invalid_token")
  })

  test("POST /api/auth/logout is idempotent for anonymous callers", async ({ request }) => {
    const response = await request.post("/api/auth/logout")
    expect(response.status()).toBe(200)
    authOkEnvelope.parse(await jsonBody(response))
  })
})

test.describe("token-consuming endpoints", () => {
  test("POST /api/auth/verify-email rejects a bogus token", async ({ request }) => {
    const response = await request.post("/api/auth/verify-email", {
      data: { token: "bogus-token" },
    })
    expect(response.status()).toBe(401)
    const body = authFailSchema.parse(await jsonBody(response))
    expect(body.code).toBe("invalid_token")
  })

  test("POST /api/auth/verify-email/resend answers ok and enforces cooldown", async ({
    request,
  }) => {
    const email = uniqueEmail("resend")
    const first = await request.post("/api/auth/verify-email/resend", { data: { email } })
    expect(first.status()).toBe(200)
    const firstBody = resendOkSchema.parse(await jsonBody(first))
    expect(firstBody.sent).toBe(true)
    expect(firstBody.retryAfter).toBeGreaterThanOrEqual(0)

    // The per-email cooldown is uniform (no enumeration oracle): an immediate
    // repeat is rate-limited regardless of whether the address is registered.
    const second = await request.post("/api/auth/verify-email/resend", { data: { email } })
    expect(second.status()).toBe(429)
    const secondBody = authFailSchema.parse(await jsonBody(second))
    expect(secondBody.code).toBe("rate_limited")
  })

  test("POST /api/auth/passwordless/request always answers sent:true", async ({ request }) => {
    const response = await request.post("/api/auth/passwordless/request", {
      data: { email: uniqueEmail("magic"), purpose: "signin" },
    })
    expect(response.status()).toBe(200)
    sentOkSchema.parse(await jsonBody(response))
  })

  test("POST /api/auth/passwordless/verify rejects a bogus token", async ({ request }) => {
    const response = await request.post("/api/auth/passwordless/verify", {
      data: { token: "bogus-token" },
    })
    expect(response.status()).toBe(401)
    const body = authFailSchema.parse(await jsonBody(response))
    expect(body.code).toBe("invalid_token")
    // Failures carry a machine-readable `reason` for targeted UI copy.
    expect(["expired", "used", "invalid"]).toContain((body as { reason?: string }).reason)
  })

  test("POST /api/auth/password/reset/request is anti-enumeration safe", async ({ request }) => {
    const response = await request.post("/api/auth/password/reset/request", {
      data: { email: uniqueEmail("reset") },
    })
    expect(response.status()).toBe(200)
    sentOkSchema.parse(await jsonBody(response))
  })

  test("POST /api/auth/password/reset/request rejects a malformed email", async ({ request }) => {
    const response = await request.post("/api/auth/password/reset/request", {
      data: { email: "not-an-email" },
    })
    expect(response.status()).toBe(400)
    authFailSchema.parse(await jsonBody(response))
  })

  test("POST /api/auth/password/reset/confirm rejects a bogus token", async ({ request }) => {
    const response = await request.post("/api/auth/password/reset/confirm", {
      data: { token: "bogus-token", password: VALID_PASSWORD },
    })
    expect(response.status()).toBe(401)
    const body = authFailSchema.parse(await jsonBody(response))
    expect(body.code).toBe("invalid_token")
  })
})
