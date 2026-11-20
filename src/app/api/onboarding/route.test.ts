import { beforeEach, describe, expect, it, vi } from "vitest"

import { createAccessToken } from "@/lib/auth/token-codec"
import {
  encodeMockSession,
  MOCK_SESSION_COOKIE,
  type MockSessionData,
} from "@/lib/auth/mock-session"
import { resetOnboardingStoreForTests } from "@/lib/onboarding"

import { GET, POST, PUT } from "./route"

// Enable the mock-session branch of the route's session resolution; the real
// encode/decode helpers stay intact via importOriginal.
vi.mock("@/lib/auth/mock-session", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/auth/mock-session")>()
  return { ...mod, mockAuthEnabled: true }
})

const UID = "user-onboarding-test"

const mockSession: MockSessionData = {
  user: { name: "Bogdan Zogovic", email: "bogdan@example.com" },
  workspace: { name: "Personal workspace", slug: "personal" },
  signedInAt: "2026-11-19T12:00:00.000Z",
}

function authCookie() {
  const { token } = createAccessToken({
    sid: "sid-1",
    uid: UID,
    email: "real@example.com",
    name: "Real User",
  })
  return `spindle_at=${token}`
}

function mockCookie() {
  return `${MOCK_SESSION_COOKIE}=${encodeMockSession(mockSession)}`
}

function get(cookie?: string) {
  return GET(
    new Request("http://localhost/api/onboarding", {
      headers: cookie ? { cookie } : {},
    }),
  )
}

function put(body: unknown, cookie?: string, headers: Record<string, string> = {}) {
  return PUT(
    new Request("http://localhost/api/onboarding", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  )
}

function post(body?: unknown, cookie?: string, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/onboarding", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  resetOnboardingStoreForTests()
})

describe("GET /api/onboarding", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await get()
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: "unauthenticated" })
  })

  it("returns a null record for a new user", async () => {
    const response = await get(mockCookie())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ ok: true, onboarding: null, progress: null })
    expect(body.steps).toEqual(["welcome", "profile", "preferences", "tour"])
  })
})

