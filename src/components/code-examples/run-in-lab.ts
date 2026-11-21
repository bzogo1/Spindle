import type { CodeExample } from "./examples"

/**
 * Handoff contract between the public code-examples gallery and the in-app
 * Lab. The gallery encodes a snippet into the `?run=` query param on
 * `/app/lab`; the project lab picker forwards it to
 * `/projects/[projectId]/lab?run=…`, where `LabScreen` decodes it and offers
 * a one-click mock run.
 */

export const LAB_RUN_PARAM = "run"

export type LabCodeSnippet = {
  title: string
  language: string
  code: string
}

/** base64url keeps the payload URL-safe and ~33% smaller than encodeURIComponent(JSON). */
function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ""
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}

function fromBase64Url(encoded: string): string {
  const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/")
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new TextDecoder().decode(bytes)
}

export function encodeLabSnippet(snippet: LabCodeSnippet): string {
  return toBase64Url(JSON.stringify(snippet))
}

/** Returns `null` for missing, malformed, or oversized payloads. */
export function decodeLabSnippet(raw: string | null | undefined): LabCodeSnippet | null {
  if (!raw || raw.length > 32_768) return null
  try {
    const parsed: unknown = JSON.parse(fromBase64Url(raw))
    if (typeof parsed !== "object" || parsed === null) return null
    const { title, language, code } = parsed as Record<string, unknown>
    if (typeof title !== "string" || typeof language !== "string" || typeof code !== "string") {
      return null
    }
    if (!code.trim()) return null
    return { title, language, code }
  } catch {
    return null
  }
}

/**
 * `/app/lab?run=<payload>` — the app-side lab picker forwards `run` onto the
 * project lab route, so the snippet survives project selection.
 */
export function labRunHref(example: Pick<CodeExample, "title" | "language" | "code">): string {
  const payload = encodeLabSnippet({
    title: example.title,
    language: example.language,
    code: example.code,
  })
  return `/app/lab?${LAB_RUN_PARAM}=${payload}`
}
