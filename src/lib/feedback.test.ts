import { describe, expect, it } from "vitest"

import { FEEDBACK_CATEGORIES } from "./feedback-constants"
import { createFeedbackStore, feedbackSchema } from "./feedback"
import { HONEYPOT_FIELD } from "./site-form-constants"
import { toFieldErrors } from "./site-forms"

const validSubmission = {
  category: "bug",
  message: "The export button does nothing when I click it twice.",
}

describe("feedbackSchema", () => {
  it("accepts a minimal valid submission", () => {
    expect(feedbackSchema.safeParse(validSubmission).success).toBe(true)
  })

  it("accepts every declared category", () => {
    for (const category of FEEDBACK_CATEGORIES) {
      expect(feedbackSchema.safeParse({ ...validSubmission, category }).success).toBe(true)
    }
  })

  it("rejects an unknown or missing category", () => {
    expect(feedbackSchema.safeParse({ ...validSubmission, category: "praise" }).success).toBe(false)
    const result = feedbackSchema.safeParse({ message: validSubmission.message })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(toFieldErrors(result.error).category).toBeTruthy()
  })

  it("rejects a missing or too-short message", () => {
    expect(feedbackSchema.safeParse({ category: "general" }).success).toBe(false)
    const result = feedbackSchema.safeParse({
      ...validSubmission,
      message: "too short",
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(toFieldErrors(result.error).message).toContain("10")
  })

  it("rejects an over-long message", () => {
    const result = feedbackSchema.safeParse({
      ...validSubmission,
      message: "x".repeat(5001),
    })
    expect(result.success).toBe(false)
  })

  it("treats an empty or absent email as no email", () => {
    expect(feedbackSchema.safeParse({ ...validSubmission, email: "" }).success).toBe(true)
    const parsed = feedbackSchema.safeParse({ ...validSubmission, email: "" })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.email).toBeUndefined()
    expect(feedbackSchema.safeParse(validSubmission).success).toBe(true)
  })

  it("accepts a valid email and rejects a malformed one", () => {
    const ok = feedbackSchema.safeParse({ ...validSubmission, email: "ada@lab.edu" })
    expect(ok.success).toBe(true)
    if (ok.success) expect(ok.data.email).toBe("ada@lab.edu")

    const bad = feedbackSchema.safeParse({ ...validSubmission, email: "not-an-email" })
    expect(bad.success).toBe(false)
    if (bad.success) return
    expect(toFieldErrors(bad.error).email).toBeTruthy()
  })

  it("allows an empty or absent honeypot but caps its length", () => {
    expect(feedbackSchema.safeParse({ ...validSubmission, [HONEYPOT_FIELD]: "" }).success).toBe(
      true,
    )
    expect(feedbackSchema.safeParse({ ...validSubmission, [HONEYPOT_FIELD]: "bot" }).success).toBe(
      true,
    )
    expect(
      feedbackSchema.safeParse({ ...validSubmission, [HONEYPOT_FIELD]: "x".repeat(501) }).success,
    ).toBe(false)
  })

  it("trims the message before validating length", () => {
    const result = feedbackSchema.safeParse({
      ...validSubmission,
      message: "   The export button is broken.   ",
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.message).toBe("The export button is broken.")
  })
})

describe("createFeedbackStore", () => {
  it("stores submissions with ids and timestamps", () => {
    const store = createFeedbackStore(() => new Date("2025-01-02T03:04:05.000Z"))
    const entry = store.add({
      category: "idea",
      message: "Please add dark mode to the charts.",
      email: "ada@lab.edu",
    })

    expect(entry.id).toBeTruthy()
    expect(entry.createdAt).toBe("2025-01-02T03:04:05.000Z")
    expect(entry.category).toBe("idea")
    expect(entry.email).toBe("ada@lab.edu")
    expect(store.list()).toHaveLength(1)
    expect(store.list()[0]).toBe(entry)
  })

  it("generates unique ids across entries", () => {
    const store = createFeedbackStore(() => new Date("2025-01-02T03:04:05.000Z"))
    const a = store.add({ category: "general", message: "First message here." })
    const b = store.add({ category: "general", message: "Second message here." })
    expect(a.id).not.toBe(b.id)
    expect(store.list()).toHaveLength(2)
  })

  it("clears all entries", () => {
    const store = createFeedbackStore()
    store.add({ category: "general", message: "A message worth keeping." })
    store.clear()
    expect(store.list()).toHaveLength(0)
  })
})
