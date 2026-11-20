import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { createNode, type FileTreeNode } from "@/lib/file-tree"

import { FileTree } from "./file-tree"

function dir(id: string, name: string, children: FileTreeNode[] = []): FileTreeNode {
  return createNode({ id, name, type: "dir", children })
}
function file(id: string, name: string): FileTreeNode {
  return createNode({ id, name, type: "file" })
}

/** root > [docs>[a.md], src>[index.ts], readme.md] */
function sampleTree(): FileTreeNode {
  return dir("root", "Project root", [
    dir("docs", "docs", [file("a", "a.md")]),
    dir("src", "src", [file("index", "index.ts")]),
    file("readme", "readme.md"),
  ])
}

function row(id: string) {
  return document.getElementById(`ft-node-${id}`) as HTMLElement
}

describe("FileTree", () => {
  it("renders the tree with ARIA semantics", () => {
    render(<FileTree tree={sampleTree()} ariaLabel="Project files" />)
    const tree = screen.getByRole("tree", { name: "Project files" })
    expect(tree).toBeInTheDocument()
    const items = screen.getAllByRole("treeitem")
    // root + docs + a + src + index + readme (all expanded by default)
    expect(items).toHaveLength(6)
    expect(row("docs")).toHaveAttribute("aria-level", "2")
    expect(row("docs")).toHaveAttribute("aria-expanded", "true")
    expect(row("a")).toHaveAttribute("aria-level", "3")
    expect(row("a")).not.toHaveAttribute("aria-expanded")
    expect(row("readme")).toHaveAttribute("aria-selected", "false")
  })

  it("collapses and expands dirs via the caret", () => {
    render(<FileTree tree={sampleTree()} />)
    const caret = screen.getByRole("button", { name: "Collapse docs" })
    fireEvent.click(caret)
    expect(screen.queryByText("a.md")).not.toBeInTheDocument()
    expect(row("docs")).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(screen.getByRole("button", { name: "Expand docs" }))
    expect(screen.getByText("a.md")).toBeInTheDocument()
  })

  it("moves focus with arrow keys", () => {
    render(<FileTree tree={sampleTree()} />)
    row("root").focus()
    fireEvent.keyDown(row("root"), { key: "ArrowDown" })
    expect(document.activeElement).toBe(row("docs"))
    fireEvent.keyDown(row("docs"), { key: "ArrowRight" })
    // docs already expanded -> focus first child
    expect(document.activeElement).toBe(row("a"))
    fireEvent.keyDown(row("a"), { key: "ArrowLeft" })
    expect(document.activeElement).toBe(row("docs"))
  })

  it("reorders with Alt+Arrow keys and reports via onMove", () => {
    const onMove = vi.fn()
    render(<FileTree tree={sampleTree()} onMove={onMove} />)
    row("readme").focus()
    // readme is top-level index 2; Alt+ArrowUp -> before src (index 1)
    fireEvent.keyDown(row("readme"), { key: "ArrowUp", altKey: true })
    expect(onMove).toHaveBeenCalledWith("readme", null, 1)
    // Alt+ArrowDown at the end announces instead of moving
    fireEvent.keyDown(row("readme"), { key: "ArrowDown", altKey: true })
    expect(onMove).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("status")).toHaveTextContent(/already last/)
  })

  it("supports cut/paste via Ctrl+X / Ctrl+V", () => {
    const onMove = vi.fn()
    render(<FileTree tree={sampleTree()} onMove={onMove} />)
    // Cut readme, then paste into docs (a dir) -> inside docs
    fireEvent.keyDown(row("readme"), { key: "x", ctrlKey: true })
    expect(screen.getByRole("status")).toHaveTextContent(/Cut "readme.md"/)
    row("docs").focus()
    fireEvent.keyDown(row("docs"), { key: "v", ctrlKey: true })
    expect(onMove).toHaveBeenCalledWith("readme", "docs", undefined)
    expect(row("readme")).not.toHaveClass("is-cut")
  })

  it("pastes after a file sibling when the target is not a dir", () => {
    const onMove = vi.fn()
    render(<FileTree tree={sampleTree()} onMove={onMove} />)
    fireEvent.keyDown(row("index"), { key: "x", ctrlKey: true })
    // Focus readme (top-level file) -> paste "after" it in the same parent
    row("readme").focus()
    fireEvent.keyDown(row("readme"), { key: "v", ctrlKey: true })
    // readme is top-level index 2; index.ts currently lives in src.
    // resolveDrop(after readme) -> newParentId null, index 3
    expect(onMove).toHaveBeenCalledWith("index", null, 3)
  })

  it("announces rejection when onMove returns ok:false", () => {
    const onMove = vi.fn(() => ({ ok: false, error: "nope" }))
    render(<FileTree tree={sampleTree()} onMove={onMove} />)
    row("readme").focus()
    fireEvent.keyDown(row("readme"), { key: "ArrowUp", altKey: true })
    expect(screen.getByRole("status")).toHaveTextContent("nope")
  })

  it("exposes a visible keyboard hint", () => {
    render(<FileTree tree={sampleTree()} />)
    expect(screen.getByText(/Alt\+↑\/↓ moves a node/)).toBeInTheDocument()
  })
})

