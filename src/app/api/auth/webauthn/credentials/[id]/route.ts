import type { NextResponse } from "next/server"

import { getAuthBackend, type AuthUser } from "@/lib/auth/backend"
import { accessTokenFromRequest, fail, isSameOriginRequest, ok } from "@/lib/auth/http"
import { isRecord, toCredentialView } from "@/lib/webauthn/types"
import { getCredentialStore } from "@/lib/webauthn/credential-store"
import { createRateLimiter, clientIp } from "@/lib/site-forms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const limiter = createRateLimiter({ limit: 30, windowMs: 60 * 1000 })

type Params = { params: Promise<{ id: string }> }

async function authenticate(
  request: Request,
): Promise<{ error: NextResponse } | { user: AuthUser }> {
  if (!limiter.check(clientIp(request))) {
    return { error: fail(429, "rate_limited", "Too many requests. Try again later.") }
  }
  const access = accessTokenFromRequest(request)
  if (!access) return { error: fail(401, "unauthenticated", "Sign in required.") }
  const user = await getAuthBackend().getUserById(access.uid)
  if (!user) return { error: fail(401, "unauthenticated", "Sign in required.") }
  return { user }
}

/**
 * PATCH /api/auth/webauthn/credentials/[id] — renames one of the caller's
 * security keys. Body: `{ label: string }`. Scoped by userId server-side:
 * a credential id belonging to another account is indistinguishable from a
 * missing one (404, no enumeration).
 */
export async function PATCH(request: Request, { params }: Params) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Invalid request body.")
  }
  if (!isRecord(body) || typeof body.label !== "string") {
    return fail(400, "invalid_request", "A label string is required.")
  }

  const auth = await authenticate(request)
  if ("error" in auth) return auth.error

  const { id } = await params
  const updated = getCredentialStore().rename(auth.user.id, id, body.label)
  if (!updated) {
    return fail(404, "not_found", "Security key not found.")
  }
  return ok({ credential: toCredentialView(updated) })
}

/**
 * DELETE /api/auth/webauthn/credentials/[id] — revokes one of the caller's
 * security keys. Revocation takes effect immediately: the credential can no
 * longer produce a verifiable assertion. Scoped by userId server-side (404
 * for foreign/missing ids — no enumeration).
 */
export async function DELETE(request: Request, { params }: Params) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }

  const auth = await authenticate(request)
  if ("error" in auth) return auth.error

  const { id } = await params
  const revoked = getCredentialStore().revoke(auth.user.id, id)
  if (!revoked) {
    return fail(404, "not_found", "Security key not found.")
  }
  return ok({ revoked: true })
}
