// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { TokenPair } from "@/lib/auth/backend"
import { createCaptchaToken } from "@/lib/captcha"
import {
  MemoryLoginAlertStore,
  getLoginAlertStore,
  setLoginAlertStoreForTests,
} from "@/lib/auth/login-alerts"
import { POST } from "./route"

const signUp = vi.fn()
const issueOneTimeToken = vi.fn()
const signIn = vi.fn()

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ signUp, issueOneTimeToken, signIn }),
  }
})

vi.mock("@/lib/auth/mailer", () => ({
  authLink: (path: string) => `https://app.test${path}`,
  sendAuthEmail: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/emails/templates", () => ({
  renderAuthLinkEmail: () => ({ subject: "Verify", text: "body", html: "<p>body</p>" }),
}))

const user = {
  id: "u-new",
  email: "new@lab.edu",
  name: "New",
  emailVerified: false,
  createdAt: new Date().toISOString(),
}

const tokens: TokenPair = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  session: {
    user,
    workspace: { id: "ws_new", name: "New workspace", slug: "new-workspace" },
    sessionId: "s1",
    expiresAt: new Date(Date.now() + 900_000).toISOString(),
  },
}

let alertStore: MemoryLoginAlertStore
let ipCounter = 0

function post(body: unknown, headers: Record<string, string> = {}) {
  ipCounter += 1
  return POST(
    new Request("http://localhost/api/auth/signup", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `172.16.0.${ipCounter}`,
        "user-agent": "SignupBrowser/1.0",
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  )
}

function validBody() {
  return {
    workspaceName: "New workspace",
    email: "new@lab.edu",
    password: "correct horse",
    remember: true,
    captchaToken: createCaptchaToken("0123456789abcdef").token,
  }
}

beforeEach(() => {
  signUp.mockReset().mockResolvedValue({ user, workspace: tokens.session.workspace })
  issueOneTimeToken.mockReset().mockResolvedValue("verify-token")
  signIn.mockReset().mockResolvedValue({ status: "ok", tokens })
  alertStore = new MemoryLoginAlertStore()
  setLoginAlertStoreForTests(alertStore)
})

describe("POST /api/auth/signup", () => {
  it("creates the account, sends verification, and sets session cookies", async () => {
    const response = await post(validBody())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ ok: true, status: "ok" })
    expect(signUp).toHaveBeenCalledWith({
      email: "new@lab.edu",
      password: "correct horse",
      workspaceName: "New workspace",
    })
    expect(issueOneTimeToken).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "verify", userId: user.id }),
    )
    expect(response.headers.get("set-cookie")).toContain("spindle_at=access-token")
  })

  it("rejects missing or forged captcha tokens before touching the backend", async () => {
    const missing = validBody() as Record<string, unknown>
    delete missing.captchaToken
    expect((await post(missing)).status).toBe(403)

    const forged = { ...validBody(), captchaToken: "v1.forged.sig" }
    const response = await post(forged)
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "captcha_failed" })
    expect(signUp).not.toHaveBeenCalled()
  })

  it("rejects breached passwords before touching the backend", async () => {
    const breached = { ...validBody(), password: "password123" }
    const response = await post(breached)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "password_breach",
      severity: "high",
    })
    expect(signUp).not.toHaveBeenCalled()
    expect(signIn).not.toHaveBeenCalled()
  })

  it("still requires the captcha before the breach check", async () => {
    const breached = { ...validBody(), password: "password123" } as Record<string, unknown>
    delete breached.captchaToken
    const response = await post(breached)
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: "captcha_failed" })
    expect(signUp).not.toHaveBeenCalled()
  })

  it("returns 409 when the email is taken", async () => {
    const { AuthBackendError } = await import("@/lib/auth/backend")
    signUp.mockRejectedValue(new AuthBackendError("email_taken", "taken"))
    const response = await post(validBody())
    expect(response.status).toBe(409)
    expect(signIn).not.toHaveBeenCalled()
  })

  it("seeds login-alert fingerprints without raising alerts", async () => {
    const response = await post(validBody(), {
      "x-forwarded-for": "203.0.113.50",
      "user-agent": "UA-signup",
    })
    expect(response.status).toBe(200)

    // The signup sign-in is the account's first: fingerprints are seeded and
    // no alert is raised. Replaying the same fingerprint produces nothing…
    expect(alertStore.listAlerts(user.id)).toEqual([])
    const replay = getLoginAlertStore().recordSuccessfulSignIn({
      userId: user.id,
      email: user.email,
      ip: "203.0.113.50",
      userAgent: "UA-signup",
    })
    expect(replay).toEqual([])

    // …while a genuinely new device is flagged on the next sign-in.
    const next = getLoginAlertStore().recordSuccessfulSignIn({
      userId: user.id,
      email: user.email,
      ip: "203.0.113.50",
      userAgent: "UA-other",
    })
    expect(next.map((a) => a.kind)).toContain("new_device")
  })
})