describe("FileTree controlled expansion", () => {
  it("honours expandedIds and reports changes via onExpandedChange", () => {
    const onExpandedChange = vi.fn()
    const { rerender } = render(
      <FileTree tree={sampleTree()} expandedIds={new Set()} onExpandedChange={onExpandedChange} />,
    )
    // Every dir collapsed: nested rows hidden, top-level rows visible.
    expect(screen.queryByText("a.md")).not.toBeInTheDocument()
    expect(screen.getByText("readme.md")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Expand docs" }))
    expect(onExpandedChange).toHaveBeenCalledTimes(1)
    const next = onExpandedChange.mock.calls[0][0] as Set<string>
    expect(next.has("docs")).toBe(true)
    // Still collapsed until the parent feeds the new set back.
    expect(screen.queryByText("a.md")).not.toBeInTheDocument()

    rerender(
      <FileTree tree={sampleTree()} expandedIds={next} onExpandedChange={onExpandedChange} />,
    )
    expect(screen.getByText("a.md")).toBeInTheDocument()
  })
})

describe("FileTree selection, activation and cancel", () => {
  it("calls onSelect on click and onActivate on Enter/Space", () => {
    const onSelect = vi.fn()
    const onActivate = vi.fn()
    render(<FileTree tree={sampleTree()} onSelect={onSelect} onActivate={onActivate} />)

    fireEvent.click(row("a"))
    expect(onSelect).toHaveBeenCalledWith("a")

    fireEvent.keyDown(row("a"), { key: "Enter" })
    fireEvent.keyDown(row("a"), { key: " " })
    expect(onActivate).toHaveBeenCalledTimes(2)
  })

  it("announces when no onMove handler is provided", () => {
    render(<FileTree tree={sampleTree()} />)
    row("readme").focus()
    fireEvent.keyDown(row("readme"), { key: "ArrowUp", altKey: true })
    expect(screen.getByRole("status")).toHaveTextContent("Moving is not available.")
  })

  it("Escape cancels a pending cut", () => {
    const onMove = vi.fn()
    render(<FileTree tree={sampleTree()} onMove={onMove} />)
    fireEvent.keyDown(row("readme"), { key: "x", ctrlKey: true })
    expect(screen.getByRole("status")).toHaveTextContent(/Cut "readme.md"/)
    fireEvent.keyDown(row("readme"), { key: "Escape" })
    expect(screen.getByRole("status")).toHaveTextContent("Move cancelled.")
    fireEvent.keyDown(row("docs"), { key: "v", ctrlKey: true })
    expect(onMove).not.toHaveBeenCalled()
    expect(screen.getByRole("status")).toHaveTextContent("Nothing to paste")
  })

  it("refuses to cut the root node", () => {
    render(<FileTree tree={sampleTree()} />)
    fireEvent.keyDown(row("root"), { key: "x", ctrlKey: true })
    expect(screen.getByRole("status")).toHaveTextContent("The root cannot be moved.")
  })
})
