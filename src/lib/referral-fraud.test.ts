import { beforeEach, describe, expect, it } from "vitest"

import {
  addReferralRecord,
  analyzeReferral,
  clearReferralFraudStoreForTests,
  DISPOSABLE_EMAIL_DOMAINS,
  flagJson,
  getFlag,
  isReferralFraudFlagStatus,
  listFlags,
  listReferralRecords,
  REFERRAL_FRAUD_FLAG_THRESHOLD,
  REFERRAL_FRAUD_VELOCITY_LIMIT,
  ReferralFraudError,
  reviewFlag,
  scanReferrals,
  type ReferralRecord,
} from "./referral-fraud"

function record(overrides: Partial<ReferralRecord> = {}): ReferralRecord {
  return {
    id: overrides.id ?? `ref-${Math.random().toString(36).slice(2)}`,
    createdAt: "2026-02-01T12:00:00.000Z",
    ...overrides,
  }
}

beforeEach(() => {
  clearReferralFraudStoreForTests()
})

describe("analyzeReferral", () => {
  it("returns zero score and no reasons for a clean referral", () => {
    const result = analyzeReferral(
      record({
        referrerId: "u1",
        referrerEmail: "ada@example.com",
        referredId: "u2",
        referredEmail: "grace@other.org",
      }),
      { records: [] },
    )
    expect(result.score).toBe(0)
    expect(result.reasons).toEqual([])
  })

  it("flags identical referrer/referred emails as self-referral", () => {
    const result = analyzeReferral(
      record({ referrerEmail: "Ada@Example.com", referredEmail: "ada@example.com" }),
      { records: [] },
    )
    expect(result.score).toBeGreaterThanOrEqual(REFERRAL_FRAUD_FLAG_THRESHOLD)
    expect(result.reasons.map((r) => r.rule)).toContain("self_referral_email")
  })

  it("flags plus-addressed aliases as the same mailbox", () => {
    const result = analyzeReferral(
      record({ referrerEmail: "ada@x.com", referredEmail: "ada+ref@x.com" }),
      { records: [] },
    )
    expect(result.reasons.map((r) => r.rule)).toContain("email_alias")
    // alias alone must NOT reach the flag threshold
    expect(result.score).toBeLessThan(REFERRAL_FRAUD_FLAG_THRESHOLD)
  })

  it("flags identical hashed IPs as self-referral", () => {
    const result = analyzeReferral(record({ referrerIpHash: "ip-abc", referredIpHash: "ip-abc" }), {
      records: [],
    })
    expect(result.reasons.map((r) => r.rule)).toContain("self_referral_ip")
  })

  it("flags disposable email domains", () => {
    const domain = DISPOSABLE_EMAIL_DOMAINS[0]
    const result = analyzeReferral(record({ referredEmail: `farming@${domain}` }), { records: [] })
    expect(result.reasons.map((r) => r.rule)).toContain("disposable_email")
  })

  it("adds the weak same-domain signal without flagging alone", () => {
    const result = analyzeReferral(
      record({ referrerEmail: "a@corp.com", referredEmail: "b@corp.com" }),
      { records: [] },
    )
    expect(result.reasons.map((r) => r.rule)).toEqual(["same_email_domain"])
    expect(result.score).toBeLessThan(REFERRAL_FRAUD_FLAG_THRESHOLD)
  })

  it("does not flag same domain when it is disposable (dedup)", () => {
    const result = analyzeReferral(
      record({
        referrerEmail: `a@${DISPOSABLE_EMAIL_DOMAINS[0]}`,
        referredEmail: `b@${DISPOSABLE_EMAIL_DOMAINS[0]}`,
      }),
      { records: [] },
    )
    const rules = result.reasons.map((r) => r.rule)
    expect(rules).toContain("disposable_email")
    expect(rules).not.toContain("same_email_domain")
  })

  it("flags velocity when a referrer exceeds the daily limit", () => {
    const now = new Date("2026-02-01T12:00:00.000Z")
    const siblings = Array.from({ length: REFERRAL_FRAUD_VELOCITY_LIMIT }, (_, i) =>
      record({
        id: `sib-${i}`,
        referrerId: "u-ref",
        createdAt: "2026-02-01T10:00:00.000Z",
      }),
    )
    const target = record({
      id: "target",
      referrerId: "u-ref",
      createdAt: "2026-02-01T11:00:00.000Z",
    })
    const result = analyzeReferral(target, { now, records: [...siblings, target] })
    expect(result.reasons.map((r) => r.rule)).toContain("velocity")
  })

  it("ignores siblings outside the 24h window", () => {
    const now = new Date("2026-02-01T12:00:00.000Z")
    const siblings = Array.from({ length: REFERRAL_FRAUD_VELOCITY_LIMIT }, (_, i) =>
      record({
        id: `old-${i}`,
        referrerId: "u-ref",
        createdAt: "2026-01-30T10:00:00.000Z", // >24h before now
      }),
    )
    const target = record({
      id: "target",
      referrerId: "u-ref",
      createdAt: "2026-02-01T11:00:00.000Z",
    })
    const result = analyzeReferral(target, { now, records: [...siblings, target] })
    expect(result.reasons.map((r) => r.rule)).not.toContain("velocity")
  })

  it("flags duplicate device fingerprints across records", () => {
    const other = record({ id: "other", fingerprint: "fp-1" })
    const target = record({ id: "target", fingerprint: "fp-1" })
    const result = analyzeReferral(target, { records: [other, target] })
    expect(result.reasons.map((r) => r.rule)).toContain("duplicate_fingerprint")
  })

  it("does not treat the record itself as a duplicate fingerprint", () => {
    const target = record({ id: "target", fingerprint: "fp-1" })
    const result = analyzeReferral(target, { records: [target] })
    expect(result.reasons.map((r) => r.rule)).not.toContain("duplicate_fingerprint")
  })

  it("caps the score at 100", () => {
    const result = analyzeReferral(
      record({
        referrerEmail: "ada@x.com",
        referredEmail: "ada@x.com",
        referrerIpHash: "h",
        referredIpHash: "h",
        fingerprint: "fp",
      }),
      { records: [record({ id: "other", fingerprint: "fp" })] },
    )
    expect(result.score).toBeLessThanOrEqual(100)
  })
})

