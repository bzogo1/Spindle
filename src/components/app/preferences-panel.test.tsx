import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { Toaster } from "@/components/ui/toast"
import { useProjects } from "@/lib/api"
import type { Project } from "@/lib/api/types"
import { defaultUserPreferences, type UserPreferences } from "@/lib/preferences"

import { PreferencesPanel } from "./preferences-panel"

// The projects list feeds the default-project select; stub the hook so the
// test does not depend on the mock API adapter's fixture data.
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return { ...actual, useProjects: vi.fn() }
})

const projectsQuery = vi.mocked(useProjects)

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const PROJECTS: Project[] = [
  {
    id: "prj_1",
    name: "Apollo",
    slug: "apollo",
    status: "active",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
  },
  {
    id: "prj_2",
    name: "Beacon",
    slug: "beacon",
    status: "active",
    createdAt: "2026-11-02T00:00:00.000Z",
    updatedAt: "2026-11-02T00:00:00.000Z",
  },
]

function renderPanel() {
  return render(
    <>
      <PreferencesPanel />
      <Toaster />
    </>,
  )
}

function fetchCalls() {
  return vi.mocked(fetch).mock.calls
}

/** Default fetch mock: serves preferences GET/PUT and the projects list. */
function mockFetch(preferences: UserPreferences) {
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input)
    if (url === "/api/preferences" && init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as { preferences: Partial<UserPreferences> }
      return jsonResponse({ ok: true, preferences: { ...preferences, ...body.preferences } })
    }
    if (url === "/api/preferences") {
      return jsonResponse({ ok: true, preferences })
    }
    if (url === "/api/projects") {
      return jsonResponse(PROJECTS)
    }
    throw new Error(`Unexpected fetch: ${url}`)
  })
}

beforeEach(() => {
  vi.mocked(fetch).mockReset()
  projectsQuery.mockReturnValue({
    data: PROJECTS,
    status: "success",
    mode: "ready",
    error: null,
    isLoading: false,
    isRetrying: false,
    isEmpty: false,
    refetch: vi.fn(),
  })
})

describe("PreferencesPanel", () => {
  it("loads and renders the general preferences", async () => {
    mockFetch(defaultUserPreferences())
    renderPanel()

    // Wait for a control that only exists once loading finishes.
    expect(await screen.findByRole("switch", { name: "Reduce motion" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Preferences" })).toBeInTheDocument()
    expect(screen.getByLabelText("Interface density")).toHaveValue("comfortable")
    expect(screen.getByLabelText("Week starts on")).toHaveValue("monday")
    expect(screen.getByLabelText("Default project")).toHaveValue("")
    expect(screen.getByRole("switch", { name: "Confirm destructive actions" })).toBeChecked()
    expect(screen.getByRole("switch", { name: "Reduce motion" })).not.toBeChecked()
    expect(screen.getByRole("button", { name: "Save preferences" })).toBeDisabled()
  })

  it("lists workspace projects in the default project select", async () => {
    mockFetch({ ...defaultUserPreferences(), defaultProjectId: "prj_2" })
    renderPanel()

    const select = await screen.findByLabelText("Default project")
    await screen.findByRole("option", { name: "Beacon" })
    expect(select).toHaveValue("prj_2")
  })

  it("tracks dirty state and PUTs only the changed fields", async () => {
    const user = userEvent.setup()
    mockFetch(defaultUserPreferences())
    renderPanel()

    const saveButton = await screen.findByRole("button", { name: "Save preferences" })
    expect(saveButton).toBeDisabled()

    await user.selectOptions(screen.getByLabelText("Interface density"), "compact")
    await user.click(screen.getByRole("switch", { name: "Reduce motion" }))

    expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument()
    expect(saveButton).toBeEnabled()

    await user.click(saveButton)

    expect(await screen.findByText("Changes saved.")).toBeInTheDocument()

    const putCall = fetchCalls().find(([, init]) => init?.method === "PUT")
    expect(putCall).toBeDefined()
    expect(putCall?.[0]).toBe("/api/preferences")
    expect(JSON.parse(String(putCall?.[1]?.body))).toEqual({
      preferences: { density: "compact", reduceMotion: true },
    })
    expect(screen.queryByText("You have unsaved changes.")).not.toBeInTheDocument()
  })

  it("sends null when the default project is cleared", async () => {
    const user = userEvent.setup()
    mockFetch({ ...defaultUserPreferences(), defaultProjectId: "prj_1" })
    renderPanel()

    const select = await screen.findByLabelText("Default project")
    await screen.findByRole("option", { name: "Apollo" })

    await user.selectOptions(select, "")
    await user.click(screen.getByRole("button", { name: "Save preferences" }))

    const putCall = fetchCalls().find(([, init]) => init?.method === "PUT")
    expect(JSON.parse(String(putCall?.[1]?.body))).toEqual({
      preferences: { defaultProjectId: null },
    })
  })

  it("shows the error state and retries the load", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("boom"))
      .mockImplementation(async (input) => {
        const url = String(input)
        if (url === "/api/preferences") {
          return jsonResponse({ ok: true, preferences: defaultUserPreferences() })
        }
        if (url === "/api/projects") {
          return jsonResponse(PROJECTS)
        }
        throw new Error(`Unexpected fetch: ${url}`)
      })
    renderPanel()

    expect(await screen.findByText("Preferences did not load")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /try again/i }))

    expect(await screen.findByRole("switch", { name: "Reduce motion" })).toBeInTheDocument()
  })
})
