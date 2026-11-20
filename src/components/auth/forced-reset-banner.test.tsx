import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ForcedResetBanner } from "./forced-reset-banner"

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

function statusResponse(body: unknown, _ok = true, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  )
}

describe("ForcedResetBanner", () => {
  it("renders nothing when the flag is not set", async () => {
    fetchMock.mockReturnValue(statusResponse({ ok: true, required: false }))
    const { container } = render(<ForcedResetBanner />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it("renders a persistent banner linking to the reset flow when required", async () => {
    fetchMock.mockReturnValue(statusResponse({ ok: true, required: true }))
    render(<ForcedResetBanner />)

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Password reset required")
    const link = screen.getByRole("link", { name: "Reset your password" })
    expect(link).toHaveAttribute("href", "/reset-password")
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/forced-reset/status",
      expect.objectContaining({ credentials: "same-origin" }),
    )
  })

  it("renders nothing on auth failure or network error", async () => {
    fetchMock.mockReturnValue(statusResponse({ ok: false, code: "unauthorized" }, false, 401))
    const { container, unmount } = render(<ForcedResetBanner />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
    unmount()

    fetchMock.mockRejectedValue(new Error("offline"))
    const second = render(<ForcedResetBanner />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(second.container).toBeEmptyDOMElement()
  })

  it("re-checks the status when the window regains focus", async () => {
    fetchMock
      .mockReturnValueOnce(statusResponse({ ok: true, required: true }))
      .mockReturnValue(statusResponse({ ok: true, required: false }))
    render(<ForcedResetBanner />)
    expect(await screen.findByRole("alert")).toBeInTheDocument()

    // Flag cleared server-side (e.g. reset completed in another tab).
    window.dispatchEvent(new Event("focus"))
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument())
  })
})
