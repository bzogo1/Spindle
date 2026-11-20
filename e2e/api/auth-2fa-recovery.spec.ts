import { randomBytes } from "node:crypto"

import { expect, request as playwrightRequest, test } from "playwright/test"

import {
  authFailSchema,
  recoveryCancelOkSchema,
  recoveryRequestOkSchema,
  recoveryStatusSchema,
  signUpOkSchema,
  totpConfirmSchema,
  totpEnrollSchema,
} from "./contract"
import { jsonBody } from "./helpers"
import { totpCode } from "./totp"

/**
 * Contract specs for the `/api/auth/2fa/recovery/*` family.
 *
 * Like the rest of `/api/auth/*` these routes authenticate via the signed
 * `spindle_at` cookie only — the unsigned mock-session cookie is NOT accepted
 * (`accessTokenFromRequest` verifies a real JWT). Specs therefore sign up a
 * unique user and enroll TOTP exactly like `auth-2fa.spec.ts` does.
 *
 * Coverage:
 *  - Unauthenticated calls to all four routes answer 401 `unauthenticated`;
 *    `request`/`cancel`/`confirm` also enforce the same-origin CSRF guard.
 *  - Lifecycle: request → resend throttle → status → confirm rejection
 *    boundary → cancel → status. The confirm *success* path needs the emailed
 *    one-time token, which the in-memory backend never exposes to specs (same
 *    limitation as verify-email / password-reset token consumers), so it is
 *    covered only at the rejection boundary.
 *
 * Rate limits are per-client-IP and the server trusts `x-forwarded-for`
 * (`clientIp` in `src/lib/site-forms.ts`), so every request carries a unique
 * forwarded address — specs stay under the limits even against a dev server
 * that has been up across many runs.
 */

/** Unique RFC1918 address per call → fresh rate-limit bucket server-side. */
function uniqueIp(): string {
  const bytes = randomBytes(3)
  return `10.${bytes[0]}.${bytes[1]}.${bytes[2]}`
}

function uniqueEmail(tag: string): string {
  return `contract-recovery-${tag}-${Date.now()}-${randomBytes(3).toString("hex")}@example.com`
}

const PASSWORD = "contract-recovery-passw0rd!"

const UNAUTH_ROUTES: Array<{ method: "get" | "post"; path: string; body?: unknown }> = [
  { method: "post", path: "/api/auth/2fa/recovery/request" },
  { method: "post", path: "/api/auth/2fa/recovery/confirm", body: { token: "x" } },
  { method: "get", path: "/api/auth/2fa/recovery/status" },
  { method: "post", path: "/api/auth/2fa/recovery/cancel" },
]

for (const route of UNAUTH_ROUTES) {
  test(`${route.method.toUpperCase()} ${route.path} requires a session`, async ({ request }) => {
    const response =
      route.method === "get"
        ? await request.get(route.path, { headers: { "x-forwarded-for": uniqueIp() } })
        : await request.post(route.path, {
            data: route.body ?? {},
            headers: { "x-forwarded-for": uniqueIp() },
          })
    expect(response.status()).toBe(401)
    const body = authFailSchema.parse(await jsonBody(response))
    expect(body.code).toBe("unauthenticated")
  })
}

test("POST /api/auth/2fa/recovery/request rejects a cross-origin call", async ({ request }) => {
  // isSameOriginRequest runs before auth — a foreign Origin is refused with
  // 403 even without any session cookie.
  const response = await request.post("/api/auth/2fa/recovery/request", {
    headers: { origin: "https://evil.example", "x-forwarded-for": uniqueIp() },
    data: {},
  })
  expect(response.status()).toBe(403)
  const body = authFailSchema.parse(await jsonBody(response))
  expect(body.code).toBe("forbidden")
})

