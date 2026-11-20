/**
 * Snapshot provider registry.
 *
 * `mock` is the dev implementation: it renders a deterministic PNG derived
 * from the capture request seed, so the whole diff/baseline pipeline can be
 * exercised without a browser or backend. It is NOT a real renderer — see the
 * `SnapshotProvider` contract in `./types` for what a production provider
 * (Playwright sidecar, screenshot service) must do.
 */

import { PNG } from "pngjs"

import type {
  SnapshotCaptureRequest,
  SnapshotCaptureResult,
  SnapshotImage,
  SnapshotProvider,
} from "./types"

/** Tiny deterministic PRNG (mulberry32) so mock captures are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seedFromString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export interface MockSnapshotOptions {
  width?: number
  height?: number
  /**
   * Deterministic "change" knob for exercising the diff pipeline: a number of
   * pixels to perturb. Comes from `request.config.mockPerturb` if present.
   */
  perturbPixels?: number
}

/**
 * Dev provider: draws a deterministic gradient + seeded shapes. Same
 * `runId`/`config` always yields identical bytes.
 */
export class MockSnapshotProvider implements SnapshotProvider {
  readonly name = "mock"
  private readonly width: number
  private readonly height: number

  constructor(options: MockSnapshotOptions = {}) {
    this.width = options.width ?? 96
    this.height = options.height ?? 64
  }

  async capture(request: SnapshotCaptureRequest): Promise<SnapshotCaptureResult> {
    const seed = seedFromString(
      JSON.stringify({
        runId: request.runId,
        toolId: request.toolId ?? null,
        params: request.params ?? {},
        config: request.config ?? {},
      }),
    )
    const rand = mulberry32(seed)
    const perturb = typeof request.config?.mockPerturb === "number" ? request.config.mockPerturb : 0

    const png = new PNG({ width: this.width, height: this.height })
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const i = (y * this.width + x) * 4
        // Deterministic gradient tinted by the seed.
        png.data[i] = (x * 3 + (seed % 61)) % 256
        png.data[i + 1] = (y * 4 + ((seed >> 8) % 61)) % 256
        png.data[i + 2] = ((x + y) * 2 + ((seed >> 16) % 61)) % 256
        png.data[i + 3] = 255
      }
    }
    // A few seeded rectangles so diffs are visually obvious.
    for (let s = 0; s < 4; s++) {
      const w = 6 + Math.floor(rand() * 14)
      const h = 4 + Math.floor(rand() * 10)
      const x = Math.floor(rand() * (this.width - w))
      const y = Math.floor(rand() * (this.height - h))
      for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) {
          const i = (yy * this.width + xx) * 4
          png.data[i] = 30
          png.data[i + 1] = 120
          png.data[i + 2] = 200
        }
      }
    }
    // Deterministic perturbation for diff testing.
    for (let p = 0; p < perturb; p++) {
      const i = Math.floor(rand() * this.width * this.height) * 4
      png.data[i] = 255
      png.data[i + 1] = 0
      png.data[i + 2] = 255
    }

    const image: SnapshotImage = {
      name:
        request.config?.imageName && typeof request.config.imageName === "string"
          ? request.config.imageName
          : "main",
      png: new Uint8Array(PNG.sync.write(png)),
      width: this.width,
      height: this.height,
    }
    return { images: [image], meta: { provider: this.name, seed } }
  }
}

const providers = new Map<string, () => SnapshotProvider>([
  ["mock", () => new MockSnapshotProvider()],
])

/**
 * Resolve a provider by name. Callers that want an environment-driven default
 * (the CLI reads `LAB_SNAPSHOT_PROVIDER`) should pass it as `name` — this
 * module deliberately does not read environment variables itself. Register
 * additional providers here (or via `registerSnapshotProvider`) once a real
 * renderer exists.
 */
export function getSnapshotProvider(name?: string): SnapshotProvider {
  const key = name ?? "mock"
  const factory = providers.get(key)
  if (!factory) {
    throw new Error(
      `Unknown snapshot provider "${key}". Available: ${[...providers.keys()].join(", ")}`,
    )
  }
  return factory()
}

export function registerSnapshotProvider(name: string, factory: () => SnapshotProvider): void {
  providers.set(name, factory)
}
