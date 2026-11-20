import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { appScreenCopy, type AppScreenKey } from "./copy"
import {
  Skeleton,
  SkeletonListItem,
  SkeletonPage,
  SkeletonStatCard,
  SkeletonTable,
  SkeletonText,
  ScreenSkeleton,
} from "./skeleton"

const screens = Object.keys(appScreenCopy) as AppScreenKey[]

describe("ScreenSkeleton", () => {
  it.each(screens)("renders the %s layout skeleton", (screen) => {
    const { container } = render(<ScreenSkeleton variant={screen} />)

    const wrapper = container.querySelector('[data-slot="screen-skeleton"]')
    expect(wrapper).toHaveAttribute("data-variant", screen)
    expect(wrapper).toHaveAttribute("aria-hidden", "true")
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
  })
})

describe("skeleton primitives", () => {
  it("renders one block per requested text line and hides it from assistive tech", () => {
    const { container } = render(<SkeletonText lines={4} />)

    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(4)
    expect(container.querySelector('[data-slot="skeleton"]')).toHaveAttribute("aria-hidden", "true")
  })

  it("renders table rows sized to the requested columns", () => {
    const { container } = render(<SkeletonTable rows={3} columns={2} />)

    // header plus one block per row/cell pair
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(2 + 3 * 2)
  })

  it("renders stat card and list item building blocks", () => {
    const { container } = render(
      <>
        <SkeletonStatCard />
        <SkeletonListItem />
      </>,
    )

    // 3 stat blocks + avatar + 2 list text lines
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(6)
  })

  it("renders a simple page skeleton with a header and card", () => {
    const { container } = render(<SkeletonPage />)

    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(3)
  })

  it("can render without the pulse animation", () => {
    const { container } = render(<Skeleton animated={false} />)

    expect(container.firstElementChild).not.toHaveClass("animate-pulse")
  })
})
