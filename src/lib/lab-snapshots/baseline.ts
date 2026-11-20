/**
 * Baseline storage for lab run snapshots.
 *
 * Layout under the snapshot root (default `.lab-snapshots/`, gitignored;
 * the CLI entry point resolves `LAB_SNAPSHOT_DIR` and passes it as `dir`):
 *
 *   <root>/baselines/<key>.png            approved baseline per config hash
 *   <root>/runs/<runId>/<name>-actual.png latest actual capture
 *   <root>/runs/<runId>/<name>-diff.png   last diff visualization
 *   <root>/runs/<runId>/<name>-baseline.png copy of baseline used
 *
 * Baselines are keyed by a hash of the run *config* (tool, params, viewport,
 * theme, masks), not the run id — re-running the same config should match the
 * same baseline, while any config change intentionally gets a new key.
 */

import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

export const DEFAULT_SNAPSHOT_DIR = ".lab-snapshots"

export function snapshotRoot(dir?: string): string {
  return dir ?? DEFAULT_SNAPSHOT_DIR
}

/** Deterministic JSON stringify with sorted object keys. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`)
  return `{${entries.join(",")}}`
}

export interface BaselineKeyInput {
  /** Stable snapshot name, e.g. tool id or "main". */
  name: string
  /** Run config that affects the rendered output. */
  config?: Record<string, unknown>
  /** Viewport, when relevant. */
  viewport?: { width: number; height: number }
  theme?: string
}

/**
 * Compute the baseline storage key: `<name>-<sha256[:16]>` of the canonical
 * config. Same name + same config ⇒ same key; any config change ⇒ new key.
 */
export function computeBaselineKey(input: BaselineKeyInput): string {
  const hash = createHash("sha256")
    .update(
      canonicalize({
        name: input.name,
        config: input.config ?? {},
        viewport: input.viewport ?? null,
        theme: input.theme ?? null,
      }),
    )
    .digest("hex")
    .slice(0, 16)
  return `${input.name}-${hash}`
}

export function baselinePath(key: string, dir?: string): string {
  return join(snapshotRoot(dir), "baselines", `${key}.png`)
}

export function runArtifactPath(
  runId: string,
  name: string,
  kind: "actual" | "diff" | "baseline",
  dir?: string,
): string {
  return join(snapshotRoot(dir), "runs", runId, `${name}-${kind}.png`)
}

async function writePng(path: string, data: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, Buffer.from(data))
}

/** Returns true when a baseline exists for `key`. */
export async function hasBaseline(key: string, dir?: string): Promise<boolean> {
  try {
    await readFile(baselinePath(key, dir))
    return true
  } catch {
    return false
  }
}

export async function readBaseline(key: string, dir?: string): Promise<Uint8Array> {
  const data = await readFile(baselinePath(key, dir))
  return new Uint8Array(data)
}

/** Approve `png` as the baseline for `key` (used by `--update` flows). */
export async function writeBaseline(key: string, png: Uint8Array, dir?: string): Promise<string> {
  const path = baselinePath(key, dir)
  await writePng(path, png)
  return path
}

export async function writeRunArtifact(
  runId: string,
  name: string,
  kind: "actual" | "diff" | "baseline",
  png: Uint8Array,
  dir?: string,
): Promise<string> {
  const path = runArtifactPath(runId, name, kind, dir)
  await writePng(path, png)
  return path
}
