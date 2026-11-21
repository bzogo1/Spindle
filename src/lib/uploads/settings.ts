/**
 * User-facing upload settings (quality, format, destination).
 *
 * These are presentation-level preferences consumed by the upload provider
 * and surfaced in the upload-settings dropdown. Real transports can read
 * them via {@link UploadsContextValue.settings} (e.g. to pick a transcoding
 * pipeline or prefix object keys with the destination); the mock transport
 * ignores them.
 *
 * Persisted to localStorage so choices survive reloads.
 */

export type UploadQuality = "original" | "high" | "medium" | "low"
export type UploadFormat = "original" | "webp" | "jpg" | "png"
export type UploadDestination = "workspace" | "project-files" | "archive"

export interface UploadSettings {
  quality: UploadQuality
  format: UploadFormat
  destination: UploadDestination
}

export const DEFAULT_UPLOAD_SETTINGS: UploadSettings = {
  quality: "original",
  format: "original",
  destination: "workspace",
}

export const UPLOAD_QUALITY_OPTIONS: { value: UploadQuality; label: string; hint: string }[] = [
  { value: "original", label: "Original", hint: "Keep the source file as-is" },
  { value: "high", label: "High", hint: "Light recompression" },
  { value: "medium", label: "Medium", hint: "Balanced size and quality" },
  { value: "low", label: "Low", hint: "Smallest size, visible loss" },
]

export const UPLOAD_FORMAT_OPTIONS: { value: UploadFormat; label: string }[] = [
  { value: "original", label: "Original format" },
  { value: "webp", label: "WebP" },
  { value: "jpg", label: "JPEG" },
  { value: "png", label: "PNG" },
]

export const UPLOAD_DESTINATION_OPTIONS: { value: UploadDestination; label: string; hint: string }[] = [
  { value: "workspace", label: "Workspace files", hint: "Default file library" },
  { value: "project-files", label: "Project files", hint: "Attach to the active project" },
  { value: "archive", label: "Archive", hint: "Cold storage, not indexed" },
]

const SETTINGS_KEY = "spindle:upload-settings:v1"

function isQuality(value: unknown): value is UploadQuality {
  return UPLOAD_QUALITY_OPTIONS.some((o) => o.value === value)
}
function isFormat(value: unknown): value is UploadFormat {
  return UPLOAD_FORMAT_OPTIONS.some((o) => o.value === value)
}
function isDestination(value: unknown): value is UploadDestination {
  return UPLOAD_DESTINATION_OPTIONS.some((o) => o.value === value)
}

/** Load persisted settings, falling back to defaults for missing/invalid values. */
export function loadUploadSettings(): UploadSettings {
  try {
    const raw = globalThis.localStorage?.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_UPLOAD_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<UploadSettings>
    return {
      quality: isQuality(parsed.quality) ? parsed.quality : DEFAULT_UPLOAD_SETTINGS.quality,
      format: isFormat(parsed.format) ? parsed.format : DEFAULT_UPLOAD_SETTINGS.format,
      destination: isDestination(parsed.destination)
        ? parsed.destination
        : DEFAULT_UPLOAD_SETTINGS.destination,
    }
  } catch {
    return { ...DEFAULT_UPLOAD_SETTINGS }
  }
}

export function saveUploadSettings(settings: UploadSettings): void {
  try {
    globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Persistence is best-effort (private mode / quota).
  }
}
