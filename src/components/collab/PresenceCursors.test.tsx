import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { AwarenessState } from "@/lib/collab/awareness"

import { PresenceCursors, type PresenceCursorEntry } from "./PresenceCursors"

const state = (overrides: Partial<AwarenessState> = {}): AwarenessState => ({
  user: { id: "u1", name: "Alice", color: "#ff0000" },
  updatedAt: 1,
  ...overrides,
})

const entry = (clientId: string, s: AwarenessState): PresenceCursorEntry => ({
  clientId,
  state: s,
})

describe("PresenceCursors", () => {
  it("renders nothing when there are no entries", () => {
    const { container } = render(
      <PresenceCursors entries={[]} toPosition={() => ({ x: 0, y: 0 })} />,
    )
    expect(container.firstChild).toBeEmptyDOMElement()
    expect(screen.queryByText("Alice")).not.toBeInTheDocument()
  })

  it("renders a caret and name label for entries with a cursor", () => {
    const toPosition = vi.fn(() => ({ x: 12, y: 24 }))
    render(
      <PresenceCursors
        entries={[entry("c1", state({ cursor: 5 }))]}
        toPosition={toPosition}
        lineHeight={20}
      />,
    )

    expect(screen.getByText("Alice")).toBeInTheDocument()
    expect(toPosition).toHaveBeenCalledWith(5)

    // Caret bar: 2px wide, positioned at the mapped point.
    const caret = document.querySelector(".w-\\[2px\\]") as HTMLElement
    expect(caret).not.toBeNull()
    expect(caret.style.left).toBe("12px")
    expect(caret.style.top).toBe("24px")
    expect(caret.style.height).toBe("20px")
    expect(caret.style.backgroundColor).toBeTruthy()
  })

  it("renders a selection highlight for ranged selections", () => {
    const toPosition = vi.fn((index: number) => ({ x: index * 10, y: index * 20 }))
    render(
      <PresenceCursors
        entries={[entry("c1", state({ selection: { anchor: 2, head: 5 } }))]}
        toPosition={toPosition}
        lineHeight={20}
      />,
    )

    // Both endpoints are queried (min/max order).
    expect(toPosition).toHaveBeenCalledWith(2)
    expect(toPosition).toHaveBeenCalledWith(5)
    // Selection rect: left = min x = 20, width spans |50-20| = 30.
    const rect = document.querySelector(".opacity-25") as HTMLElement
    expect(rect).not.toBeNull()
    expect(rect.style.left).toBe("20px")
    expect(rect.style.width).toBe("30px")
    // No caret -> no name label.
    expect(screen.queryByText("Alice")).not.toBeInTheDocument()
  })

  it("collapses reversed selections via min/max", () => {
    const toPosition = vi.fn((index: number) => ({ x: index, y: 0 }))
    render(
      <PresenceCursors
        entries={[entry("c1", state({ selection: { anchor: 9, head: 3 } }))]}
        toPosition={toPosition}
      />,
    )
    expect(toPosition).toHaveBeenCalledWith(3)
    expect(toPosition).toHaveBeenCalledWith(9)
  })

  it("skips entries with neither cursor nor selection", () => {
    const { container } = render(
      <PresenceCursors
        entries={[entry("c1", state({ cursor: null, selection: null }))]}
        toPosition={() => ({ x: 0, y: 0 })}
      />,
    )
    // Overlay wrapper exists but has no rendered children.
    expect(container.firstChild).toBeEmptyDOMElement()
  })

  it("renders multiple peers independently", () => {
    render(
      <PresenceCursors
        entries={[
          entry("c1", state({ cursor: 1 })),
          entry(
            "c2",
            state({
              user: { id: "u2", name: "Bob", color: "#00ff00" },
              cursor: 7,
              updatedAt: 2,
            }),
          ),
        ]}
        toPosition={() => ({ x: 0, y: 0 })}
      />,
    )
    expect(screen.getByText("Alice")).toBeInTheDocument()
    expect(screen.getByText("Bob")).toBeInTheDocument()
  })
})
