import { fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { LAB_BROWSERS, LAB_SNAPSHOTS, labBrowserSnapshot } from "./lab-mock"
import { SnapshotBrowserMatrix } from "./lab-snapshot-browser-matrix"

const source = LAB_SNAPSHOTS[0]
const captures = LAB_BROWSERS.map((browser) => labBrowserSnapshot(source, browser))

function renderMatrix(overrides?: Partial<Parameters<typeof SnapshotBrowserMatrix>[0]>) {
  return render(
    <SnapshotBrowserMatrix
      source={source}
      captures={captures}
      onComparePair={vi.fn()}
      onClose={vi.fn()}
      {...overrides}
    />,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

beforeEach(() => {
  // jsdom has no 2D canvas; the matrix treats that as "diff unavailable".
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null)
})

describe("SnapshotBrowserMatrix", () => {
  it("lists one row per browser with the reference first", () => {
    renderMatrix()

    expect(screen.getByText("Cross-browser test")).toBeInTheDocument()
    const region = screen.getByRole("region", { name: "Cross-browser test matrix" })
    const rows = within(region).getAllByRole("listitem")
    expect(rows).toHaveLength(captures.length)
    expect(rows[0]).toHaveTextContent("Chromium")
    expect(rows[0]).toHaveTextContent("Reference")
    expect(rows[1]).toHaveTextContent("Firefox")
    expect(rows[2]).toHaveTextContent("WebKit")
  })

  it("renders a preview thumbnail per capture", () => {
    renderMatrix()

    const images = screen.getAllByRole("img")
    expect(images).toHaveLength(captures.length)
    for (const image of images) {
      expect(image.getAttribute("src")).toMatch(/^data:image\/svg\+xml/)
    }
  })

  it("degrades to 'diff unavailable' hints when canvas is missing", async () => {
    renderMatrix()

    expect(await screen.findAllByText(/Pixel diff is unavailable in this browser/)).toHaveLength(
      captures.length - 1,
    )
  })

  it("disables Compare on the reference row and fires onComparePair elsewhere", async () => {
    const onComparePair = vi.fn()
    renderMatrix({ onComparePair })

    const region = screen.getByRole("region", { name: "Cross-browser test matrix" })
    const rows = within(region).getAllByRole("listitem")
    expect(within(rows[0]).getByRole("button", { name: "Compare" })).toBeDisabled()

    fireEvent.click(within(rows[1]).getByRole("button", { name: "Compare" }))
    expect(onComparePair).toHaveBeenCalledWith(captures[0], captures[1])
  })

  it("invokes onClose", () => {
    const onClose = vi.fn()
    renderMatrix({ onClose })

    fireEvent.click(screen.getByRole("button", { name: "Close browser matrix" }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
