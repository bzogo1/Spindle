import { beforeEach, describe, expect, it } from "vitest"

import {
  ALL_UNSUBSCRIBE_SCOPE,
  clearUnsubscribeStore,
  createUnsubscribeToken,
  isUnsubscribed,
  normalizeEmail,
  resubscribeAddress,
  unsubscribeAddress,
  unsubscribePageUrl,
  UNSUBSCRIBE_TOKEN_TTL_SECONDS,
  verifyUnsubscribeToken,
} from "./email-unsubscribe"

beforeEach(() => {
  clearUnsubscribeStore()
})

describe("unsubscribe tokens", () => {
  it("round-trips email and scope", () => {
    const { token, expiresAt } = createUnsubscribeToken({
      email: "  Reader@Lab.EDU ",
      scope: "newsletter",
    })
    const verified = verifyUnsubscribeToken(token)
    expect(verified).not.toBeNull()
    expect(verified!.email).toBe("reader@lab.edu")
    expect(verified!.scope).toBe("newsletter")
    expect(verified!.expiresAt.getTime()).toBe(expiresAt.getTime())
  })

  it("defaults the scope to marketing", () => {
    const { token } = createUnsubscribeToken({ email: "a@b.c" })
    expect(verifyUnsubscribeToken(token)!.scope).toBe("marketing")
  })

  it("rejects malformed and tampered tokens", () => {
    expect(verifyUnsubscribeToken("garbage")).toBeNull()
    expect(verifyUnsubscribeToken("")).toBeNull()
    expect(verifyUnsubscribeToken("a.b.c.d.e")).toBeNull()

    const { token } = createUnsubscribeToken({ email: "a@b.c" })
    // Flip the last signature character.
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`
    expect(verifyUnsubscribeToken(tampered)).toBeNull()

    // A token signed for a different address cannot be edited to match.
    const other = createUnsubscribeToken({ email: "victim@lab.edu" }).token
    expect(other).not.toBe(token)
    expect(verifyUnsubscribeToken(other)!.email).toBe("victim@lab.edu")
  })

  it("rejects expired tokens", () => {
    const { token } = createUnsubscribeToken({
      email: "a@b.c",
      ttlSeconds: -10,
    })
    expect(verifyUnsubscribeToken(token)).toBeNull()
  })

  it("uses a long but bounded default TTL", () => {
    const before = Math.floor(Date.now() / 1000)
    const { expiresAt } = createUnsubscribeToken({ email: "a@b.c" })
    const ttl = expiresAt.getTime() / 1000 - before
    expect(ttl).toBeGreaterThan(30 * 24 * 60 * 60)
    expect(ttl).toBeLessThanOrEqual(UNSUBSCRIBE_TOKEN_TTL_SECONDS + 1)
  })
})

describe("opt-out store", () => {
  it("records and checks opt-outs idempotently", () => {
    expect(isUnsubscribed("a@b.c", "marketing")).toBe(false)
    unsubscribeAddress("A@B.C", "marketing")
    unsubscribeAddress("a@b.c", "marketing")
    expect(isUnsubscribed("a@b.c", "marketing")).toBe(true)
    expect(isUnsubscribed("A@b.c")).toBe(true)
    expect(isUnsubscribed("other@b.c")).toBe(false)
  })

  it("scopes opt-outs: 'all' covers specific scopes", () => {
    unsubscribeAddress("a@b.c", ALL_UNSUBSCRIBE_SCOPE)
    expect(isUnsubscribed("a@b.c", "marketing")).toBe(true)
    expect(isUnsubscribed("a@b.c", "newsletter")).toBe(true)
    expect(isUnsubscribed("a@b.c")).toBe(true)

    clearUnsubscribeStore()
    unsubscribeAddress("a@b.c", "newsletter")
    expect(isUnsubscribed("a@b.c", "marketing")).toBe(false)
    expect(isUnsubscribed("a@b.c", "newsletter")).toBe(true)
    expect(isUnsubscribed("a@b.c")).toBe(true)
  })

  it("resubscribeAddress clears only the matching scope", () => {
    unsubscribeAddress("a@b.c", "newsletter")
    unsubscribeAddress("a@b.c", "marketing")
    resubscribeAddress("A@B.C", "newsletter")
    expect(isUnsubscribed("a@b.c", "newsletter")).toBe(false)
    expect(isUnsubscribed("a@b.c", "marketing")).toBe(true)
    // Clearing a scope that was never opted out is a no-op.
    resubscribeAddress("a@b.c", "newsletter")
    expect(isUnsubscribed("a@b.c", "marketing")).toBe(true)
  })

  it("resubscribeAddress does not clear the 'all' opt-out", () => {
    unsubscribeAddress("a@b.c", ALL_UNSUBSCRIBE_SCOPE)
    resubscribeAddress("a@b.c", "newsletter")
    expect(isUnsubscribed("a@b.c", "newsletter")).toBe(true)
  })
})

describe("unsubscribePageUrl", () => {
  it("builds an absolute /unsubscribe URL carrying token and email", () => {
    const url = unsubscribePageUrl({ email: "Reader@Lab.EDU", origin: "https://spindle.example/" })
    const parsed = new URL(url)
    expect(parsed.origin).toBe("https://spindle.example")
    expect(parsed.pathname).toBe("/unsubscribe")
    expect(parsed.searchParams.get("email")).toBe("reader@lab.edu")
    expect(parsed.searchParams.get("token")).toBeTruthy()
    expect(verifyUnsubscribeToken(parsed.searchParams.get("token")!)).not.toBeNull()
  })
})

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Foo@Bar.COM ")).toBe("foo@bar.com")
  })
})
