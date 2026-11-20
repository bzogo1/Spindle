import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { useProjectHome, useSession } from "@/lib/api"
import type { ProjectHomeData } from "@/lib/api/types"
import { Toaster } from "@/components/ui/toast"

import {
  AppNotificationsProvider,
  NOTIFICATION_PREFERENCES_STORAGE_KEY,
} from "./notifications-provider"
import { ProjectSettingsScreen } from "./project-settings-screen"

const navigationMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigationMocks.push, replace: navigationMocks.replace }),
  usePathname: () => "/projects/prj_01/settings",
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    api: {
      ...actual.api,
      projects: {
        ...actual.api.projects,
        updateProject: vi.fn(),
        deleteProject: vi.fn(),
        addProjectMember: vi.fn(),
        updateProjectMemberRole: vi.fn(),
        removeProjectMember: vi.fn(),
      },
    },
    useProjectHome: vi.fn(),
    useSession: vi.fn(),
  }
})

const homeQuery = vi.mocked(useProjectHome)
const sessionQuery = vi.mocked(useSession)

const now = "2026-11-19T12:00:00.000Z"

const owner = {
  id: "usr_01",
  email: "bogdan@example.com",
  name: "Bogdan",
  createdAt: now,
}

function buildHome(): ProjectHomeData {
  return {
    project: {
      id: "prj_01",
      name: "Coastal resilience",
      slug: "coastal-resilience",
      description: "Tidal analysis workspace",
      status: "active",
      createdAt: now,
      updatedAt: now,
      visibility: "private",
      owner,
      members: [
        { id: "mem_1", user: owner, role: "owner", joinedAt: now },
        {
          id: "mem_2",
          user: { id: "usr_02", email: "ana@example.com", name: "Ana K", createdAt: now },
          role: "member",
          joinedAt: now,
        },
      ],
    },
    files: [],
    labSessions: [],
    agentRuns: [],
    chatConversationId: "conv_prj_01",
    chatMessages: [],
    activity: [],
    storageBytes: 0,
    generatedAt: now,
  }
}

function mockHome(overrides: Partial<ReturnType<typeof useProjectHome>> = {}) {
  homeQuery.mockReturnValue({
    status: "success",
    mode: "ready",
    data: buildHome(),
    error: undefined,
    isRetrying: false,
    refetch: vi.fn(),
    ...overrides,
  })
}

function mockSession(userId = owner.id) {
  sessionQuery.mockReturnValue({
    status: "success",
    data: { ...owner, id: userId },
    error: null,
    isLoading: false,
    isRetrying: false,
    isEmpty: false,
    mode: "ready",
    refetch: vi.fn(),
  })
}

