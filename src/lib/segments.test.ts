import { beforeEach, describe, expect, it } from "vitest"

import { setAdminEmailsForTests } from "@/lib/admin"
import {
  clearSegmentsForTests,
  createSegment,
  deleteSegment,
  evaluateSegment,
  getSegment,
  listBackendSegmentUsers,
  listSegments,
  normalizeSegmentRule,
  SEGMENTS_STORE_MAX,
  type Segment,
  type SegmentUser,
} from "@/lib/segments"
import { MemoryAuthBackend, setAuthBackendForTests } from "@/lib/auth/backend"

function user(overrides: Partial<SegmentUser> = {}): SegmentUser {
  return {
    id: "u1",
    email: "alice@example.com",
    emailVerified: true,
    createdAt: "2026-01-15T00:00:00.000Z",
    hasSession: false,
    role: "member",
    ...overrides,
  }
}

function segmentWith(rules: Segment["rules"], combinator: Segment["combinator"] = "all"): Segment {
  return {
    id: "seg_test",
    name: "test",
    rules,
    combinator,
    createdAt: "2026-01-01T00:00:00.000Z",
  }
}

beforeEach(() => {
  clearSegmentsForTests()
  setAdminEmailsForTests(["admin@example.com"])
})

describe("normalizeSegmentRule", () => {
  it("normalizes emailDomain to lowercase and strips stray dots", () => {
    expect(
      normalizeSegmentRule({ field: "emailDomain", operator: "equals", value: " Example.COM " }),
    ).toEqual({ field: "emailDomain", operator: "equals", value: "example.com" })
  })

  it("rejects invalid domains", () => {
    for (const value of ["", "not a domain", "@example.com", "example", "a@b.com", "-bad.com"]) {
      expect(() =>
        normalizeSegmentRule({ field: "emailDomain", operator: "equals", value }),
      ).toThrow()
    }
  })

  it("rejects operators not allowed for a field", () => {
    expect(() =>
      normalizeSegmentRule({ field: "emailVerified", operator: "equals", value: "" }),
    ).toThrow(/not allowed/)
    expect(() =>
      normalizeSegmentRule({ field: "createdAfter", operator: "contains", value: "2026" }),
    ).toThrow(/not allowed/)
  })

  it("rejects unknown fields", () => {
    expect(() =>
      normalizeSegmentRule({
        field: "bogus" as Segment["rules"][number]["field"],
        operator: "equals",
        value: "x",
      }),
    ).toThrow(/Unknown segment field/)
  })

  it("rejects values on boolean predicates", () => {
    expect(() =>
      normalizeSegmentRule({ field: "emailVerified", operator: "isTrue", value: "yes" }),
    ).toThrow(/do not take a value/)
    expect(() =>
      normalizeSegmentRule({ field: "hasSession", operator: "isFalse", value: "" }),
    ).not.toThrow()
  })

  it("normalizes dates to ISO", () => {
    const rule = normalizeSegmentRule({
      field: "createdAfter",
      operator: "is",
      value: "2026-03-01",
    })
    expect(rule.value).toBe("2026-03-01T00:00:00.000Z")
  })

  it("rejects unparseable dates", () => {
    expect(() =>
      normalizeSegmentRule({ field: "createdBefore", operator: "is", value: "soon" }),
    ).toThrow(/valid date/)
  })

  it("validates role values", () => {
    expect(normalizeSegmentRule({ field: "role", operator: "equals", value: "Admin" }).value).toBe(
      "admin",
    )
    expect(() =>
      normalizeSegmentRule({ field: "role", operator: "equals", value: "superuser" }),
    ).toThrow(/admin.*member/)
  })
})

