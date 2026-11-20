import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ProjectTabs } from "./project-tabs"

let pathname = "/projects/prj_01"

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}))

describe("ProjectTabs", () => {
  beforeEach(() => {
    pathname = "/projects/prj_01"
  })

  it("renders every project section tab linking into the project route", () => {
    render(<ProjectTabs projectId="prj_01" />)

    const nav = screen.getByRole("navigation", { name: "Project sections" })
    const tabs = screen.getAllByRole("link")
    expect(tabs).toHaveLength(8)
    for (const tab of tabs) expect(nav).toContainElement(tab)

    const expected: [string, string][] = [
      ["Home", "/projects/prj_01"],
      ["Files", "/projects/prj_01/files"],
      ["Lab", "/projects/prj_01/lab"],
      ["Chat", "/projects/prj_01/chat"],
      ["Agent", "/projects/prj_01/agent"],
      ["Activity", "/projects/prj_01/activity"],
      ["Analytics", "/projects/prj_01/analytics"],
      ["Settings", "/projects/prj_01/settings"],
    ]
    for (const [label, href] of expected) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", href)
    }
  })

  it("marks only the Home tab current on the project root", () => {
    render(<ProjectTabs projectId="prj_01" />)

    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page")
    for (const label of ["Files", "Lab", "Chat", "Agent", "Activity", "Analytics", "Settings"]) {
      expect(screen.getByRole("link", { name: label })).not.toHaveAttribute("aria-current")
    }
  })

  it("marks the section tab current for its exact path", () => {
    pathname = "/projects/prj_01/files"

    render(<ProjectTabs projectId="prj_01" />)

    expect(screen.getByRole("link", { name: "Files" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current")
    expect(screen.getByRole("link", { name: "Lab" })).not.toHaveAttribute("aria-current")
  })

  it("keeps a tab current for nested paths under its section", () => {
    pathname = "/projects/prj_01/files/docs/readme"

    render(<ProjectTabs projectId="prj_01" />)

    expect(screen.getByRole("link", { name: "Files" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current")
  })

  it("does not mark Home current on nested project paths", () => {
    pathname = "/projects/prj_01/activity"

    render(<ProjectTabs projectId="prj_01" />)

    expect(screen.getByRole("link", { name: "Activity" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current")
  })

  it("does not treat a sibling project prefix as a nested path", () => {
    pathname = "/projects/prj_01/files-extra"

    render(<ProjectTabs projectId="prj_01" />)

    for (const label of [
      "Home",
      "Files",
      "Lab",
      "Chat",
      "Agent",
      "Activity",
      "Analytics",
      "Settings",
    ]) {
      expect(screen.getByRole("link", { name: label })).not.toHaveAttribute("aria-current")
    }
  })
})
