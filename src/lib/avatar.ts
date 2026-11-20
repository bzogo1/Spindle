/**
 * Avatar (profile picture) validation and storage.
 *
 * Like `src/lib/profile.ts` and `src/lib/username.ts`, there is no
 * user-profile/avatar table or upload endpoint in the auth backend yet, so
 * uploaded avatars live in a process-local map keyed by the same session
 * principal (`user:<id>` for real sessions, `mock:<email>` for mock auth).
 * State is lost on restart; when a real profile API lands this module is the
 * single seam to replace.
 *
 * Storage format: the image bytes are kept as a base64 `data:` URL
 * (`data:image/png;base64,…`), which is what `GET /api/avatar` returns and
 * what `<img src>` can render directly without a separate blob endpoint.
 *
 * Validation is magic-byte based, never MIME/extension based: the declared
 * `Content-Type`/`file.type` is treated as an untrusted hint and the actual
 * bytes must sniff as PNG, JPEG, WebP, or GIF.
 *
 * This module is intentionally free of server-only imports so both the API
 * route and client components can share validation and types.
 */

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024

/** Raster formats we accept. SVG is deliberately excluded (scriptable). */
export const AVATAR_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const

export const AVATAR_ACCEPT = AVATAR_MIME_TYPES.join(",")

export type AvatarMime = (typeof AVATAR_MIME_TYPES)[number]

export type AvatarRecord = {
  /** `data:<mime>;base64,…` URL, safe to drop into `<img src>`. */
  dataUrl: string
  mime: AvatarMime
  /** ISO timestamp of the last upload. */
  updatedAt: string
}

const avatars = new Map<string, AvatarRecord>()

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false
  return signature.every((byte, index) => bytes[offset + index] === byte)
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = ""
  for (let index = 0; index < length; index += 1) {
    out += String.fromCharCode(bytes[offset + index] ?? 0)
  }
  return out
}

/**
 * Identifies the image format from magic bytes. Returns the canonical MIME
 * type or `null` when the bytes do not match a supported raster format.
 */
export function sniffAvatarMime(bytes: Uint8Array): AvatarMime | null {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png"
  // JPEG: FF D8 FF
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg"
  // GIF: full "GIF87a" / "GIF89a" signatures — a bare "GIF8" prefix would
  // also match GIF8<x> variants that are not real GIFs.
  const gifTag = ascii(bytes, 0, 6)
  if (gifTag === "GIF87a" || gifTag === "GIF89a") return "image/gif"
  // WebP: "RIFF" <size> "WEBP"
  if (ascii(bytes, 0, 4) === "RIFF" && bytes.length >= 12 && ascii(bytes, 8, 4) === "WEBP") {
    return "image/webp"
  }
  return null
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64")
  }
  let binary = ""
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

/**
 * Decodes a base64 payload (raw base64 or a full `data:` URL) into bytes.
 * Returns `null` on malformed input. Whitespace is tolerated.
 */
export function decodeAvatarBase64(input: string): Uint8Array | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const payload = trimmed.startsWith("data:")
    ? (trimmed.slice(trimmed.indexOf(",") + 1) ?? "")
    : trimmed
  const clean = payload.replace(/\s+/g, "")
  if (!clean || clean.length % 4 === 1) return null
  try {
    if (typeof Buffer !== "undefined") {
      const bytes = Buffer.from(clean, "base64")
      // Buffer is lenient; round-trip to catch junk that decodes to garbage.
      return bytes.length > 0 && bytesToBase64(bytes) === clean ? bytes : null
    }
    const binary = atob(clean)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return bytesToBase64(bytes) === clean ? bytes : null
  } catch {
    return null
  }
}

export type AvatarValidation =
  { ok: true; avatar: { dataUrl: string; mime: AvatarMime } } | { ok: false; error: string }

/**
 * Validates raw image bytes for upload: non-empty, within
 * {@link AVATAR_MAX_BYTES}, and sniffing as a supported raster format.
 * `declaredMime` (file.type / Content-Type) is accepted for API symmetry but
 * never trusted — magic bytes decide.
 */
export function parseAvatarUpload(input: {
  bytes: Uint8Array
  declaredMime?: string | null
}): AvatarValidation {
  const { bytes } = input
  if (!bytes || bytes.length === 0) {
    return { ok: false, error: "Choose an image file to upload." }
  }
  if (bytes.length > AVATAR_MAX_BYTES) {
    return {
      ok: false,
      error: `Avatar images must be ${Math.floor(AVATAR_MAX_BYTES / (1024 * 1024))} MB or smaller.`,
    }
  }
  const mime = sniffAvatarMime(bytes)
  if (!mime) {
    return {
      ok: false,
      error: "That file is not a supported image. Use PNG, JPG, WebP, or GIF.",
    }
  }
  return {
    ok: true,
    avatar: {
      mime,
      dataUrl: `data:${mime};base64,${bytesToBase64(bytes)}`,
    },
  }
}

/**
 * Extracts upload bytes from a parsed JSON request body. Accepts either
 * `{ dataUrl: "data:image/png;base64,…" }` or `{ data: "<base64>", mime? }`.
 * Returns the decoded bytes plus the declared MIME hint, or an error.
 */
export function avatarBytesFromJsonBody(
  body: unknown,
): { ok: true; bytes: Uint8Array; declaredMime: string | null } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Request body must be a JSON object." }
  }
  const record = body as { dataUrl?: unknown; data?: unknown; mime?: unknown }
  const raw = typeof record.dataUrl === "string" ? record.dataUrl : record.data
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, error: "Provide the image as `dataUrl` or base64 `data`." }
  }
  const bytes = decodeAvatarBase64(raw)
  if (!bytes) {
    return { ok: false, error: "The image payload is not valid base64." }
  }
  let declaredMime: string | null = null
  if (typeof record.dataUrl === "string" && raw.startsWith("data:")) {
    const header = raw.slice("data:".length, raw.indexOf(",") === -1 ? undefined : raw.indexOf(","))
    declaredMime = header.split(";")[0] || null
  } else if (typeof record.mime === "string") {
    declaredMime = record.mime
  }
  return { ok: true, bytes, declaredMime }
}

export function getAvatar(principal: string): AvatarRecord | null {
  return avatars.get(principal) ?? null
}

export function setAvatar(
  principal: string,
  avatar: { dataUrl: string; mime: AvatarMime },
): AvatarRecord {
  const record: AvatarRecord = { ...avatar, updatedAt: new Date().toISOString() }
  avatars.set(principal, record)
  return record
}

export function removeAvatar(principal: string): boolean {
  return avatars.delete(principal)
}

/** Test hook: clears every stored avatar. */
export function resetAvatarsForTests(): void {
  avatars.clear()
}