describe("evaluateSegment", () => {
  const alice = user({ id: "a", email: "alice@example.com", emailVerified: true })
  const bob = user({
    id: "b",
    email: "bob@other.org",
    emailVerified: false,
    createdAt: "2026-06-01T00:00:00.000Z",
    hasSession: true,
    role: "admin",
  })
  const carol = user({
    id: "c",
    email: "carol@sub.example.com",
    emailVerified: true,
    createdAt: "2025-01-01T00:00:00.000Z",
  })
  const users = [alice, bob, carol]

  it("emailDomain equals matches only the exact domain", () => {
    const seg = segmentWith([{ field: "emailDomain", operator: "equals", value: "example.com" }])
    expect(evaluateSegment(seg, users).map((u) => u.id)).toEqual(["a"])
  })

  it("emailDomain notEquals inverts the match", () => {
    const seg = segmentWith([{ field: "emailDomain", operator: "notEquals", value: "example.com" }])
    expect(evaluateSegment(seg, users).map((u) => u.id)).toEqual(["b", "c"])
  })

  it("emailDomain contains matches subdomains", () => {
    const seg = segmentWith([{ field: "emailDomain", operator: "contains", value: "example.com" }])
    expect(evaluateSegment(seg, users).map((u) => u.id)).toEqual(["a", "c"])
  })

  it("emailVerified isTrue / isFalse", () => {
    expect(
      evaluateSegment(
        segmentWith([{ field: "emailVerified", operator: "isTrue", value: "" }]),
        users,
      ).map((u) => u.id),
    ).toEqual(["a", "c"])
    expect(
      evaluateSegment(
        segmentWith([{ field: "emailVerified", operator: "isFalse", value: "" }]),
        users,
      ).map((u) => u.id),
    ).toEqual(["b"])
  })

  it("createdAfter is is exclusive", () => {
    const seg = segmentWith([
      {
        field: "createdAfter",
        operator: "is",
        value: "2026-03-01T00:00:00.000Z",
      },
    ])
    expect(evaluateSegment(seg, users).map((u) => u.id)).toEqual(["b"])
  })

  it("createdBefore is is exclusive", () => {
    const seg = segmentWith([
      {
        field: "createdBefore",
        operator: "is",
        value: "2026-01-01T00:00:00.000Z",
      },
    ])
    expect(evaluateSegment(seg, users).map((u) => u.id)).toEqual(["c"])
  })

  it("createdAt exactly equal to the bound matches neither after nor before", () => {
    const exact = user({ createdAt: "2026-01-01T00:00:00.000Z" })
    const after = segmentWith([
      { field: "createdAfter", operator: "is", value: "2026-01-01T00:00:00.000Z" },
    ])
    const before = segmentWith([
      { field: "createdBefore", operator: "is", value: "2026-01-01T00:00:00.000Z" },
    ])
    expect(evaluateSegment(after, [exact])).toEqual([])
    expect(evaluateSegment(before, [exact])).toEqual([])
  })

  it("hasSession isTrue / isFalse", () => {
    expect(
      evaluateSegment(
        segmentWith([{ field: "hasSession", operator: "isTrue", value: "" }]),
        users,
      ).map((u) => u.id),
    ).toEqual(["b"])
    expect(
      evaluateSegment(
        segmentWith([{ field: "hasSession", operator: "isFalse", value: "" }]),
        users,
      ).map((u) => u.id),
    ).toEqual(["a", "c"])
  })

  it("role equals / notEquals", () => {
    expect(
      evaluateSegment(
        segmentWith([{ field: "role", operator: "equals", value: "admin" }]),
        users,
      ).map((u) => u.id),
    ).toEqual(["b"])
    expect(
      evaluateSegment(
        segmentWith([{ field: "role", operator: "notEquals", value: "admin" }]),
        users,
      ).map((u) => u.id),
    ).toEqual(["a", "c"])
  })

  it("combinator all requires every rule to match", () => {
    const seg = segmentWith(
      [
        { field: "emailVerified", operator: "isTrue", value: "" },
        { field: "hasSession", operator: "isTrue", value: "" },
      ],
      "all",
    )
    // No single user is both verified and has a session.
    expect(evaluateSegment(seg, users)).toEqual([])
  })

  it("combinator any matches when at least one rule matches", () => {
    const seg = segmentWith(
      [
        { field: "emailDomain", operator: "equals", value: "example.com" },
        { field: "role", operator: "equals", value: "admin" },
      ],
      "any",
    )
    // alice matches the domain rule; bob matches the role rule; carol's
    // subdomain does not equal example.com and she is a member.
    expect(evaluateSegment(seg, users).map((u) => u.id)).toEqual(["a", "b"])
  })

  it("an unknown combinator matches nobody instead of widening to 'any'", () => {
    // Simulates a hand-built or legacy stored record: the rules would match
    // many users under "any", but a corrupt combinator must not silently
    // widen the audience.
    const seg = segmentWith(
      [{ field: "emailVerified", operator: "isTrue", value: "" }],
      "bogus" as Segment["combinator"],
    )
    expect(evaluateSegment(seg, users)).toEqual([])
  })

  it("a segment with no rules matches nobody", () => {
    expect(evaluateSegment(segmentWith([], "all"), users)).toEqual([])
    expect(evaluateSegment(segmentWith([], "any"), users)).toEqual([])
  })

  it("invalid stored rules never match", () => {
    const seg = segmentWith([
      { field: "emailDomain", operator: "equals", value: "not a domain" },
      { field: "role", operator: "equals", value: "admin" },
    ])
    // "all": the bad rule fails for everyone.
    expect(evaluateSegment(seg, users)).toEqual([])
    // "any": only the role rule can match.
    expect(evaluateSegment({ ...seg, combinator: "any" }, users).map((u) => u.id)).toEqual(["b"])
  })

  it("handles users with unparseable createdAt without throwing", () => {
    const seg = segmentWith([
      { field: "createdAfter", operator: "is", value: "2020-01-01T00:00:00.000Z" },
    ])
    expect(evaluateSegment(seg, [user({ createdAt: "garbage" })])).toEqual([])
  })
})

