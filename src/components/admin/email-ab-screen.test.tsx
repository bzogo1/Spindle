import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { EmailAbScreen, type EmailAbExperimentRow } from "./email-ab-screen"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const EXPERIMENTS: EmailAbExperimentRow[] = [
  {
    id: "exp_1",
    name: "Welcome subject test",
    emailKey: "welcome-day-0",
    variants: [
      { key: "control", subject: "Welcome aboard", bodyPreview: "Hi there" },
      { key: "b", subject: "You're in!" },
    ],
    status: "running",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "exp_2",
    name: "Newsletter spring",
    emailKey: "newsletter-spring",
    variants: [
      { key: "control", subject: "Spring news" },
      { key: "b", subject: "Big spring update" },
      { key: "c", subject: "Spring is here" },
    ],
    status: "draft",
    createdAt: "2026-01-02T00:00:00.000Z",
  },
  {
    id: "exp_3",
    name: "Old concluded",
    emailKey: "tips-day-3",
    variants: [
      { key: "control", subject: "Tips" },
      { key: "b", subject: "Tips v2" },
    ],
    status: "concluded",
    winnerKey: "b",
    createdAt: "2026-01-03T00:00:00.000Z",
    concludedAt: "2026-01-10T00:00:00.000Z",
  },
]

let experimentsState: EmailAbExperimentRow[] = [...EXPERIMENTS]
let fetchMock: ReturnType<typeof vi.fn>

function mockFetch() {
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === "/api/admin/email-ab" && (!init || init.method === undefined)) {
      return Promise.resolve(jsonResponse({ ok: true, experiments: experimentsState }))
    }
    if (url === "/api/admin/email-ab" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as {
        name: string
        emailKey: string
        variants: Array<{ key: string; subject: string; body?: string }>
      }
      const experiment: EmailAbExperimentRow = {
        id: `exp_new_${experimentsState.length}`,
        name: body.name,
        emailKey: body.emailKey,
        variants: body.variants.map((v) => ({
          key: v.key,
          subject: v.subject,
          ...(v.body ? { bodyPreview: v.body.slice(0, 160) } : {}),
        })),
        status: "draft",
        createdAt: "2026-02-01T00:00:00.000Z",
      }
      experimentsState = [...experimentsState, experiment]
      return Promise.resolve(jsonResponse({ ok: true, experiment }))
    }
    const match = url.match(/^\/api\/admin\/email-ab\/(exp_[^/]+)$/)
    if (match && init?.method === "PATCH") {
      const id = match[1]
      const body = JSON.parse(String(init.body)) as {
        status?: EmailAbExperimentRow["status"]
        winnerKey?: string
      }
      const existing = experimentsState.find((e) => e.id === id)
      if (!existing) {
        return Promise.resolve(jsonResponse({ ok: false, message: "Not found" }, 404))
      }
      const updated: EmailAbExperimentRow = {
        ...existing,
        status: body.status ?? existing.status,
        ...(body.winnerKey ? { winnerKey: body.winnerKey } : {}),
        ...(body.status === "concluded" ? { concludedAt: "2026-02-02T00:00:00.000Z" } : {}),
      }
      experimentsState = experimentsState.map((e) => (e.id === id ? updated : e))
      return Promise.resolve(jsonResponse({ ok: true, experiment: updated }))
    }
    if (match && !init?.method) {
      const existing = experimentsState.find((e) => e.id === match[1])
      return Promise.resolve(
        existing
          ? jsonResponse({ ok: true, experiment: existing })
          : jsonResponse({ ok: false, message: "Not found" }, 404),
      )
    }
    return Promise.resolve(jsonResponse({ ok: false, message: "Unexpected" }, 500))
  })
}

beforeEach(() => {
  experimentsState = [...EXPERIMENTS]
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
  mockFetch()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("EmailAbScreen", () => {
  it("renders the experiment list with status badges and variant counts", async () => {
    render(<EmailAbScreen />)

    expect(await screen.findByText("Welcome subject test")).toBeInTheDocument()
    expect(screen.getByText("Newsletter spring")).toBeInTheDocument()
    expect(screen.getByText("welcome-day-0")).toBeInTheDocument()
    expect(screen.getAllByText("running").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("draft").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("concluded").length).toBeGreaterThanOrEqual(1)
  })

  it("expands an experiment to show variants, actions, and honest results copy", async () => {
    render(<EmailAbScreen />)
    await screen.findByText("Welcome subject test")

    await userEvent.click(screen.getByRole("button", { name: "Expand Welcome subject test" }))

    expect(await screen.findByText(/You're in!/)).toBeInTheDocument()
    expect(screen.getByText(/assignment only/i)).toBeInTheDocument()
    expect(screen.getAllByText(/not tracked yet/i).length).toBeGreaterThan(0)
    // Running experiment offers Pause + winner picker + Conclude.
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Conclude" })).toBeInTheDocument()
  })

  it("shows variant subjects for a concluded experiment with the winner badge", async () => {
    render(<EmailAbScreen />)
    await screen.findByText("Old concluded")

    await userEvent.click(screen.getByRole("button", { name: "Expand Old concluded" }))

    expect(await screen.findByText(/Tips v2/)).toBeInTheDocument()
    expect(screen.getByText("winner")).toBeInTheDocument()
    // Concluded experiments offer no status actions.
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument()
  })

  it("starts a draft experiment via the detail actions", async () => {
    render(<EmailAbScreen />)
    await screen.findByText("Newsletter spring")

    await userEvent.click(screen.getByRole("button", { name: "Expand Newsletter spring" }))
    await userEvent.click(await screen.findByRole("button", { name: "Start" }))

    await waitFor(() => {
      expect(experimentsState.find((e) => e.id === "exp_2")?.status).toBe("running")
    })
  })

  it("creates an experiment through the form", async () => {
    render(<EmailAbScreen />)
    await screen.findByText("Welcome subject test")

    await userEvent.type(screen.getByLabelText("Name"), "New test")
    await userEvent.type(screen.getByLabelText("Email key"), "tips-day-3")
    await userEvent.type(screen.getByLabelText("Variant 1 key"), "control")
    await userEvent.type(screen.getByLabelText("Variant 1 subject"), "Subject A")
    await userEvent.type(screen.getByLabelText("Variant 2 key"), "b")
    await userEvent.type(screen.getByLabelText("Variant 2 subject"), "Subject B")

    await userEvent.click(screen.getByRole("button", { name: "Create experiment" }))

    expect(await screen.findByText("New test")).toBeInTheDocument()
    expect(experimentsState.at(-1)).toMatchObject({
      name: "New test",
      emailKey: "tips-day-3",
      status: "draft",
    })
    expect(screen.getByText(/Draft experiment saved/)).toBeInTheDocument()
  })

  it("shows an error state with retry when loading fails", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ ok: false, message: "Denied" }, 500)),
    )
    render(<EmailAbScreen />)

    expect(await screen.findByText("Experiments unavailable")).toBeInTheDocument()
    expect(screen.getByText("Denied")).toBeInTheDocument()
  })

  it("shows the empty state when there are no experiments", async () => {
    experimentsState = []
    render(<EmailAbScreen />)
    expect(await screen.findByText("No experiments yet")).toBeInTheDocument()
  })
})
