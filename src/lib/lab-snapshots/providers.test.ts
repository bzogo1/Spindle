import { describe, expect, it } from "vitest"

import { getSnapshotProvider, MockSnapshotProvider, registerSnapshotProvider } from "./providers"
import type { SnapshotProvider } from "./types"

class StubProvider implements SnapshotProvider {
  constructor(readonly name = "stub") {}
  async capture() {
    return { images: [] }
  }
}

describe("getSnapshotProvider", () => {
  it("returns the mock provider by default", () => {
    const provider = getSnapshotProvider()
    expect(provider).toBeInstanceOf(MockSnapshotProvider)
    expect(provider.name).toBe("mock")
  })

  it("resolves a provider by explicit name", () => {
    expect(getSnapshotProvider("mock").name).toBe("mock")
  })

  it("resolves whatever provider name the caller supplies", () => {
    // Entry points resolve LAB_SNAPSHOT_PROVIDER themselves and pass the
    // value here; the library never reads env vars directly.
    registerSnapshotProvider("env-stub", () => new StubProvider("env-stub"))
    expect(getSnapshotProvider("env-stub").name).toBe("env-stub")
    // An explicit name still wins over any caller-supplied default.
    expect(getSnapshotProvider("mock").name).toBe("mock")
  })

  it("throws for unknown providers and lists the available ones", () => {
    expect(() => getSnapshotProvider("does-not-exist")).toThrow(
      /Unknown snapshot provider "does-not-exist"/,
    )
    try {
      getSnapshotProvider("does-not-exist")
      expect.unreachable()
    } catch (error) {
      expect(String(error)).toContain("mock")
    }
  })
})

describe("registerSnapshotProvider", () => {
  it("makes a custom provider resolvable by name", () => {
    const provider = new StubProvider()
    registerSnapshotProvider("registered-stub", () => provider)
    expect(getSnapshotProvider("registered-stub")).toBe(provider)
  })
})

describe("MockSnapshotProvider", () => {
  it("produces deterministic PNG output for identical requests", async () => {
    const provider = new MockSnapshotProvider()
    const request = { runId: "run-1", params: { a: 1 } }
    const first = await provider.capture(request)
    const second = await provider.capture(request)

    expect(first.images).toHaveLength(1)
    expect(first.images[0].png).toEqual(second.images[0].png)
    expect(first.meta?.provider).toBe("mock")
    expect(first.meta?.seed).toBe(second.meta?.seed)
  })

  it("uses config.imageName and config.mockPerturb", async () => {
    const provider = new MockSnapshotProvider()
    const result = await provider.capture({
      runId: "run-2",
      config: { imageName: "cell-3", mockPerturb: 4 },
    })
    expect(result.images[0].name).toBe("cell-3")
    expect(result.images[0].width).toBe(96)
    expect(result.images[0].height).toBe(64)
  })
})
