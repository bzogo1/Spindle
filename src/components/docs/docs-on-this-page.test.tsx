import { act, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { DocHeading } from "@/lib/docs"

import { DocsOnThisPage } from "./docs-on-this-page"

const headings: DocHeading[] = [
  { id: "intro", title: "Introduction" },
  { id: "install", title: "Installation" },
  { id: "usage", title: "Usage" },
]

type ObserverEntry = { isIntersecting: boolean; target: Element }
type ObserverCallback = (entries: ObserverEntry[]) => void

let observerCallback: ObserverCallback | null

function flushFrames() {
  return act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
}

/** Renders heading elements the scroll-spy can observe, plus the nav. */
function renderPage(hash = "") {
  window.history.replaceState(null, "", `/docs/guide${hash}`)
  return render(
    <>
      <article>
        {headings.map((heading) => (
          <h2 key={heading.id} id={heading.id} data-doc-heading>
            {heading.title}
          </h2>
        ))}
      </article>
      <DocsOnThisPage headings={headings} />
    </>,
  )
}

function link(id: string) {
  return screen.getByRole("link", { name: headings.find((h) => h.id === id)!.title })
}

beforeEach(() => {
  observerCallback = null
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: ObserverCallback) {
        observerCallback = callback
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    return setTimeout(() => callback(0), 0) as unknown as number
  })
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("DocsOnThisPage", () => {
  it("renders one anchor per heading plus a back-to-top link", () => {
    render(<DocsOnThisPage headings={headings} />)

    for (const heading of headings) {
      expect(screen.getByRole("link", { name: heading.title })).toHaveAttribute(
        "href",
        `#${heading.id}`,
      )
    }
    expect(screen.getByRole("link", { name: "Back to top" })).toHaveAttribute("href", "#top")
  })

  it("keeps the first heading active when no headings are in the document", async () => {
    window.history.replaceState(null, "", "/docs/guide")
    render(<DocsOnThisPage headings={headings} />)
    await flushFrames()

    expect(link("intro")).toHaveAttribute("aria-current", "location")
    expect(link("install")).not.toHaveAttribute("aria-current")
  })

  it("moves aria-current to the heading reported as intersecting", async () => {
    renderPage()
    await flushFrames()

    const install = document.getElementById("install")!
    act(() => {
      observerCallback?.([{ isIntersecting: true, target: install }])
    })
    await flushFrames()

    expect(link("install")).toHaveAttribute("aria-current", "location")
    expect(link("intro")).not.toHaveAttribute("aria-current")
  })

  it("follows the location hash on hashchange for a known heading", async () => {
    renderPage()
    await flushFrames()

    act(() => {
      window.history.replaceState(null, "", "/docs/guide#usage")
      window.dispatchEvent(new Event("hashchange"))
    })

    expect(link("usage")).toHaveAttribute("aria-current", "location")
    expect(link("intro")).not.toHaveAttribute("aria-current")
  })
})
