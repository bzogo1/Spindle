import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { EmptyState } from "./empty-state"
import {
  NoFilesEmptyState,
  NoNotificationsEmptyState,
  NoProjectsEmptyState,
  NoRunsEmptyState,
  SearchNoResultsEmptyState,
} from "./empty-states"

describe("EmptyState", () => {
  it("renders the title, description, and both actions", async () => {
    const onClick = vi.fn()
    render(
      <EmptyState
        title="No files yet"
        description="Upload a file to get started."
        primaryAction={{ label: "Upload", onClick }}
        secondaryAction={{ label: "Read the guide", href: "/docs" }}
      />,
    )

    expect(screen.getByRole("heading", { name: "No files yet" })).toBeInTheDocument()
    expect(screen.getByText("Upload a file to get started.")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Upload" }))
    expect(onClick).toHaveBeenCalledTimes(1)

    expect(screen.getByRole("link", { name: "Read the guide" })).toHaveAttribute("href", "/docs")
  })

  it("lets callers override the default copy", () => {
    render(<EmptyState title="Custom title" description="Custom body" />)

    expect(screen.getByRole("heading", { name: "Custom title" })).toBeInTheDocument()
    expect(screen.getByText("Custom body")).toBeInTheDocument()
  })
})

describe("empty-state variants", () => {
  it("NoProjectsEmptyState renders the shared project copy", () => {
    render(<NoProjectsEmptyState />)

    expect(screen.getByRole("heading", { name: "No projects yet" })).toBeInTheDocument()
    expect(screen.getByText(/Create a project to start collecting files/i)).toBeInTheDocument()
  })

  it("NoFilesEmptyState renders the shared file copy", () => {
    render(<NoFilesEmptyState />)

    expect(screen.getByRole("heading", { name: "No files yet" })).toBeInTheDocument()
  })

  it("NoRunsEmptyState renders the shared agent run copy", () => {
    render(<NoRunsEmptyState />)

    expect(screen.getByRole("heading", { name: "No agent runs yet" })).toBeInTheDocument()
  })

  it("NoNotificationsEmptyState renders notification copy", () => {
    render(<NoNotificationsEmptyState />)

    expect(screen.getByRole("heading", { name: "No notifications yet" })).toBeInTheDocument()
  })

  it("SearchNoResultsEmptyState interpolates the query", () => {
    render(<SearchNoResultsEmptyState query="tide" />)

    expect(screen.getByRole("heading", { name: "No results" })).toBeInTheDocument()
    expect(screen.getByText(/Nothing matches “tide”/)).toBeInTheDocument()
  })

  it("variant overrides win over the defaults", () => {
    render(
      <NoFilesEmptyState
        title="Folder is empty"
        primaryAction={{ label: "Upload", href: "/app/files" }}
      />,
    )

    expect(screen.getByRole("heading", { name: "Folder is empty" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Upload" })).toHaveAttribute("href", "/app/files")
  })
})
