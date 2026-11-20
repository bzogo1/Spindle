import { getAuthBackend } from "@/lib/auth/backend"
import type { WorkspaceMemberInfo } from "@/lib/auth/backend"
import {
  authenticateScimRequest,
  scimError,
  scimJson,
  scimRateLimited,
} from "@/app/api/scim/shared"
import {
  buildListResponse,
  parseScimFilter,
  parseScimUser,
  SCIM_BASE_PATH,
  userToScim,
} from "@/lib/scim"
import { getWorkspaceSettings } from "@/lib/workspace-settings"
import { recordWorkspaceEvent } from "@/lib/workspace-audit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** RFC 7644 `count` cap; also the declared maxResults in ServiceProviderConfig. */
const MAX_PAGE_SIZE = 200
const DEFAULT_PAGE_SIZE = 100

function parsePositiveInt(raw: string | null, fallback: number, max: number): number {
  const value = raw === null ? NaN : Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value < 1) return fallback
  return Math.min(value, max)
}

function matchesUserName(member: WorkspaceMemberInfo, userName: string): boolean {
  return member.user.email.toLowerCase() === userName.toLowerCase()
}

/**
 * GET /api/scim/v2/Users — list workspace members as SCIM User resources.
 *
 * Auth: `Authorization: Bearer <scim-token>` (see shared.ts). Supports the
 * documented filter subset `userName eq "x"` plus `startIndex`/`count`
 * pagination (1-based startIndex per RFC 7644). Unsupported filters return
 * 400 rather than silently ignoring the filter.
 */
export async function GET(request: Request) {
  const limited = scimRateLimited(request)
  if (limited) return limited

  const auth = authenticateScimRequest(request)
  if (!auth.ok) return auth.response

  const backend = getAuthBackend()
  const members = await backend.listWorkspaceMembers(auth.workspaceId)

  const url = new URL(request.url)
  const filter = parseScimFilter(url.searchParams.get("filter"))
  if (filter.kind === "unsupported") {
    return scimError(400, 'Unsupported filter. Only `userName eq "value"` is supported.')
  }

  const filtered =
    filter.kind === "userName"
      ? members.filter((member) => matchesUserName(member, filter.value))
      : members

  const startIndex = parsePositiveInt(
    url.searchParams.get("startIndex"),
    1,
    Number.MAX_SAFE_INTEGER,
  )
  const count = parsePositiveInt(url.searchParams.get("count"), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
  const page = filtered.slice(startIndex - 1, startIndex - 1 + count)

  return scimJson(
    buildListResponse(
      page.map((member) => userToScim(member, SCIM_BASE_PATH)),
      {
        startIndex,
        totalResults: filtered.length,
      },
    ),
  )
}

/**
 * POST /api/scim/v2/Users — provision a user into the token's workspace.
 *
 * Finds or creates the user by email via `upsertOAuthUser` (provider
 * `"scim"`), then adds them to the workspace at the configured
 * `defaultJoinRole`. Emits `scim.user_provisioned` to the workspace audit
 * log. Returns 409 when the user already belongs to the workspace.
 */
export async function POST(request: Request) {
  const limited = scimRateLimited(request)
  if (limited) return limited

  const auth = authenticateScimRequest(request)
  if (!auth.ok) return auth.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return scimError(400, "Request body must be valid JSON.")
  }
  const parsed = parseScimUser(body)
  if (!parsed.ok) {
    return scimError(400, parsed.detail)
  }

  const backend = getAuthBackend()
  const workspace = await backend.getWorkspace(auth.workspaceId)
  if (!workspace) {
    return scimError(404, "Workspace not found.")
  }

  // SCIM uniqueness: one User resource per workspace. The account itself is
  // global (keyed by email), but membership is what this endpoint manages.
  const existing = await backend.getUserByEmail(parsed.data.email)
  if (existing) {
    const members = await backend.listWorkspaceMembers(auth.workspaceId)
    if (members.some((member) => member.user.id === existing.id)) {
      return scimError(409, "User is already provisioned in this workspace.")
    }
  }

  const { user } = await backend.upsertOAuthUser({
    email: parsed.data.email,
    name: parsed.data.displayName,
    provider: "scim",
  })

  const role = getWorkspaceSettings(auth.workspaceId).defaultJoinRole
  await backend.addWorkspaceMember({
    userId: user.id,
    workspace,
    role,
  })

  recordWorkspaceEvent({
    workspaceId: auth.workspaceId,
    type: "scim.user_provisioned",
    actorId: null, // SCIM calls are machine actors; the token id is the credential
    details: {
      userId: user.id,
      userName: parsed.data.userName,
      email: parsed.data.email,
      role,
      scimTokenId: auth.tokenId,
    },
  })

  const member: WorkspaceMemberInfo = { user, role }
  return scimJson(userToScim(member, SCIM_BASE_PATH), 201)
}
