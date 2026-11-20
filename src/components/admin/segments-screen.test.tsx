import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SegmentsScreen, type SegmentRow } from "./segments-screen"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function segment(overrides: Partial<SegmentRow> = {}): SegmentRow {
  return {
    id: "seg_1",
    name: "Verified example users",
    description: "Verified users on example.com",
    combinator: "all",
    rules: [
      { field: "emailVerified", operator: "isTrue", value: "" },
      { field: "emailDomain", operator: "equals", value: "example.com" },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
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

function mockList(rows: SegmentRow[] = [segment()]) {
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === "DELETE") {
      return Promise.resolve(jsonResponse({ ok: true, deleted: true }))
    }
    if (init?.method === "POST") {
      return Promise.resolve(jsonResponse({ ok: true, segment: segment({ id: "seg_new" }) }))
    }
    if (url.includes("/api/admin/segments/seg_1") && !init?.method) {
      return Promise.resolve(
        jsonResponse({
          ok: true,
          segment: segment(),
          matchCount: 3,
          sample: ["a@example.com", "b@example.com", "c@example.com"],
          evaluatedUsers: 10,
        }),
      )
    }
    return Promise.resolve(jsonResponse({ ok: true, segments: rows }))
  })
}

describe("SegmentsScreen", () => {
  it("shows a loading state then the segment list", async () => {
    mockList([segment(), segment({ id: "seg_2", name: "Admins", combinator: "any" })])
    render(<SegmentsScreen />)

    expect(await screen.findByText("Verified example users")).toBeInTheDocument()
    expect(screen.getByText("Admins")).toBeInTheDocument()
    expect(screen.getByText(/ALL of 2 rules/)).toBeInTheDocument()
    expect(screen.getByText(/ANY of 2 rules/)).toBeInTheDocument()
  })

  it("shows an empty state when there are no segments", async () => {
    mockList([])
    render(<SegmentsScreen />)
    expect(await screen.findByText("No segments yet")).toBeInTheDocument()
  })

  it("shows an error with retry when the list fails", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, message: "denied" }, 403))
    render(<SegmentsScreen />)
    expect(await screen.findByText("Segments unavailable")).toBeInTheDocument()
  })

  it("creates a segment via POST and reloads", async () => {
    const user = userEvent.setup()
    mockList([])
    render(<SegmentsScreen />)
    await screen.findByText("No segments yet")

    await user.type(screen.getByLabelText("Name"), "Example domain")
    // The default rule is emailDomain equals — fill its value input.
    await user.type(screen.getByLabelText("Value"), "example.com")

    await user.click(screen.getByRole("button", { name: /Create segment/ }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/segments",
        expect.objectContaining({ method: "POST" }),
      ),
    )

    const postCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST",
    )
    const sent = JSON.parse(String((postCall?.[1] as RequestInit).body))
    expect(sent).toMatchObject({
      name: "Example domain",
      combinator: "all",
      rules: [{ field: "emailDomain", operator: "equals", value: "example.com" }],
    })

    expect(await screen.findByText("Segment created.")).toBeInTheDocument()
  })

  it("keeps submit disabled until name and rule values are set", async () => {
    mockList([])
    render(<SegmentsScreen />)
    await screen.findByText("No segments yet")

    const submit = screen.getByRole("button", { name: /Create segment/ })
    expect(submit).toBeDisabled()

    await userEvent.type(screen.getByLabelText("Name"), "Only name")
    // Default rule still has an empty value.
    expect(submit).toBeDisabled()
  })

  it("loads match details for a segment and deletes it", async () => {
    const user = userEvent.setup()
    mockList([segment()])
    render(<SegmentsScreen />)
    await screen.findByText("Verified example users")

    await user.click(screen.getByRole("button", { name: "Matches" }))

    // The count/evaluated numbers live in nested elements; match the sentence
    // text and the sample emails separately.
    expect(await screen.findByText(/matching users out of/)).toBeInTheDocument()
    expect(screen.getByText("3")).toBeInTheDocument()
    expect(screen.getByText("a@example.com")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /Delete segment/ }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/segments/seg_1",
        expect.objectContaining({ method: "DELETE" }),
      ),
    )
    // Detail panel closes after delete.
    await waitFor(() => expect(screen.queryByText(/matching users out of/)).not.toBeInTheDocument())
  })

  it("serializes date rule values to ISO on submit", async () => {
    const user = userEvent.setup()
    mockList([])
    render(<SegmentsScreen />)
    await screen.findByText("No segments yet")

    await user.type(screen.getByLabelText("Name"), "Recent signups")
    // Switch the rule field to "Created after" via the field select.
    // The Select is a popover; open it and pick the option.
    await user.click(screen.getByLabelText("Rule 1 field"))
    fireEvent.click(await screen.findByText("Created after"))
    fireEvent.change(screen.getByLabelText("Value"), {
      target: { value: "2030-01-01T10:00" },
    })

    await user.click(screen.getByRole("button", { name: /Create segment/ }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/segments",
        expect.objectContaining({ method: "POST" }),
      ),
    )
    const postCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST",
    )
    const sent = JSON.parse(String((postCall?.[1] as RequestInit).body))
    expect(sent.rules[0].field).toBe("createdAfter")
    expect(sent.rules[0].operator).toBe("is")
    expect(sent.rules[0].value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })
})
