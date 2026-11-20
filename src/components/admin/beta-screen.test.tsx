import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { BetaAdminScreen, type BetaProgramRow } from "./beta-screen"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function row(overrides: Partial<BetaProgramRow> = {}): BetaProgramRow {
  return {
    id: "beta_1",
    name: "AI copilot",
    description: "Try the new copilot.",
    status: "open",
    enrolledCount: 2,
    createdAt: "2020-01-01T00:00:00.000Z",
    ...overrides,
  }
}

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function isProgramsUrl(input: RequestInfo | URL) {
  const url = typeof input === "string" ? input : input.toString()
  return url === "/api/admin/beta"
}

function mockList(programs: BetaProgramRow[] = [row()]) {
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString()
    const method = init?.method ?? "GET"

    if (method === "POST" && isProgramsUrl(input)) {
      return Promise.resolve(
        jsonResponse({
          ok: true,
          program: row({ id: "beta_new", name: "New program", enrolledCount: 0 }),
        }),
      )
    }
    if (method === "PATCH" && url === "/api/admin/beta/beta_1") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      if (body.status) {
        return Promise.resolve(
          jsonResponse({
            ok: true,
            program: row({ status: body.status as "open" | "closed" }),
          }),
        )
      }
      return Promise.resolve(jsonResponse({ ok: true, program: row() }))
    }
    if (method === "GET" && url === "/api/admin/beta/beta_1") {
      return Promise.resolve(jsonResponse({ ok: true, program: row(), enrollments: ["u1", "u2"] }))
    }
    if (isProgramsUrl(input)) {
      return Promise.resolve(jsonResponse({ ok: true, programs }))
    }
    return Promise.resolve(jsonResponse({ ok: false, message: "unexpected" }, 500))
  })
}

describe("BetaAdminScreen", () => {
  it("lists programs with status and enrollment counts", async () => {
    mockList([row(), row({ id: "beta_2", name: "Dark mode", status: "closed", enrolledCount: 5 })])
    render(<BetaAdminScreen />)

    expect(await screen.findByText("AI copilot")).toBeInTheDocument()
    expect(screen.getByText("Dark mode")).toBeInTheDocument()
    // "open"/"closed" badges appear in the table; the create panel also
    // mentions "open", so assert presence rather than uniqueness.
    expect(screen.getAllByText("open").length).toBeGreaterThan(0)
    expect(screen.getAllByText("closed").length).toBeGreaterThan(0)
    expect(screen.getByText("2")).toBeInTheDocument()
    expect(screen.getByText("5")).toBeInTheDocument()
  })

  it("shows an empty state when there are no programs", async () => {
    mockList([])
    render(<BetaAdminScreen />)
    expect(await screen.findByText("No beta programs yet")).toBeInTheDocument()
  })

  it("creates a program via POST and reloads the list", async () => {
    mockList([])
    const user = userEvent.setup()
    render(<BetaAdminScreen />)

    await screen.findByText("No beta programs yet")
    await user.type(screen.getByLabelText("Name"), "Search v2")
    await user.type(screen.getByLabelText("Description"), "New search.")
    await user.click(screen.getByRole("button", { name: /Create program/ }))

    await waitFor(() => {
      const createCall = fetchMock.mock.calls.find(
        ([input, init]) => isProgramsUrl(input) && init?.method === "POST",
      )
      expect(createCall).toBeDefined()
      expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
        name: "Search v2",
        description: "New search.",
      })
    })
    expect(await screen.findByText("Beta program created.")).toBeInTheDocument()
  })

  it("expands a program to manage enrollments", async () => {
    mockList([row()])
    const user = userEvent.setup()
    render(<BetaAdminScreen />)

    await screen.findByText("AI copilot")
    await user.click(screen.getByRole("button", { name: "Manage" }))

    // Enrollments load via GET /api/admin/beta/beta_1
    expect(await screen.findByText("u1")).toBeInTheDocument()
    expect(screen.getByText("u2")).toBeInTheDocument()

    // Enroll by user id
    await user.type(screen.getByLabelText("Enroll by user ID or email"), "u42")
    await user.click(screen.getByRole("button", { name: "Enroll" }))

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        ([input, init]) => String(input) === "/api/admin/beta/beta_1" && init?.method === "PATCH",
      )
      expect(patchCall).toBeDefined()
      expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({
        action: "enroll",
        userId: "u42",
      })
    })

    // Unenroll an existing enrollment
    const u1Row = screen.getByText("u1").closest("li")
    expect(u1Row).not.toBeNull()
    await user.click(within(u1Row as HTMLElement).getByRole("button", { name: "Unenroll" }))

    await waitFor(() => {
      const unenrollCall = fetchMock.mock.calls.filter(
        ([input, init]) => String(input) === "/api/admin/beta/beta_1" && init?.method === "PATCH",
      )
      const last = unenrollCall.at(-1)
      expect(JSON.parse(String(last?.[1]?.body))).toEqual({
        action: "unenroll",
        userId: "u1",
      })
    })
  })

  it("sends user:/mock: principals as userId and plain emails as email", async () => {
    mockList([row()])
    const user = userEvent.setup()
    render(<BetaAdminScreen />)

    await screen.findByText("AI copilot")
    await user.click(screen.getByRole("button", { name: "Manage" }))
    const input = await screen.findByLabelText("Enroll by user ID or email")
    const enrollButton = screen.getByRole("button", { name: "Enroll" })

    const patchBodies = () =>
      fetchMock.mock.calls
        .filter(
          ([input, init]) => String(input) === "/api/admin/beta/beta_1" && init?.method === "PATCH",
        )
        .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>)

    await user.type(input, "mock:dev@mock.local")
    await user.click(enrollButton)
    await waitFor(() =>
      expect(patchBodies().at(-1)).toEqual({
        action: "enroll",
        userId: "mock:dev@mock.local",
      }),
    )

    await user.clear(input)
    await user.type(input, "user:u-9")
    await user.click(enrollButton)
    await waitFor(() =>
      expect(patchBodies().at(-1)).toEqual({
        action: "enroll",
        userId: "user:u-9",
      }),
    )

    await user.clear(input)
    await user.type(input, "name@example.com")
    await user.click(enrollButton)
    await waitFor(() =>
      expect(patchBodies().at(-1)).toEqual({
        action: "enroll",
        email: "name@example.com",
      }),
    )
  })

  it("toggles program status via PATCH", async () => {
    mockList([row()])
    const user = userEvent.setup()
    render(<BetaAdminScreen />)

    await screen.findByText("AI copilot")
    await user.click(screen.getByRole("button", { name: "Close" }))

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        ([input, init]) => String(input) === "/api/admin/beta/beta_1" && init?.method === "PATCH",
      )
      expect(patchCall).toBeDefined()
      expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({ status: "closed" })
    })
  })
})
