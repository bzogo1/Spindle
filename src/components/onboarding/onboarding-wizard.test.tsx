import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { MockSessionProvider } from "@/components/app/mock-session-provider"
import { LanguageProvider } from "@/components/i18n/language-provider"
import type { MockSessionData } from "@/lib/auth/mock-session"
import type { OnboardingRecord } from "@/lib/onboarding"
import { onboardingStorageKey } from "@/lib/onboarding"

import { OnboardingWizard } from "./onboarding-wizard"

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}))

const session: MockSessionData = {
  user: { name: "Bogdan Zogovic", email: "bogdan@example.com" },
  workspace: { name: "Personal workspace", slug: "personal" },
  signedInAt: "2026-11-19T12:00:00.000Z",
}

function renderWizard() {
  return render(
    <LanguageProvider>
      <MockSessionProvider initialSession={session}>
        <OnboardingWizard />
      </MockSessionProvider>
    </LanguageProvider>,
  )
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function requestInfo(
  input: RequestInfo | URL,
  init?: RequestInit,
): { url: string; method: string; body: unknown } {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  const method = init?.method ?? "GET"
  const rawBody = init?.body
  let body: unknown = null
  try {
    body = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody
  } catch {
    body = rawBody
  }
  return { url, method, body }
}

/** Routes fetch calls by method; `onboarding` is the record the API returns. `offline` fails every request. */
function mockApi(record: OnboardingRecord | null = null, offline = false) {
  vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
    const { url, method, body } = requestInfo(input as RequestInfo, init)
    if (!url.includes("/api/onboarding")) throw new Error(`Unexpected fetch: ${url}`)
    if (offline) throw new Error("network down")
    if (method === "GET") return jsonResponse({ ok: true, onboarding: record, steps: [] })
    if (method === "PUT") {
      const b = body as { stepIndex: number; answers?: OnboardingRecord["answers"] }
      return jsonResponse({
        ok: true,
        onboarding: {
          stepIndex: b.stepIndex,
          answers: b.answers ?? {},
          completedAt: null,
          skipped: false,
          updatedAt: new Date().toISOString(),
        },
      })
    }
    if (method === "POST") {
      const b = body as { skipped?: boolean }
      return jsonResponse({
        ok: true,
        onboarding: {
          stepIndex: 3,
          answers: {},
          completedAt: new Date().toISOString(),
          skipped: b.skipped === true,
          updatedAt: new Date().toISOString(),
        },
      })
    }
    throw new Error(`Unexpected method ${method}`)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
})

