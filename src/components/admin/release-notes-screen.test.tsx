import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ReleaseNotesScreen } from "./release-notes-screen"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const PREVIEW = {
  ok: true,
  entries: [
    {
      slug: "1-0",
      version: "1.0",
      date: "2026-11-19",
      title: "Spindle 1.0 — a home for the whole project",
      tags: ["Release"],
    },
  ],
  subject: "Spindle 1.0 — a home for the whole project",
  text: "Hi there,\n\nSpindle 1.0\n\nFull notes: https://example.com/changelog/1-0\n",
  textTruncated: false,
  html: "<!doctype html><html></html>",
  recipientCount: 2,
  emailConfigured: false,
}

const SEND_RESULT = {
  ok: true,
  audience: "subscribers",
  audienceNote: null,
  result: { attempted: 2, suppressed: 0, sent: 0, unconfigured: 2, failed: 0 },
  emailConfigured: false,
}

let fetchMock: ReturnType<typeof vi.fn>
let confirmSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
  confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true)
})

afterEach(() => {
  vi.unstubAllGlobals()
  confirmSpy.mockRestore()
})

describe("ReleaseNotesScreen", () => {
  it("shows the preview, recipient count, and unconfigured delivery state", async () => {
    fetchMock.mockResolvedValue(jsonResponse(PREVIEW))
    render(<ReleaseNotesScreen />)

    expect(await screen.findByText(PREVIEW.subject)).toBeInTheDocument()
    expect(screen.getByText("2")).toBeInTheDocument()
    expect(screen.getByText("Unconfigured")).toBeInTheDocument()
    expect(screen.getByText(/Hi there/)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/release-notes", {
      cache: "no-store",
    })
  })

  it("posts the send and renders honest results", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return Promise.resolve(jsonResponse(SEND_RESULT))
      return Promise.resolve(jsonResponse(PREVIEW))
    })
    const user = userEvent.setup()
    render(<ReleaseNotesScreen />)

    const button = await screen.findByRole("button", { name: /send now/i })
    await user.click(button)

    await waitFor(() => {
      expect(screen.getByText("Send result")).toBeInTheDocument()
    })
    expect(screen.getByText(/Unconfigured: 2/)).toBeInTheDocument()
    expect(screen.getByText(/nothing was delivered/i)).toBeInTheDocument()

    const postCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST",
    )
    expect(postCall).toBeTruthy()
    const body = JSON.parse(String((postCall![1] as RequestInit).body))
    expect(body).toEqual({ latestCount: 1, audience: "subscribers" })
  })

  it("does not send when the confirm dialog is declined", async () => {
    confirmSpy.mockReturnValue(false)
    fetchMock.mockResolvedValue(jsonResponse(PREVIEW))
    const user = userEvent.setup()
    render(<ReleaseNotesScreen />)

    const button = await screen.findByRole("button", { name: /send now/i })
    await user.click(button)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    expect(screen.queryByText("Send result")).not.toBeInTheDocument()
  })

  it("shows an error when the preview fails to load", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, message: "Nope." }, 500))
    render(<ReleaseNotesScreen />)
    expect(await screen.findByText("Nope.")).toBeInTheDocument()
  })
})
