import { describe, expect, it } from "vitest"

import {
  clientIp,
  contactSchema,
  createContactReference,
  createRateLimiter,
  HONEYPOT_FIELD,
  isHoneypotTriggered,
  newsletterSchema,
  toFieldErrors,
} from "./site-forms"

const validContact = {
  name: "Ada Lovelace",
  email: "ada@lab.edu",
  topic: "product",
  subject: "Question about exports",
  message: "Hi, how do I export a lab session?",
}

describe("contactSchema", () => {
  it("accepts a valid submission", () => {
    expect(contactSchema.safeParse(validContact).success).toBe(true)
  })

  it("rejects missing required fields", () => {
    const result = contactSchema.safeParse({})
    expect(result.success).toBe(false)
    if (result.success) return
    const errors = toFieldErrors(result.error)
    expect(errors.name).toBeTruthy()
    expect(errors.email).toBeTruthy()
    expect(errors.topic).toBeTruthy()
    expect(errors.subject).toBeTruthy()
    expect(errors.message).toBeTruthy()
  })

  it("rejects a missing or unknown topic", () => {
    expect(contactSchema.safeParse({ ...validContact, topic: "" }).success).toBe(false)
    expect(contactSchema.safeParse({ ...validContact, topic: "billing-ish" }).success).toBe(false)
    const result = contactSchema.safeParse({ ...validContact, topic: "" })
    if (result.success) return
    expect(toFieldErrors(result.error).topic).toBe("Please choose a topic.")
  })

  it("accepts every declared topic", () => {
    for (const topic of ["general", "product", "billing", "security", "other"]) {
      expect(contactSchema.safeParse({ ...validContact, topic }).success).toBe(true)
    }
  })

  it("treats an empty or absent reference as not provided", () => {
    const empty = contactSchema.safeParse({ ...validContact, reference: "" })
    expect(empty.success).toBe(true)
    if (empty.success) expect(empty.data.reference).toBeUndefined()

    const absent = contactSchema.safeParse(validContact)
    expect(absent.success).toBe(true)
    if (absent.success) expect(absent.data.reference).toBeUndefined()
  })

  it("accepts a reference and trims it", () => {
    const result = contactSchema.safeParse({ ...validContact, reference: "  ORD-1234  " })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.reference).toBe("ORD-1234")
  })

  it("rejects an over-long reference", () => {
    const result = contactSchema.safeParse({ ...validContact, reference: "x".repeat(121) })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(toFieldErrors(result.error).reference).toBe("Reference is too long.")
  })

  it("rejects a malformed email and a too-short message", () => {
    const result = contactSchema.safeParse({
      ...validContact,
      email: "not-an-email",
      message: "short",
    })
    expect(result.success).toBe(false)
    if (result.success) return
    const errors = toFieldErrors(result.error)
    expect(errors.email).toBeTruthy()
    expect(errors.message).toContain("10")
  })

  it("rejects over-long name, subject, and message", () => {
    const result = contactSchema.safeParse({
      ...validContact,
      name: "x".repeat(121),
      subject: "x".repeat(201),
      message: "x".repeat(5001),
    })
    expect(result.success).toBe(false)
  })

  it("allows an empty or absent honeypot", () => {
    expect(contactSchema.safeParse({ ...validContact, [HONEYPOT_FIELD]: "" }).success).toBe(true)
    expect(contactSchema.safeParse({ ...validContact, [HONEYPOT_FIELD]: "bot" }).success).toBe(true)
  })

  it("accepts an optional render timestamp and rejects over-long values", () => {
    const ok = contactSchema.safeParse({
      ...validContact,
      renderedAt: "2025-01-01T00:00:00.000Z",
    })
    expect(ok.success).toBe(true)
    if (ok.success) expect(ok.data.renderedAt).toBe("2025-01-01T00:00:00.000Z")

    const tooLong = contactSchema.safeParse({ ...validContact, renderedAt: "x".repeat(41) })
    expect(tooLong.success).toBe(false)
  })

  it("trims whitespace on string fields before validating", () => {
    const result = contactSchema.safeParse({
      name: "  Ada  ",
      email: "ada@lab.edu",
      topic: "general",
      subject: "  Hi  ",
      message: "  Enough characters here.  ",
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe("Ada")
      expect(result.data.subject).toBe("Hi")
    }
  })
})

