import { fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import {
  AVATAR_MAX_BYTES,
  avatarBytesFromJsonBody,
  getAvatar,
  parseAvatarUpload,
  removeAvatar,
  setAvatar,
  type AvatarRecord,
} from "@/lib/avatar"
import { createRateLimiter } from "@/lib/site-forms"
import { resolveProfileIdentity } from "../profile/route"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET/PUT/DELETE /api/avatar — the signed-in user's profile picture.
 *
 * Session resolution reuses `resolveProfileIdentity` from `/api/profile`
 * (`user:<id>` for real sessions, `mock:<email>` for mock auth). Avatars are
 * stored as base64 `data:` URLs in the process-local map in
 * `src/lib/avatar.ts` until a real profile API exists — see that module's
 * docstring.
 *
 * `PUT` accepts either `multipart/form-data` with an `avatar` (or `file`)
 * field, or a JSON body `{ "dataUrl": "data:image/png;base64,…" }` /
 * `{ "data": "<base64>", "mime": "image/png" }`. Validation is magic-byte
 * based (PNG/JPEG/WebP/GIF, ≤ 2 MB); the declared MIME is never trusted.
 * Uploads are rate limited per principal.
 */

// Uploads are heavier than a typical settings write; 20/min per principal is
// generous for real use while blunting scripted abuse. Per-instance state,
// same caveat as the other in-memory limiters.
const uploadLimiter = createRateLimiter({ limit: 20, windowMs: 60 * 1000 })

function avatarPayload(record: AvatarRecord | null) {
  return { avatar: record }
}

export async function GET(request: Request) {
  const identity = await resolveProfileIdentity(request)
  if (!identity) {
    return fail(401, "unauthenticated", "Sign in to view your avatar.")
  }
  return ok(avatarPayload(getAvatar(identity.principal)))
}

async function readUploadBytes(
  request: Request,
): Promise<
  | { ok: true; bytes: Uint8Array; declaredMime: string | null }
  | { ok: false; status: number; code: string; message: string }
> {
  const contentType = request.headers.get("content-type") ?? ""

  if (contentType.includes("multipart/form-data")) {
    let form: FormData
    try {
      form = await request.formData()
    } catch {
      return {
        ok: false,
        status: 400,
        code: "invalid_request",
        message: "Malformed multipart body.",
      }
    }
    const entry = form.get("avatar") ?? form.get("file")
    // Duck-type rather than `instanceof File`: runtimes (jsdom tests, edge
    // workers) may hand back a Blob/File from a different realm.
    const file =
      typeof entry === "object" && entry !== null && "arrayBuffer" in entry ? (entry as File) : null
    if (!file || file.size === 0) {
      return {
        ok: false,
        status: 400,
        code: "invalid_request",
        message: "Attach the image in the `avatar` field.",
      }
    }
    // Reject on the declared part size before buffering the whole body into
    // memory; `parseAvatarUpload` re-checks the actual bytes afterwards.
    if (file.size > AVATAR_MAX_BYTES) {
      return {
        ok: false,
        status: 413,
        code: "file_too_large",
        message: `Avatar images must be ${Math.floor(AVATAR_MAX_BYTES / (1024 * 1024))} MB or smaller.`,
      }
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    return { ok: true, bytes, declaredMime: file.type || null }
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return {
      ok: false,
      status: 400,
      code: "invalid_request",
      message: "Request body must be JSON or multipart/form-data.",
    }
  }
  const parsed = avatarBytesFromJsonBody(body)
  if (!parsed.ok) {
    return { ok: false, status: 400, code: "invalid_request", message: parsed.error }
  }
  return parsed
}

export async function PUT(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }

  const identity = await resolveProfileIdentity(request)
  if (!identity) {
    return fail(401, "unauthenticated", "Sign in to update your avatar.")
  }

  if (!uploadLimiter.check(identity.principal)) {
    return fail(429, "rate_limited", "Too many avatar uploads. Try again in a minute.")
  }

  const upload = await readUploadBytes(request)
  if (!upload.ok) {
    return fail(upload.status, upload.code, upload.message)
  }

  const parsed = parseAvatarUpload({
    bytes: upload.bytes,
    declaredMime: upload.declaredMime,
  })
  if (!parsed.ok) {
    return fail(422, "invalid_avatar", parsed.error)
  }

  return ok({ avatar: setAvatar(identity.principal, parsed.avatar) })
}

export async function DELETE(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }

  const identity = await resolveProfileIdentity(request)
  if (!identity) {
    return fail(401, "unauthenticated", "Sign in to update your avatar.")
  }

  removeAvatar(identity.principal)
  return ok(avatarPayload(null))
}
