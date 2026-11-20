import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  baselinePath,
  canonicalize,
  computeBaselineKey,
  hasBaseline,
  readBaseline,
  runArtifactPath,
  snapshotRoot,
  writeBaseline,
  writeRunArtifact,
} from "./baseline"
import { compareSnapshots } from "./diff"
import { MockSnapshotProvider } from "./providers"
import type { SnapshotCaptureRequest } from "./types"

describe("canonicalize", () => {
  it("sorts object keys recursively and drops undefined", () => {
    expect(canonicalize({ b: 1, a: { d: 2, c: 3 }, skip: undefined })).toBe(
      canonicalize({ a: { c: 3, d: 2 }, b: 1 }),
    )
  })
})

describe("computeBaselineKey", () => {
  it("is deterministic and insensitive to key order", () => {
    const a = computeBaselineKey({ name: "main", config: { x: 1, y: 2 } })
    const b = computeBaselineKey({ name: "main", config: { y: 2, x: 1 } })
    expect(a).toBe(b)
    expect(a).toMatch(/^main-[0-9a-f]{16}$/)
  })

  it("changes when name, config, viewport, or theme changes", () => {
    const base = computeBaselineKey({ name: "main", config: { x: 1 } })
    expect(computeBaselineKey({ name: "other", config: { x: 1 } })).not.toBe(base)
    expect(computeBaselineKey({ name: "main", config: { x: 2 } })).not.toBe(base)
    expect(
      computeBaselineKey({ name: "main", config: { x: 1 }, viewport: { width: 800, height: 600 } }),
    ).not.toBe(base)
    expect(computeBaselineKey({ name: "main", config: { x: 1 }, theme: "dark" })).not.toBe(base)
  })
})

describe("baseline storage", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "lab-snap-"))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it("writes, checks, and reads baselines under the snapshot root", async () => {
    expect(snapshotRoot(dir)).toBe(dir)
    const key = computeBaselineKey({ name: "main", config: {} })
    expect(await hasBaseline(key, dir)).toBe(false)

    const png = new Uint8Array([137, 80, 78, 71])
    const path = await writeBaseline(key, png, dir)
    expect(path).toBe(baselinePath(key, dir))
    expect(await hasBaseline(key, dir)).toBe(true)
    expect(await readBaseline(key, dir)).toEqual(png)
  })

  it("stores run artifacts under runs/<runId>/", async () => {
    const path = await writeRunArtifact("run-1", "main", "diff", new Uint8Array([1, 2, 3]), dir)
    expect(path).toBe(runArtifactPath("run-1", "main", "diff", dir))
    expect(await readFile(path)).toEqual(Buffer.from([1, 2, 3]))
  })
})

describe("MockSnapshotProvider", () => {
  const request = (overrides: Partial<SnapshotCaptureRequest> = {}): SnapshotCaptureRequest => ({
    runId: "run-1",
    toolId: "tide-analysis",
    params: { window: 30 },
    config: { viewport: { width: 800, height: 600 } },
    ...overrides,
  })

  it("produces identical PNGs for identical requests", async () => {
    const provider = new MockSnapshotProvider()
    const [a, b] = await Promise.all([provider.capture(request()), provider.capture(request())])
    expect(a.images[0].png).toEqual(b.images[0].png)
    const result = compareSnapshots(a.images[0].png, b.images[0].png)
    expect(result.pass).toBe(true)
  })

  it("changes output when config changes (new baseline key)", async () => {
    const provider = new MockSnapshotProvider()
    const a = await provider.capture(request())
    const b = await provider.capture(request({ params: { window: 60 } }))
    const keyA = computeBaselineKey({
      name: "main",
      config: { params: { window: 30 }, viewport: { width: 800, height: 600 } },
    })
    const keyB = computeBaselineKey({
      name: "main",
      config: { params: { window: 60 }, viewport: { width: 800, height: 600 } },
    })
    expect(keyA).not.toBe(keyB)
    // Different params change the seed, so images differ.
    const result = compareSnapshots(a.images[0].png, b.images[0].png)
    expect(result.diffPixels).toBeGreaterThan(0)
  })
})
