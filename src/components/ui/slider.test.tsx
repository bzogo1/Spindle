import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { Slider } from "./slider"

function getThumbs(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-slot="slider-thumb"]'))
}

describe("Slider", () => {
  it("renders a single slider with ARIA attributes", () => {
    render(<Slider defaultValue={40} min={0} max={100} />)

    const slider = screen.getByRole("slider")
    expect(slider).toHaveAttribute("aria-valuemin", "0")
    expect(slider).toHaveAttribute("aria-valuemax", "100")
    expect(slider).toHaveAttribute("aria-valuenow", "40")
    expect(slider).toHaveAttribute("aria-orientation", "horizontal")
  })

  it("changes value with arrow keys and reports a number in single mode", () => {
    const onValueChange = vi.fn()
    const { container } = render(
      <Slider defaultValue={50} min={0} max={100} step={5} onValueChange={onValueChange} />,
    )

    const thumb = getThumbs(container)[0]
    thumb.focus()
    fireEvent.keyDown(thumb, { key: "ArrowRight" })
    expect(onValueChange).toHaveBeenLastCalledWith(55)

    fireEvent.keyDown(thumb, { key: "ArrowLeft" })
    expect(onValueChange).toHaveBeenLastCalledWith(50)
  })

  it("supports PageUp/PageDown and Home/End", () => {
    const onValueChange = vi.fn()
    const { container } = render(
      <Slider defaultValue={50} min={0} max={100} step={1} onValueChange={onValueChange} />,
    )

    const thumb = getThumbs(container)[0]
    fireEvent.keyDown(thumb, { key: "PageUp" })
    expect(onValueChange).toHaveBeenLastCalledWith(60)

    fireEvent.keyDown(thumb, { key: "PageDown" })
    expect(onValueChange).toHaveBeenLastCalledWith(50)

    fireEvent.keyDown(thumb, { key: "Home" })
    expect(onValueChange).toHaveBeenLastCalledWith(0)

    fireEvent.keyDown(thumb, { key: "End" })
    expect(onValueChange).toHaveBeenLastCalledWith(100)
  })

  it("renders two thumbs for a range and reports number[]", () => {
    const onValueChange = vi.fn()
    const { container } = render(
      <Slider defaultValue={[20, 80]} min={0} max={100} onValueChange={onValueChange} />,
    )

    const thumbs = getThumbs(container)
    expect(thumbs).toHaveLength(2)
    expect(thumbs[0]).toHaveAttribute("aria-valuenow", "20")
    expect(thumbs[1]).toHaveAttribute("aria-valuenow", "80")

    fireEvent.keyDown(thumbs[0], { key: "ArrowRight" })
    expect(onValueChange).toHaveBeenLastCalledWith([21, 80])
  })

  it("supports controlled values", () => {
    const onValueChange = vi.fn()
    const { container, rerender } = render(
      <Slider value={30} min={0} max={100} onValueChange={onValueChange} />,
    )

    expect(getThumbs(container)[0]).toHaveAttribute("aria-valuenow", "30")

    fireEvent.keyDown(getThumbs(container)[0], { key: "ArrowRight" })
    expect(onValueChange).toHaveBeenCalledWith(31)
    // Controlled: value stays until the parent updates it.
    expect(getThumbs(container)[0]).toHaveAttribute("aria-valuenow", "30")

    rerender(<Slider value={70} min={0} max={100} />)
    expect(getThumbs(container)[0]).toHaveAttribute("aria-valuenow", "70")
  })

  it("marks thumbs as disabled and ignores interaction", () => {
    const onValueChange = vi.fn()
    const { container } = render(
      <Slider defaultValue={50} min={0} max={100} disabled onValueChange={onValueChange} />,
    )

    const thumb = getThumbs(container)[0]
    expect(thumb).toHaveAttribute("data-disabled")
    fireEvent.keyDown(thumb, { key: "ArrowRight" })
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it("renders vertical orientation and marks", () => {
    const { container } = render(
      <Slider defaultValue={50} min={0} max={100} orientation="vertical" marks={[0, 50, 100]} />,
    )

    const slider = screen.getByRole("slider")
    expect(slider).toHaveAttribute("aria-orientation", "vertical")
    expect(container.querySelector('[data-slot="slider-marks"]')).not.toBeNull()
  })

  it("renders mark labels and tick positions", () => {
    const { container } = render(
      <Slider
        defaultValue={50}
        min={0}
        max={100}
        marks={[
          { value: 0, label: "Low" },
          { value: 100, label: "High" },
        ]}
      />,
    )

    expect(screen.getByText("Low")).toBeInTheDocument()
    expect(screen.getByText("High")).toBeInTheDocument()
    const marks = container.querySelector('[data-slot="slider-marks"]')!
    // One wrapper span per mark, each holding a tick and optional label.
    expect(marks.children).toHaveLength(2)
    expect(marks.querySelectorAll(".bg-border")).toHaveLength(2)
  })

  it("positions marks with logical properties so RTL works", () => {
    const { container } = render(
      <Slider dir="rtl" defaultValue={50} min={0} max={100} marks={[0, 100]} />,
    )

    const mark = container.querySelector('[data-slot="slider-marks"] > span')!
    // insetInlineStart resolves to the right edge under dir="rtl".
    expect(mark.getAttribute("style")).toContain("inset-inline-start")
  })

  it("supports dir=rtl for keyboard stepping direction", () => {
    const onValueChange = vi.fn()
    const { container } = render(
      <Slider
        dir="rtl"
        defaultValue={50}
        min={0}
        max={100}
        step={1}
        onValueChange={onValueChange}
      />,
    )

    const thumb = getThumbs(container)[0]
    // In RTL, ArrowLeft increases the value (mirrored from LTR).
    fireEvent.keyDown(thumb, { key: "ArrowLeft" })
    expect(onValueChange).toHaveBeenLastCalledWith(51)
  })

  it("shows a tooltip with the value while dragging", () => {
    const { container } = render(<Slider defaultValue={50} min={0} max={100} showTooltip />)

    const thumb = getThumbs(container)[0]
    fireEvent.pointerDown(thumb)
    fireEvent.pointerUp(thumb)

    // jsdom has no layout, so Radix cannot compute a drag position; the
    // tooltip content is asserted via focus instead.
    fireEvent.focus(thumb)
    expect(screen.getAllByText("50").length).toBeGreaterThan(0)
  })
})
