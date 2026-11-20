import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { useAppSettings } from "@/lib/api"
import type { AppSettingsData } from "@/lib/api/types"
import { defaultUserPreferences } from "@/lib/preferences"
import { Toaster } from "@/components/ui/toast"

import { SettingsScreen } from "./settings-screen"

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return { ...actual, useAppSettings: vi.fn() }
})

const settingsQuery = vi.mocked(useAppSettings)

const now = "2026-11-19T12:00:00.000Z"

function buildSettings(overrides: Partial<AppSettingsData> = {}): AppSettingsData {
  return {
    user: { id: "usr_01", email: "bogdan@example.com", name: "Bogdan", createdAt: now },
    workspace: {
      id: "wsp_01",
      name: "Northlight Research",
      slug: "northlight",
      description: "Independent research workspace.",
      role: "owner",
      createdAt: now,
    },
    usage: {
      periodStart: "2026-11-01T00:00:00.000Z",
      periodEnd: "2026-11-30T00:00:00.000Z",
      requests: 1284,
      tokens: 98234,
      costUsd: 12.5,
      daily: [],
    },
    generatedAt: now,
    ...overrides,
  }
}

function mockQuery(overrides: Partial<ReturnType<typeof useAppSettings>> = {}) {
  settingsQuery.mockReturnValue({
    status: "success",
    mode: "ready",
    data: buildSettings(),
    error: undefined,
    isRetrying: false,
    refetch: vi.fn(),
    ...overrides,
  })
}

function renderScreen() {
  return render(
    <>
      <SettingsScreen />
      <Toaster />
    </>,
  )
}

