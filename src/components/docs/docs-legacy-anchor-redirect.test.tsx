import { render } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { DocsLegacyAnchorRedirect } from "./docs-legacy-anchor-redirect"

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}))

const anchors: Record<string, string> = {
  quickstart: "/docs/intro#quickstart",
  "quick start": "/docs/intro#quick-start",
  "%E0%A4%A": "/docs/raw-hash",
}

function setHash(hash: string) {
  window.history.replaceState(null, "", `/docs${hash}`)
}

beforeEach(() => {
  replace.mockClear()
  setHash("")
})

describe("DocsLegacyAnchorRedirect", () => {
  it("replaces the route when the hash matches a known anchor", () => {
    setHash("#quickstart")
    render(<DocsLegacyAnchorRedirect anchors={anchors} />)

    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith("/docs/intro#quickstart")
  })

  it("decodes percent-encoded hashes before looking them up", () => {
    setHash("#quick%20start")
    render(<DocsLegacyAnchorRedirect anchors={anchors} />)

    expect(replace).toHaveBeenCalledWith("/docs/intro#quick-start")
  })

  it("falls back to the raw hash when percent-decoding fails", () => {
    setHash("#%E0%A4%A")
    render(<DocsLegacyAnchorRedirect anchors={anchors} />)

    expect(replace).toHaveBeenCalledWith("/docs/raw-hash")
  })

  it("does nothing for an unknown anchor", () => {
    setHash("#does-not-exist")
    render(<DocsLegacyAnchorRedirect anchors={anchors} />)

    expect(replace).not.toHaveBeenCalled()
  })

  it("does nothing when the URL has no hash", () => {
    render(<DocsLegacyAnchorRedirect anchors={anchors} />)

    expect(replace).not.toHaveBeenCalled()
  })
})
