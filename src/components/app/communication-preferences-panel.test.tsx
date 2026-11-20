import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { Toaster } from "@/components/ui/toast"
import {
  defaultCommunicationPreferences,
  type CommunicationPreferences,
} from "@/lib/communication-preferences"

import { CommunicationPreferencesPanel } from "./communication-preferences-panel"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function renderPanel() {
  return render(
    <>
      <CommunicationPreferencesPanel />
      <Toaster />
    </>,
  )
}

function fetchCalls() {
  return vi.mocked(fetch).mock.calls
}

beforeEach(() => {
  vi.mocked(fetch).mockReset()
})

describe("CommunicationPreferencesPanel", () => {
  it("loads and renders the account-level opt-ins", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ ok: true, preferences: defaultCommunicationPreferences() }),
    )
    renderPanel()

    // Wait for a control that only exists once loading finishes — the
    // heading is rendered in both the loading and loaded states.
    expect(await screen.findByRole("switch", { name: "Product updates" })).toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: "Email & product communications" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "Product updates" })).toBeChecked()
    expect(screen.getByRole("switch", { name: "Security alerts" })).toBeChecked()
    expect(screen.getByRole("switch", { name: "Security alerts" })).toBeDisabled()
    expect(screen.getByRole("switch", { name: "Feedback requests" })).toBeChecked()
    expect(screen.getByRole("switch", { name: "Referral program" })).not.toBeChecked()
    expect(screen.getByLabelText("Email digest frequency")).toHaveValue("weekly")
    // Nothing is dirty yet — the save button stays disabled.
    expect(screen.getByRole("button", { name: "Save preferences" })).toBeDisabled()
  })

  it("tracks dirty state and PUTs only the changed fields", async () => {
    const user = userEvent.setup()
    const stored: CommunicationPreferences = {
      ...defaultCommunicationPreferences(),
      productUpdates: true,
      referralProgram: false,
    }
    vi.mocked(fetch).mockImplementation(async (_input, init) => {
      if (init?.method === "PUT") {
        return jsonResponse({
          ok: true,
          preferences: { ...stored, referralProgram: true },
        })
      }
      return jsonResponse({ ok: true, preferences: stored })
    })
    renderPanel()

    const saveButton = await screen.findByRole("button", { name: "Save preferences" })
    expect(saveButton).toBeDisabled()

    await user.click(screen.getByRole("switch", { name: "Referral program" }))

    expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument()
    expect(saveButton).toBeEnabled()

    await user.click(saveButton)

    expect(await screen.findByText("Changes saved.")).toBeInTheDocument()

    const putCall = fetchCalls().find(([, init]) => init?.method === "PUT")
    expect(putCall).toBeDefined()
    expect(putCall?.[0]).toBe("/api/communication-preferences")
    expect(JSON.parse(String(putCall?.[1]?.body))).toEqual({
      preferences: { referralProgram: true },
    })
    // After saving, the dirty indicator clears.
    expect(screen.queryByText("You have unsaved changes.")).not.toBeInTheDocument()
  })

  it("shows the error state and retries the load", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, preferences: defaultCommunicationPreferences() }),
      )
    renderPanel()

    expect(await screen.findByText("Communication preferences did not load")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /try again/i }))

    expect(await screen.findByRole("switch", { name: "Product updates" })).toBeInTheDocument()
  })
})
