import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { PasswordRotationPolicy, PasswordRotationStatus } from "@/lib/password-rotation"

import { PasswordRotationPanel } from "./password-rotation-panel"

const DEFAULT_POLICY: PasswordRotationPolicy = {
  maxPasswordAgeDays: 0,
  passwordHistoryCount: 0,
}

function statusFor(
  policy: PasswordRotationPolicy,
  patch: Partial<PasswordRotationStatus> = {},
): PasswordRotationStatus {
  return {
    policy,
    passwordChangedAt: null,
    expiresAt: null,
    daysRemaining: null,
    passwordAgeTracked: false,
    expired: false,
    changeRequired: false,
    historySize: 0,
    ...patch,
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function rotationResponse(policy: PasswordRotationPolicy, status?: PasswordRotationStatus) {
  return jsonResponse({ ok: true, policy, status: status ?? statusFor(policy) })
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

describe("PasswordRotationPanel", () => {
  it("loads and renders default settings with status line", async () => {
    mockFetchSequence(rotationResponse(DEFAULT_POLICY))
    render(<PasswordRotationPanel />)
    expect(screen.getByText(/Loading password rotation settings/)).toBeInTheDocument()
    await screen.findByText("Password rotation")
    expect(screen.getByTestId("rotation-status")).toHaveTextContent(/No rotation policy/)
    expect(screen.getByLabelText("Maximum password age")).toHaveValue("0")
    expect(screen.getByLabelText("Prevent password reuse")).toHaveValue("0")
    expect(screen.getByRole("button", { name: /Save rotation/ })).toBeDisabled()
  })

  it("renders saved values and expiry status", async () => {
    const policy: PasswordRotationPolicy = {
      maxPasswordAgeDays: 90,
      passwordHistoryCount: 5,
    }
    mockFetchSequence(
      rotationResponse(
        policy,
        statusFor(policy, {
          passwordChangedAt: "2026-01-01T00:00:00.000Z",
          passwordAgeTracked: true,
          expiresAt: "2026-04-01T00:00:00.000Z",
          daysRemaining: 42,
          historySize: 3,
        }),
      ),
    )
    render(<PasswordRotationPanel />)
    await screen.findByDisplayValue("90 days")
    expect(screen.getByDisplayValue("Last 5 passwords")).toBeInTheDocument()
    expect(screen.getByTestId("rotation-status")).toHaveTextContent(/expires in 42 days/)
  })

  it("shows advisory wording when a tracked password is past max age", async () => {
    const policy: PasswordRotationPolicy = {
      maxPasswordAgeDays: 30,
      passwordHistoryCount: 0,
    }
    mockFetchSequence(
      rotationResponse(
        policy,
        statusFor(policy, {
          passwordChangedAt: "2025-01-01T00:00:00.000Z",
          passwordAgeTracked: true,
          expired: true,
          changeRequired: true,
        }),
      ),
    )
    render(<PasswordRotationPanel />)
    await screen.findByDisplayValue("30 days")
    expect(screen.getByTestId("rotation-status")).toHaveTextContent(/past the maximum age/)
    expect(screen.getByTestId("rotation-status")).not.toHaveTextContent(/Password change required/)
  })

  it("shows 'not yet tracked' — not 'change required' — when age is unknown", async () => {
    const policy: PasswordRotationPolicy = {
      maxPasswordAgeDays: 30,
      passwordHistoryCount: 0,
    }
    // This is the real-world state after saving a max-age policy: the
    // record route is unwired, so passwordChangedAt stays null forever
    // and expired/changeRequired are permanently true (advisory only).
    mockFetchSequence(
      rotationResponse(
        policy,
        statusFor(policy, {
          passwordChangedAt: null,
          passwordAgeTracked: false,
          expired: true,
          changeRequired: true,
        }),
      ),
    )
    render(<PasswordRotationPanel />)
    await screen.findByDisplayValue("30 days")
    const status = screen.getByTestId("rotation-status")
    expect(status).toHaveTextContent(/not tracked yet/)
    expect(status).not.toHaveTextContent(/change required/i)
  })

  it("PUTs the full policy object on save", async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetchSequence(
      rotationResponse(DEFAULT_POLICY),
      rotationResponse({ maxPasswordAgeDays: 60, passwordHistoryCount: 3 }),
    )
    render(<PasswordRotationPanel />)
    await user.selectOptions(await screen.findByLabelText("Maximum password age"), "60")
    await user.selectOptions(screen.getByLabelText("Prevent password reuse"), "3")
    await user.click(screen.getByRole("button", { name: /Save rotation/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe("/api/auth/password/rotation")
    expect(init.method).toBe("PUT")
    expect(JSON.parse(init.body as string)).toEqual({
      maxPasswordAgeDays: 60,
      passwordHistoryCount: 3,
    })
    await screen.findByText("Password rotation settings saved.")
  })

  it("shows an error with retry when the initial load fails", async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetchSequence(
      jsonResponse({ ok: false, message: "boom" }, 500),
      rotationResponse(DEFAULT_POLICY),
    )
    render(<PasswordRotationPanel />)
    await screen.findByText("Password rotation unavailable")
    await user.click(screen.getByRole("button", { name: "Retry" }))
    await screen.findByText("Password rotation")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
