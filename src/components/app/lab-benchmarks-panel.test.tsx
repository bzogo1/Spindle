import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { LabSnapshot } from "./lab-mock"
import { LAB_BENCHMARK_RUNS_PER_SNAPSHOT } from "./lab-mock"
import { LabBenchmarkPanel } from "./lab-benchmarks-panel"

const snapshots: LabSnapshot[] = [
  {
    id: "snap-01",
    name: "Pre-analysis baseline",
    environment: "RStudio",
    description: "First capture.",
    sizeBytes: 48 * 1024 * 1024,
    createdAt: "2026-11-18T16:40:00.000Z",
  },
  {
    id: "snap-02",
    name: "Clean survey inputs",
    environment: "JupyterLab",
    description: "Second capture.",
    sizeBytes: 132 * 1024 * 1024,
    createdAt: "2026-11-17T09:05:00.000Z",
  },
]

describe("LabBenchmarkPanel", () => {
  it("renders the benchmark history for every snapshot", () => {
    render(<LabBenchmarkPanel snapshots={snapshots} />)

    expect(screen.getByRole("heading", { name: "Performance benchmarks" })).toBeInTheDocument()
    expect(
      screen.getByText(`${snapshots.length * LAB_BENCHMARK_RUNS_PER_SNAPSHOT} benchmark runs`),
    ).toBeInTheDocument()
    // Each snapshot contributes its seeded run count.
    expect(screen.getAllByText(/— run \d$/).length).toBe(
      snapshots.length * LAB_BENCHMARK_RUNS_PER_SNAPSHOT,
    )
    expect(screen.getAllByText(/render .* · capture .* · total /).length).toBeGreaterThan(0)
  })

  it("compares the two newest runs by default", () => {
    render(<LabBenchmarkPanel snapshots={snapshots} />)

    expect(screen.getByText(/vs .*: (faster|slower|even)/)).toBeInTheDocument()
    expect(screen.getByText("Total")).toBeInTheDocument()
    expect(screen.getByText("Render")).toBeInTheDocument()
    expect(screen.getByText("Capture")).toBeInTheDocument()
  })

  it("shows the empty state without snapshots", () => {
    render(<LabBenchmarkPanel snapshots={[]} />)

    expect(screen.getByText("No benchmark data")).toBeInTheDocument()
    expect(screen.queryByLabelText("Reference benchmark run")).not.toBeInTheDocument()
  })

  it("hides the comparison hint once two distinct runs are picked", async () => {
    render(<LabBenchmarkPanel snapshots={snapshots} />)

    // Default selection already compares two runs, so the hint is absent.
    expect(
      screen.queryByText("Pick two different runs to compare their timings."),
    ).not.toBeInTheDocument()

    // Selecting the same run for both sides restores the hint.
    const options = screen.getAllByRole("combobox")
    expect(options.length).toBeGreaterThanOrEqual(2)
    fireEvent.click(options[0])
    const listbox = await screen.findByRole("listbox")
    const firstOption = within(listbox).getAllByRole("option")[0]
    fireEvent.click(firstOption)
    fireEvent.click(options[1])
    const secondListbox = await screen.findByRole("listbox")
    fireEvent.click(within(secondListbox).getAllByRole("option")[0])

    expect(
      screen.getByText("Pick two different runs to compare their timings."),
    ).toBeInTheDocument()
  })
})
