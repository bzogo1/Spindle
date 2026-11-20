import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { FeatureFlagsScreen, type FeatureFlagRow } from "./feature-flags-screen"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const FLAGS: FeatureFlagRow[] = [
  {
    id: "ff_1",
    key: "new-dashboard",
    name: "New dashboard",
    description: "Experimental shell",
    enabled: true,
    rolloutPercent: 25,
    targetUserIds: ["u-1"],
    targetEmails: ["vip@example.com"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  },
  {
    id: "ff_2",
    key: "docs-v2",
    name: "Docs v2",
    description: "",
    enabled: false,
    createdAt: "2026-01-03T00:00:00.000Z",
    updatedAt: "2026-01-03T00:00:00.000Z",
  },
]

let flagsState: FeatureFlagRow[] = [...FLAGS]
let fetchMock: ReturnType<typeof vi.fn>

function mockFetch() {
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"

    if (url === "/api/admin/feature-flags" && method === "GET") {
      return Promise.resolve(jsonResponse({ ok: true, flags: flagsState }))
    }
    if (url === "/api/admin/feature-flags" && method === "POST") {
      const body = JSON.parse(String(init?.body)) as Partial<FeatureFlagRow> & { key: string }
      const created: FeatureFlagRow = {
        id: `ff_${flagsState.length + 10}`,
        description: "",
        enabled: false,
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z",
        ...body,
      } as FeatureFlagRow
      flagsState = [...flagsState, created]
      return Promise.resolve(jsonResponse({ ok: true, flag: created }))
    }
    if (url === "/api/admin/feature-flags/evaluate" && method === "POST") {
      const body = JSON.parse(String(init?.body)) as { email?: string }
      return Promise.resolve(
        jsonResponse({
          ok: true,
          flags: body.email === "vip@example.com" ? ["new-dashboard"] : [],
        }),
      )
    }
    const patchMatch = url.match(/^\/api\/admin\/feature-flags\/(ff_\d+)$/)
    if (patchMatch) {
      const id = patchMatch[1]
      if (method === "PATCH") {
        const body = JSON.parse(String(init?.body)) as Partial<FeatureFlagRow>
        flagsState = flagsState.map((flag) => (flag.id === id ? { ...flag, ...body } : flag))
        const updated = flagsState.find((flag) => flag.id === id)
        return Promise.resolve(jsonResponse({ ok: true, flag: updated }))
      }
      if (method === "DELETE") {
        flagsState = flagsState.filter((flag) => flag.id !== id)
        return Promise.resolve(jsonResponse({ ok: true, deleted: true }))
      }
    }
    return Promise.resolve(jsonResponse({ ok: false, message: "Not found" }, 404))
  })
}

beforeEach(() => {
  flagsState = [...FLAGS]
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
  mockFetch()
  window.confirm = vi.fn(() => true)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("FeatureFlagsScreen", () => {
  it("lists flags with key, rollout, and target counts", async () => {
    render(<FeatureFlagsScreen />)
    expect(await screen.findByText("new-dashboard")).toBeInTheDocument()
    expect(screen.getByText("docs-v2")).toBeInTheDocument()
    expect(screen.getByText("25%")).toBeInTheDocument()
    expect(screen.getAllByText("2").length).toBeGreaterThan(0)
  })

  it("creates a flag via the form", async () => {
    const user = userEvent.setup()
    render(<FeatureFlagsScreen />)
    await screen.findByText("new-dashboard")

    await user.type(screen.getByLabelText("Key"), "beta-feature")
    await user.type(screen.getByLabelText("Name"), "Beta feature")
    await user.type(screen.getByLabelText("Rollout % (optional)"), "10")
    await user.click(screen.getByRole("button", { name: "Create flag" }))

    await waitFor(() => {
      expect(screen.getByText("beta-feature")).toBeInTheDocument()
    })
    const postCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input) === "/api/admin/feature-flags" && init?.method === "POST",
    )
    expect(postCall).toBeDefined()
    const body = JSON.parse(String(postCall![1]?.body))
    expect(body.key).toBe("beta-feature")
    expect(body.rolloutPercent).toBe(10)
  })

  it("omits rolloutPercent on create when the field is blank", async () => {
    const user = userEvent.setup()
    render(<FeatureFlagsScreen />)
    await screen.findByText("new-dashboard")

    await user.type(screen.getByLabelText("Key"), "plain-flag")
    await user.type(screen.getByLabelText("Name"), "Plain flag")
    await user.click(screen.getByRole("button", { name: "Create flag" }))

    await waitFor(() => {
      expect(screen.getByText("plain-flag")).toBeInTheDocument()
    })
    const postCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input) === "/api/admin/feature-flags" && init?.method === "POST",
    )
    const body = JSON.parse(String(postCall![1]?.body))
    expect("rolloutPercent" in body).toBe(false)
  })

  it("toggles a flag's enabled switch", async () => {
    const user = userEvent.setup()
    render(<FeatureFlagsScreen />)
    await screen.findByText("docs-v2")

    // docs-v2 is disabled — flip its switch on.
    const switches = screen.getAllByRole("switch")
    // First switch is the form "Enabled" checkbox; row switches follow.
    await user.click(switches[switches.length - 1])

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input) === "/api/admin/feature-flags/ff_2" && init?.method === "PATCH",
      )
      expect(patchCall).toBeDefined()
      expect(JSON.parse(String(patchCall![1]?.body))).toEqual({ enabled: true })
    })
  })

  it("sends rolloutPercent: null when clearing rollout on edit", async () => {
    const user = userEvent.setup()
    render(<FeatureFlagsScreen />)
    await screen.findByText("new-dashboard")

    // ff_1 ("new-dashboard") has rolloutPercent 25 — start editing it.
    const editButtons = screen.getAllByRole("button", { name: "Edit" })
    await user.click(editButtons[0])

    const rolloutInput = screen.getByLabelText("Rollout % (optional)")
    expect(rolloutInput).toHaveValue(25)
    await user.clear(rolloutInput)
    await user.click(screen.getByRole("button", { name: "Save changes" }))

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input) === "/api/admin/feature-flags/ff_1" && init?.method === "PATCH",
      )
      expect(patchCall).toBeDefined()
      const body = JSON.parse(String(patchCall![1]?.body))
      expect(body.rolloutPercent).toBeNull()
    })
  })

  it("evaluates an email and shows enabled flags", async () => {
    const user = userEvent.setup()
    render(<FeatureFlagsScreen />)
    await screen.findByText("new-dashboard")

    await user.type(screen.getByLabelText("Email to evaluate"), "vip@example.com")
    await user.click(screen.getByRole("button", { name: "Evaluate" }))

    expect(await screen.findByText("new-dashboard", { selector: "span" })).toBeInTheDocument()
    expect(screen.getByText(/would see 1 flag/)).toBeInTheDocument()
  })

  it("deletes a flag after confirmation", async () => {
    const user = userEvent.setup()
    render(<FeatureFlagsScreen />)
    await screen.findByText("docs-v2")

    const deleteButtons = screen.getAllByRole("button", { name: /Delete/ })
    await user.click(deleteButtons[deleteButtons.length - 1])

    await waitFor(() => {
      expect(screen.queryByText("docs-v2")).not.toBeInTheDocument()
    })
    expect(window.confirm).toHaveBeenCalled()
  })
})
