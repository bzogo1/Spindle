// @vitest-environment node
import { describe, expect, it } from "vitest"

import type { TokenPair } from "./backend"
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  applyAuthCookies,
  clearAuthCookies,
  isSameOriginRequest,
  ok,
  readCookie,
} from "./http"

const TOKENS: TokenPair = {
  accessToken: "access.jwt.value",
  refreshToken: "opaque-refresh",
  session: {
    user: {
      id: "u1",
      email: "a@b.c",
      name: "A",
      emailVerified: true,
      createdAt: new Date().toISOString(),
    },
    workspace: null,
    sessionId: "s1",
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  },
}

function setCookieHeaders(response: Response): string[] {
  // `getSetCookie` is available on Headers in Node 18.14+/Next's fetch types.
  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie()
  const single = response.headers.get("set-cookie")
  return single ? [single] : []
}

function cookieHeader(response: Response, name: string): string {
  const found = setCookieHeaders(response).find((line) => line.startsWith(`${name}=`))
  expect(found, `expected a Set-Cookie for ${name}`).toBeDefined()
  return found as string
}

describe("applyAuthCookies", () => {
  it("sets the access cookie as a session cookie (no Max-Age/Expires) at Path=/", () => {
    for (const remember of [true, false]) {
      const response = applyAuthCookies(ok(), TOKENS, { remember })
      const line = cookieHeader(response, ACCESS_COOKIE)

      expect(line).toContain(`${ACCESS_COOKIE}=${TOKENS.accessToken}`)
      expect(line).toContain("Path=/")
      expect(line).toContain("HttpOnly")
      expect(line).not.toMatch(/Max-Age/i)
      expect(line).not.toMatch(/Expires/i)
    }
  })

  it("scopes the refresh cookie to Path=/api/auth", () => {
    const response = applyAuthCookies(ok(), TOKENS, { remember: false })
    const line = cookieHeader(response, REFRESH_COOKIE)

    expect(line).toContain(`${REFRESH_COOKIE}=${TOKENS.refreshToken}`)
    expect(line).toContain("Path=/api/auth")
    expect(line).toContain("HttpOnly")
    expect(line).not.toMatch(/Max-Age/i)
    expect(line).not.toMatch(/Expires/i)
  })

  it("gives the refresh cookie a Max-Age only when remember is set", () => {
    const remembered = applyAuthCookies(ok(), TOKENS, { remember: true })
    const forgotten = applyAuthCookies(ok(), TOKENS, { remember: false })

    expect(cookieHeader(remembered, REFRESH_COOKIE)).toMatch(/Max-Age=2592000/i)
    expect(cookieHeader(forgotten, REFRESH_COOKIE)).not.toMatch(/Max-Age/i)
    // The access cookie never gets a Max-Age, regardless of remember.
    expect(cookieHeader(remembered, ACCESS_COOKIE)).not.toMatch(/Max-Age/i)
    expect(cookieHeader(forgotten, ACCESS_COOKIE)).not.toMatch(/Max-Age/i)
  })
})

describe("clearAuthCookies", () => {
  it("expires both cookies at their scoped paths", () => {
    const response = clearAuthCookies(ok())

    expect(cookieHeader(response, ACCESS_COOKIE)).toMatch(/Max-Age=0/i)
    expect(cookieHeader(response, ACCESS_COOKIE)).toContain("Path=/")
    expect(cookieHeader(response, REFRESH_COOKIE)).toMatch(/Max-Age=0/i)
    expect(cookieHeader(response, REFRESH_COOKIE)).toContain("Path=/api/auth")
  })
})

describe("readCookie", () => {
  it("reads a named cookie and decodes its value", () => {
    const request = new Request("https://example.com/", {
      headers: { cookie: "other=1; spindle_at=abc%3Ddef; trailing=2" },
    })
    expect(readCookie(request, ACCESS_COOKIE)).toBe("abc=def")
    expect(readCookie(request, "missing")).toBeNull()
  })
})

describe("isSameOriginRequest", () => {
  it("allows same-origin and rejects cross-origin mutations", () => {
    const same = new Request("https://app.example.com/api/auth/signin", {
      method: "POST",
      headers: { origin: "https://app.example.com" },
    })
    const cross = new Request("https://app.example.com/api/auth/signin", {
      method: "POST",
      headers: { origin: "https://evil.example.com" },
    })
    const noOrigin = new Request("https://app.example.com/api/auth/signin", {
      method: "POST",
    })

    expect(isSameOriginRequest(same)).toBe(true)
    expect(isSameOriginRequest(cross)).toBe(false)
    expect(isSameOriginRequest(noOrigin)).toBe(true)
  })
})
