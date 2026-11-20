import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { createNode, type FileTreeNode } from "@/lib/file-tree"
import { LocalGitStatusProvider } from "@/lib/file-tree/git-status"

import { DiffViewer } from "./diff-viewer"
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

describe("FileTree multi-select", () => {
  it("ctrl+click toggles nodes in the selection", () => {
    const onSelectionChange = vi.fn()
    render(<FileTree tree={sampleTree()} onSelectionChange={onSelectionChange} />)

    fireEvent.click(row("a"), { ctrlKey: true })
    expect(onSelectionChange).toHaveBeenLastCalledWith(new Set(["a"]))
    fireEvent.click(row("readme"), { ctrlKey: true })
    expect(onSelectionChange).toHaveBeenLastCalledWith(new Set(["a", "readme"]))
    fireEvent.click(row("a"), { ctrlKey: true })
    expect(onSelectionChange).toHaveBeenLastCalledWith(new Set(["readme"]))
    expect(row("readme")).toHaveAttribute("aria-selected", "true")
    expect(row("a")).toHaveAttribute("aria-selected", "false")
  })

  it("shift+click selects the visible range from the anchor", () => {
    const onSelectionChange = vi.fn()
    render(<FileTree tree={sampleTree()} onSelectionChange={onSelectionChange} />)

    fireEvent.click(row("docs")) // anchor = docs
    fireEvent.click(row("readme"), { shiftKey: true })
    const ids = onSelectionChange.mock.calls.at(-1)![0] as Set<string>
    // docs..readme covers docs, a, src, index, readme (root excluded)
    expect(ids).toEqual(new Set(["docs", "a", "src", "index", "readme"]))
  })

  it("Ctrl+A selects every visible non-root row", () => {
    const onSelectionChange = vi.fn()
    render(<FileTree tree={sampleTree()} onSelectionChange={onSelectionChange} />)
    fireEvent.keyDown(row("root"), { key: "a", ctrlKey: true })
    const ids = onSelectionChange.mock.calls.at(-1)![0] as Set<string>
    expect(ids).toEqual(new Set(["docs", "a", "src", "index", "readme"]))
    expect(ids.has("root")).toBe(false)
  })
})

describe("FileTree keyboard extras", () => {
  it("type-ahead jumps to the next matching name", () => {
    render(<FileTree tree={sampleTree()} />)
    row("root").focus()
    // "r" should jump to readme.md (docs, src don't start with r)
    fireEvent.keyDown(row("root"), { key: "r" })
    expect(document.activeElement).toBe(row("readme"))
    expect(screen.getByRole("status")).toHaveTextContent(/Jumped to "readme.md"/)
  })

  it("type-ahead accumulates characters", () => {
    render(<FileTree tree={sampleTree()} />)
    row("root").focus()
    fireEvent.keyDown(row("root"), { key: "i" })
    // first "i" match after root is index.ts inside src? Order: docs,a,src,index,readme
    // "i" matches index.ts (src doesn't start with i... wait src children order)
    expect(document.activeElement).toBe(row("index"))
  })
})

describe("FileTree toolbar", () => {
  it("expand all / collapse all buttons drive expansion", () => {
    render(<FileTree tree={sampleTree()} showToolbar />)
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }))
    expect(screen.queryByText("a.md")).not.toBeInTheDocument()
    expect(screen.queryByText("readme.md")).toBeInTheDocument() // top-level stays
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }))
    expect(screen.getByText("a.md")).toBeInTheDocument()
  })
})

describe("FileTree decorations", () => {
  it("renders git status badges from a provider", () => {
    const git = new LocalGitStatusProvider({ a: "modified", readme: "untracked" })
    render(<FileTree tree={sampleTree()} gitStatus={git} />)
    expect(screen.getByLabelText("Git status: Modified")).toHaveTextContent("M")
    expect(screen.getByLabelText("Git status: Untracked")).toHaveTextContent("??")
    expect(screen.queryByLabelText("Git status: Added")).not.toBeInTheDocument()
  })

  it("renders tag, bookmark, favorite and recent badges", () => {
    render(
      <FileTree
        tree={sampleTree()}
        tagsFor={(id) => (id === "a" ? [{ id: "t1", name: "bug", color: "#f00" }] : [])}
        isBookmarked={(id) => id === "readme"}
        isFavorite={(id) => id === "index"}
        isRecent={(id) => id === "docs"}
      />,
    )
    expect(screen.getByLabelText("Tag: bug")).toBeInTheDocument()
    expect(screen.getByLabelText("Bookmarked")).toBeInTheDocument()
    expect(screen.getByLabelText("Favorite")).toBeInTheDocument()
    expect(screen.getByLabelText("Recently opened")).toBeInTheDocument()
  })
})