describe("OnboardingWizard", () => {
  it("loads the welcome step with an accessible step indicator", async () => {
    mockApi()
    renderWizard()

    expect(await screen.findByRole("heading", { name: "Welcome to Spindle" })).toBeInTheDocument()
    const current = document.querySelector('[aria-current="step"]')
    expect(current).toHaveTextContent("Welcome")
    expect(screen.getByRole("progressbar", { name: "Setup progress" })).toBeInTheDocument()
  })

  it("walks through all steps and finishes back to /app", async () => {
    const user = userEvent.setup()
    mockApi()
    renderWizard()

    await screen.findByRole("heading", { name: "Welcome to Spindle" })

    // welcome -> profile
    await user.click(screen.getByRole("button", { name: "Get started" }))
    expect(
      await screen.findByRole("heading", { name: "What should we call you?" }),
    ).toBeInTheDocument()
    expect(document.activeElement).toHaveAttribute("id", "onboarding-step-heading")

    // profile -> preferences (optional name left empty)
    await user.click(screen.getByRole("button", { name: "Next" }))
    expect(
      await screen.findByRole("heading", { name: "How will you use Spindle?" }),
    ).toBeInTheDocument()

    // pick a role, then -> tour
    await user.click(screen.getByRole("radio", { name: "Research lab" }))
    await user.click(screen.getByRole("button", { name: "Next" }))
    expect(await screen.findByRole("heading", { name: "You're all set" })).toBeInTheDocument()

    // tour -> finish
    await user.click(screen.getByRole("button", { name: "Finish setup" }))
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/app"))

    const calls = vi
      .mocked(globalThis.fetch)
      .mock.calls.map(([input, init]) => requestInfo(input as RequestInfo, init as RequestInit))
    const post = calls.find((c) => c.method === "POST")
    expect(post?.body).toEqual({ skipped: false })
    const puts = calls.filter((c) => c.method === "PUT")
    expect(puts.length).toBeGreaterThanOrEqual(3)
  })

  it("blocks advancing on an invalid display name", async () => {
    const user = userEvent.setup()
    mockApi()
    renderWizard()

    await screen.findByRole("heading", { name: "Welcome to Spindle" })
    await user.click(screen.getByRole("button", { name: "Get started" }))

    const input = await screen.findByLabelText("Display name")
    await user.type(input, "x".repeat(81))
    await user.click(screen.getByRole("button", { name: "Next" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("80 characters")
    expect(screen.getByRole("heading", { name: "What should we call you?" })).toBeInTheDocument()
  })

  it("skips the whole flow via the skip button", async () => {
    const user = userEvent.setup()
    mockApi()
    renderWizard()

    await screen.findByRole("heading", { name: "Welcome to Spindle" })
    await user.click(screen.getByRole("button", { name: "Skip setup" }))

    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/app"))
    const calls = vi
      .mocked(globalThis.fetch)
      .mock.calls.map(([input, init]) => requestInfo(input as RequestInfo, init as RequestInit))
    const post = calls.find((c) => c.method === "POST")
    expect(post?.body).toEqual({ skipped: true })
  })

  it("'I'll do this later' exits to the dashboard without completing", async () => {
    const user = userEvent.setup()
    mockApi()
    renderWizard()

    await screen.findByRole("heading", { name: "Welcome to Spindle" })
    await user.click(screen.getByRole("button", { name: "I'll do this later" }))

    // Non-terminal exit: no completion POST, straight to /dashboard (the
    // banner there offers resume; /app would redirect back into the wizard).
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/dashboard"))
    const calls = vi
      .mocked(globalThis.fetch)
      .mock.calls.map(([input, init]) => requestInfo(input as RequestInfo, init as RequestInit))
    expect(calls.some((c) => c.method === "POST")).toBe(false)
  })

  it("resumes from a saved server record", async () => {
    mockApi({
      stepIndex: 2,
      answers: { displayName: "Ada", role: "individual" },
      completedAt: null,
      skipped: false,
      updatedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      completedSteps: ["welcome", "profile"],
      stepHistory: [],
    })
    renderWizard()

    expect(
      await screen.findByRole("heading", { name: "How will you use Spindle?" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "Individual researcher" })).toBeChecked()
  })

  it("resumes at the first incomplete step even when stepIndex points earlier", async () => {
    // User advanced through welcome+profile, then went Back to review
    // welcome (stepIndex 0). Resume must return to preferences — the first
    // step not in completedSteps — not restart at step 0.
    mockApi({
      stepIndex: 0,
      answers: {},
      completedAt: null,
      skipped: false,
      updatedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      completedSteps: ["welcome", "profile"],
      stepHistory: [],
    })
    renderWizard()

    expect(
      await screen.findByRole("heading", { name: "How will you use Spindle?" }),
    ).toBeInTheDocument()
  })

  it("marks the departed step complete when advancing", async () => {
    const user = userEvent.setup()
    mockApi()
    renderWizard()

    await screen.findByRole("heading", { name: "Welcome to Spindle" })
    await user.click(screen.getByRole("button", { name: "Get started" }))
    await screen.findByRole("heading", { name: "What should we call you?" })

    const puts = vi
      .mocked(globalThis.fetch)
      .mock.calls.map(([input, init]) => requestInfo(input as RequestInfo, init as RequestInit))
      .filter((c) => c.method === "PUT")
    expect(puts.at(-1)?.body).toMatchObject({
      stepIndex: 1,
      completedStep: "welcome",
    })
  })

  it("shows completed steps with a check and the percent in the header", async () => {
    const user = userEvent.setup()
    mockApi()
    renderWizard()

    await screen.findByRole("heading", { name: "Welcome to Spindle" })
    expect(screen.getByText(/25%/)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Get started" }))
    await screen.findByRole("heading", { name: "What should we call you?" })
    expect(screen.getByText(/50%/)).toBeInTheDocument()
  })

  it("re-submits a locally-completed record to an empty server before redirecting", async () => {
    // Regression: localStorage says "done" but the server store is empty.
    // The wizard must sync the completion (PUT + POST) and only then
    // redirect — otherwise /app's server-side guard bounces back here forever.
    mockApi(null)
    window.localStorage.setItem(
      onboardingStorageKey(session.user.email),
      JSON.stringify({
        stepIndex: 3,
        answers: { role: "lab" },
        completedAt: new Date().toISOString(),
        skipped: false,
        updatedAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        completedSteps: ["welcome", "profile", "preferences", "tour"],
        stepHistory: [],
      } satisfies OnboardingRecord),
    )
    renderWizard()

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith("/app"))
    const calls = vi
      .mocked(globalThis.fetch)
      .mock.calls.map(([input, init]) => requestInfo(input as RequestInfo, init as RequestInit))
    expect(calls.some((c) => c.method === "PUT")).toBe(true)
    const post = calls.find((c) => c.method === "POST")
    expect(post?.body).toEqual({ skipped: false })
    // No wizard chrome should render once the redirect fires.
    expect(screen.queryByRole("heading", { name: "Welcome to Spindle" })).not.toBeInTheDocument()
  })

  it("does not redirect when a local completion cannot sync to the server", async () => {
    // Fully offline: GET fails AND the sync PUT/POST fail. The wizard must
    // render again instead of navigating to /app (which would loop back).
    mockApi(null, true)
    window.localStorage.setItem(
      onboardingStorageKey(session.user.email),
      JSON.stringify({
        stepIndex: 3,
        answers: {},
        completedAt: new Date().toISOString(),
        skipped: true,
        updatedAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        completedSteps: [],
        stepHistory: [],
      } satisfies OnboardingRecord),
    )
    renderWizard()

    expect(await screen.findByRole("heading", { name: "You're all set" })).toBeInTheDocument()
    expect(routerMock.replace).not.toHaveBeenCalled()
    expect(routerMock.push).not.toHaveBeenCalled()
  })

  it("merges newer localStorage progress over a stale server record and re-syncs it", async () => {
    // Regression: the server returns an OLD in-progress record while
    // localStorage holds newer offline work. The wizard must resume from the
    // merged (newer) record — not the stale server one — and PUT the missing
    // completed steps back to the server.
    const staleServer: OnboardingRecord = {
      stepIndex: 1,
      answers: {},
      completedAt: null,
      skipped: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedSteps: ["welcome"],
      stepHistory: [],
    }
    mockApi(staleServer)
    window.localStorage.setItem(
      onboardingStorageKey(session.user.email),
      JSON.stringify({
        stepIndex: 2,
        answers: { displayName: "Ada", role: "lab" },
        completedAt: null,
        skipped: false,
        updatedAt: "2026-01-02T00:00:00.000Z",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedSteps: ["welcome", "profile"],
        stepHistory: [],
      } satisfies OnboardingRecord),
    )
    renderWizard()

    // Stored record wins: resume lands on preferences (first incomplete),
    // not profile where the stale server record would have sent us.
    expect(
      await screen.findByRole("heading", { name: "How will you use Spindle?" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "Research lab" })).toBeChecked()

    // The merged record is re-synced: a PUT replays "profile" — the step the
    // server is missing — along with the stored stepIndex and answers.
    await waitFor(() => {
      const calls = vi
        .mocked(globalThis.fetch)
        .mock.calls.map(([input, init]) => requestInfo(input as RequestInfo, init as RequestInit))
      const syncPut = calls.find(
        (c) =>
          c.method === "PUT" && (c.body as { completedStep?: string }).completedStep === "profile",
      )
      expect(syncPut?.body).toMatchObject({
        stepIndex: 2,
        answers: { displayName: "Ada", role: "lab" },
      })
    })
  })

  it("falls back to localStorage when the API is unreachable", async () => {
    const user = userEvent.setup()
    mockApi(null, true)
    // Pre-seed a stored draft for this user.
    window.localStorage.setItem(
      onboardingStorageKey(session.user.email),
      JSON.stringify({
        stepIndex: 1,
        answers: { displayName: "Stored Name" },
        completedAt: null,
        skipped: false,
        updatedAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        completedSteps: ["welcome"],
        stepHistory: [],
      }),
    )
    renderWizard()

    expect(
      await screen.findByRole("heading", { name: "What should we call you?" }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText("Display name")).toHaveValue("Stored Name")

    // Progress writes go to localStorage instead of the API.
    await user.click(screen.getByRole("button", { name: "Next" }))
    await screen.findByRole("heading", { name: "How will you use Spindle?" })
    const stored = JSON.parse(
      window.localStorage.getItem(onboardingStorageKey(session.user.email)) ?? "{}",
    ) as OnboardingRecord
    expect(stored.stepIndex).toBe(2)
    expect(stored.answers.displayName).toBe("Stored Name")
  })
})