test.describe("recovery lifecycle", () => {
  test("request → resend throttle → status → confirm rejection → cancel", async ({ baseURL }) => {
    const ctx = await playwrightRequest.newContext({
      baseURL: baseURL ?? "http://localhost:3000",
      extraHTTPHeaders: { "x-forwarded-for": uniqueIp() },
    })
    try {
      // Fresh account with 2FA enrolled — recovery only applies to
      // TOTP-enabled users holding a live session.
      const email = uniqueEmail("lifecycle")
      const signup = await ctx.post("/api/auth/signup", {
        data: { workspaceName: "Recovery Contract", email, password: PASSWORD },
      })
      expect(signup.status()).toBe(200)
      signUpOkSchema.parse(await jsonBody(signup))

      const enroll = await ctx.post("/api/auth/2fa/enroll")
      expect(enroll.status()).toBe(200)
      const enrollBody = totpEnrollSchema.parse(await jsonBody(enroll))

      const confirm2fa = await ctx.post("/api/auth/2fa/confirm", {
        data: { code: totpCode(enrollBody.secret) },
      })
      expect(confirm2fa.status()).toBe(200)
      totpConfirmSchema.parse(await jsonBody(confirm2fa))

      // No recovery in flight yet.
      const statusNone = await ctx.get("/api/auth/2fa/recovery/status")
      expect(statusNone.status()).toBe(200)
      expect(recoveryStatusSchema.parse(await jsonBody(statusNone)).state).toBe("none")

      // Request opens an awaiting_token recovery. The single-use token is
      // emailed (dev: logged server-side); emailSent reflects delivery setup.
      const first = await ctx.post("/api/auth/2fa/recovery/request")
      expect(first.status()).toBe(200)
      const firstBody = recoveryRequestOkSchema.parse(await jsonBody(first))
      expect(firstBody.state).toBe("awaiting_token")
      expect(typeof firstBody.emailSent).toBe("boolean")

      // An immediate second request hits the resend throttle — same state,
      // no duplicate email, with a retry hint.
      const second = await ctx.post("/api/auth/2fa/recovery/request")
      expect(second.status()).toBe(200)
      const secondBody = recoveryRequestOkSchema.parse(await jsonBody(second))
      expect(secondBody.state).toBe("awaiting_token")
      expect(secondBody.emailSent).toBe(false)
      expect(secondBody.retryAfterSeconds).toBeGreaterThan(0)

      const statusPending = await ctx.get("/api/auth/2fa/recovery/status")
      expect(statusPending.status()).toBe(200)
      expect(recoveryStatusSchema.parse(await jsonBody(statusPending)).state).toBe("awaiting_token")

      // Confirm validates the body before touching tokens.
      const badShape = await ctx.post("/api/auth/2fa/recovery/confirm", { data: {} })
      expect(badShape.status()).toBe(400)
      const badShapeBody = authFailSchema.parse(await jsonBody(badShape))
      expect(badShapeBody.code).toBe("invalid_request")

      // A bogus token is rejected as invalid_token — the real emailed token
      // is not reachable from specs (see file header).
      const bogus = await ctx.post("/api/auth/2fa/recovery/confirm", {
        data: { token: "not-a-real-recovery-token" },
      })
      expect(bogus.status()).toBe(401)
      const bogusBody = authFailSchema.parse(await jsonBody(bogus))
      expect(bogusBody.code).toBe("invalid_token")
      expect(bogusBody.reason).toBe("invalid")

      // Cancel aborts the pending recovery; status returns to none.
      const cancel = await ctx.post("/api/auth/2fa/recovery/cancel")
      expect(cancel.status()).toBe(200)
      recoveryCancelOkSchema.parse(await jsonBody(cancel))

      const statusAfter = await ctx.get("/api/auth/2fa/recovery/status")
      expect(statusAfter.status()).toBe(200)
      expect(recoveryStatusSchema.parse(await jsonBody(statusAfter)).state).toBe("none")

      // Cancelling again has nothing to abort.
      const cancelAgain = await ctx.post("/api/auth/2fa/recovery/cancel")
      expect(cancelAgain.status()).toBe(404)
      expect(authFailSchema.parse(await jsonBody(cancelAgain)).code).toBe("no_active_recovery")
    } finally {
      await ctx.dispose()
    }
  })

  test("request rejects a session without 2FA enrolled", async ({ baseURL }) => {
    const ctx = await playwrightRequest.newContext({
      baseURL: baseURL ?? "http://localhost:3000",
      extraHTTPHeaders: { "x-forwarded-for": uniqueIp() },
    })
    try {
      const email = uniqueEmail("no-2fa")
      const signup = await ctx.post("/api/auth/signup", {
        data: { workspaceName: "Recovery Contract", email, password: PASSWORD },
      })
      expect(signup.status()).toBe(200)

      const response = await ctx.post("/api/auth/2fa/recovery/request")
      expect(response.status()).toBe(403)
      const body = authFailSchema.parse(await jsonBody(response))
      expect(body.code).toBe("totp_not_enabled")
    } finally {
      await ctx.dispose()
    }
  })
})