describe("segment store", () => {
  it("creates, lists, gets, and deletes segments", () => {
    const created = createSegment({
      name: "Verified users",
      description: "email verified",
      rules: [{ field: "emailVerified", operator: "isTrue", value: "" }],
    })
    expect(created.id).toMatch(/^seg_/)
    expect(created.combinator).toBe("all")
    expect(created.rules).toHaveLength(1)

    expect(listSegments().map((s) => s.id)).toEqual([created.id])
    expect(getSegment(created.id)?.name).toBe("Verified users")
    expect(getSegment("seg_missing")).toBeNull()

    expect(deleteSegment(created.id)).toBe(true)
    expect(deleteSegment(created.id)).toBe(false)
    expect(getSegment(created.id)).toBeNull()
  })

  it("normalizes rules on create", () => {
    const created = createSegment({
      name: "Domain",
      rules: [{ field: "emailDomain", operator: "equals", value: " Example.com " }],
    })
    expect(created.rules[0]?.value).toBe("example.com")
  })

  it("rejects invalid input", () => {
    const valid = { field: "emailVerified", operator: "isTrue", value: "" } as const
    expect(() => createSegment({ name: "  ", rules: [valid] })).toThrow(/name/)
    expect(() => createSegment({ name: "x".repeat(121), rules: [valid] })).toThrow(/name/)
    expect(() =>
      createSegment({ name: "ok", description: "x".repeat(501), rules: [valid] }),
    ).toThrow(/description/)
    expect(() => createSegment({ name: "ok", rules: [] })).toThrow(/At least one rule/)
    expect(() =>
      createSegment({
        name: "ok",
        combinator: "bogus" as Segment["combinator"],
        rules: [valid],
      }),
    ).toThrow(/combinator/)
    expect(() =>
      createSegment({
        name: "ok",
        rules: [
          {
            field: "emailDomain",
            operator: "equals",
            value: "not a domain",
          } as Segment["rules"][number],
        ],
      }),
    ).toThrow(/domain/)
    expect(() =>
      createSegment({
        name: "ok",
        rules: Array.from({ length: 21 }, () => valid),
      }),
    ).toThrow(/At most 20 rules/)
  })

  it("orders newest first", async () => {
    const first = createSegment({
      name: "first",
      rules: [{ field: "hasSession", operator: "isTrue", value: "" }],
    })
    await new Promise((resolve) => setTimeout(resolve, 2))
    const second = createSegment({
      name: "second",
      rules: [{ field: "hasSession", operator: "isFalse", value: "" }],
    })
    expect(listSegments().map((s) => s.id)).toEqual([second.id, first.id])
  })

  it("evicts the oldest segment beyond the store cap", () => {
    for (let i = 0; i < SEGMENTS_STORE_MAX + 1; i += 1) {
      createSegment({
        name: `seg-${i}`,
        rules: [{ field: "hasSession", operator: "isTrue", value: "" }],
      })
    }
    expect(listSegments()).toHaveLength(SEGMENTS_STORE_MAX)
  })
})

describe("listBackendSegmentUsers", () => {
  it("projects MemoryAuthBackend users with session and role flags", async () => {
    const backend = new MemoryAuthBackend()
    const admin = await backend.signUp({
      email: "admin@example.com",
      password: "password123",
      workspaceName: "Admin WS",
    })
    const member = await backend.signUp({
      email: "member@other.org",
      password: "password123",
      workspaceName: "Member WS",
    })
    // Give the member a live session.
    await backend.signIn("member@other.org", "password123")

    // The default backend is whatever getAuthBackend() returns; swap in ours
    // via the test hook so the projection sees these users.
    setAuthBackendForTests(backend)
    try {
      const users = listBackendSegmentUsers()
      const byId = new Map(users.map((u) => [u.id, u]))
      expect(byId.get(admin.user.id)).toMatchObject({
        email: "admin@example.com",
        emailVerified: false,
        hasSession: false,
        role: "admin",
      })
      expect(byId.get(member.user.id)).toMatchObject({
        email: "member@other.org",
        hasSession: true,
        role: "member",
      })
    } finally {
      setAuthBackendForTests(undefined)
    }
  })

  it("returns an empty list for backends without an in-memory user store", () => {
    setAuthBackendForTests({} as never)
    try {
      expect(listBackendSegmentUsers()).toEqual([])
    } finally {
      setAuthBackendForTests(undefined)
    }
  })
})
