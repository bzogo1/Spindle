import { z } from "zod"

import {
  getAuthBackend,
  type TokenPair,
  type WorkspaceInfo,
  type WorkspaceMembership,
} from "@/lib/auth/backend"
import {
  ACCESS_COOKIE,
  applyAuthCookies,
  fail,
  isSameOriginRequest,
  ok,
  readCookie,
} from "@/lib/auth/http"
import {
  decodeMockSession,
  encodeMockSession,
  MOCK_SESSION_COOKIE,
  MOCK_SESSION_MAX_AGE_SECONDS,
  mockAuthEnabled,
  type MockSessionData,
} from "@/lib/auth/mock-session"
import {
  invitationStore,
  resolveInvitationByToken,
  type InvitationRecord,
  type ResolvedInvitation,
} from "@/lib/invitations"
import {
  AUTH_LIMITS,
  authRateLimited,
  clientIp,
  createAuthRateLimiter,
} from "@/lib/auth-endpoint-rate-limit"
import { logger } from "@/lib/logger"

import { invitationView } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const statusLimiter = createAuthRateLimiter(AUTH_LIMITS.publicRead)
const acceptLimiter = createAuthRateLimiter(AUTH_LIMITS.tokenConsumeFast)

const acceptSchema = z.object({ token: z.string().min(1).max(4096) })

/**
 * GET /api/invitations/accept?token=… — public status probe for the accept
 * page. The HMAC token is the capability: whoever holds the emailed link may
 * learn the invite's state and display details. Always answers 200 with a
 * `status` so the page can render every state uniformly.
 */
export async function GET(request: Request) {
  if (!statusLimiter.check(clientIp(request))) return authRateLimited()

  const token = new URL(request.url).searchParams.get("token") ?? ""
  if (!token) return ok({ status: "invalid" })

  const resolved = resolveInvitationByToken(token)
  if (resolved.status === "pending") {
    return ok({ status: "pending", invitation: invitationView(resolved.invitation) })
  }
  return ok({ status: resolved.status })
}

function slugifyWorkspace(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
  return slug || "workspace"
}

function acceptFailure(status: ResolvedInvitation["status"]): Response {
  switch (status) {
    case "used":
      return fail(409, "invite_used", "This invitation has already been accepted.")
    case "revoked":
      return fail(410, "invite_revoked", "This invitation was revoked by the workspace.")
    case "expired":
      return fail(410, "invite_expired", "This invitation has expired. Ask for a new one.")
    default:
      return fail(400, "invalid_token", "This invitation link isn't valid.")
  }
}

/** Maps a lost accept race onto the same status envelope the resolver uses. */
function acceptRaceFailure(reason: "not_found" | "used" | "revoked" | "expired"): Response {
  return acceptFailure(reason === "not_found" ? "invalid" : reason)
}

/**
 * Completes a mock-auth acceptance: flips the invite single-use and writes
 * the `spindle_mock_session` cookie for the invitee so the `(app)` shell
 * lets them in. Mirrors what `completeAuthSession` does client-side for
 * regular sign-in.
 */
function mockSessionFor(record: InvitationRecord, existing: MockSessionData | null) {
  const session: MockSessionData = {
    user: {
      // Keep a name the invitee already chose in mock mode when it matches.
      name:
        existing?.user.email.trim().toLowerCase() === record.email
          ? existing.user.name
          : record.email.split("@")[0],
      email: record.email,
    },
    workspace: {
      name: record.workspaceName,
      slug: slugifyWorkspace(record.workspaceName),
      // The invited role lands on the mock session too — mock workspaces have
      // no membership table, so the session role is the only place it can go.
      role: record.role,
    },
    signedInAt: new Date().toISOString(),
  }
  return session
}

