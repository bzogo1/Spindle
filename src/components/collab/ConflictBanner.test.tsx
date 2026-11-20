import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { TextConflict } from "@/lib/collab/conflict"

import { ConflictBanner } from "./ConflictBanner"

const conflict = (overrides: Partial<TextConflict> = {}): TextConflict => ({
  id: "c1",
  kind: "concurrent-insert",
  start: 5,
  end: 10,
  localText: " mine",
  remoteText: " theirs",
  createdAt: 1,
  remoteIds: [{ client: "b", clock: 0 }],
  localIds: [{ client: "a", clock: 5 }],
  localDeletedText: "",
  ...overrides,
})

describe("ConflictBanner", () => {
  it("renders nothing when there are no conflicts", () => {
    const { container } = render(<ConflictBanner conflicts={[]} onResolve={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("shows both versions side by side", () => {
    render(<ConflictBanner conflicts={[conflict()]} onResolve={vi.fn()} />)
    expect(screen.getByText("Yours")).toBeInTheDocument()
    expect(screen.getByText("Theirs")).toBeInTheDocument()
    // Text is whitespace-normalised by the matcher.
    expect(screen.getByText("mine")).toBeInTheDocument()
    expect(screen.getByText("theirs")).toBeInTheDocument()
  })

  it("shows '(deleted)' placeholders for empty sides", () => {
    render(
      <ConflictBanner
        conflicts={[conflict({ kind: "overlapping-delete", remoteText: "", localText: "XY" })]}
        onResolve={vi.fn()}
      />,
    )
    expect(screen.getByText("(deleted)")).toBeInTheDocument()
  })

  it("routes each resolution choice to onResolve", () => {
    const onResolve = vi.fn()
    render(<ConflictBanner conflicts={[conflict()]} onResolve={onResolve} />)

    fireEvent.click(screen.getByRole("button", { name: "Keep mine" }))
    expect(onResolve).toHaveBeenCalledWith("c1", "local")

    fireEvent.click(screen.getByRole("button", { name: "Use theirs" }))
    expect(onResolve).toHaveBeenCalledWith("c1", "remote")

    fireEvent.click(screen.getByRole("button", { name: "Keep both" }))
    expect(onResolve).toHaveBeenCalledWith("c1", "merge")
  })

  it("renders one card per conflict", () => {
    render(
      <ConflictBanner
        conflicts={[
          conflict({ id: "c1" }),
          conflict({ id: "c2", localText: "x", remoteText: "y" }),
        ]}
        onResolve={vi.fn()}
      />,
    )
    expect(screen.getAllByRole("alert")).toHaveLength(2)
  })
})
