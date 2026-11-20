import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { MockSessionProvider } from "@/components/app/mock-session-provider"
import { Toaster } from "@/components/ui/toast"
import type { MockSessionData } from "@/lib/auth/mock-session"
import type { ProfileData } from "@/lib/profile"

import { ProfileScreen } from "./profile-screen"

const session: MockSessionData = {
  user: { name: "Session Name", email: "session@example.com" },
  workspace: { name: "Personal workspace", slug: "personal" },
  signedInAt: "2026-11-19T12:00:00.000Z",
}

const profile: ProfileData = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  handle: "ada_lovelace",
  memberSince: "2024-03-01T12:00:00.000Z",
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function renderScreen({ toasts = false }: { toasts?: boolean } = {}) {
  return render(
    <MockSessionProvider initialSession={session}>
      <ProfileScreen />
      {toasts ? <Toaster /> : null}
    </MockSessionProvider>,
  )
}

function fetchCalls() {
  return vi.mocked(fetch).mock.calls
}

beforeEach(() => {
  vi.mocked(fetch).mockReset()
})

describe("ProfileScreen", () => {
  it("renders the avatar initial, display name, email, and member-since date", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true, profile }))
    renderScreen()

    expect(await screen.findByRole("heading", { name: "Profile", level: 1 })).toBeInTheDocument()
    expect(screen.getByLabelText("Display name")).toHaveValue("Ada Lovelace")
    expect(screen.getByLabelText("Email")).toHaveValue("ada@example.com")
    expect(screen.getByText("Member since")).toBeInTheDocument()
    expect(screen.getByLabelText("Username")).toHaveValue("ada_lovelace")
    expect(screen.getByText("@ada_lovelace")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save profile" })).toBeInTheDocument()
  })

  it("shows the loading panel while the profile request is in flight", async () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}))
    renderScreen()

    expect(await screen.findByText("Loading profile")).toBeInTheDocument()
    expect(screen.queryByLabelText("Display name")).not.toBeInTheDocument()
  })

  it("shows the error state and retries", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(jsonResponse({ ok: true, profile }))
    renderScreen()

    expect(await screen.findByText("Profile did not load")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /try again/i }))

    expect(await screen.findByLabelText("Display name")).toHaveValue("Ada Lovelace")
    expect(fetchCalls().length).toBeGreaterThanOrEqual(2)
  })

  it("saves the display name through PUT /api/profile", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockImplementation(async (_input, init) => {
      if (init?.method === "PUT") {
        return jsonResponse({
          ok: true,
          profile: { ...profile, name: "Augusta Ada" },
        })
      }
      return jsonResponse({ ok: true, profile })
    })
    renderScreen()

    const input = await screen.findByLabelText("Display name")
    await user.clear(input)
    await user.type(input, "Augusta Ada")
    await user.click(screen.getByRole("button", { name: "Save profile" }))

    expect(await screen.findByRole("status")).toHaveTextContent("Changes saved.")
    expect(input).toHaveValue("Augusta Ada")

    const putCall = fetchCalls().find(([, init]) => init?.method === "PUT")
    expect(putCall).toBeDefined()
    expect(putCall?.[0]).toBe("/api/profile")
    expect(JSON.parse(String(putCall?.[1]?.body))).toEqual({ name: "Augusta Ada" })
  })

  it("requires a display name and does not call the API", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true, profile }))
    renderScreen()

    const input = await screen.findByLabelText("Display name")
    await user.clear(input)
    await user.click(screen.getByRole("button", { name: "Save profile" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Display name is required.")
    expect(fetchCalls().every(([, init]) => !init?.method || init.method === "GET")).toBe(true)
    expect(screen.queryByText("Changes saved.")).not.toBeInTheDocument()
  })

  it("shows an error toast when saving fails", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockImplementation(async (_input, init) => {
      if (init?.method === "PUT") {
        return jsonResponse({ ok: false, code: "server_error", message: "nope" }, 500)
      }
      return jsonResponse({ ok: true, profile })
    })
    renderScreen({ toasts: true })

    await user.click(await screen.findByRole("button", { name: "Save profile" }))

    expect(await screen.findByText("Couldn't save profile")).toBeInTheDocument()
    expect(screen.queryByText("Changes saved.")).not.toBeInTheDocument()
    // The button recovers so the user can retry.
    expect(screen.getByRole("button", { name: "Save profile" })).toBeEnabled()
  })
})
