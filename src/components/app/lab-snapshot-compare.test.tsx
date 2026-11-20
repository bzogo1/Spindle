import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { LabSnapshot } from "./lab-mock"
import { SnapshotComparePanel } from "./lab-snapshot-compare"

const base: LabSnapshot = {
  id: "snap-01",
  name: "Pre-analysis baseline",
  environment: "RStudio",
  description: "Workspace state before the November tide analysis pass.",
  sizeBytes: 48 * 1024 * 1024,
  createdAt: "2026-11-18T16:40:00.000Z",
}

const other: LabSnapshot = {
  id: "snap-02",
  name: "Clean survey inputs",
  environment: "JupyterLab",
  description: "Validated survey exports ready for the cleaning notebook.",
  sizeBytes: 132 * 1024 * 1024,
  createdAt: "2026-11-17T09:05:00.000Z",
}

function renderPanel(props?: Partial<Parameters<typeof SnapshotComparePanel>[0]>) {
  return render(
    <SnapshotComparePanel
      base={base}
      other={other}
      onSwap={vi.fn()}
      onClose={vi.fn()}
      {...props}
    />,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

beforeEach(() => {
  // jsdom has no 2D canvas; the panel treats that as "diff unavailable".
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null)
})

describe("SnapshotComparePanel", () => {
  it("shows metadata for both snapshots side by side", () => {
    renderPanel()

    expect(screen.getByText("Snapshot comparison")).toBeInTheDocument()
    expect(screen.getByText("Environment")).toBeInTheDocument()
    expect(screen.getAllByText("RStudio").length).toBeGreaterThan(0)
    expect(screen.getAllByText("JupyterLab").length).toBeGreaterThan(0)
    // Size delta: other is 84 MB larger.
    expect(screen.getByText("84 MB larger")).toBeInTheDocument()
    // Created delta: other is ~1d 7h earlier.
    expect(screen.getByText(/earlier/)).toBeInTheDocument()
  })

  it("renders side-by-side previews with mock capture data URLs", () => {
    renderPanel()

    const images = screen.getAllByRole("img")
    expect(images).toHaveLength(2)
    for (const image of images) {
      expect(image.getAttribute("src")).toMatch(/^data:image\/svg\+xml/)
    }
    expect(screen.getByAltText("A: Pre-analysis baseline preview")).toBeInTheDocument()
    expect(screen.getByAltText("B: Clean survey inputs preview")).toBeInTheDocument()
  })

  it("switches to overlay view with an opacity slider", () => {
    renderPanel()

    fireEvent.click(screen.getByRole("button", { name: "Overlay" }))

    expect(screen.getByAltText("B: Clean survey inputs preview overlay")).toBeInTheDocument()
    expect(screen.getByRole("slider")).toBeInTheDocument()
  })

  it("falls back gracefully when canvas is unavailable", async () => {
    renderPanel()

    expect(await screen.findByText(/Pixel diff is unavailable in this browser/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Diff" }))
    expect(screen.getByText("Pixel diff is unavailable in this browser.")).toBeInTheDocument()
  })

  it("pins an annotation by clicking a preview", () => {
    renderPanel()

    fireEvent.click(screen.getByRole("button", { name: "Pin an annotation on the A preview" }))
    expect(screen.getByText(/Pinned to the A preview at/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText("Annotation note"), {
      target: { value: "Check the axis labels here" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Add annotation" }))

    expect(screen.getByText("Check the axis labels here")).toBeInTheDocument()
    expect(screen.getByText(/A preview · 0% · 0%/)).toBeInTheDocument()
    expect(screen.getByText("Annotations (1)")).toBeInTheDocument()
  })

  it("adds and removes a general note", () => {
    renderPanel()

    fireEvent.click(screen.getByRole("button", { name: "Add note" }))
    expect(screen.getByText("General note — not pinned to a preview.")).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText("Annotation note"), {
      target: { value: "Re-run after the baseline update" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Add annotation" }))

    expect(screen.getByText("Re-run after the baseline update")).toBeInTheDocument()
    expect(screen.getByText(/General note/)).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole("button", { name: "Remove annotation: Re-run after the baseline update" }),
    )
    expect(screen.queryByText("Re-run after the baseline update")).not.toBeInTheDocument()
    expect(screen.getByText("No annotations yet.")).toBeInTheDocument()
  })

  it("invokes swap and close callbacks", () => {
    const onSwap = vi.fn()
    const onClose = vi.fn()
    renderPanel({ onSwap, onClose })

    fireEvent.click(screen.getByRole("button", { name: "Swap" }))
    expect(onSwap).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole("button", { name: "Close comparison" }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
