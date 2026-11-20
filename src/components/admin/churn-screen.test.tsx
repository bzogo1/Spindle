import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ChurnScore } from "@/lib/churn"
import { ChurnScreen } from "./churn-screen"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function score(overrides: Partial<ChurnScore>): ChurnScore {
  return {
    userId: "u1",
    email: "user@example.com",
    name: null,
    risk: "low",
    score: 10,
    factors: [
      { signal: "recency", impact: 0, detail: "Active within the last week (1d ago)." },
      { signal: "sessions", impact: 0, detail: "2 active sessions." },
    ],
    computedAt: "2026-06-15T12:00:00.000Z",
    ...overrides,
  }
}

const SCORES: ChurnScore[] = [
  score({
    userId: "u-high",
    email: "risky@example.com",
    name: "Risky User",
    risk: "high",
    score: 82,
    factors: [
      { signal: "recency", impact: 45, detail: "No observed activity for 120 days." },
      { signal: "sessions", impact: 15, detail: "No active sessions." },
      { signal: "email_verified", impact: 10, detail: "Email address is not verified." },
    ],
  }),
  score({
    userId: "u-low",
    email: "calm@example.com",
    risk: "low",
    score: 4,
  }),
]

let fetchMock: ReturnType<typeof vi.fn>

function mockFetch(
  scores: ChurnScore[] = SCORES,
  opts: { status?: number; message?: string } = {},
) {
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith("/api/admin/churn")) {
      if (opts.status && opts.status !== 200) {
        return Promise.resolve(
          jsonResponse({ ok: false, message: opts.message ?? "Nope" }, opts.status),
        )
      }
      return Promise.resolve(
        jsonResponse({
          ok: true,
          method: "heuristic",
          computedAt: "2026-06-15T12:00:00.000Z",
          minRisk: "low",
          limit: 500,
          total: scores.length,
          returned: scores.length,
          scores,
        }),
      )
    }
    return Promise.resolve(jsonResponse({ ok: false }, 404))
  })
}

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("ChurnScreen", () => {
  it("loads scores, renders the ranked table, and shows honest heuristic copy", async () => {
    mockFetch()
    render(<ChurnScreen />)

    expect(await screen.findByText("risky@example.com")).toBeInTheDocument()
    expect(screen.getByText("calm@example.com")).toBeInTheDocument()
    expect(screen.getByText("High risk")).toBeInTheDocument()
    expect(screen.getByText("Low risk")).toBeInTheDocument()
    expect(screen.getByText("82")).toBeInTheDocument()

    // Honest labeling: heuristic, not ML.
    expect(screen.getByText(/heuristic scores, not a machine-learning/i)).toBeInTheDocument()
    expect(screen.getByText(/not as a prediction/i)).toBeInTheDocument()

    // Highest score first.
    const emails = screen.getAllByText(/@example\.com/)
    expect(emails[0]).toHaveTextContent("risky@example.com")

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/admin/churn?"), {
      cache: "no-store",
    })
  })

  it("expands a row to reveal the full factor breakdown", async () => {
    mockFetch()
    render(<ChurnScreen />)

    const row = await screen.findByText("risky@example.com")
    await userEvent.click(row)

    expect(await screen.findByText("No observed activity for 120 days.")).toBeInTheDocument()
    expect(screen.getByText("No active sessions.")).toBeInTheDocument()
    expect(screen.getByText("Email address is not verified.")).toBeInTheDocument()
  })

  it("filters loaded scores by the search box", async () => {
    mockFetch()
    render(<ChurnScreen />)

    await screen.findByText("risky@example.com")
    await userEvent.type(screen.getByLabelText("Search email or name"), "calm")

    await waitFor(() => {
      expect(screen.queryByText("risky@example.com")).not.toBeInTheDocument()
    })
    expect(screen.getByText("calm@example.com")).toBeInTheDocument()
  })

  it("refetches with minRisk when the filter changes", async () => {
    mockFetch()
    render(<ChurnScreen />)

    await screen.findByText("risky@example.com")
    await userEvent.click(screen.getByLabelText("Minimum risk"))
    await userEvent.click(await screen.findByText("High risk only"))

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => String(call[0]))
      expect(urls.some((u) => u.includes("minRisk=high"))).toBe(true)
    })
  })

  it("shows the empty state when there are no scores", async () => {
    mockFetch([])
    render(<ChurnScreen />)
    expect(await screen.findByText("No users to score")).toBeInTheDocument()
  })

  it("shows an error state with retry on failure", async () => {
    mockFetch(SCORES, { status: 500, message: "Scoring exploded" })
    render(<ChurnScreen />)

    expect(await screen.findByText("Churn scores unavailable")).toBeInTheDocument()
    expect(screen.getByText("Scoring exploded")).toBeInTheDocument()

    // Retry recovers once the endpoint succeeds.
    mockFetch()
    await userEvent.click(screen.getByRole("button", { name: /retry/i }))
    expect(await screen.findByText("risky@example.com")).toBeInTheDocument()
  })
})
