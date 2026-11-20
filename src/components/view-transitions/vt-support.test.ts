import { describe, expect, it } from "vitest"

import {
  canUseViewTransitions,
  viewTransitionName,
  NAV_BACK,
  NAV_FORWARD,
  type ViewTransitionEnvironment,
} from "./vt-support"

const supported: ViewTransitionEnvironment = {
  startViewTransition: () => ({}),
  supportsViewTransitionName: true,
}

describe("canUseViewTransitions", () => {
  it("returns true only when both APIs are present", () => {
    expect(canUseViewTransitions(supported)).toBe(true)
  })

  it("returns false without document.startViewTransition", () => {
    expect(canUseViewTransitions({ ...supported, startViewTransition: undefined })).toBe(false)
    expect(canUseViewTransitions({ supportsViewTransitionName: true })).toBe(false)
  })

  it("returns false when view-transition-name CSS is unsupported", () => {
    expect(canUseViewTransitions({ ...supported, supportsViewTransitionName: false })).toBe(false)
    expect(canUseViewTransitions({ startViewTransition: () => ({}) })).toBe(false)
  })

  it("returns false for an empty environment (SSR / jsdom)", () => {
    expect(canUseViewTransitions({})).toBe(false)
  })
})

describe("viewTransitionName", () => {
  it("prefixes the scope and id", () => {
    expect(viewTransitionName("project", "abc123")).toBe("spindle-project-abc123")
  })

  it("produces identical names for identical inputs (cross-page pairing)", () => {
    expect(viewTransitionName("project", "p1")).toBe(viewTransitionName("project", "p1"))
  })

  it("scopes names so different entity types never collide", () => {
    expect(viewTransitionName("project", "x")).not.toBe(viewTransitionName("file", "x"))
  })

  it("sanitizes characters that are invalid in a custom-ident", () => {
    expect(viewTransitionName("project", "a/b:c d")).toBe("spindle-project-a-b-c-d")
  })
})

describe("transition type constants", () => {
  it("exposes the directional types PageTransition understands", () => {
    expect(NAV_FORWARD).toBe("nav-forward")
    expect(NAV_BACK).toBe("nav-back")
  })
})