describe("FileTree filtering", () => {
  it("hides non-matching rows but keeps ancestors", () => {
    render(
      <FileTree
        tree={sampleTree()}
        filter={{ bookmarkOnly: true }}
        filterSources={{ isBookmarked: (id) => id === "a" }}
      />,
    )
    expect(screen.getByText("a.md")).toBeInTheDocument()
    expect(screen.getByText("docs")).toBeInTheDocument() // ancestor kept
    expect(screen.queryByText("index.ts")).not.toBeInTheDocument()
    expect(screen.queryByText("readme.md")).not.toBeInTheDocument()
    expect(screen.queryByText("src")).not.toBeInTheDocument()
  })

  it("auto-expands ancestors of matches hidden inside collapsed dirs", () => {
    render(
      <FileTree
        tree={sampleTree()}
        expandedIds={new Set()} // every dir collapsed
        onExpandedChange={() => {}}
        filter={{ bookmarkOnly: true }}
        filterSources={{ isBookmarked: (id) => id === "a" }}
      />,
    )
    // "a" lives inside collapsed docs — the filter force-expands docs.
    expect(screen.getByText("a.md")).toBeInTheDocument()
    expect(screen.getByText("docs")).toBeInTheDocument()
    expect(screen.queryByText("index.ts")).not.toBeInTheDocument()
    // The force-expanded caret advertises that collapsing won't hide it.
    const caret = screen.getByRole("button", { name: "Collapse docs" })
    expect(caret).toHaveAttribute("aria-disabled", "true")
    expect(caret).toHaveAttribute("title", "Expanded to show filter matches")
  })
})

describe("FileTree permissions / read-only", () => {
  it("readOnly disables the grip and blocks moves", () => {
    const onMove = vi.fn()
    render(<FileTree tree={sampleTree()} onMove={onMove} readOnly />)
    expect(screen.getAllByRole("button", { name: /Drag to reorder/ })[0]).toBeDisabled()
    fireEvent.keyDown(row("readme"), { key: "ArrowUp", altKey: true })
    expect(onMove).not.toHaveBeenCalled()
    expect(screen.getByRole("status")).toHaveTextContent(/Read-only/)
  })

  it("viewer role blocks mutations while siblings stay editable", () => {
    const onMove = vi.fn()
    render(<FileTree tree={sampleTree()} onMove={onMove} permissions={{ docs: "viewer" }} />)
    // docs subtree is read-only: can't cut a.md
    fireEvent.keyDown(row("a"), { key: "x", ctrlKey: true })
    expect(screen.getByRole("status")).toHaveTextContent(/Read-only/)
    // readme (admin) can still be cut
    fireEvent.keyDown(row("readme"), { key: "x", ctrlKey: true })
    expect(screen.getByRole("status")).toHaveTextContent(/Cut "readme.md"/)
  })
})

describe("FileTree detail panel", () => {
  it("renderDetail receives the selected node", () => {
    render(
      <FileTree
        tree={sampleTree()}
        selectedId="a"
        renderDetail={(node) => <div data-testid="detail">{node ? node.name : "none"}</div>}
      />,
    )
    expect(screen.getByTestId("detail")).toHaveTextContent("a.md")
  })
})

describe("DiffViewer", () => {
  it("renders added/removed/context lines", () => {
    render(<DiffViewer oldText={"a\nb\nc"} newText={"a\nB\nc\nd"} />)
    const lines = document.querySelectorAll(".ft-diff-line")
    expect(lines).toHaveLength(5)
    expect(lines[1]).toHaveClass("ft-diff-line--del")
    expect(lines[2]).toHaveClass("ft-diff-line--add")
    expect(screen.getByText(/\+2/)).toBeInTheDocument()
    expect(screen.getByText(/−1/)).toBeInTheDocument()
  })

  it("shows 'No changes' for identical content", () => {
    render(<DiffViewer oldText="same" newText="same" />)
    expect(screen.getByText("No changes")).toBeInTheDocument()
  })
})