describe("ProjectSettingsScreen", () => {
  beforeEach(() => {
    homeQuery.mockReset()
    sessionQuery.mockReset()
    navigationMocks.push.mockReset()
    navigationMocks.replace.mockReset()
    window.localStorage.clear()
    mockSession()
  })

  it("shows the skeleton while the project loads", () => {
    mockHome({ status: "loading", mode: "loading", data: undefined })

    render(<ProjectSettingsScreen projectId="prj_01" />)

    expect(screen.getByRole("status")).toHaveTextContent("Loading project")
  })

  it("renders the general tab with the project name and description", () => {
    mockHome()

    render(<ProjectSettingsScreen projectId="prj_01" />)

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument()
    expect(screen.getByLabelText("Project name")).toHaveValue("Coastal resilience")
    expect(screen.getByLabelText("Description")).toHaveValue("Tidal analysis workspace")
    expect(screen.getByLabelText("Visibility")).toBeDisabled()
    expect(screen.getByLabelText("Default branch")).toBeDisabled()
  })

  it("saves name and description through the projects API", async () => {
    const { api } = await import("@/lib/api")
    const updateProject = vi.mocked(api.projects.updateProject)
    updateProject.mockResolvedValue({ ...buildHome().project })
    mockHome()

    const user = userEvent.setup()
    render(<ProjectSettingsScreen projectId="prj_01" />)

    const nameInput = screen.getByLabelText("Project name")
    await user.clear(nameInput)
    await user.type(nameInput, "Coastal Resilience 2026")
    await user.click(screen.getByRole("button", { name: "Save changes" }))

    await waitFor(() => {
      expect(updateProject).toHaveBeenCalledWith("prj_01", {
        name: "Coastal Resilience 2026",
        description: "Tidal analysis workspace",
      })
    })
  })

  it("shows an inline error and skips the API when the project name is blank", async () => {
    const { api } = await import("@/lib/api")
    const updateProject = vi.mocked(api.projects.updateProject)
    mockHome()

    const user = userEvent.setup()
    render(<ProjectSettingsScreen projectId="prj_01" />)

    const nameInput = screen.getByLabelText("Project name")
    await user.clear(nameInput)
    await user.type(nameInput, "   ")
    await user.click(screen.getByRole("button", { name: "Save changes" }))

    expect(await screen.findByText("Project name is required.")).toBeInTheDocument()
    expect(nameInput).toHaveAttribute("aria-invalid", "true")
    expect(updateProject).not.toHaveBeenCalled()
  })

  it("validates the webhook URL format and event selection", async () => {
    mockHome()

    const user = userEvent.setup()
    render(<ProjectSettingsScreen projectId="prj_01" />)

    await user.click(screen.getByRole("tab", { name: "Webhooks" }))
    await user.click(screen.getAllByRole("button", { name: "New webhook" })[0])

    await user.type(screen.getByLabelText("Endpoint URL"), "not-a-url")
    await user.click(screen.getByRole("button", { name: "Create webhook" }))

    expect(
      await screen.findByText("Enter a valid URL starting with http:// or https://."),
    ).toBeInTheDocument()
    expect(screen.getByText("Select at least one event to subscribe to.")).toBeInTheDocument()
    expect(screen.queryByText(/whsec_/)).not.toBeInTheDocument()
  })

  it("creates a webhook and reveals the signing secret once", async () => {
    mockHome()

    const user = userEvent.setup()
    render(<ProjectSettingsScreen projectId="prj_01" />)

    await user.click(screen.getByRole("tab", { name: "Webhooks" }))
    // Both the card header and the empty state offer a "New webhook" action.
    await user.click(screen.getAllByRole("button", { name: "New webhook" })[0])

    await user.type(screen.getByLabelText("Endpoint URL"), "https://example.com/hooks/spindle")
    await user.click(screen.getByRole("checkbox", { name: /file\.uploaded/ }))
    await user.click(screen.getByRole("button", { name: "Create webhook" }))

    expect(await screen.findByText(/whsec_[0-9a-f]{36}/)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Done" }))

    expect(screen.queryByText(/whsec_/)).not.toBeInTheDocument()
    expect(screen.getByText("https://example.com/hooks/spindle")).toBeInTheDocument()
  })

  it("shows saved values when editing a webhook again", async () => {
    mockHome()

    const user = userEvent.setup()
    render(<ProjectSettingsScreen projectId="prj_01" />)

    await user.click(screen.getByRole("tab", { name: "Webhooks" }))
    await user.click(screen.getAllByRole("button", { name: "New webhook" })[0])
    await user.type(screen.getByLabelText("Endpoint URL"), "https://example.com/hooks/one")
    await user.click(screen.getByRole("checkbox", { name: /file\.uploaded/ }))
    await user.click(screen.getByRole("button", { name: "Create webhook" }))
    await user.click(await screen.findByRole("button", { name: "Done" }))

    await user.click(screen.getByRole("button", { name: "Edit" }))
    const urlInput = screen.getByLabelText("Endpoint URL")
    await user.clear(urlInput)
    await user.type(urlInput, "https://example.com/hooks/two")
    await user.click(screen.getByRole("button", { name: "Save changes" }))

    // Saving an edit closes the dialog; reopening Edit shows the new values.
    await waitFor(() => {
      expect(screen.queryByLabelText("Endpoint URL")).not.toBeInTheDocument()
    })
    await user.click(screen.getByRole("button", { name: "Edit" }))
    expect(screen.getByLabelText("Endpoint URL")).toHaveValue("https://example.com/hooks/two")
    expect(screen.getByRole("checkbox", { name: /file\.uploaded/ })).toBeChecked()
  })

  it("pauses and resumes a webhook with the enable switch", async () => {
    mockHome()

    const user = userEvent.setup()
    render(<ProjectSettingsScreen projectId="prj_01" />)

    await user.click(screen.getByRole("tab", { name: "Webhooks" }))
    await user.click(screen.getAllByRole("button", { name: "New webhook" })[0])
    await user.type(screen.getByLabelText("Endpoint URL"), "https://example.com/hooks/one")
    await user.click(screen.getByRole("checkbox", { name: /file\.uploaded/ }))
    await user.click(screen.getByRole("button", { name: "Create webhook" }))
    await user.click(await screen.findByRole("button", { name: "Done" }))

    const toggle = screen.getByRole("switch", {
      name: "Enable deliveries for https://example.com/hooks/one",
    })
    expect(toggle).toHaveAttribute("aria-checked", "true")
    expect(screen.getByText("active")).toBeInTheDocument()

    await user.click(toggle)
    expect(toggle).toHaveAttribute("aria-checked", "false")
    expect(screen.getByText("paused")).toBeInTheDocument()

    await user.click(toggle)
    expect(toggle).toHaveAttribute("aria-checked", "true")
  })

  it("records a mock delivery when test-firing a webhook", async () => {
    mockHome()

    const user = userEvent.setup()
    render(<ProjectSettingsScreen projectId="prj_01" />)

    await user.click(screen.getByRole("tab", { name: "Webhooks" }))
    await user.click(screen.getAllByRole("button", { name: "New webhook" })[0])
    await user.type(screen.getByLabelText("Endpoint URL"), "https://example.com/hooks/one")
    await user.click(screen.getByRole("checkbox", { name: /file\.uploaded/ }))
    await user.click(screen.getByRole("button", { name: "Create webhook" }))
    await user.click(await screen.findByRole("button", { name: "Done" }))

    await user.click(screen.getByRole("button", { name: "Test" }))

    expect(await screen.findByText("webhook.test")).toBeInTheDocument()
    // The webhook was created with a secret, so the mock notes the signature.
    expect(
      screen.getByText(/Mock delivery — no request sent\. Payload would be signed/),
    ).toBeInTheDocument()
    expect(screen.getByText("delivered")).toBeInTheDocument()
  })

  it("disables destructive actions for non-owners", async () => {
    mockHome()
    mockSession("usr_02")

    const user = userEvent.setup()
    render(<ProjectSettingsScreen projectId="prj_01" />)

    await user.click(screen.getByRole("tab", { name: "Danger zone" }))

    expect(screen.getByRole("button", { name: /Delete project/ })).toBeDisabled()
    expect(screen.getByRole("button", { name: /Transfer ownership/ })).toBeDisabled()
    expect(screen.getByRole("button", { name: /Archive project/ })).toBeDisabled()
  })

  it("archives the project after confirmation", async () => {
    const { api } = await import("@/lib/api")
    const updateProject = vi.mocked(api.projects.updateProject)
    updateProject.mockResolvedValue({ ...buildHome().project, status: "archived" })
    const refetch = vi.fn()
    mockHome({ refetch })

    const user = userEvent.setup()
    render(<ProjectSettingsScreen projectId="prj_01" />)

    await user.click(screen.getByRole("tab", { name: "Danger zone" }))
    await user.click(screen.getByRole("button", { name: "Archive project" }))

    // Both the danger-zone row and the dialog footer render an "Archive project" button.
    const confirmButton = screen
      .getAllByRole("button", { name: "Archive project" })
      .at(-1) as HTMLElement
    await user.click(confirmButton)

    await waitFor(() => {
      expect(updateProject).toHaveBeenCalledWith("prj_01", { status: "archived" })
      expect(refetch).toHaveBeenCalled()
    })
  })

  it("transfers ownership after typing the project name to confirm", async () => {
    const { api } = await import("@/lib/api")
    const updateProject = vi.mocked(api.projects.updateProject)
    updateProject.mockResolvedValue({ ...buildHome().project })
    const refetch = vi.fn()
    mockHome({ refetch })

    const user = userEvent.setup()
    render(<ProjectSettingsScreen projectId="prj_01" />)

    await user.click(screen.getByRole("tab", { name: "Danger zone" }))
    await user.click(screen.getByRole("button", { name: /Transfer ownership/ }))

    // The footer button stays disabled until the project name is typed.
    const confirmButton = screen
      .getAllByRole("button", { name: "Transfer ownership" })
      .at(-1) as HTMLElement
    expect(confirmButton).toBeDisabled()

    await user.type(screen.getByLabelText(/Type/), "Coastal resilience")
    await user.click(confirmButton)

    await waitFor(() => {
      expect(updateProject).toHaveBeenCalledWith("prj_01", { ownerId: "usr_02" })
      expect(refetch).toHaveBeenCalled()
    })
  })

  it("shows an error toast when the ownership transfer fails", async () => {
    const { api } = await import("@/lib/api")
    const updateProject = vi.mocked(api.projects.updateProject)
    updateProject.mockRejectedValue(new Error("Owner transfer is not permitted"))
    mockHome()

    const user = userEvent.setup()
    render(
      <>
        <ProjectSettingsScreen projectId="prj_01" />
        <Toaster />
      </>,
    )

    await user.click(screen.getByRole("tab", { name: "Danger zone" }))
    await user.click(screen.getByRole("button", { name: /Transfer ownership/ }))
    await user.type(screen.getByLabelText(/Type/), "Coastal resilience")
    const confirmButton = screen
      .getAllByRole("button", { name: "Transfer ownership" })
      .at(-1) as HTMLElement
    await user.click(confirmButton)

    expect(await screen.findByText("Could not transfer ownership")).toBeInTheDocument()
  })

  it("reactivates an archived project", async () => {
    const { api } = await import("@/lib/api")
    const updateProject = vi.mocked(api.projects.updateProject)
    updateProject.mockResolvedValue({ ...buildHome().project })
    const archivedHome = buildHome()
    archivedHome.project = { ...archivedHome.project, status: "archived" }
    mockHome({ data: archivedHome })

    const user = userEvent.setup()
    render(<ProjectSettingsScreen projectId="prj_01" />)

    await user.click(screen.getByRole("tab", { name: "Danger zone" }))
    expect(screen.getByText("Archived")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Reactivate project" }))
    const confirmButton = screen
      .getAllByRole("button", { name: "Reactivate project" })
      .at(-1) as HTMLElement
    await user.click(confirmButton)

    await waitFor(() => {
      expect(updateProject).toHaveBeenCalledWith("prj_01", { status: "active" })
    })
  })

  it("exports the general settings as a JSON download", async () => {
    const createObjectURL = vi.fn(() => "blob:mock")
    const revokeObjectURL = vi.fn()
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)
    mockHome()

    const user = userEvent.setup()
    render(<ProjectSettingsScreen projectId="prj_01" />)

    await user.click(screen.getByRole("button", { name: "Export JSON" }))

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock")

    click.mockRestore()
    vi.unstubAllGlobals()
  })

  it("imports project settings from a JSON file into the form", async () => {
    mockHome()

    const user = userEvent.setup()
    render(<ProjectSettingsScreen projectId="prj_01" />)

    const file = new File(
      [
        JSON.stringify({
          kind: "spindle-project-settings",
          version: 1,
          settings: { name: "Imported project", description: "Restored from file" },
        }),
      ],
      "settings.json",
      { type: "application/json" },
    )
    await user.upload(screen.getByLabelText("Choose a settings file to import"), file)

    await waitFor(() => {
      expect(screen.getByLabelText("Project name")).toHaveValue("Imported project")
      expect(screen.getByLabelText("Description")).toHaveValue("Restored from file")
    })
  })

  it("rejects a settings file that is not a project settings export", async () => {
    mockHome()

    const user = userEvent.setup()
    render(<ProjectSettingsScreen projectId="prj_01" />)

    const file = new File([JSON.stringify({ hello: "world" })], "settings.json", {
      type: "application/json",
    })
    await user.upload(screen.getByLabelText("Choose a settings file to import"), file)

    expect(
      await screen.findByText("This file is not a Spindle project settings export."),
    ).toBeInTheDocument()
    expect(screen.getByLabelText("Project name")).toHaveValue("Coastal resilience")
  })

  it("deletes the project after typed confirmation", async () => {
    const { api } = await import("@/lib/api")
    const deleteProject = vi.mocked(api.projects.deleteProject)
    deleteProject.mockResolvedValue(undefined)
    mockHome()

    const user = userEvent.setup()
    render(<ProjectSettingsScreen projectId="prj_01" />)

    await user.click(screen.getByRole("tab", { name: "Danger zone" }))
    await user.click(screen.getByRole("button", { name: /Delete project/ }))

    // Both the danger-zone row and the dialog footer render a "Delete project" button.
    const confirmButton = screen
      .getAllByRole("button", { name: "Delete project" })
      .at(-1) as HTMLElement
    expect(confirmButton).toBeDisabled()

    await user.type(screen.getByLabelText(/Type/), "Coastal resilience")
    await user.click(confirmButton)

    await waitFor(() => {
      expect(deleteProject).toHaveBeenCalledWith("prj_01")
      expect(navigationMocks.replace).toHaveBeenCalledWith("/projects")
    })
  })

  it("lists project members on the Members tab", async () => {
    mockHome()

    const user = userEvent.setup()
    render(<ProjectSettingsScreen projectId="prj_01" />)

    await user.click(screen.getByRole("tab", { name: "Members" }))

    expect(screen.getByRole("heading", { name: "Members" })).toBeInTheDocument()
    expect(screen.getByText("Bogdan")).toBeInTheDocument()
    expect(screen.getByText("Ana K")).toBeInTheDocument()
    // The workspace roster loads asynchronously before candidates appear.
    expect(await screen.findByRole("option", { name: /Ilya Petrov/ })).toBeInTheDocument()
  })

  it("adds a workspace member through the members API", async () => {
    const { api } = await import("@/lib/api")
    const addProjectMember = vi.mocked(api.projects.addProjectMember)
    addProjectMember.mockResolvedValue({
      id: "mem_3",
      user: {
        id: "usr_03",
        email: "ilya@northlight.dev",
        name: "Ilya Petrov",
        createdAt: now,
      },
      role: "member",
      joinedAt: now,
    })
    const refetch = vi.fn()
    mockHome({ refetch })

    const user = userEvent.setup()
    render(<ProjectSettingsScreen projectId="prj_01" />)

    await user.click(screen.getByRole("tab", { name: "Members" }))
    await user.selectOptions(await screen.findByLabelText("Add a workspace member"), "usr_03")
    await user.click(screen.getByRole("button", { name: "Add member" }))

    await waitFor(() => {
      expect(addProjectMember).toHaveBeenCalledWith("prj_01", {
        userId: "usr_03",
        role: "member",
      })
      expect(refetch).toHaveBeenCalled()
    })
  })

  it("changes a member role through the members API", async () => {
    const { api } = await import("@/lib/api")
    const updateProjectMemberRole = vi.mocked(api.projects.updateProjectMemberRole)
    updateProjectMemberRole.mockResolvedValue({
      id: "mem_2",
      user: { id: "usr_02", email: "ana@example.com", name: "Ana K", createdAt: now },
      role: "admin",
      joinedAt: now,
    })
    const refetch = vi.fn()
    mockHome({ refetch })

    const user = userEvent.setup()
    render(<ProjectSettingsScreen projectId="prj_01" />)

    await user.click(screen.getByRole("tab", { name: "Members" }))
    await user.selectOptions(screen.getByLabelText("Role for Ana K"), "admin")

    await waitFor(() => {
      expect(updateProjectMemberRole).toHaveBeenCalledWith("prj_01", "mem_2", "admin")
      expect(refetch).toHaveBeenCalled()
    })
  })

  it("hides member management controls from plain members", async () => {
    mockHome()
    // usr_02 is a regular member of the fixture project.
    mockSession("usr_02")

    const user = userEvent.setup()
    render(<ProjectSettingsScreen projectId="prj_01" />)

    await user.click(screen.getByRole("tab", { name: "Members" }))

    expect(
      screen.getByText("Only project owners and admins can manage members."),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText("Add a workspace member")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Role for Ana K")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument()
  })

  it("stores project notification overrides from the Notifications tab", async () => {
    window.localStorage.removeItem(NOTIFICATION_PREFERENCES_STORAGE_KEY)
    mockHome()

    const user = userEvent.setup()
    render(
      <AppNotificationsProvider>
        <ProjectSettingsScreen projectId="prj_01" />
      </AppNotificationsProvider>,
    )

    await user.click(screen.getByRole("tab", { name: "Notifications" }))

    const muteSwitch = screen.getByRole("switch", { name: "Mute this project" })
    expect(muteSwitch).toHaveAttribute("aria-checked", "false")
    await user.click(muteSwitch)

    await waitFor(() => {
      const stored = JSON.parse(
        window.localStorage.getItem(NOTIFICATION_PREFERENCES_STORAGE_KEY) ?? "{}",
      ) as { projects?: Record<string, { muted?: boolean }> }
      expect(stored.projects?.prj_01?.muted).toBe(true)
    })
    expect(muteSwitch).toHaveAttribute("aria-checked", "true")
  })

  it("stores and clears a per-category in-app override", async () => {
    window.localStorage.removeItem(NOTIFICATION_PREFERENCES_STORAGE_KEY)
    mockHome()

    const user = userEvent.setup()
    render(
      <AppNotificationsProvider>
        <ProjectSettingsScreen projectId="prj_01" />
      </AppNotificationsProvider>,
    )

    await user.click(screen.getByRole("tab", { name: "Notifications" }))

    const overrideSelect = screen.getByLabelText("Agent runs in-app override for this project")
    await user.selectOptions(overrideSelect, "off")

    await waitFor(() => {
      const stored = JSON.parse(
        window.localStorage.getItem(NOTIFICATION_PREFERENCES_STORAGE_KEY) ?? "{}",
      ) as { projects?: Record<string, { categories?: Record<string, { inApp?: boolean }> }> }
      expect(stored.projects?.prj_01?.categories?.agent?.inApp).toBe(false)
    })

    // Switching back to Default removes the override and drops the empty entry.
    await user.selectOptions(overrideSelect, "inherit")

    await waitFor(() => {
      const stored = JSON.parse(
        window.localStorage.getItem(NOTIFICATION_PREFERENCES_STORAGE_KEY) ?? "{}",
      ) as { projects?: Record<string, unknown> }
      expect(stored.projects?.prj_01).toBeUndefined()
    })
    expect(
      screen.queryByRole("button", { name: "Reset project overrides" }),
    ).not.toBeInTheDocument()
  })
})
