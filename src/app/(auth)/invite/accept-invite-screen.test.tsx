import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const search = vi.hoisted(() => ({ value: "" }))

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search.value),
}))

import { LanguageProvider } from "@/components/i18n/language-provider"
import { AcceptInviteScreen } from "./accept-invite-screen"

const fetchMock = vi.fn()

const PENDING_INVITE = {
  id: "inv_1",
  email: "new@acme.dev",
  role: "member",
  status: "pending",
  inviterName: "Olivia Owner",
  workspaceName: "Acme Research",
  createdAt: "2026-11-19T00:00:00.000Z",
  sentAt: "2026-11-19T00:00:00.000Z",
  expiresAt: "2026-11-26T00:00:00.000Z",
  acceptedAt: null,
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function renderScreen() {
  return render(
    <LanguageProvider>
      <AcceptInviteScreen />
    </LanguageProvider>,
  )
}

beforeEach(() => {
  search.value = ""
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("AcceptInviteScreen", () => {
  it("shows the invalid state when the token is missing", async () => {
    renderScreen()
    expect(await screen.findByText("This invitation link isn't valid")).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("renders pending invite details and accepts", async () => {
    search.value = "token=tok123"
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ status: "pending", invitation: PENDING_INVITE }))
      .mockResolvedValueOnce(jsonResponse({ status: "accepted" }))

    renderScreen()
    expect(await screen.findByText("Join Acme Research")).toBeInTheDocument()
    expect(screen.getByText(/Olivia Owner/)).toBeInTheDocument()
    expect(screen.getByText(/new@acme\.dev/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Accept invitation" }))
    expect(await screen.findByText("You're in")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Open your workspace" })).toHaveAttribute(
      "href",
      "/dashboard",
    )

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/invitations/accept?token=tok123",
      expect.objectContaining({ headers: { accept: "application/json" } }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/invitations/accept",
      expect.objectContaining({ method: "POST" }),
    )
    const postBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)
    expect(postBody).toEqual({ token: "tok123" })
  })

  it("renders terminal states from the status probe", async () => {
    search.value = "token=tok123"
    fetchMock.mockResolvedValue(jsonResponse({ status: "used" }))
    renderScreen()
    expect(await screen.findByText("This invitation has already been accepted")).toBeInTheDocument()
  })

  it("maps accept failures onto terminal states", async () => {
    search.value = "token=tok123"
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ status: "pending", invitation: PENDING_INVITE }))
      .mockResolvedValueOnce(
        jsonResponse({ ok: false, code: "invite_expired", message: "expired" }, 410),
      )

    renderScreen()
    await userEvent.click(await screen.findByRole("button", { name: "Accept invitation" }))
    await waitFor(() => expect(screen.getByText("This invitation has expired")).toBeInTheDocument())
  })

  it("shows an error state when the probe fails", async () => {
    search.value = "token=tok123"
    fetchMock.mockRejectedValue(new Error("network down"))
    renderScreen()
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument()
  })
})
