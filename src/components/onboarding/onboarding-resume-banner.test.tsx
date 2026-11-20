import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { OnboardingRecord } from "@/lib/onboarding"

import { OnboardingResumeBanner } from "./onboarding-resume-banner"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function incompleteRecord(overrides: Partial<OnboardingRecord> = {}): OnboardingRecord {
  return {
    stepIndex: 1,
    answers: {},
    completedAt: null,
    skipped: false,
    updatedAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    completedSteps: ["welcome"],
    stepHistory: [],
    ...overrides,
  }
}

function mockApi(body: unknown) {
  vi.mocked(globalThis.fetch).mockImplementation(async () => jsonResponse(body))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("OnboardingResumeBanner", () => {
  it("shows progress and a resume link for incomplete onboardings", async () => {
    mockApi({
      ok: true,
      onboarding: incompleteRecord(),
      progress: { percent: 25, isComplete: false },
    })
    render(<OnboardingResumeBanner />)

    expect(await screen.findByText("Continue setup")).toBeInTheDocument()
    expect(screen.getByText(/25% complete/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Resume/ })).toHaveAttribute("href", "/app/onboarding")
  })

  it.each([
    [
      "completed",
      {
        ok: true,
        onboarding: incompleteRecord({ completedAt: new Date().toISOString() }),
        progress: { percent: 100, isComplete: true },
      },
    ],
    ["missing", { ok: true, onboarding: null, progress: null }],
  ])("renders nothing when the record is %s", async (_label, body) => {
    mockApi(body)
    const { container } = render(<OnboardingResumeBanner />)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    // Give the state update a tick, then assert nothing rendered.
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it("renders nothing when the API is unreachable", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error("network down"))
    const { container } = render(<OnboardingResumeBanner />)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it("hides on dismiss for the current view", async () => {
    const user = userEvent.setup()
    mockApi({
      ok: true,
      onboarding: incompleteRecord(),
      progress: { percent: 50 },
    })
    render(<OnboardingResumeBanner />)

    await screen.findByText("Continue setup")
    await user.click(screen.getByRole("button", { name: "Dismiss setup reminder" }))
    expect(screen.queryByText("Continue setup")).not.toBeInTheDocument()
  })
})
