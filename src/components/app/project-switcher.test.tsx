import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { api } from "@/lib/api"
import type { ProjectSummary } from "@/lib/api/types"
import { Toaster } from "@/components/ui/toast"

import { ProjectSwitcher } from "./project-switcher"

const navigationMocks = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  search: "",
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigationMocks.replace, push: navigationMocks.push }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(navigationMocks.search),
}))

const now = "2026-11-19T12:00:00.000Z"

const owner = { id: "usr_01", email: "ada@example.com", name: "Ada Lovelace", createdAt: now }

function project(id: string, name: string, slug: string, description?: string): ProjectSummary {
  return {
    id,
    name,
    slug,
    description,
    status: "active",
    createdAt: now,
    updatedAt: now,
    owner,
    visibility: "workspace",
    memberCount: 2,
    fileCount: 4,
    labSessionCount: 1,
    agentRunCount: 3,
    storageBytes: 1024,
  }
}

const projects = [
  project("prj_01", "Tide Pool Survey", "tide-pool-survey", "Weekly tide pool measurements"),
  project("prj_02", "Harbor Ledger", "harbor-ledger", "Dock maintenance log"),
]

function renderSwitcher(list: ProjectSummary[] = projects) {
  return render(
    <>
      <ProjectSwitcher projects={list} onCreateProject={vi.fn()} />
      <Toaster />
    </>,
  )
}

async function openSwitcher() {
  const user = userEvent.setup()
  await user.click(screen.getByRole("button", { name: /switch project/i }))
  return user
}

describe("ProjectSwitcher", () => {
  beforeEach(() => {
    navigationMocks.replace.mockReset()
    navigationMocks.push.mockReset()
    navigationMocks.search = ""
  })

  it("shows the selected project on the trigger and lists projects when opened", async () => {
    renderSwitcher()

    const trigger = screen.getByRole("button", { name: /switch project/i })
    expect(trigger).toHaveTextContent("Tide Pool Survey")

    await openSwitcher()

    const combobox = screen.getByRole("combobox", { name: "Search projects" })
    expect(combobox).toHaveAttribute("aria-autocomplete", "list")
    expect(combobox).toHaveAttribute("aria-expanded", "true")
    expect(combobox).toHaveAttribute("aria-controls")
    const listbox = screen.getByRole("listbox")
    expect(combobox.getAttribute("aria-controls")).toBe(listbox.id)
    expect(screen.getByRole("option", { name: /Tide Pool Survey/ })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: /Harbor Ledger/ })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: /Create new project/ })).toBeInTheDocument()
  })

  it("honors the ?project= search param for the current project", async () => {
    navigationMocks.search = "project=prj_02"
    renderSwitcher()

    expect(screen.getByRole("button", { name: /switch project/i })).toHaveTextContent(
      "Harbor Ledger",
    )

    await openSwitcher()

    const current = screen.getByRole("option", { name: /Harbor Ledger/ })
    expect(current.querySelector("svg")).not.toBeNull()
  })

  it("filters projects by fuzzy name match while typing", async () => {
    renderSwitcher()
    const user = await openSwitcher()

    await user.type(screen.getByRole("combobox", { name: "Search projects" }), "harbor")

    expect(screen.getByRole("option", { name: /Harbor Ledger/ })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: /Tide Pool Survey/ })).not.toBeInTheDocument()
    // The create action stays available even when nothing matches.
    expect(screen.getByRole("option", { name: /Create “harbor”/ })).toBeInTheDocument()
  })

  it("selects a project with arrow keys and Enter", async () => {
    renderSwitcher()
    const user = await openSwitcher()
    const search = screen.getByRole("combobox", { name: "Search projects" })

    await user.keyboard("{ArrowDown}")
    await user.keyboard("{Enter}")

    await waitFor(() => {
      expect(navigationMocks.replace).toHaveBeenCalledWith("/dashboard?project=prj_02", {
        scroll: false,
      })
    })
    expect(search).not.toBeInTheDocument()
  })

  it("creates a project inline and shows a success toast", async () => {
    const createSpy = vi
      .spyOn(api.projects, "createProject")
      .mockResolvedValue({ ...projects[0], id: "prj_new", name: "Reef Census" })
    renderSwitcher()
    const user = await openSwitcher()

    await user.click(screen.getByRole("option", { name: /Create new project/ }))

    const nameInput = screen.getByRole("textbox", { name: "New project name" })
    await user.type(nameInput, "Reef Census")
    await user.click(screen.getByRole("button", { name: "Create" }))

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith({ name: "Reef Census" })
    })
    expect(await screen.findByText("Project created")).toBeInTheDocument()
  })

  it("shows an error toast when creation fails", async () => {
    vi.spyOn(api.projects, "createProject").mockRejectedValue(new Error("Quota exceeded"))
    renderSwitcher()
    const user = await openSwitcher()

    await user.click(screen.getByRole("option", { name: /Create new project/ }))
    await user.type(screen.getByRole("textbox", { name: "New project name" }), "Reef Census")
    await user.click(screen.getByRole("button", { name: "Create" }))

    expect(await screen.findByText("Couldn't create project")).toBeInTheDocument()
  })
})
