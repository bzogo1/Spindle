import { act, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { AwarenessState } from "@/lib/collab/awareness"

import { PresenceBar } from "./PresenceBar"

const state = (name: string, updatedAt = Date.now()): AwarenessState => ({
  user: { id: `u-${name}`, name, color: "#123456" },
  cursor: 0,
  updatedAt,
})

const entries = (...pairs: [string, AwarenessState][]) =>
  pairs.map(([clientId, s]) => ({ clientId, state: s }))

describe("PresenceBar", () => {
  it("renders nothing without entries", () => {
    const { container } = render(<PresenceBar entries={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("renders a chip per collaborator with names and self marker", () => {
    render(
      <PresenceBar
        selfId="me"
        entries={entries(["me", state("me")], ["u1", state("Alice")], ["u2", state("Bob")])}
      />,
    )
    expect(screen.getByText("me (you)")).toBeInTheDocument()
    expect(screen.getByText("Alice")).toBeInTheDocument()
    expect(screen.getByText("Bob")).toBeInTheDocument()
  })

  it("marks stale peers as idle and explicit statuses", () => {
    const now = Date.now()
    render(
      <PresenceBar
        idleAfterMs={1000}
        entries={entries(
          ["fresh", state("Fresh", now)],
          ["stale", state("Stale", now - 60_000)],
          ["away", { ...state("Gone", now), status: "away" as const }],
        )}
      />,
    )
    expect(screen.getByText("Fresh")).toBeInTheDocument()
    expect(screen.getByText("· idle")).toBeInTheDocument()
    expect(screen.getByText("· away")).toBeInTheDocument()
    // The idle/away chips carry data-status for styling/tests.
    expect(document.querySelector('[data-status="idle"]')).not.toBeNull()
    expect(document.querySelector('[data-status="away"]')).not.toBeNull()
    expect(document.querySelector('[data-status="online"]')).not.toBeNull()
  })

  it("shows a join toast when a peer appears and a leave toast when they go", () => {
    const { rerender } = render(
      <PresenceBar entries={entries(["me", state("me")], ["u1", state("Alice")])} />,
    )
    expect(screen.queryByTestId("presence-toast")).not.toBeInTheDocument()

    act(() => {
      rerender(
        <PresenceBar
          toastDurationMs={60_000}
          entries={entries(["me", state("me")], ["u1", state("Alice")], ["u2", state("Bob")])}
        />,
      )
    })
    expect(screen.getByText("Bob joined")).toBeInTheDocument()

    act(() => {
      rerender(
        <PresenceBar
          toastDurationMs={60_000}
          entries={entries(["me", state("me")], ["u2", state("Bob")])}
        />,
      )
    })
    expect(screen.getByText("Alice left")).toBeInTheDocument()
    // Bob's chip remains.
    expect(screen.getByText("Bob")).toBeInTheDocument()
  })

  it("expires toasts after toastDurationMs", async () => {
    const { rerender } = render(<PresenceBar entries={entries(["me", state("me")])} />)
    act(() => {
      rerender(
        <PresenceBar
          toastDurationMs={10}
          entries={entries(["me", state("me")], ["u1", state("Alice")])}
        />,
      )
    })
    expect(screen.getByText("Alice joined")).toBeInTheDocument()
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(screen.queryByText("Alice joined")).not.toBeInTheDocument()
    // The roster chip stays — only the toast expired.
    expect(screen.getByText("Alice")).toBeInTheDocument()
  })
})
