import { act, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it } from "vitest"

import { PaneBoundary } from "./pane-boundary"

/** Suspends forever so the boundary stays on its fallback. */
function NeverResolves(): ReactNode {
  throw new Promise(() => {})
}

interface SuspenseGate {
  promise: Promise<void>
  isResolved: () => boolean
}

/** Suspends until the gate resolves, then renders the pane content. */
function SuspendsUntil({ gate, children }: { gate: SuspenseGate; children: ReactNode }) {
  if (!gate.isResolved()) throw gate.promise
  return <>{children}</>
}

function createSuspenseGate() {
  let resolved = false
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = () => {
      resolved = true
      resolve()
    }
  })
  return { promise, release, isResolved: () => resolved }
}

describe("PaneBoundary", () => {
  it("renders children inside the suspense boundary", () => {
    render(
      <PaneBoundary screen="files">
        <p>File list</p>
      </PaneBoundary>,
    )

    expect(screen.getByText("File list")).toBeInTheDocument()
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })

  it("shows the screen-matched loading fallback while the pane suspends", () => {
    render(
      <PaneBoundary screen="agent">
        <NeverResolves />
      </PaneBoundary>,
    )

    const status = screen.getByRole("status")
    expect(status).toHaveTextContent("Loading agent runs")
    expect(status.querySelector('[data-variant="agent"]')).toBeInTheDocument()
  })

  it("swaps the fallback for content once the pane resolves", async () => {
    const gate = createSuspenseGate()

    const { container } = render(
      <PaneBoundary screen="lab">
        <SuspendsUntil gate={gate}>
          <p>Session pane</p>
        </SuspendsUntil>
      </PaneBoundary>,
    )

    expect(screen.getByRole("status")).toHaveTextContent("Loading lab sessions")

    await act(async () => {
      gate.release()
      await gate.promise
    })

    expect(container.querySelector('[data-variant="lab"]')).not.toBeInTheDocument()
    expect(screen.getByText("Session pane")).toBeInTheDocument()
  })
})
