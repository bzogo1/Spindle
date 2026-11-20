// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { MemoryAuthBackend, setAuthBackendForTests } from "@/lib/auth/backend"
import { feedbackStore } from "@/lib/feedback"
import { completeOnboarding, resetOnboardingStoreForTests } from "@/lib/onboarding"

import { computeChurnRisk, scoreAllUsers, type ChurnSignals, type ChurnUserInput } from "./churn"

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: { user: { findMany: mocks.findMany } },
}))

const NOW = new Date("2026-06-15T12:00:00.000Z")

function user(overrides: Partial<ChurnUserInput> = {}): ChurnUserInput {
  return {
    id: "u1",
    email: "user@example.com",
    name: "User",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

/** Fully healthy signal set: recently active, engaged, verified. */
function healthySignals(overrides: Partial<ChurnSignals> = {}): ChurnSignals {
  return {
    daysSinceLastActivity: 1,
    sessionCount: 2,
    emailVerified: true,
    onboardingComplete: true,
    feedbackCount: 0,
    negativeFeedbackCount: 0,
    ...overrides,
  }
}

describe("computeChurnRisk", () => {
  it("scores a healthy, recently active user as low risk", () => {
    const score = computeChurnRisk(user(), healthySignals(), NOW)
    expect(score.risk).toBe("low")
    expect(score.score).toBeLessThan(30)
    expect(score.score).toBeGreaterThanOrEqual(0)
    expect(score.computedAt).toBe(NOW.toISOString())
    expect(score.factors.length).toBeGreaterThan(0)
  })

  it("scores an inactive, unverified, non-onboarded user with bug reports as high risk", () => {
    const score = computeChurnRisk(
      user(),
      healthySignals({
        daysSinceLastActivity: 75,
        sessionCount: 0,
        emailVerified: false,
        onboardingComplete: false,
        negativeFeedbackCount: 2,
      }),
      NOW,
    )
    expect(score.risk).toBe("high")
    expect(score.score).toBeGreaterThanOrEqual(60)
    // Recency is the heaviest signal and must top the factor list.
    expect(score.factors[0].signal).toBe("recency")
  })

  it("treats missing signals as neutral-ish rather than maximally bad", () => {
    const score = computeChurnRisk(
      user({ createdAt: "2025-01-01T00:00:00.000Z" }),
      healthySignals({
        daysSinceLastActivity: null,
        sessionCount: null,
        emailVerified: null,
        onboardingComplete: null,
      }),
      NOW,
    )
    expect(score.score).toBeLessThan(30)
    expect(score.risk).toBe("low")
  })

  it("is softer on missing activity data for brand-new accounts", () => {
    const fresh = computeChurnRisk(
      user({ createdAt: "2026-06-10T00:00:00.000Z" }),
      healthySignals({ daysSinceLastActivity: null, sessionCount: null }),
      NOW,
    )
    const old = computeChurnRisk(
      user({ createdAt: "2025-01-01T00:00:00.000Z" }),
      healthySignals({ daysSinceLastActivity: null, sessionCount: null }),
      NOW,
    )
    expect(fresh.score).toBeLessThan(old.score)
  })

  it("applies the medium band between 30 and 60 points", () => {
    // ~14d inactive + no sessions + unverified + incomplete onboarding ≈ 40.
    const score = computeChurnRisk(
      user(),
      healthySignals({
        daysSinceLastActivity: 40,
        sessionCount: 0,
        emailVerified: false,
        onboardingComplete: false,
      }),
      NOW,
    )
    expect(score.score).toBeGreaterThanOrEqual(30)
    expect(score.score).toBeLessThan(60)
    expect(score.risk).toBe("medium")
  })

  it("caps the score and floors it at 0", () => {
    // Worst-case signals sum to 90 (45 recency + 15 sessions + 10 verified
    // + 10 onboarding + 10 feedback) — the heuristic tops out below 100.
    const worst = computeChurnRisk(
      user(),
      healthySignals({
        daysSinceLastActivity: 400,
        sessionCount: 0,
        emailVerified: false,
        onboardingComplete: false,
        negativeFeedbackCount: 9,
      }),
      NOW,
    )
    expect(worst.score).toBe(90)
    expect(worst.score).toBeLessThanOrEqual(100)
    expect(worst.risk).toBe("high")

    const best = computeChurnRisk(user(), healthySignals(), NOW)
    expect(best.score).toBe(0)
  })

  it("sorts factors by impact descending", () => {
    const score = computeChurnRisk(
      user(),
      healthySignals({ daysSinceLastActivity: 50, sessionCount: 0 }),
      NOW,
    )
    const impacts = score.factors.map((f) => f.impact)
    expect([...impacts].sort((a, b) => b - a)).toEqual(impacts)
  })
})

describe("scoreAllUsers", () => {
  beforeEach(() => {
    mocks.findMany.mockReset()
    mocks.findMany.mockResolvedValue([])
    feedbackStore.clear()
    resetOnboardingStoreForTests()
  })

  afterEach(() => {
    setAuthBackendForTests(undefined)
    feedbackStore.clear()
    resetOnboardingStoreForTests()
  })

  it("returns an empty list when no users exist anywhere", async () => {
    setAuthBackendForTests(new MemoryAuthBackend())
    await expect(scoreAllUsers({ now: NOW })).resolves.toEqual([])
  })

  it("scores auth-backend users with session, verification, and onboarding signals", async () => {
    const backend = new MemoryAuthBackend()
    setAuthBackendForTests(backend)

    const { user: signedUp } = await backend.signUp({
      email: "churn@example.com",
      password: "correct horse battery staple",
      workspaceName: "Churn WS",
      name: "Churn User",
    })
    // No sign-in -> no sessions; email unverified; onboarding never started.
    // Signup is recent, so recency stays low — but the other signals add up.
    const scores = await scoreAllUsers({ now: new Date() })
    const mine = scores.find((s) => s.email === "churn@example.com")
    expect(mine).toBeDefined()
    expect(mine!.userId).toBe(signedUp.id)
    expect(mine!.factors.map((f) => f.signal)).toContain("sessions")
    expect(mine!.factors.map((f) => f.signal)).toContain("onboarding")
    const sessionsFactor = mine!.factors.find((f) => f.signal === "sessions")
    expect(sessionsFactor?.detail).toContain("No active sessions")
    expect(mine!.risk).not.toBe("low")
  })

  it("reflects sessions and verified email after sign-in", async () => {
    const backend = new MemoryAuthBackend()
    setAuthBackendForTests(backend)

    await backend.signUp({
      email: "active@example.com",
      password: "correct horse battery staple",
      workspaceName: "Active WS",
    })
    // Two sign-ins -> two active sessions (a single session scores +8).
    const first = await backend.signIn("active@example.com", "correct horse battery staple")
    const second = await backend.signIn("active@example.com", "correct horse battery staple")
    expect(first.status).toBe("ok")
    expect(second.status).toBe("ok")
    await backend.markEmailVerified((await backend.getUserByEmail("active@example.com"))!.id)
    completeOnboarding(`user:${(await backend.getUserByEmail("active@example.com"))!.id}`, {
      skipped: false,
    })

    const scores = await scoreAllUsers({ now: new Date() })
    const mine = scores.find((s) => s.email === "active@example.com")
    expect(mine).toBeDefined()
    expect(mine!.factors.find((f) => f.signal === "sessions")?.impact).toBe(0)
    expect(mine!.factors.find((f) => f.signal === "email_verified")?.impact).toBe(0)
    expect(mine!.factors.find((f) => f.signal === "onboarding")?.impact).toBe(0)
    expect(mine!.risk).toBe("low")
  })

  it("counts bug-report feedback matched by email as a negative signal", async () => {
    const backend = new MemoryAuthBackend()
    setAuthBackendForTests(backend)

    await backend.signUp({
      email: "feedback@example.com",
      password: "correct horse battery staple",
      workspaceName: "FB WS",
    })
    feedbackStore.add({
      category: "bug",
      message: "Everything is broken for me.",
      email: "feedback@example.com",
    })
    feedbackStore.add({
      category: "bug",
      message: "Still broken after retry.",
      email: "FEEDBACK@example.com",
    })
    feedbackStore.add({
      category: "idea",
      message: "Please add dark mode.",
      email: "someone-else@example.com",
    })

    const scores = await scoreAllUsers({ now: new Date() })
    const mine = scores.find((s) => s.email === "feedback@example.com")
    expect(mine).toBeDefined()
    const factor = mine!.factors.find((f) => f.signal === "negative_feedback")
    expect(factor?.impact).toBe(10)
  })

  it("merges Prisma directory users with null verification when the backend does not know them", async () => {
    setAuthBackendForTests(new MemoryAuthBackend())
    mocks.findMany.mockResolvedValue([
      {
        id: "prisma-1",
        email: "prisma-only@example.com",
        name: "Prisma Only",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ])

    const scores = await scoreAllUsers({ now: NOW })
    const mine = scores.find((s) => s.email === "prisma-only@example.com")
    expect(mine).toBeDefined()
    expect(mine!.userId).toBe("prisma-1")
    // No backend record -> verification/onboarding stay unknown (neutral-ish),
    // but recency is measured from the account creation date.
    const recency = mine!.factors.find((f) => f.signal === "recency")
    expect(recency?.detail).toContain("No observed activity")
  })
})
