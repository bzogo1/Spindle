import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { createEmptyGraph, addNodeToGraph, type GraphVersion } from "@/lib/automation-graph"

import { VersionHistoryPanel } from "./version-history-panel"

function makeVersion(name: string, label?: string): GraphVersion {
  const graph = addNodeToGraph(createEmptyGraph(name), "trigger.schedule", { x: 0, y: 0 })
  return {
    id: `gv_${name}`,
    label,
    graph,
    createdAt: new Date().toISOString(),
  }
}

describe("VersionHistoryPanel", () => {
  it("shows an empty-state hint when there are no versions", () => {
    render(
      <VersionHistoryPanel
        versions={[]}
        onRestore={vi.fn()}
        onSnapshot={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByText(/No saved versions yet/)).toBeInTheDocument()
  })

  it("lists versions with labels, counts, and timestamps", () => {
    render(
      <VersionHistoryPanel
        versions={[makeVersion("Daily digest", "before refactor"), makeVersion("Untitled")]}
        onRestore={vi.fn()}
        onSnapshot={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByText("before refactor")).toBeInTheDocument()
    expect(screen.getByText("Untitled")).toBeInTheDocument()
    expect(screen.getAllByText(/1 node · 0 connections/)).toHaveLength(2)
    expect(screen.getAllByRole("button", { name: "Restore this version" })).toHaveLength(2)
  })

  it("calls onRestore with the stored graph", async () => {
    const user = userEvent.setup()
    const version = makeVersion("Old graph")
    const onRestore = vi.fn()
    render(
      <VersionHistoryPanel
        versions={[version]}
        onRestore={onRestore}
        onSnapshot={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Restore this version" }))
    expect(onRestore).toHaveBeenCalledWith(version.graph)
  })

  it("passes the typed label to onSnapshot and clears the input", async () => {
    const user = userEvent.setup()
    const onSnapshot = vi.fn()
    render(
      <VersionHistoryPanel
        versions={[]}
        onRestore={vi.fn()}
        onSnapshot={onSnapshot}
        onDelete={vi.fn()}
      />,
    )

    await user.type(screen.getByLabelText("Version label"), "checkpoint A")
    await user.click(screen.getByRole("button", { name: "Snapshot" }))

    expect(onSnapshot).toHaveBeenCalledWith("checkpoint A")
    expect(screen.getByLabelText("Version label")).toHaveValue("")
  })

  it("calls onDelete with the version id", async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    render(
      <VersionHistoryPanel
        versions={[makeVersion("Doomed", "bad snapshot")]}
        onRestore={vi.fn()}
        onSnapshot={vi.fn()}
        onDelete={onDelete}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Delete version bad snapshot" }))
    expect(onDelete).toHaveBeenCalledWith("gv_Doomed")
  })
})
