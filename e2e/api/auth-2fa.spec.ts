import { randomBytes } from "node:crypto"

import { expect, request as playwrightRequest, test } from "playwright/test"

import {
  authFailSchema,
  backupCodeStatusSchema,
  backupCodesIssueSchema,
  signInOkSchema,
  signUpOkSchema,
  totpConfirmSchema,
  totpDisableSchema,
  totpEnrollSchema,
  verifyLoginOkSchema,
} from "./contract"
import { jsonBody } from "./helpers"
import { totpCode } from "./totp"

// Unique forwarded IP per run keeps the per-IP rate limiters (signup is
// 5/hour) from accumulating hits on a long-lived dev server — `clientIp`
// trusts `x-forwarded-for`.
function uniqueIp(): string {
  const bytes = randomBytes(3)
  return `10.${bytes[0]}.${bytes[1]}.${bytes[2]}`
}

/**
 * Contract specs for the `/api/auth/2fa/*` family.
 *
 * Coverage splits in two:
 *  - Unauthenticated calls must answer 401 `unauthenticated` (per-endpoint
 *    checks below, no session needed).
 *  - The happy path runs end to end against the in-memory auth backend:
 *    signup → enroll → confirm (real RFC 6238 TOTP computed in-test) →
 *    password sign-in returns `totp_required` → verify-login issues a
 *    session → backup-code management → disable. One dedicated
 *    APIRequestContext carries the cookie jar across the steps because the
 *    `request` fixture is per-test.
 */

function uniqueEmail(tag: string): string {
  return `contract-2fa-${tag}-${Date.now()}-${randomBytes(3).toString("hex")}@example.com`
}

const PASSWORD = "contract-2fa-passw0rd!"

const UNAUTH_2FA_ROUTES: Array<{ method: "get" | "post"; path: string; body?: unknown }> = [
  { method: "post", path: "/api/auth/2fa/enroll" },
  { method: "post", path: "/api/auth/2fa/confirm", body: { code: "123456" } },
  { method: "post", path: "/api/auth/2fa/disable", body: { password: PASSWORD } },
  { method: "post", path: "/api/auth/2fa/backup-codes" },
  { method: "get", path: "/api/auth/2fa/backup-codes" },
]

for (const route of UNAUTH_2FA_ROUTES) {
  test(`${route.method.toUpperCase()} ${route.path} requires a session`, async ({ request }) => {
    const response =
      route.method === "get"
        ? await request.get(route.path)
        : await request.post(route.path, { data: route.body ?? {} })
    expect(response.status()).toBe(401)
    const body = authFailSchema.parse(await jsonBody(response))
    expect(body.code).toBe("unauthenticated")
  })
}

test.describe("2FA lifecycle", () => {
  const email = uniqueEmail("lifecycle")

  test("enroll → confirm → totp sign-in → backup codes → disable", async ({ baseURL }) => {
    const ctx = await playwrightRequest.newContext({
      baseURL: baseURL ?? "http://localhost:3000",
      extraHTTPHeaders: { "x-forwarded-for": uniqueIp() },
    })
    try {
      // Fresh account; signup also signs in (session cookies on ctx).
      const signup = await ctx.post("/api/auth/signup", {
        data: { workspaceName: "2FA Contract", email, password: PASSWORD },
      })
      expect(signup.status()).toBe(200)
      signUpOkSchema.parse(await jsonBody(signup))

      // Enrollment returns the provisioning material; nothing is active yet.
      const enroll = await ctx.post("/api/auth/2fa/enroll")
      expect(enroll.status()).toBe(200)
      const enrollBody = totpEnrollSchema.parse(await jsonBody(enroll))
      expect(enrollBody.otpauthUrl).toContain("otpauth://totp/")
      expect(enrollBody.secret.length).toBeGreaterThan(0)

      // A wrong code is rejected before activation. Pick a code that differs
      // from every step inside the server's ±1 verification window.
      const windowCodes = new Set(
        [-30_000, 0, 30_000].map((offset) => totpCode(enrollBody.secret, Date.now() + offset)),
      )
      const wrongCode = windowCodes.has("000000") ? "000001" : "000000"
      const badConfirm = await ctx.post("/api/auth/2fa/confirm", { data: { code: wrongCode } })
      expect(badConfirm.status()).toBe(401)
      authFailSchema.parse(await jsonBody(badConfirm))

      // Confirm with a real TOTP code computed from the returned secret.
      const confirm = await ctx.post("/api/auth/2fa/confirm", {
        data: { code: totpCode(enrollBody.secret) },
      })
      expect(confirm.status()).toBe(200)
      const confirmBody = totpConfirmSchema.parse(await jsonBody(confirm))
      expect(confirmBody.enabled).toBe(true)
      expect(confirmBody.backupCodes.length).toBeGreaterThan(0)

      // Password sign-in now returns a TOTP challenge instead of a session.
      const signin = await ctx.post("/api/auth/signin", {
        data: { email, password: PASSWORD },
      })
      expect(signin.status()).toBe(200)
      const signinBody = signInOkSchema.parse(await jsonBody(signin))
      expect(signinBody.status).toBe("totp_required")
      expect(signinBody.challenge).toBeTruthy()

      // Complete the second factor with a fresh TOTP code.
      const verify = await ctx.post("/api/auth/2fa/verify-login", {
        data: { challenge: signinBody.challenge, code: totpCode(enrollBody.secret) },
      })
      expect(verify.status()).toBe(200)
      const verifyBody = verifyLoginOkSchema.parse(await jsonBody(verify))
      expect(verifyBody.session.user.email).toBe(email)

      // Backup-code status: TOTP enabled, no API-managed set yet.
      const status = await ctx.get("/api/auth/2fa/backup-codes")
      expect(status.status()).toBe(200)
      const statusBody = backupCodeStatusSchema.parse(await jsonBody(status))
      expect(statusBody.enabled).toBe(true)
      expect(statusBody.managed).toBe(false)
      expect(statusBody.remaining).toBeNull()

      // Issuing a managed set returns plaintext codes exactly once.
      const issue = await ctx.post("/api/auth/2fa/backup-codes")
      expect(issue.status()).toBe(200)
      const issueBody = backupCodesIssueSchema.parse(await jsonBody(issue))
      expect(issueBody.backupCodes.length).toBeGreaterThan(0)
      expect(issueBody.remaining).toBe(issueBody.backupCodes.length)

      const statusAfter = await ctx.get("/api/auth/2fa/backup-codes")
      const statusAfterBody = backupCodeStatusSchema.parse(await jsonBody(statusAfter))
      expect(statusAfterBody.managed).toBe(true)
      expect(statusAfterBody.remaining).toBe(issueBody.remaining)

      // Disable requires the account password as re-auth.
      const wrongPassword = await ctx.post("/api/auth/2fa/disable", {
        data: { password: "wrong-password" },
      })
      expect(wrongPassword.status()).toBe(400)
      authFailSchema.parse(await jsonBody(wrongPassword))

      const disable = await ctx.post("/api/auth/2fa/disable", { data: { password: PASSWORD } })
      expect(disable.status()).toBe(200)
      totpDisableSchema.parse(await jsonBody(disable))

      // With 2FA off, sign-in returns a session directly again.
      const signinAgain = await ctx.post("/api/auth/signin", {
        data: { email, password: PASSWORD },
      })
      expect(signinAgain.status()).toBe(200)
      const signinAgainBody = signInOkSchema.parse(await jsonBody(signinAgain))
      expect(signinAgainBody.status).toBe("ok")
      expect(signinAgainBody.session?.user.email).toBe(email)
    } finally {
      await ctx.dispose()
    }
  })
})
