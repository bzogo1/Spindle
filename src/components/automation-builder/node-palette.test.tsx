import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { NODE_TYPES } from "@/lib/automation-graph"

import { NodePalette } from "./node-palette"

describe("NodePalette", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("renders all category groups and node buttons", () => {
    render(<NodePalette onAddNode={vi.fn()} />)

    expect(screen.getByText("Node palette")).toBeInTheDocument()
    for (const label of ["Triggers", "Transforms", "Logic", "Actions"]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    for (const def of NODE_TYPES) {
      expect(screen.getByRole("button", { name: `Add ${def.label} node` })).toBeInTheDocument()
    }
  })

  it("calls onAddNode with the node type when clicked", async () => {
    const user = userEvent.setup()
    const onAddNode = vi.fn()
    render(<NodePalette onAddNode={onAddNode} />)

    await user.click(screen.getByRole("button", { name: "Add Transform node" }))
    expect(onAddNode).toHaveBeenCalledWith("transform")

    await user.click(screen.getByRole("button", { name: "Quick add trigger" }))
    expect(onAddNode).toHaveBeenCalledWith("trigger.schedule")
  })

  it("exposes node type data for drag-and-drop", () => {
    render(<NodePalette onAddNode={vi.fn()} />)
    const button = screen.getByRole("button", { name: "Add Schedule trigger node" })
    expect(button).toHaveAttribute("draggable", "true")

    // jsdom has no DragEvent/dataTransfer; dispatch a plain event carrying a stub.
    const dataTransfer = {
      setData: vi.fn(),
      effectAllowed: "",
    }
    const event = new Event("dragstart", { bubbles: true, cancelable: true })
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer })
    button.dispatchEvent(event)

    expect(dataTransfer.setData).toHaveBeenCalledWith(
      "application/x-automation-node",
      "trigger.schedule",
    )
    expect(dataTransfer.effectAllowed).toBe("copy")
  })

  it("filters node types by the search query", async () => {
    const user = userEvent.setup()
    render(<NodePalette onAddNode={vi.fn()} />)

    await user.type(screen.getByLabelText("Filter nodes"), "condition")

    expect(screen.getByRole("button", { name: "Add Condition node" })).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Add Schedule trigger node" }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText("Triggers")).not.toBeInTheDocument()
    expect(screen.getByText("Logic")).toBeInTheDocument()
  })

  it("shows an empty state and clears the filter", async () => {
    const user = userEvent.setup()
    render(<NodePalette onAddNode={vi.fn()} />)

    await user.type(screen.getByLabelText("Filter nodes"), "zzz-no-match")

    expect(screen.getByText(/No nodes match/)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Clear filter" }))
    expect(screen.getByRole("button", { name: "Add Transform node" })).toBeInTheDocument()
  })

  it("pins favorites to a Favorites group and persists them", async () => {
    const user = userEvent.setup()
    render(<NodePalette onAddNode={vi.fn()} />)

    await user.click(screen.getByRole("button", { name: "Favorite Agent task node" }))

    await waitFor(() => {
      expect(screen.getByText("Favorites")).toBeInTheDocument()
    })
    // Favorited node appears in both the Favorites group and its category.
    expect(screen.getAllByRole("button", { name: "Add Agent task node" })).toHaveLength(2)
    expect(localStorage.getItem("spindle:automation-palette-favorites")).toContain("agent.task")

    // Toggling again removes it from favorites. The node renders twice
    // (Favorites group + Actions category), so either toggle works.
    const removeButtons = screen.getAllByRole("button", {
      name: "Remove Agent task from favorites",
    })
    await user.click(removeButtons[0])
    await waitFor(() => {
      expect(screen.queryByText("Favorites")).not.toBeInTheDocument()
    })
  })
})
