import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { SecurityPolicies } from "@/lib/auth/security-policies"

import { SecurityPoliciesPanel } from "./security-policies-panel"

const DEFAULTS: SecurityPolicies = {
  requireTwoFactor: false,
  sessionMaxAgeHours: null,
  allowedSignInWindow: null,
  minPasswordLength: null,
}

const SAVED: SecurityPolicies = {
  requireTwoFactor: true,
  sessionMaxAgeHours: 12,
  allowedSignInWindow: { start: "08:00", end: "20:00" },
  minPasswordLength: 10,
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function policiesResponse(policies: SecurityPolicies) {
  return jsonResponse({ ok: true, policies })
}

function mockFetchSequence(...responses: Response[]) {
  const fetchMock = vi.fn()
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response)
  }
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe("SecurityPoliciesPanel", () => {
  it("loads and renders default policies", async () => {
    mockFetchSequence(policiesResponse(DEFAULTS))
    render(<SecurityPoliciesPanel />)
    expect(screen.getByText(/Loading security policies/)).toBeInTheDocument()
    await screen.findByText("Sign-in security policies")
    expect(
      screen.getByRole("switch", { name: "Require two-factor authentication" }),
    ).not.toBeChecked()
    expect(screen.getByRole("switch", { name: "Restrict sign-in hours" })).not.toBeChecked()
    // Nothing to save yet.
    expect(screen.getByRole("button", { name: /Save policies/ })).toBeDisabled()
  })

  it("renders saved values including the sign-in window", async () => {
    mockFetchSequence(policiesResponse(SAVED))
    render(<SecurityPoliciesPanel />)
    await screen.findByDisplayValue("12")
    expect(screen.getByDisplayValue("10")).toBeInTheDocument()
    expect(screen.getByDisplayValue("08:00")).toBeInTheDocument()
    expect(screen.getByDisplayValue("20:00")).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "Require two-factor authentication" })).toBeChecked()
  })

  it("PUTs the full policy object on save", async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetchSequence(
      policiesResponse(DEFAULTS),
      policiesResponse({ ...DEFAULTS, requireTwoFactor: true }),
    )
    render(<SecurityPoliciesPanel />)
    const toggle = await screen.findByRole("switch", {
      name: "Require two-factor authentication",
    })
    await user.click(toggle)
    await user.click(screen.getByRole("button", { name: /Save policies/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe("/api/auth/policies")
    expect(init.method).toBe("PUT")
    expect(JSON.parse(init.body as string)).toEqual({
      ...DEFAULTS,
      requireTwoFactor: true,
    })
    await screen.findByText("Security policies saved.")
  })

  it("reveals time inputs when the window toggle is enabled and saves them", async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetchSequence(
      policiesResponse(DEFAULTS),
      policiesResponse({
        ...DEFAULTS,
        allowedSignInWindow: { start: "09:00", end: "17:00" },
      }),
    )
    render(<SecurityPoliciesPanel />)
    await user.click(await screen.findByRole("switch", { name: "Restrict sign-in hours" }))
    await user.click(screen.getByRole("button", { name: /Save policies/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [, init] = fetchMock.mock.calls[1]
    expect(JSON.parse(init.body as string)).toEqual({
      ...DEFAULTS,
      allowedSignInWindow: { start: "09:00", end: "17:00" },
    })
  })

  it("blocks save with an error for invalid numeric input", async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetchSequence(policiesResponse(DEFAULTS))
    render(<SecurityPoliciesPanel />)
    const hours = await screen.findByLabelText("Maximum session age (hours)")
    await user.type(hours, "0")
    await user.click(screen.getByRole("button", { name: /Save policies/ }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/Check the policy values/)).toBeInTheDocument()
  })

  it("shows an error with retry when the initial load fails", async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetchSequence(
      jsonResponse({ ok: false, message: "boom" }, 500),
      policiesResponse(SAVED),
    )
    render(<SecurityPoliciesPanel />)
    await screen.findByText("Security policies unavailable")
    await user.click(screen.getByRole("button", { name: "Retry" }))
    await screen.findByDisplayValue("12")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
