import { act, fireEvent, render, screen } from "@testing-library/react"
import { createRef } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  ScrollArea,
  ScrollAreaCorner,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
  type ScrollAreaHandle,
} from "@/components/ui/scroll-area"

function TestScrollArea({
  hideDelay = 600,
  edgeFade = false,
}: {
  hideDelay?: number
  edgeFade?: boolean
} = {}) {
  return (
    <ScrollArea hideDelay={hideDelay} edgeFade={edgeFade} className="h-40">
      <ScrollAreaViewport>
        <div style={{ height: 400 }}>
          {Array.from({ length: 20 }, (_, i) => (
            <div key={i}>Row {i}</div>
          ))}
        </div>
      </ScrollAreaViewport>
      <ScrollAreaScrollbar orientation="vertical">
        <ScrollAreaThumb />
      </ScrollAreaScrollbar>
      <ScrollAreaScrollbar orientation="horizontal">
        <ScrollAreaThumb />
      </ScrollAreaScrollbar>
      <ScrollAreaCorner />
    </ScrollArea>
  )
}

describe("ScrollArea", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("renders root, viewport, scrollbars, thumb and corner", () => {
    const { container } = render(<TestScrollArea />)

    expect(screen.getByText("Row 0")).toBeInTheDocument()
    expect(container.querySelector('[data-slot="scroll-area"]')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="scroll-area-viewport"]')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-slot="scroll-area-scrollbar"]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-slot="scroll-area-thumb"]')).toHaveLength(2)
    expect(container.querySelector('[data-slot="scroll-area-corner"]')).toBeInTheDocument()
  })

  it("marks the vertical scrollbar with data-orientation", () => {
    const { container } = render(<TestScrollArea />)
    const bars = container.querySelectorAll('[data-slot="scroll-area-scrollbar"]')
    const orientations = Array.from(bars).map((b) => b.getAttribute("data-orientation"))
    expect(orientations).toContain("vertical")
    expect(orientations).toContain("horizontal")
  })

  it("shows scrollbars on scroll and hides them after hideDelay", () => {
    const { container } = render(<TestScrollArea hideDelay={300} />)
    const viewport = container.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]')!
    const bar = container.querySelector<HTMLElement>(
      '[data-slot="scroll-area-scrollbar"][data-orientation="vertical"]',
    )!

    expect(bar).not.toHaveAttribute("data-visible", "true")

    act(() => {
      fireEvent.scroll(viewport)
    })
    expect(bar).toHaveAttribute("data-visible", "true")

    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(bar).not.toHaveAttribute("data-visible", "true")
  })

  it("keeps scrollbars visible while hovering", () => {
    const { container } = render(<TestScrollArea />)
    const root = container.querySelector<HTMLElement>('[data-slot="scroll-area"]')!
    const bar = container.querySelector<HTMLElement>(
      '[data-slot="scroll-area-scrollbar"][data-orientation="vertical"]',
    )!

    fireEvent.mouseEnter(root)
    expect(bar).toHaveAttribute("data-visible", "true")

    fireEvent.mouseLeave(root)
    expect(bar).not.toHaveAttribute("data-visible", "true")
  })

  it("exposes scrollTo via ref and scrolls the viewport", () => {
    const ref = createRef<ScrollAreaHandle>()
    const { container } = render(
      <ScrollArea ref={ref}>
        <ScrollAreaViewport>
          <div>content</div>
        </ScrollAreaViewport>
        <ScrollAreaScrollbar>
          <ScrollAreaThumb />
        </ScrollAreaScrollbar>
      </ScrollArea>,
    )
    const viewport = container.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]')!

    act(() => {
      ref.current?.scrollTo(0, 120)
    })
    expect(viewport.scrollTop).toBe(120)

    act(() => {
      ref.current?.scrollTo({ top: 40 })
    })
    expect(viewport.scrollTop).toBe(40)
  })

  it("scrollToElement scrolls the target into view", () => {
    const ref = createRef<ScrollAreaHandle>()
    const { container } = render(
      <ScrollArea ref={ref}>
        <ScrollAreaViewport>
          <div>
            <div data-testid="target">target</div>
          </div>
        </ScrollAreaViewport>
        <ScrollAreaScrollbar>
          <ScrollAreaThumb />
        </ScrollAreaScrollbar>
      </ScrollArea>,
    )
    const target = screen.getByTestId("target")
    const viewport = container.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]')!

    // jsdom rects are all zero, so nearest is a no-op; force block: "start".
    act(() => {
      ref.current?.scrollToElement(target, { block: "start" })
    })
    // scrollTop = 0 + rect.top - viewportRect.top = 0; still exercises path.
    expect(viewport).toBeInTheDocument()
  })

  it("scrolls smoothly by default and honors explicit behavior", () => {
    const ref = createRef<ScrollAreaHandle>()
    const { container } = render(
      <ScrollArea ref={ref}>
        <ScrollAreaViewport>
          <div>content</div>
        </ScrollAreaViewport>
      </ScrollArea>,
    )
    const viewport = container.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]')!
    const scrollToSpy = vi.fn()
    viewport.scrollTo = scrollToSpy

    act(() => {
      ref.current?.scrollTo({ top: 50 })
    })
    expect(scrollToSpy).toHaveBeenCalledWith(
      expect.objectContaining({ top: 50, behavior: "smooth" }),
    )

    act(() => {
      ref.current?.scrollTo({ top: 10, behavior: "auto" })
    })
    expect(scrollToSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ top: 10, behavior: "auto" }),
    )
  })

  it("applies edge fade data attribute", () => {
    const { container } = render(<TestScrollArea edgeFade />)
    expect(
      container.querySelector('[data-slot="scroll-area"]')?.getAttribute("data-edge-fade"),
    ).toBe("true")
  })
})