/**
 * POST /api/invitations/accept — consumes the invite (single-use) and signs
 * the invitee in. The emailed token is the only credential required: it
 * proves mailbox control, the same trust model as magic-link sign-in, so an
 * existing session for a different account is simply replaced.
 *
 * Two session modes, mirroring the rest of the app:
 *  - Mock auth enabled and no real access cookie → a mock session cookie is
 *    issued for the invitee (the `(app)` shell only understands mock
 *    sessions today).
 *  - Otherwise → the invitee's backend account is found or provisioned via
 *    `upsertOAuthUser` (provider "invitation", email pre-verified), the
 *    invite is consumed, workspace membership is recorded at the invited
 *    role, and a real token pair is issued through `createSessionForUser`.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return fail(403, "forbidden", "Cross-origin request blocked.")
  }
  if (!acceptLimiter.check(clientIp(request))) return authRateLimited()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, "invalid_request", "Request body must be JSON.")
  }
  const parsed = acceptSchema.safeParse(body)
  if (!parsed.success) return fail(400, "invalid_request", "Missing invitation token.")

  const resolved = resolveInvitationByToken(parsed.data.token)
  if (resolved.status !== "pending") return acceptFailure(resolved.status)
  const record = resolved.invitation

  const hasAccessToken = readCookie(request, ACCESS_COOKIE) !== null
  if (!hasAccessToken && mockAuthEnabled) {
    const existing = decodeMockSession(readCookie(request, MOCK_SESSION_COOKIE))
    const accepted = invitationStore.accept(record.id, `mock:${record.email}`)
    if (!accepted.ok) return acceptRaceFailure(accepted.reason)

    const session = mockSessionFor(record, existing)
    const response = ok({
      status: "accepted",
      invitation: invitationView(accepted.invitation),
    })
    response.cookies.set(MOCK_SESSION_COOKIE, encodeMockSession(session), {
      path: "/",
      maxAge: MOCK_SESSION_MAX_AGE_SECONDS,
      sameSite: "lax",
    })
    return response
  }

  // Real-auth path: find or provision the invitee's account, consume the
  // invite, join the workspace, then mint a session — identical trust to
  // consuming a magic link.
  //
  // Ordering: `accept` is the atomic single-use gate and runs BEFORE any
  // session/membership side effects, so a lost race leaves nothing behind
  // (the runner-up exits here; the invite is consumed by the winner). The
  // remaining steps compensate on failure via `invitationStore.release` +
  // `removeWorkspaceMember`, so a downstream error hands the invite back
  // instead of burning it. Provisioning (`upsertOAuthUser`) stays before the
  // gate because `accept` needs the user id — a lost race can therefore
  // leave an unused account behind, the same orphan any OAuth sign-up
  // produces; documented residual gap.
  const backend = getAuthBackend()
  let user = await backend.getUserByEmail(record.email)
  if (!user) {
    user = (
      await backend.upsertOAuthUser({
        email: record.email,
        provider: "invitation",
      })
    ).user
  }

  const accepted = invitationStore.accept(record.id, user.id)
  if (!accepted.ok) return acceptRaceFailure(accepted.reason)

  // Membership must be written before the session is issued: `issueTokens`
  // snapshots the workspace into the session, so the invitee's first session
  // already resolves to the workspace they joined. Invites without a
  // `workspaceId` (mock-created, or predating the field) skip this — the
  // accept still succeeds, the role just has nowhere to land.
  //
  // Pre-existing membership is captured BEFORE the write: the invitee may
  // already belong to this workspace (re-invite, second accept, or an
  // account that joined through another path). In that case the invited
  // role must NOT overwrite their current one — `addWorkspaceMember` is
  // called with the existing role purely to repoint the session workspace —
  // and the rollback below restores the prior state instead of deleting a
  // membership the invite never created.
  let priorMembership: WorkspaceMembership | null = null
  let priorSessionWorkspace: WorkspaceInfo | null = null
  if (record.workspaceId) {
    // Fail closed: if the membership lookup errors we cannot know whether the
    // invitee already belongs here. Proceeding with `priorMembership = null`
    // could overwrite an existing member's role and, on session-failure
    // rollback, delete a membership the invite never created — so the invite
    // is released and the request fails instead.
    let memberships: WorkspaceMembership[]
    try {
      memberships = await backend.listWorkspaceMemberships(user.id)
    } catch (error) {
      invitationStore.release(record.id, user.id)
      logger.warn(
        { event: "invitations.membership-lookup-failed", invitationId: record.id },
        "Membership lookup failed for an accepted invite; invite released.",
      )
      void error
      return fail(500, "accept_failed", "Couldn't finish joining the workspace. Try again.")
    }
    priorMembership = memberships.find((m) => m.workspace.id === record.workspaceId) ?? null
    priorSessionWorkspace =
      (await backend.getSessionContext(user.id).catch(() => null))?.workspace ?? null

    try {
      await backend.addWorkspaceMember({
        userId: user.id,
        workspace: {
          id: record.workspaceId,
          name: record.workspaceName,
          slug: slugifyWorkspace(record.workspaceName),
        },
        // Existing members keep their role — accepting an invite is never a
        // (re)grant of privileges they already declined or outgrew.
        role: priorMembership?.role ?? record.role,
      })
    } catch (error) {
      invitationStore.release(record.id, user.id)
      logger.warn(
        { event: "invitations.membership-failed", invitationId: record.id },
        "Workspace membership could not be recorded for an accepted invite.",
      )
      void error
      return fail(500, "accept_failed", "Couldn't finish joining the workspace. Try again.")
    }
  }

  let tokens: TokenPair
  try {
    tokens = await backend.createSessionForUser(user.id)
  } catch (error) {
    // Roll back best-effort so the invitee's pre-accept state is restored:
    //  - no prior membership → remove the row this accept added;
    //  - prior membership    → re-write the prior role (never delete a
    //    membership the invite did not create), then repoint the session
    //    workspace if the failed join moved it.
    if (record.workspaceId) {
      try {
        if (priorMembership) {
          await backend.addWorkspaceMember({
            userId: user.id,
            workspace: priorMembership.workspace,
            role: priorMembership.role,
          })
          if (priorSessionWorkspace && priorSessionWorkspace.id !== record.workspaceId) {
            const priorActiveId = priorSessionWorkspace.id
            const priorActive = (await backend.listWorkspaceMemberships(user.id)).find(
              (m) => m.workspace.id === priorActiveId,
            )
            if (priorActive) {
              await backend.addWorkspaceMember({
                userId: user.id,
                workspace: priorActive.workspace,
                role: priorActive.role,
              })
            }
          }
        } else {
          await backend.removeWorkspaceMember(user.id, record.workspaceId)
        }
      } catch {
        // Compensation is best-effort; the invite release below still runs.
      }
    }
    invitationStore.release(record.id, user.id)
    logger.warn(
      { event: "invitations.session-failed", invitationId: record.id },
      "Session issuance failed for an accepted invite; invite released.",
    )
    void error
    return fail(500, "accept_failed", "Couldn't finish signing you in. Try again.")
  }

  return applyAuthCookies(
    ok({
      status: "accepted",
      invitation: invitationView(accepted.invitation),
      session: tokens.session,
    }),
    tokens,
    { remember: true },
  )
}
