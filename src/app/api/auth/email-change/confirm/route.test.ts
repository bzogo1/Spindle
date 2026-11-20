import { beforeEach, describe, expect, it, vi } from "vitest"

import { GET, POST } from "./route"
import {
  requestEmailChange,
  resetEmailChangeStoreForTests,
  type EmailChangeIdentity,
} from "@/lib/email-change"

const identity: EmailChangeIdentity = {
  principal: "user:u1",
  userId: "u1",
  email: "ada@lab.edu",
}

const sendAuthEmail = vi.fn()

vi.mock("@/lib/auth/mailer", () => ({
  authLink: (path: string) => `https://spindle.example${path}`,
  sendAuthEmail: (...args: unknown[]) => sendAuthEmail(...args),
}))

let ipCounter = 0

function getRequest(token: string | null) {
  const url = token
    ? `http://localhost/api/auth/email-change/confirm?token=${encodeURIComponent(token)}`
    : "http://localhost/api/auth/email-change/confirm"
  return GET(
    new Request(url, {
      headers: { "x-forwarded-for": `10.7.7.${++ipCounter}` },
    }),
  )
}

function postRequest(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/auth/email-change/confirm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": `10.7.7.${++ipCounter}`,
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  )
}

function freshToken(newEmail = "new@lab.edu"): string {
  const result = requestEmailChange(identity, newEmail)
  if (!result.ok) throw new Error("setup failed")
  return result.token
}

beforeEach(() => {
  resetEmailChangeStoreForTests()
  sendAuthEmail.mockReset().mockResolvedValue(undefined)
})

describe("GET /api/auth/email-change/confirm (interstitial)", () => {
  it("renders a confirm page WITHOUT consuming the token (prefetch-safe)", async () => {
    const token = freshToken()
    const response = await getRequest(token)
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/html")
    const html = await response.text()
    expect(html).toContain("Confirm email change")
    expect(html).toContain("new@lab.edu")
    expect(html).toContain('name="token"')
    // The token is still live: the form POST performs the real confirm.
    expect(sendAuthEmail).not.toHaveBeenCalled()

    const post = await postRequest({ token })
    expect(post.status).toBe(200)
    expect(sendAuthEmail).toHaveBeenCalledTimes(1)
    expect((sendAuthEmail.mock.calls[0][0] as { to: string }).to).toBe("ada@lab.edu")
  })

  it("renders an unavailable page for bad tokens without side effects", async () => {
    const response = await getRequest("forged.token.here")
    expect(response.status).toBe(200)
    expect(await response.text()).toContain("invalid, expired, or has already been used")

    const missing = await getRequest(null)
    expect(await missing.text()).toContain("invalid, expired, or has already been used")
    expect(sendAuthEmail).not.toHaveBeenCalled()
  })

  it("shows the unavailable page after the token was consumed", async () => {
    const token = freshToken()
    await postRequest({ token }) // consumes it
    const response = await getRequest(token)
    expect(await response.text()).toContain("invalid, expired, or has already been used")
  })
})

describe("POST /api/auth/email-change/confirm", () => {
  it("returns the new email as JSON for API clients", async () => {
    const token = freshToken("json@lab.edu")
    const response = await postRequest({ token })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, email: "json@lab.edu" })
  })

  it("accepts the interstitial's form-urlencoded POST and redirects to account settings", async () => {
    const token = freshToken("form@lab.edu")
    const response = await POST(
      new Request("http://localhost/api/auth/email-change/confirm", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-forwarded-for": `10.7.7.${++ipCounter}`,
        },
        body: new URLSearchParams({ token }).toString(),
      }),
    )
    expect(response.status).toBe(307)
    const location = new URL(response.headers.get("location")!)
    expect(location.pathname).toBe("/app/account")
    expect(location.searchParams.get("email-change")).toBe("confirmed")
  })

  it("redirects form-urlencoded failures back to account settings instead of raw JSON", async () => {
    const token = freshToken("gone@lab.edu")
    // Consume the token first so the form post hits the failure path.
    await postRequest({ token })
    const response = await POST(
      new Request("http://localhost/api/auth/email-change/confirm", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-forwarded-for": `10.7.7.${++ipCounter}`,
        },
        body: new URLSearchParams({ token }).toString(),
      }),
    )
    expect(response.status).toBe(307)
    const location = new URL(response.headers.get("location")!)
    expect(location.pathname).toBe("/app/account")
    expect(location.searchParams.get("email-change")).toBe("failed")
    expect(location.searchParams.get("reason")).toBe("expired")
  })

  it("rejects malformed bodies, bad tokens, and cross-origin requests", async () => {
    expect((await postRequest({})).status).toBe(400)
    expect((await postRequest({ token: 42 })).status).toBe(400)

    const bad = await postRequest({ token: "nope" })
    expect(bad.status).toBe(410)
    expect((await bad.json()).reason).toBe("invalid")

    const crossOrigin = await POST(
      new Request("http://localhost/api/auth/email-change/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          origin: "https://evil.example",
          "x-forwarded-for": "10.7.7.250",
        },
        body: JSON.stringify({ token: "x" }),
      }),
    )
    expect(crossOrigin.status).toBe(403)
  })
})