describe("createContactReference", () => {
  it("returns a CT- prefixed 8-char hex id", () => {
    const ref = createContactReference()
    expect(ref).toMatch(/^CT-[0-9A-F]{8}$/)
  })

  it("generates distinct ids", () => {
    expect(createContactReference()).not.toBe(createContactReference())
  })
})

describe("newsletterSchema", () => {
  it("accepts a valid subscription with consent", () => {
    expect(newsletterSchema.safeParse({ email: "reader@lab.edu", consent: true }).success).toBe(
      true,
    )
  })

  it("rejects a missing or malformed email", () => {
    expect(newsletterSchema.safeParse({ consent: true }).success).toBe(false)
    expect(newsletterSchema.safeParse({ email: "nope", consent: true }).success).toBe(false)
  })

  it("requires explicit consent", () => {
    expect(newsletterSchema.safeParse({ email: "reader@lab.edu" }).success).toBe(false)
    expect(newsletterSchema.safeParse({ email: "reader@lab.edu", consent: false }).success).toBe(
      false,
    )
  })

  it("accepts an optional source and honeypot", () => {
    const result = newsletterSchema.safeParse({
      email: "reader@lab.edu",
      source: "site-footer",
      consent: true,
      [HONEYPOT_FIELD]: "",
    })
    expect(result.success).toBe(true)
  })
})

describe("isHoneypotTriggered", () => {
  it("is false for empty, missing, or whitespace values", () => {
    expect(isHoneypotTriggered("")).toBe(false)
    expect(isHoneypotTriggered("   ")).toBe(false)
    expect(isHoneypotTriggered(undefined)).toBe(false)
    expect(isHoneypotTriggered(null)).toBe(false)
  })

  it("is true when a bot filled the field", () => {
    expect(isHoneypotTriggered("http://spam.example")).toBe(true)
    expect(isHoneypotTriggered(" x ")).toBe(true)
  })
})

describe("toFieldErrors", () => {
  it("maps issues to their first path segment", () => {
    const result = contactSchema.safeParse({ email: "bad" })
    expect(result.success).toBe(false)
    if (result.success) return
    const errors = toFieldErrors(result.error)
    expect(errors.email).toBeTruthy()
    expect(errors.name).toBeTruthy()
  })
})

describe("createRateLimiter", () => {
  it("allows up to the limit then blocks", () => {
    let at = 1_000
    const limiter = createRateLimiter({ limit: 3, windowMs: 100, now: () => at })

    expect(limiter.check("ip-a")).toBe(true)
    expect(limiter.check("ip-a")).toBe(true)
    expect(limiter.check("ip-a")).toBe(true)
    expect(limiter.check("ip-a")).toBe(false)
  })

  it("tracks keys independently", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 100, now: () => 0 })
    expect(limiter.check("ip-a")).toBe(true)
    expect(limiter.check("ip-b")).toBe(true)
    expect(limiter.check("ip-a")).toBe(false)
  })

  it("resets after the window elapses", () => {
    let at = 0
    const limiter = createRateLimiter({ limit: 1, windowMs: 50, now: () => at })
    expect(limiter.check("ip-a")).toBe(true)
    expect(limiter.check("ip-a")).toBe(false)
    at = 51
    expect(limiter.check("ip-a")).toBe(true)
  })

  it("sweeps expired entries once the tracked-key count passes the threshold", () => {
    let at = 0
    const limiter = createRateLimiter({ limit: 1, windowMs: 100, now: () => at })

    // Fill past the 500-key prune threshold while every entry is live.
    for (let i = 0; i < 600; i++) {
      expect(limiter.check(`ip-${i}`)).toBe(true)
    }
    expect(limiter.size()).toBe(600)

    // Every window has expired; the next write must prune before inserting.
    at = 200
    expect(limiter.check("ip-new")).toBe(true)
    expect(limiter.size()).toBe(1)
  })
})

describe("clientIp", () => {
  it("uses the first forwarded address", () => {
    const request = new Request("http://localhost/api/contact", {
      headers: { "x-forwarded-for": "  10.0.0.1, 10.0.0.2" },
    })
    expect(clientIp(request)).toBe("10.0.0.1")
  })

  it("falls back to a shared bucket without the header", () => {
    const request = new Request("http://localhost/api/contact")
    expect(clientIp(request)).toBe("unknown")
  })
})
