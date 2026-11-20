import { z } from "zod"

import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { getAuthBackend } from "@/lib/auth/backend"
import { accessTokenFromRequest, fail, isSameOriginRequest, ok } from "@/lib/auth/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const readLimiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)
const writeLimiter = createAuthRateLimiter(AUTH_LIMITS.tokenConsume)

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(80, "Name is too long."),
})

/**
 * GET /api/workspaces — every workspace the caller belongs to, with their
 * role and whether it is the session's active workspace. Backs the
 * workspace switcher and the "create workspace" entry points.
 */
export async function GET(request: Request) {
  if (!readLimiter.check(clientIp(request))) return authRateLimited()

  const access = accessTokenFromRequest(request)
  if (!access) return fail(401, "unauthorized", "Sign in required.")

  const backend = getAuthBackend()
  const user = await backend.getUserById(access.uid)
  if (!user) return fail(401, "unauthorized", "Sign in required.")

  const [memberships, session] = await Promise.all([
    backend.listWorkspaceMemberships(user.id),
    backend.getSessionContext(user.id),
  ])
  const activeId = session?.workspace?.id ?? null

  return ok({
    workspaces: memberships.map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      slug: m.workspace.slug,
      role: m.role,
      active: m.workspace.id === activeId,
    })),
  })
}

/**
 * POST /api/workspaces — create an additional workspace owned by the caller.
 * The creator becomes `owner` and the new workspace becomes the session's
 * active workspace (see `createWorkspace` in the auth backend).
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request rejected.")
  }
  if (!writeLimiter.check(clientIp(request))) return authRateLimited()

  const access = accessTokenFromRequest(request)
  if (!access) return fail(401, "unauthorized", "Sign in required.")

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_input", "Invalid request body.")
  }
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return fail(400, "invalid_input", parsed.error.issues[0]?.message ?? "Invalid input.")
  }

  const backend = getAuthBackend()
  const user = await backend.getUserById(access.uid)
  if (!user) return fail(401, "unauthorized", "Sign in required.")

  try {
    const membership = await backend.createWorkspace({
      userId: user.id,
      name: parsed.data.name,
    })
    return ok({
      workspace: {
        id: membership.workspace.id,
        name: membership.workspace.name,
        slug: membership.workspace.slug,
        role: membership.role,
        active: true,
      },
    })
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "invalid_input") {
      return fail(400, "invalid_input", error.message)
    }
    throw error
  }
}