describe("store + scan", () => {
  it("scanReferrals flags suspicious stored records and lists them", () => {
    addReferralRecord(record({ id: "clean", referrerEmail: "a@x.com", referredEmail: "b@y.com" }))
    addReferralRecord(record({ id: "bad", referrerEmail: "a@x.com", referredEmail: "a@x.com" }))
    const flagged = scanReferrals()
    expect(flagged).toHaveLength(1)
    expect(flagged[0]).toMatchObject({ referralId: "bad", status: "pending" })
    expect(listReferralRecords()).toHaveLength(2)
  })

  it("rescan keeps a reviewed status but refreshes the score", () => {
    addReferralRecord(record({ id: "bad", referrerEmail: "a@x.com", referredEmail: "a@x.com" }))
    const [first] = scanReferrals()
    reviewFlag(first.id, "cleared", "admin@example.com")

    const [second] = scanReferrals()
    expect(second.id).toBe(first.id)
    expect(second.status).toBe("cleared")
    expect(second.reviewedBy).toBe("admin@example.com")
    expect(getFlag(first.id)?.status).toBe("cleared")
  })

  it("listFlags filters by status and paginates", () => {
    addReferralRecord(record({ id: "b1", referrerEmail: "a@x.com", referredEmail: "a@x.com" }))
    addReferralRecord(record({ id: "b2", referrerEmail: "c@x.com", referredEmail: "c@x.com" }))
    const flagged = scanReferrals()
    reviewFlag(flagged[0].id, "confirmed_fraud", "admin@example.com")

    expect(listFlags({ status: "pending" }).total).toBe(1)
    expect(listFlags({ status: "confirmed_fraud" }).total).toBe(1)
    expect(listFlags({ status: "cleared" }).total).toBe(0)
    expect(listFlags({ limit: 1 }).items).toHaveLength(1)
    expect(listFlags({ limit: 1 }).total).toBe(2)
  })

  it("reviewFlag throws for unknown ids and bad statuses", () => {
    expect(() => reviewFlag("nope", "cleared", "a@x.com")).toThrowError(ReferralFraudError)
    try {
      reviewFlag("nope", "bogus" as never, "a@x.com")
    } catch (error) {
      expect(error).toBeInstanceOf(ReferralFraudError)
      expect((error as ReferralFraudError).code).toBe("not_found")
    }
  })

  it("reviewFlag rejects an invalid status on a real flag", () => {
    addReferralRecord(record({ id: "bad", referrerEmail: "a@x.com", referredEmail: "a@x.com" }))
    const [flag] = scanReferrals()
    expect(() => reviewFlag(flag.id, "bogus" as never, "a@x.com")).toThrowError(ReferralFraudError)
    try {
      reviewFlag(flag.id, "bogus" as never, "a@x.com")
    } catch (error) {
      expect((error as ReferralFraudError).code).toBe("invalid_status")
    }
  })

  it("flagJson produces a JSON-safe view", () => {
    addReferralRecord(
      record({
        id: "bad",
        referrerId: "u1",
        referrerEmail: "a@x.com",
        referredEmail: "a@x.com",
      }),
    )
    const [flag] = scanReferrals()
    const json = flagJson(flag)
    expect(json).toMatchObject({
      referralId: "bad",
      referrerId: "u1",
      referrerEmail: "a@x.com",
      referredEmail: "a@x.com",
      status: "pending",
    })
    expect(json.reviewedBy).toBeNull()
    expect(json.reasons.length).toBeGreaterThan(0)
  })
})

describe("isReferralFraudFlagStatus", () => {
  it("accepts the three queue states and rejects others", () => {
    expect(isReferralFraudFlagStatus("pending")).toBe(true)
    expect(isReferralFraudFlagStatus("cleared")).toBe(true)
    expect(isReferralFraudFlagStatus("confirmed_fraud")).toBe(true)
    expect(isReferralFraudFlagStatus("bogus")).toBe(false)
  })
})
