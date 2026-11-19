import { describe, expect, it } from "vitest"

import {
  clearMockSessionCookie,
  decodeMockSession,
  encodeMockSession,
  MOCK_SESSION_COOKIE,
  persistMockSession,
  readMockSessionCookie,
  type MockSessionData,
} from "./mock-session"

const session: MockSessionData = {
  user: { name: "Ada Lovelace", email: "ada@lab.edu" },
  workspace: { name: "Research team", slug: "research-team" },
  signedInAt: "2026-11-19T12:00:00.000Z",
}

describe("mock session cookie codec", () => {
  it("round-trips a session through encode/decode", () => {
    expect(decodeMockSession(encodeMockSession(session))).toEqual(session)
  })

  it("round-trips non-ASCII names", () => {
    const unicode: MockSessionData = {
      ...session,
      user: { name: "José Ñoño", email: "jose@lab.edu" },
    }
    expect(decodeMockSession(encodeMockSession(unicode))).toEqual(unicode)
  })

  it("returns null for missing, malformed, or tampered values", () => {
    expect(decodeMockSession(undefined)).toBeNull()
    expect(decodeMockSession("")).toBeNull()
    expect(decodeMockSession("not-base64!!!")).toBeNull()
    expect(decodeMockSession(encodeMockSession(session).slice(0, -4) + "AAAA")).toBeNull()
    expect(decodeMockSession(btoa("{}").replace(/=+$/, ""))).toBeNull()
  })
})

describe("mock session cookie helpers", () => {
  it("persists, reads, and clears the session cookie", () => {
    persistMockSession(session)
    expect(document.cookie).toContain(`${MOCK_SESSION_COOKIE}=`)
    expect(readMockSessionCookie()).toEqual(session)

    clearMockSessionCookie()
    expect(readMockSessionCookie()).toBeNull()
  })
})
