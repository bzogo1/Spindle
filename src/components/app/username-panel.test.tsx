import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { MockSessionProvider } from "@/components/app/mock-session-provider"
import { Toaster } from "@/components/ui/toast"
import type { MockSessionData } from "@/lib/auth/mock-session"

import { UsernamePanel } from "./username-panel"

const session: MockSessionData = {
  user: { name: "Session Name", email: "session@example.com" },
  workspace: { name: "Personal workspace", slug: "personal" },
  signedInAt: "2026-11-19T12:00:00.000Z",
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function renderPanel(handle: string | null, onSaved?: (handle: string | null) => void) {
  return render(
    <MockSessionProvider initialSession={session}>
      <UsernamePanel handle={handle} onSaved={onSaved} />
      <Toaster />
    </MockSessionProvider>,
  )
}

function fetchCalls() {
  return vi.mocked(fetch).mock.calls
}

beforeEach(() => {
  vi.mocked(fetch).mockReset()
})

describe("UsernamePanel", () => {
  it("shows the current handle and prefilled input", () => {
    renderPanel("ada_lovelace")
    expect(screen.getByLabelText("Username")).toHaveValue("ada_lovelace")
    expect(screen.getByText("@ada_lovelace")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Change username" })).toBeInTheDocument()
  })

  it("prompts to claim a handle when none is set", () => {
    renderPanel(null)
    expect(screen.getByText(/No username yet/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Claim username" })).toBeInTheDocument()
  })

  it("live-checks availability after the debounce", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith("/api/username?handle=")) {
        return jsonResponse({ ok: true, available: true, username: "grace_hopper" })
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    renderPanel(null)

    await user.type(screen.getByLabelText("Username"), "grace_hopper")

    await waitFor(
      () => expect(screen.getByText(/@grace_hopper is available/)).toBeInTheDocument(),
      { timeout: 3000 },
    )
    const checkCall = fetchCalls().find(([input]) =>
      String(input).startsWith("/api/username?handle="),
    )
    expect(checkCall?.[0]).toBe("/api/username?handle=grace_hopper")
  })

  it("shows the server reason when a handle is taken", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        ok: true,
        available: false,
        username: "ada",
        error: "That username is already taken.",
      }),
    )
    renderPanel(null)

    await user.type(screen.getByLabelText("Username"), "ada")

    await waitFor(() => expect(screen.getByText(/already taken/)).toBeInTheDocument(), {
      timeout: 3000,
    })
  })

  it("saves a valid handle through PUT /api/username", async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    vi.mocked(fetch).mockImplementation(async (_input, init) => {
      if (init?.method === "PUT") {
        return jsonResponse({ ok: true, handle: "ada_99" })
      }
      return jsonResponse({ ok: true, available: true, username: "ada_99" })
    })
    renderPanel(null, onSaved)

    await user.type(screen.getByLabelText("Username"), "ada_99")
    await user.click(screen.getByRole("button", { name: "Claim username" }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("ada_99"))
    expect(await screen.findByText("Username saved.")).toBeInTheDocument()

    const putCall = fetchCalls().find(([, init]) => init?.method === "PUT")
    expect(putCall?.[0]).toBe("/api/username")
    expect(JSON.parse(String(putCall?.[1]?.body))).toEqual({ handle: "ada_99" })
  })

  it("rejects invalid input without calling the API", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true, available: true }))
    renderPanel(null)

    await user.type(screen.getByLabelText("Username"), "ab")
    await user.click(screen.getByRole("button", { name: "Claim username" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(/3–20 characters/)
    expect(fetchCalls().every(([, init]) => !init?.method || init.method === "GET")).toBe(true)
  })

  it("shows the server error when saving fails", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockImplementation(async (_input, init) => {
      if (init?.method === "PUT") {
        return jsonResponse(
          { ok: false, code: "invalid_username", message: "That username is already taken." },
          422,
        )
      }
      return jsonResponse({ ok: true, available: true, username: "ada" })
    })
    renderPanel(null)

    await user.type(screen.getByLabelText("Username"), "ada")
    await user.click(screen.getByRole("button", { name: "Claim username" }))

    expect(await screen.findByText("That username is already taken.")).toBeInTheDocument()
  })
})