describe("SettingsScreen", () => {
  beforeEach(() => {
    settingsQuery.mockReset()
  })

  it("renders the workspace form and disabled danger zone", () => {
    mockQuery()
    renderScreen()

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument()
    expect(screen.getByLabelText("Workspace name")).toHaveValue("Northlight Research")
    expect(screen.getByLabelText("Slug")).toHaveValue("northlight")
    expect(screen.getByLabelText("Description")).toHaveValue("Independent research workspace.")
    expect(screen.getByText("Workspace logo")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Delete workspace" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled()
  })

  it("shows the loading skeleton while settings load", () => {
    mockQuery({ status: "loading", mode: "loading", data: undefined })
    renderScreen()

    expect(screen.getByRole("status")).toHaveTextContent("Loading settings")
  })

  it("shows the error state and retries", async () => {
    const refetch = vi.fn()
    mockQuery({ status: "error", mode: "error", data: undefined, refetch })
    renderScreen()

    expect(screen.getByRole("alert")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it("validates the workspace name before saving", async () => {
    const user = userEvent.setup()
    mockQuery()
    renderScreen()

    // Pin a custom slug first so clearing the name does not auto-clear it —
    // jsdom blocks submission while the required slug input is empty.
    await user.clear(screen.getByLabelText("Slug"))
    await user.type(screen.getByLabelText("Slug"), "custom-slug")

    const nameInput = screen.getByLabelText("Workspace name")
    await user.clear(nameInput)
    await user.type(nameInput, "   ")
    await user.click(screen.getByRole("button", { name: "Save changes" }))

    expect(await screen.findByText("Workspace name is required.")).toBeInTheDocument()
  })

  it("saves locally and confirms with a toast", async () => {
    const user = userEvent.setup()
    mockQuery()
    renderScreen()

    await user.clear(screen.getByLabelText("Workspace name"))
    await user.type(screen.getByLabelText("Workspace name"), "Northlight Labs")
    await user.click(screen.getByRole("button", { name: "Save changes" }))

    expect(await screen.findByText("Workspace settings saved")).toBeInTheDocument()
    // Radix Toast renders its content twice (visible toast + aria-live
    // announcer), so assert at least one match rather than exactly one.
    expect(
      screen.getAllByText(/stored locally until the workspace settings API/).length,
    ).toBeGreaterThan(0)
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled()
  })

  it("shows plan, usage, and billing links on the billing tab", async () => {
    const user = userEvent.setup()
    mockQuery()
    renderScreen()

    await user.click(screen.getByRole("tab", { name: "Plan & billing" }))

    expect(await screen.findByRole("heading", { name: "Current plan" })).toBeInTheDocument()
    expect(screen.getByText("Team")).toBeInTheDocument()
    expect(screen.getByText("1,284")).toBeInTheDocument()
    expect(screen.getByText("98,234")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /compare plans/i })).toHaveAttribute("href", "/pricing")
    expect(screen.getByRole("link", { name: /manage billing/i })).toHaveAttribute(
      "href",
      "/dashboard/usage",
    )
  })

  it("shows the member summary and a link to team members", async () => {
    const user = userEvent.setup()
    mockQuery()
    renderScreen()

    await user.click(screen.getByRole("tab", { name: "Members" }))

    expect(await screen.findByRole("heading", { name: "Members" })).toBeInTheDocument()
    expect(screen.getByText("Owner")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /open team members/i })).toHaveAttribute(
      "href",
      "/dashboard/members",
    )
  })

  it("exports the workspace settings as a JSON download", async () => {
    const createObjectURL = vi.fn(() => "blob:mock")
    const revokeObjectURL = vi.fn()
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)
    mockQuery()
    renderScreen()

    await userEvent.click(screen.getByRole("button", { name: "Export JSON" }))

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock")

    click.mockRestore()
    vi.unstubAllGlobals()
  })

  it("imports workspace settings from a JSON file into the form", async () => {
    const user = userEvent.setup()
    mockQuery()
    renderScreen()

    const file = new File(
      [
        JSON.stringify({
          kind: "spindle-workspace-settings",
          version: 1,
          settings: {
            name: "Imported Workspace",
            slug: "imported-workspace",
            description: "Restored from file",
          },
        }),
      ],
      "settings.json",
      { type: "application/json" },
    )
    await user.upload(screen.getByLabelText("Choose a settings file to import"), file)

    await waitFor(() => {
      expect(screen.getByLabelText("Workspace name")).toHaveValue("Imported Workspace")
      expect(screen.getByLabelText("Slug")).toHaveValue("imported-workspace")
      expect(screen.getByLabelText("Description")).toHaveValue("Restored from file")
    })
    expect(screen.getAllByText("Settings imported").length).toBeGreaterThan(0)
  })

  it("rejects an import whose workspace slug is invalid", async () => {
    const user = userEvent.setup()
    mockQuery()
    renderScreen()

    const file = new File(
      [
        JSON.stringify({
          kind: "spindle-workspace-settings",
          version: 1,
          settings: { name: "Bad Slug", slug: "Not A Slug!", description: "" },
        }),
      ],
      "settings.json",
      { type: "application/json" },
    )
    await user.upload(screen.getByLabelText("Choose a settings file to import"), file)

    expect(await screen.findByText("The export has an invalid workspace slug.")).toBeInTheDocument()
    expect(screen.getByLabelText("Workspace name")).toHaveValue("Northlight Research")
  })

  it("mounts the preferences panel on the Preferences tab", async () => {
    const user = userEvent.setup()
    mockQuery()
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url === "/api/preferences") {
        return new Response(JSON.stringify({ ok: true, preferences: defaultUserPreferences() }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      if (url === "/api/projects") {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    renderScreen()

    await user.click(screen.getByRole("tab", { name: "Preferences" }))

    expect(await screen.findByRole("heading", { name: "Preferences" })).toBeInTheDocument()
    expect(await screen.findByRole("switch", { name: "Reduce motion" })).toBeInTheDocument()
    // The workspace sections are untouched.
    expect(screen.getByRole("tab", { name: "General" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Plan & billing" })).toBeInTheDocument()
  })

  it("offers leave instead of delete for non-owners", () => {
    mockQuery({
      data: buildSettings({
        workspace: {
          id: "wsp_01",
          name: "Northlight Research",
          slug: "northlight",
          role: "member",
          createdAt: now,
        },
      }),
    })
    renderScreen()

    expect(screen.getByRole("button", { name: "Leave workspace" })).toBeDisabled()
    expect(screen.queryByRole("button", { name: "Delete workspace" })).not.toBeInTheDocument()
  })
})