describe("PUT /api/onboarding", () => {
  it("rejects cross-origin requests", async () => {
    const response = await put({ stepIndex: 0 }, mockCookie(), {
      origin: "https://evil.example.com",
    })
    expect(response.status).toBe(403)
  })

  it("rejects unauthenticated requests", async () => {
    expect((await put({ stepIndex: 0 })).status).toBe(401)
  })

  it("rejects malformed JSON and invalid step indexes", async () => {
    const cookie = mockCookie()
    expect((await put("{nope", cookie)).status).toBe(400)
    expect((await put({}, cookie)).status).toBe(422)
    expect((await put({ stepIndex: "1" }, cookie)).status).toBe(422)
    expect((await put({ stepIndex: -1 }, cookie)).status).toBe(422)
    expect((await put({ stepIndex: 4 }, cookie)).status).toBe(422)
    expect((await put({ stepIndex: 1.5 }, cookie)).status).toBe(422)
  })

  it("persists progress per principal", async () => {
    const cookie = mockCookie()

    const saved = await put(
      { stepIndex: 1, answers: { displayName: "  Ada   Lovelace ", role: "lab", bogus: true } },
      cookie,
    )
    expect(saved.status).toBe(200)
    expect(await saved.json()).toMatchObject({
      ok: true,
      onboarding: {
        stepIndex: 1,
        answers: { displayName: "Ada Lovelace", role: "lab" },
        completedAt: null,
        skipped: false,
      },
    })

    const fetched = await get(cookie)
    expect(await fetched.json()).toMatchObject({
      onboarding: { stepIndex: 1, answers: { displayName: "Ada Lovelace" } },
    })

    // Real-auth principal is independent of the mock one.
    const real = await get(authCookie())
    expect(await real.json()).toMatchObject({ onboarding: null })
  })

  it("replaces answers wholesale so cleared fields are deleted", async () => {
    const cookie = mockCookie()
    await put({ stepIndex: 1, answers: { displayName: "Ada", role: "lab" } }, cookie)

    // Wizard sends the full answers object; a cleared displayName is simply
    // absent from `answers` and must not survive the merge.
    const updated = await put({ stepIndex: 2, answers: { role: "team" } }, cookie)
    expect(await updated.json()).toMatchObject({
      onboarding: { answers: { role: "team" } },
    })
    expect((await (await get(cookie)).json()).onboarding.answers).toEqual({ role: "team" })

    // Omitting `answers` entirely keeps the stored answers (step-only save).
    const stepOnly = await put({ stepIndex: 3 }, cookie)
    expect(await stepOnly.json()).toMatchObject({
      onboarding: { stepIndex: 3, answers: { role: "team" } },
    })
  })

  it("records step completions and exposes progress fields", async () => {
    const cookie = mockCookie()

    const first = await put({ stepIndex: 1, completedStep: "welcome" }, cookie)
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({
      onboarding: {
        stepIndex: 1,
        completedSteps: ["welcome"],
        startedAt: expect.any(String),
        stepHistory: [{ stepId: "profile", at: expect.any(String) }],
      },
      progress: {
        percent: 25,
        completedSteps: ["welcome"],
        resumeStepIndex: 1,
        currentStepId: "profile",
        isComplete: false,
      },
    })

    // Advancing again accumulates; going Back does not erase completions.
    await put({ stepIndex: 2, completedStep: "profile" }, cookie)
    const back = await put({ stepIndex: 0 }, cookie)
    expect(await back.json()).toMatchObject({
      onboarding: { stepIndex: 0, completedSteps: ["welcome", "profile"] },
      progress: { percent: 50, resumeStepIndex: 2 },
    })

    // completedStep is idempotent and validated.
    expect((await put({ stepIndex: 1, completedStep: "bogus" }, cookie)).status).toBe(422)
    const again = await put({ stepIndex: 1, completedStep: "welcome" }, cookie)
    expect(await again.json()).toMatchObject({
      onboarding: { completedSteps: ["welcome", "profile"] },
    })
  })

  it("reports 100% progress once the flow completes", async () => {
    const cookie = mockCookie()
    await put({ stepIndex: 1, completedStep: "welcome" }, cookie)
    const done = await post({ skipped: false }, cookie)
    expect(await done.json()).toMatchObject({
      progress: { percent: 100, isComplete: true },
    })
  })
})

describe("POST /api/onboarding", () => {
  it("rejects cross-origin and unauthenticated requests", async () => {
    expect(
      (await post({ skipped: true }, mockCookie(), { origin: "https://evil.example.com" })).status,
    ).toBe(403)
    expect((await post({})).status).toBe(401)
  })

  it("marks the flow complete, honoring the skipped flag", async () => {
    const cookie = mockCookie()
    await put({ stepIndex: 2, answers: { role: "team" } }, cookie)

    const skipped = await post({ skipped: true }, cookie)
    expect(skipped.status).toBe(200)
    const skippedBody = await skipped.json()
    expect(skippedBody).toMatchObject({
      ok: true,
      onboarding: { skipped: true, answers: { role: "team" } },
    })
    expect(skippedBody.onboarding.completedAt).not.toBeNull()

    const finished = await post({}, authCookie())
    expect(await finished.json()).toMatchObject({
      onboarding: { skipped: false },
    })
  })

  it("is idempotent once completed — a later POST cannot flip skipped", async () => {
    const cookie = mockCookie()
    await put({ stepIndex: 1 }, cookie)

    const first = await post({ skipped: false }, cookie)
    const firstBody = await first.json()
    expect(firstBody.onboarding).toMatchObject({ skipped: false })

    // Stray second POST (retry/double-submit) must not downgrade the
    // finished record to skipped or move completedAt.
    const second = await post({ skipped: true }, cookie)
    const secondBody = await second.json()
    expect(secondBody.onboarding.skipped).toBe(false)
    expect(secondBody.onboarding.completedAt).toBe(firstBody.onboarding.completedAt)
  })
})
