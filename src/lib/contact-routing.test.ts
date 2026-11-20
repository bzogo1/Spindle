// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest"

import {
  assignQueue,
  clearContactSubmissions,
  CONTACT_STORE_MAX_SUBMISSIONS,
  getSubmission,
  listSubmissions,
  routeSubmission,
  updateSubmissionStatus,
} from "./contact-routing"

function makeSubmission(overrides: Partial<Parameters<typeof routeSubmission>[0]> = {}) {
  return routeSubmission({
    name: "Ada Lovelace",
    email: "ada@example.com",
    topic: "general",
    subject: "Hello",
    message: "A reasonably long message body for testing.",
    ...overrides,
  })
}

beforeEach(() => {
  clearContactSubmissions()
})

describe("assignQueue", () => {
  it("maps topics to queues when no keyword fires", () => {
    expect(assignQueue({ topic: "product", subject: "How do I export?" })).toBe("support")
    expect(assignQueue({ topic: "billing", subject: "Receipt question" })).toBe("billing")
    expect(assignQueue({ topic: "security", subject: "Report a bug" })).toBe("security")
    expect(assignQueue({ topic: "general", subject: "Hi" })).toBe("general")
    expect(assignQueue({ topic: "other", subject: "Misc" })).toBe("general")
  })

  it("routes keyword hits to their queues regardless of topic", () => {
    expect(
      assignQueue({
        topic: "general",
        subject: "Question",
        message: "I was double charged on my invoice",
      }),
    ).toBe("billing")
    expect(
      assignQueue({ topic: "product", subject: "Press inquiry", message: "Interview request" }),
    ).toBe("press")
    expect(
      assignQueue({ topic: "other", subject: "Demo", message: "Can we get a trial for our team?" }),
    ).toBe("sales")
    expect(
      assignQueue({
        topic: "general",
        subject: "Security",
        message: "Possible vulnerability report",
      }),
    ).toBe("security")
  })

  it("does not fire on substrings inside longer words", () => {
    // "implicated" contains "invoice"-adjacent text? Use a real non-match:
    expect(
      assignQueue({ topic: "general", subject: "Complicated onboarding", message: "Help me" }),
    ).toBe("general")
  })
})

describe("routeSubmission", () => {
  it("records a submission with routed queue, preview, and timestamps", () => {
    const submission = makeSubmission({ topic: "product" })
    expect(submission.id).toMatch(/^CT-[0-9A-F]{8}$/)
    expect(submission.routedTo).toBe("support")
    expect(submission.status).toBe("new")
    expect(submission.messagePreview.length).toBeLessThanOrEqual(281)
    expect(submission.createdAt).toBe(submission.updatedAt)
    expect(getSubmission(submission.id)).toEqual(submission)
  })

  it("honours an explicit id, status, assignee, and spam signals", () => {
    const submission = makeSubmission({
      id: "CT-DEADBEEF",
      status: "spam",
      assignee: "ops",
      spamSignals: ["repeated-chars"],
    })
    expect(submission.id).toBe("CT-DEADBEEF")
    expect(submission.status).toBe("spam")
    expect(submission.assignee).toBe("ops")
    expect(submission.spamSignals).toEqual(["repeated-chars"])
  })

  it("stores the visitor-supplied reference when present", () => {
    const submission = makeSubmission({ reference: "ORD-42" })
    expect(submission.reference).toBe("ORD-42")
  })

  it("evicts the oldest record beyond the store bound", () => {
    for (let i = 0; i < CONTACT_STORE_MAX_SUBMISSIONS + 5; i += 1) {
      makeSubmission({ email: `user${i}@example.com` })
    }
    const page = listSubmissions({ limit: CONTACT_STORE_MAX_SUBMISSIONS + 10 })
    expect(page.total).toBe(CONTACT_STORE_MAX_SUBMISSIONS)
  })
})

describe("listSubmissions", () => {
  it("filters by status and queue and paginates", () => {
    makeSubmission({ id: "CT-00000001", topic: "billing", subject: "Invoice help" })
    const second = makeSubmission({
      id: "CT-00000002",
      topic: "general",
      subject: "Hello there",
    })
    updateSubmissionStatus(second.id, "in_progress")

    const billing = listSubmissions({ queue: "billing" })
    expect(billing.total).toBe(1)
    expect(billing.items[0].id).toBe("CT-00000001")

    const inProgress = listSubmissions({ status: "in_progress" })
    expect(inProgress.total).toBe(1)
    expect(inProgress.items[0].id).toBe(second.id)

    const paged = listSubmissions({ limit: 1, offset: 1 })
    expect(paged.total).toBe(2)
    expect(paged.items).toHaveLength(1)
  })

  it("searches name, email, subject, message, and id case-insensitively", () => {
    makeSubmission({ id: "CT-AAAA0001", name: "Grace Hopper", email: "grace@navy.mil" })
    makeSubmission({ id: "CT-BBBB0002", name: "Alan Turing", email: "alan@bletchley.uk" })

    expect(listSubmissions({ query: "hopper" }).total).toBe(1)
    expect(listSubmissions({ query: "BLETCHLEY" }).total).toBe(1)
    expect(listSubmissions({ query: "aaaa0001" }).total).toBe(1)
    expect(listSubmissions({ query: "reasonably long" }).total).toBe(2)
    expect(listSubmissions({ query: "nomatch" }).total).toBe(0)
  })
})

describe("updateSubmissionStatus", () => {
  it("updates status and assignee, bumping updatedAt", () => {
    const submission = makeSubmission()
    const updated = updateSubmissionStatus(submission.id, "resolved", "admin@x.io")
    expect(updated?.status).toBe("resolved")
    expect(updated?.assignee).toBe("admin@x.io")
    expect((updated?.updatedAt ?? "") >= submission.updatedAt).toBe(true)
  })

  it("clears the assignee on an empty string and returns null for unknown ids", () => {
    const submission = makeSubmission({ assignee: "someone" })
    const updated = updateSubmissionStatus(submission.id, "new", "  ")
    expect(updated?.assignee).toBeUndefined()
    expect(updateSubmissionStatus("CT-NOPE", "resolved")).toBeNull()
  })
})

describe("clearContactSubmissions", () => {
  it("empties the store", () => {
    makeSubmission()
    clearContactSubmissions()
    expect(listSubmissions().total).toBe(0)
  })
})
