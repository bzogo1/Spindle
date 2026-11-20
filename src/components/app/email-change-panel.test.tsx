import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { Toaster } from "@/components/ui/toast"

import { EmailChangePanel } from "./email-change-panel"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const STATUS_IDLE = {
  ok: true,
  emailChange: {
    email: "ada@lab.edu",
    pending: null,
    resendCooldownSeconds: 0,
  },
}

const STATUS_PENDING = {
  ok: true,
  emailChange: {
    email: "ada@lab.edu",
    pending: {
      newEmail: "new@lab.edu",
      requestedAt: "2026-11-19T12:00:00.000Z",
      expiresAt: "2026-11-20T12:00:00.000Z",
    },
    resendCooldownSeconds: 0,
  },
}

function renderPanel(currentEmail = "ada@lab.edu") {
  return render(
    <>
      <EmailChangePanel currentEmail={currentEmail} />
      <Toaster />
    </>,
  )
}

function fetchCalls() {
  return vi.mocked(fetch).mock.calls
}

function callsTo(suffix: string, method?: string) {
  return fetchCalls().filter(([input, init]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    return url.includes(suffix) && (!method || init?.method === method)
  })
}

beforeEach(() => {
  vi.mocked(fetch).mockReset()
  window.history.replaceState(null, "", "/")
})

describe("EmailChangePanel", () => {
  it("shows the current email and a new-email form when nothing is pending", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(STATUS_IDLE))
    renderPanel()

    expect(await screen.findByText(/Current email:/)).toHaveTextContent("ada@lab.edu")
    expect(screen.getByLabelText("New email address")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /send verification link/i })).toBeInTheDocument()
    expect(screen.queryByText("Change pending")).not.toBeInTheDocument()
  })

  it("requests a change and shows the pending state", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockImplementation((input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      if (url.includes("/api/auth/email-change/request") && init?.method === "POST") {
        return Promise.resolve(
          jsonResponse({
            ok: true,
            pending: STATUS_PENDING.emailChange.pending,
            retryAfter: 60,
          }),
        )
      }
      return Promise.resolve(jsonResponse(STATUS_IDLE))
    })
    renderPanel()

    await user.type(await screen.findByLabelText("New email address"), "new@lab.edu")
    await user.click(screen.getByRole("button", { name: /send verification link/i }))

    expect(await screen.findByText("Change pending")).toBeInTheDocument()
    expect(screen.getByText("new@lab.edu")).toBeInTheDocument()
    expect(callsTo("/api/auth/email-change/request", "POST")).toHaveLength(1)
    const body = JSON.parse(String(callsTo("/api/auth/email-change/request", "POST")[0][1]?.body))
    expect(body).toEqual({ newEmail: "new@lab.edu" })
    // Resend is on cooldown right after the request (countdown may already
    // have ticked to 59s, so match the prefix only).
    expect(screen.getByRole("button", { name: /resend in \d+s/i })).toBeDisabled()
  })

  it("shows the pending state from the status endpoint with resend and cancel", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockImplementation((input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      if (url.includes("/api/auth/email-change/cancel") && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ ok: true, cancelled: true }))
      }
      if (url.includes("/api/auth/email-change/resend") && init?.method === "POST") {
        return Promise.resolve(
          jsonResponse({
            ok: true,
            pending: STATUS_PENDING.emailChange.pending,
            retryAfter: 60,
          }),
        )
      }
      return Promise.resolve(jsonResponse(STATUS_PENDING))
    })
    renderPanel()

    expect(await screen.findByText("Change pending")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /resend link/i }))
    await waitFor(() => expect(callsTo("/api/auth/email-change/resend", "POST")).toHaveLength(1))

    await user.click(screen.getByRole("button", { name: /cancel change/i }))
    await waitFor(() => expect(callsTo("/api/auth/email-change/cancel", "POST")).toHaveLength(1))
    await waitFor(() => expect(screen.queryByText("Change pending")).not.toBeInTheDocument())
    expect(await screen.findByLabelText("New email address")).toBeInTheDocument()
  })

  it("surfaces an error state when the status load fails", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("boom"))
    renderPanel()
    expect(
      await screen.findByText("We could not load your email settings. Try again."),
    ).toBeInTheDocument()
  })

  it("validates the new email before calling the API", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(jsonResponse(STATUS_IDLE))
    renderPanel()

    await user.click(await screen.findByRole("button", { name: /send verification link/i }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter the new email address.")
    expect(callsTo("/api/auth/email-change/request")).toHaveLength(0)
  })
})
