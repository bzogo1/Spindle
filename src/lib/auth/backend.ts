import { createHash, randomBytes, randomUUID } from "node:crypto"

import {
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCode,
  verifyTotpCode,
} from "@/lib/auth/totp"
import { createAccessToken, createTotpChallenge, verifyAuthToken } from "@/lib/auth/token-codec"
import { hashPassword, verifyPassword } from "@/lib/auth/password"
import { getSessionLimitStore, planSessionEvictions } from "@/lib/auth/session-limits"
import {
  canChangeMemberRole,
  canManageMembers,
  canRemoveMember,
  isWorkspaceRole,
  type WorkspaceRole,
} from "@/lib/members/permissions"

/**
 * Auth data layer behind a provider interface.
 *
 * The Prisma schema currently only has a minimal `User` row (see
 * prisma/schema.prisma) — there are no credential, session, token, or 2FA
 * tables yet. Rather than block on a migration, the data layer is defined as
 * an interface with an in-memory development implementation
 * ({@link MemoryAuthBackend}). `getAuthBackend()` is the single seam where a
 * Prisma-backed implementation plugs in once the schema lands.
 *
 * REQUIRED SCHEMA ADDITIONS (see prisma/AUTH-SCHEMA.md):
 *   - User: passwordHash, emailVerified, totpSecret, totpEnabledAt
 *   - AuthSession: id, userId, refreshTokenHash, expiresAt, revokedAt, createdAt
 *   - AuthOneTimeToken: id, kind (magic|reset|verify), email, userId?,
 *     tokenHash, expiresAt, consumedAt
 *   - UserBackupCode: id, userId, codeHash, consumedAt
 *   - Workspace membership is partially landed: {@link MemoryAuthBackend}
 *     records memberships in-process and supports create/switch/rename/
 *     delete plus role management (see the workspace methods below), but
 *     there is still no persisted Workspace/Membership table.
 *
 * IMPORTANT: the in-memory backend loses all state on restart and does not
 * scale past one process. It exists so the auth flow is exercisable in dev
 * and tests; production MUST run the Prisma implementation.
 */

export type AuthUser = {
  id: string
  email: string
  name: string | null
  emailVerified: boolean
  createdAt: string
}

export type WorkspaceInfo = {
  /**
   * Stable workspace id. Invitations and membership records key on this;
   * `name`/`slug` are display-only and can change.
   */
  id: string
  name: string
  slug: string
}

/** A user's membership in a workspace: the workspace plus their role in it. */
export type WorkspaceMembership = {
  workspace: WorkspaceInfo
  role: WorkspaceRole
}

/** One row of a workspace roster: the member's public user plus their role. */
export type WorkspaceMemberInfo = {
  user: AuthUser
  role: WorkspaceRole
}

export type AuthSessionInfo = {
  user: AuthUser
  workspace: WorkspaceInfo | null
  sessionId: string
  /** ISO timestamp when the access token expires. */
  expiresAt: string
}

export type TokenPair = {
  accessToken: string
  refreshToken: string
  session: AuthSessionInfo
}

/** Public summary of one active session (for listing/usage display). */
export type ActiveSessionInfo = {
  id: string
  /** ISO timestamp when the session was created. */
  createdAt: string
  /** ISO timestamp when the refresh token expires. */
  expiresAt: string
}

export type SignInResult =
  | { status: "ok"; tokens: TokenPair }
  | { status: "totp_required"; challenge: string }
  | { status: "invalid" }

export type OneTimeTokenKind = "magic" | "reset" | "verify"

export type OneTimeTokenRecord = {
  email: string
  userId: string | null
}

export type OneTimeTokenConsume =
  { ok: true; record: OneTimeTokenRecord } | { ok: false; reason: "expired" | "used" | "invalid" }

export type TotpEnrollment = {
  secret: string
  otpauthUrl: string
  backupCodes: string[]
}

export type AuthBackendErrorCode =
  | "email_taken"
  | "user_not_found"
  | "invalid_credentials"
  | "invalid_token"
  | "totp_invalid"
  | "rate_limited"
  | "invalid_input"

export class AuthBackendError extends Error {
  readonly code: AuthBackendErrorCode

  constructor(code: AuthBackendErrorCode, message: string) {
    super(message)
    this.name = "AuthBackendError"
    this.code = code
  }
}

export interface AuthBackend {
  signUp(input: {
    email: string
    password: string
    workspaceName: string
    name?: string
  }): Promise<{ user: AuthUser; workspace: WorkspaceInfo }>

  /** Returns "invalid" for unknown email OR wrong password (no enumeration). */
  signIn(email: string, password: string): Promise<SignInResult>

  /** Completes a login that paused on the TOTP challenge. */
  verifyTotpLogin(challenge: string, code: string): Promise<TokenPair | null>

  issueOneTimeToken(input: {
    kind: OneTimeTokenKind
    email: string
    userId?: string | null
    ttlMs: number
  }): Promise<string>

  /** Single-use: consumes the token or reports why it failed. */
  consumeOneTimeToken(rawToken: string, kind: OneTimeTokenKind): Promise<OneTimeTokenConsume>

  refreshSession(refreshToken: string): Promise<TokenPair | null>
  revokeSession(refreshToken: string): Promise<void>
  /** Active (non-revoked, unexpired) sessions for a user, newest first. */
  listSessions(userId: string): Promise<ActiveSessionInfo[]>
  /** Issues a fresh token pair for an already-authenticated user (magic link,
   * OAuth callback). The caller must have verified identity out-of-band. */
  createSessionForUser(userId: string): Promise<TokenPair>
  getUserById(id: string): Promise<AuthUser | null>
  getUserByEmail(email: string): Promise<AuthUser | null>
  /** Workspace + user bundle used by GET /api/auth/session. */
  getSessionContext(
    userId: string,
  ): Promise<{ user: AuthUser; workspace: WorkspaceInfo | null } | null>
  /** Finds or creates a user from an OAuth identity assertion. */
  upsertOAuthUser(input: {
    email: string
    name?: string | null
    provider: string
  }): Promise<{ user: AuthUser; created: boolean }>
  /**
   * Every workspace `userId` belongs to, with their role. Includes the
   * auto-provisioned personal workspace (role `owner`) and any workspaces
   * joined via {@link addWorkspaceMember}.
   */
  listWorkspaceMemberships(userId: string): Promise<WorkspaceMembership[]>
  /**
   * Records `userId`'s membership in `workspace` at `role` — this is where an
   * accepted invitation's role actually lands. Idempotent: re-adding the same
   * user/workspace pair updates the role. Until a workspace switcher exists,
   * the most recently joined workspace becomes the user's session workspace.
   */
  addWorkspaceMember(input: {
    userId: string
    workspace: WorkspaceInfo
    role: WorkspaceRole
  }): Promise<WorkspaceMembership>
  /**
   * Removes `userId`'s membership in `workspaceId`. Used to compensate a
   * failed accept flow; a no-op when the membership does not exist. If the
   * removed workspace was the session workspace, sessions fall back to the
   * user's home workspace.
   */
  removeWorkspaceMember(userId: string, workspaceId: string): Promise<void>

  // -- Workspace management -------------------------------------------------
  // These back the workspace settings/members/switching surfaces. Role
  // enforcement reuses the pure guards in src/lib/members/permissions so the
  // API layer and this backend can never disagree about who may do what.

  /**
   * Creates an additional workspace owned by `userId` (the auto-provisioned
   * personal workspace is separate). The creator becomes `owner` and the new
   * workspace becomes the session workspace, matching join semantics.
   */
  createWorkspace(input: { userId: string; name: string }): Promise<WorkspaceMembership>
  /** Workspace lookup by stable id. */
  getWorkspace(workspaceId: string): Promise<WorkspaceInfo | null>
  /**
   * Repoints the user's session workspace at `workspaceId`. Returns the
   * membership, or null when the user does not belong to it.
   */
  switchWorkspace(userId: string, workspaceId: string): Promise<WorkspaceMembership | null>
  /** Full roster of a workspace (empty array for unknown ids). */
  listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMemberInfo[]>
  /**
   * Renames a workspace. `actorId` must hold an owner/admin membership;
   * returns null when the actor lacks permission or the workspace is gone.
   */
  updateWorkspace(
    actorId: string,
    workspaceId: string,
    patch: { name: string },
  ): Promise<WorkspaceInfo | null>
  /**
   * Deletes a workspace and every membership. `actorId` must be an owner;
   * affected members' session workspaces fall back to their home workspace.
   */
  deleteWorkspace(actorId: string, workspaceId: string): Promise<boolean>
  /**
   * Changes `targetUserId`'s role under the same rules as
   * `canChangeMemberRole` (src/lib/members/permissions): no self-changes,
   * admins manage members only, the last owner cannot be demoted. Returns
   * the updated membership, or null when denied/unknown.
   */
  setWorkspaceMemberRole(
    actorId: string,
    workspaceId: string,
    targetUserId: string,
    role: WorkspaceRole,
  ): Promise<WorkspaceMembership | null>
  /**
   * Removes `targetUserId` from the workspace under `canRemoveMember` rules.
   * The removed member's session workspace falls back like
   * {@link removeWorkspaceMember}. Returns false when denied/unknown.
   */
  kickWorkspaceMember(actorId: string, workspaceId: string, targetUserId: string): Promise<boolean>

  markEmailVerified(userId: string): Promise<void>
  setPassword(userId: string, password: string): Promise<void>
  /** Revokes every live session for the user (password reset, security event). */
  revokeAllSessions(userId: string): Promise<void>

  startTotpEnrollment(userId: string): Promise<TotpEnrollment>
  /**
   * Activates 2FA after a valid code. Returns the plaintext backup codes —
   * they are shown to the user exactly once and stored only as hashes.
   */
  confirmTotpEnrollment(userId: string, code: string): Promise<string[] | null>
  disableTotp(userId: string, password: string): Promise<boolean>
  /** Whether the user currently has TOTP two-factor enabled. */
  isTotpEnabled(userId: string): Promise<boolean>
  /** Verifies a code against the user's enrolled secret (login or settings). */
  verifyUserTotp(userId: string, code: string): Promise<boolean>
  consumeBackupCode(userId: string, code: string): Promise<boolean>
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

function randomToken(): string {
  return randomBytes(32).toString("base64url")
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex")
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

function newWorkspaceId(): string {
  return `ws_${randomBytes(8).toString("base64url")}`
}

// ---------------------------------------------------------------------------
// In-memory development backend
// ---------------------------------------------------------------------------

type StoredUser = AuthUser & {
  passwordHash: string | null
  totpSecret: string | null
  totpEnabledAt: string | null
  backupCodes: string[] // sha256 hashes
}

type StoredSession = {
  id: string
  userId: string
  refreshTokenHash: string
  expiresAt: number
  revokedAt: number | null
  createdAt: number
}

type StoredOneTimeToken = OneTimeTokenRecord & {
  kind: OneTimeTokenKind
  tokenHash: string
  expiresAt: number
  consumedAt: number | null
}

export class MemoryAuthBackend implements AuthBackend {
  private users = new Map<string, StoredUser>()
  private usersByEmail = new Map<string, string>() // email -> userId
  private sessions = new Map<string, StoredSession>() // sessionId -> record
  private refreshIndex = new Map<string, string>() // refreshTokenHash -> sessionId
  private oneTimeTokens = new Map<string, StoredOneTimeToken[]>() // userId|"anon" -> records
  private workspaces = new Map<string, WorkspaceInfo>() // userId -> home workspace
  // Workspace membership (in-memory stand-in for the Prisma tables noted in
  // AUTH-SCHEMA.md): workspaceId -> (userId -> role), plus the id -> info
  // index and the per-user "current" workspace sessions resolve to.
  private memberships = new Map<string, Map<string, WorkspaceRole>>()
  private workspaceIndex = new Map<string, WorkspaceInfo>()
  private activeWorkspace = new Map<string, string>() // userId -> workspaceId

  async signUp(input: { email: string; password: string; workspaceName: string; name?: string }) {
    const email = input.email.trim().toLowerCase()
    if (this.usersByEmail.has(email)) {
      throw new AuthBackendError("email_taken", "An account already uses this email.")
    }
    const user: StoredUser = {
      id: randomUUID(),
      email,
      name: input.name?.trim() || email.split("@")[0],
      emailVerified: false,
      createdAt: new Date().toISOString(),
      passwordHash: await hashPassword(input.password),
      totpSecret: null,
      totpEnabledAt: null,
      backupCodes: [],
    }
    const workspace: WorkspaceInfo = {
      id: newWorkspaceId(),
      name: input.workspaceName.trim(),
      slug: slugifyWorkspace(input.workspaceName),
    }
    this.users.set(user.id, user)
    this.usersByEmail.set(email, user.id)
    this.workspaces.set(user.id, workspace)
    this.registerOwnedWorkspace(user.id, workspace)
    return { user: this.publicUser(user), workspace }
  }

  /**
   * Registers a freshly created workspace: indexes it by id, records the
   * creator's `owner` membership, and makes it the user's session workspace.
   */
  private registerOwnedWorkspace(userId: string, workspace: WorkspaceInfo): void {
    this.workspaceIndex.set(workspace.id, workspace)
    const members = this.memberships.get(workspace.id) ?? new Map<string, WorkspaceRole>()
    members.set(userId, "owner")
    this.memberships.set(workspace.id, members)
    this.activeWorkspace.set(userId, workspace.id)
  }

  /** Workspace shown on issued sessions / session context for `userId`. */
  private workspaceForSession(userId: string): WorkspaceInfo | null {
    const activeId = this.activeWorkspace.get(userId)
    return (
      (activeId ? this.workspaceIndex.get(activeId) : undefined) ??
      this.workspaces.get(userId) ??
      null
    )
  }

  async signIn(email: string, password: string): Promise<SignInResult> {
    const user = this.users.get(this.usersByEmail.get(email.trim().toLowerCase()) ?? "")
    // Verify against a dummy hash for unknown users so timing does not
    // enumerate registered emails.
    const stored = user?.passwordHash ?? (await hashPassword(randomBytes(16).toString("hex")))
    const ok = await verifyPassword(password, stored)
    if (!user || !ok) return { status: "invalid" }

    if (user.totpEnabledAt && user.totpSecret) {
      const challenge = createTotpChallenge(user.id)
      return { status: "totp_required", challenge: challenge.token }
    }

    return { status: "ok", tokens: await this.issueTokens(user.id) }
  }

  async verifyTotpLogin(challenge: string, code: string): Promise<TokenPair | null> {
    const payload = verifyAuthToken(challenge, "totp-challenge")
    if (!payload) return null
    const user = this.users.get(payload.uid)
    if (!user?.totpSecret) return null

    // Try the TOTP code first; fall back to a backup code. Backup codes are
    // single-use and consumed only on success.
    let ok = await verifyTotpCode(user.totpSecret, code)
    if (!ok) ok = await this.consumeBackupCode(user.id, code)
    if (!ok) return null
    return this.issueTokens(user.id)
  }

  private async issueTokens(userId: string): Promise<TokenPair> {
    const user = this.users.get(userId)
    if (!user) throw new AuthBackendError("user_not_found", "Unknown user.")

    const refreshToken = randomToken()
    const sessionId = randomUUID()
    const now = Date.now()
    this.sessions.set(sessionId, {
      id: sessionId,
      userId,
      refreshTokenHash: sha256(refreshToken),
      expiresAt: now + REFRESH_TOKEN_TTL_MS,
      revokedAt: null,
      createdAt: now,
    })
    this.refreshIndex.set(sha256(refreshToken), sessionId)

    // Concurrent session cap: every mint path funnels through here, so
    // enforcing once covers sign-in, TOTP verify, refresh rotation, OAuth,
    // passwordless/magic-link, and signup auto sign-in. The just-created
    // session is preserved; oldest actives beyond the limit are revoked.
    this.enforceSessionLimit(userId, sessionId)

    const access = createAccessToken({
      sid: sessionId,
      uid: user.id,
      email: user.email,
      name: user.name,
    })

    return {
      accessToken: access.token,
      refreshToken,
      session: {
        user: this.publicUser(user),
        workspace: this.workspaceForSession(user.id),
        sessionId,
        expiresAt: access.expiresAt.toISOString(),
      },
    }
  }

  /**
   * Revokes the user's oldest active sessions until they fit within their
   * configured concurrent-session limit (see session-limits.ts; 0 =
   * unlimited). `preserveSessionId` — the session being minted — always
   * survives. No-op when within the cap.
   */
  private enforceSessionLimit(userId: string, preserveSessionId: string): void {
    const limit = getSessionLimitStore().getLimit(userId)
    // Only this user's sessions count toward — and can be evicted by —
    // their limit. Passing the global session map would let one user's
    // sign-in revoke another user's sessions.
    const userSessions = [...this.sessions.values()].filter((s) => s.userId === userId)
    const victims = planSessionEvictions(userSessions, limit, {
      preserveId: preserveSessionId,
    })
    if (victims.length === 0) return
    const now = Date.now()
    const victimIds = new Set(victims)
    for (const session of this.sessions.values()) {
      if (!victimIds.has(session.id)) continue
      session.revokedAt = now
      for (const [hash, sid] of this.refreshIndex) {
        if (sid === session.id) this.refreshIndex.delete(hash)
      }
    }
  }

  async listSessions(userId: string): Promise<ActiveSessionInfo[]> {
    const now = Date.now()
    return [...this.sessions.values()]
      .filter((s) => s.userId === userId && s.revokedAt === null && s.expiresAt > now)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((s) => ({
        id: s.id,
        createdAt: new Date(s.createdAt).toISOString(),
        expiresAt: new Date(s.expiresAt).toISOString(),
      }))
  }

  async refreshSession(refreshToken: string): Promise<TokenPair | null> {
    const hash = sha256(refreshToken)
    const sessionId = this.refreshIndex.get(hash)
    const session = sessionId ? this.sessions.get(sessionId) : undefined
    if (!session || session.revokedAt !== null || session.expiresAt <= Date.now()) {
      return null
    }
    // Rotation: the presented refresh token is single-use.
    this.refreshIndex.delete(hash)
    session.revokedAt = Date.now()
    return this.issueTokens(session.userId)
  }

  async revokeSession(refreshToken: string): Promise<void> {
    const hash = sha256(refreshToken)
    const sessionId = this.refreshIndex.get(hash)
    if (!sessionId) return
    const session = this.sessions.get(sessionId)
    if (session) session.revokedAt = Date.now()
    this.refreshIndex.delete(hash)
  }

  async issueOneTimeToken(input: {
    kind: OneTimeTokenKind
    email: string
    userId?: string | null
    ttlMs: number
  }): Promise<string> {
    const raw = randomToken()
    const key = input.userId ?? input.email.toLowerCase()
    const list = this.oneTimeTokens.get(key) ?? []
    list.push({
      kind: input.kind,
      email: input.email.toLowerCase(),
      userId: input.userId ?? null,
      tokenHash: sha256(raw),
      expiresAt: Date.now() + input.ttlMs,
      consumedAt: null,
    })
    this.oneTimeTokens.set(key, list)
    return raw
  }

  async consumeOneTimeToken(
    rawToken: string,
    kind: OneTimeTokenKind,
  ): Promise<OneTimeTokenConsume> {
    const hash = sha256(rawToken)
    for (const list of this.oneTimeTokens.values()) {
      const record = list.find((entry) => entry.tokenHash === hash)
      if (!record) continue
      if (record.kind !== kind) return { ok: false, reason: "invalid" }
      if (record.consumedAt !== null) return { ok: false, reason: "used" }
      if (record.expiresAt <= Date.now()) return { ok: false, reason: "expired" }
      record.consumedAt = Date.now()
      return { ok: true, record: { email: record.email, userId: record.userId } }
    }
    return { ok: false, reason: "invalid" }
  }

  async createSessionForUser(userId: string): Promise<TokenPair> {
    return this.issueTokens(userId)
  }

  async getSessionContext(userId: string) {
    const user = this.users.get(userId)
    if (!user) return null
    return { user: this.publicUser(user), workspace: this.workspaceForSession(userId) }
  }

  async getUserById(id: string): Promise<AuthUser | null> {
    const user = this.users.get(id)
    return user ? this.publicUser(user) : null
  }

  async getUserByEmail(email: string): Promise<AuthUser | null> {
    const user = this.users.get(this.usersByEmail.get(email.trim().toLowerCase()) ?? "")
    return user ? this.publicUser(user) : null
  }

  async upsertOAuthUser(input: {
    email: string
    name?: string | null
    provider: string
  }): Promise<{ user: AuthUser; created: boolean }> {
    void input.provider // providers are interchangeable at the account level
    const email = input.email.trim().toLowerCase()
    const existingId = this.usersByEmail.get(email)
    if (existingId) {
      const existing = this.users.get(existingId)
      if (existing) {
        // Trust the provider's verified email claim; mark verified on link.
        if (!existing.emailVerified) existing.emailVerified = true
        return { user: this.publicUser(existing), created: false }
      }
    }
    const user: StoredUser = {
      id: randomUUID(),
      email,
      name: input.name?.trim() || email.split("@")[0],
      emailVerified: true,
      createdAt: new Date().toISOString(),
      passwordHash: null, // OAuth-only account until a password is set
      totpSecret: null,
      totpEnabledAt: null,
      backupCodes: [],
    }
    this.users.set(user.id, user)
    this.usersByEmail.set(email, user.id)
    const workspace: WorkspaceInfo = {
      id: newWorkspaceId(),
      name: "Personal workspace",
      slug: `personal-${user.id.slice(0, 8)}`,
    }
    this.workspaces.set(user.id, workspace)
    this.registerOwnedWorkspace(user.id, workspace)
    return { user: this.publicUser(user), created: true }
  }

  async listWorkspaceMemberships(userId: string): Promise<WorkspaceMembership[]> {
    const memberships: WorkspaceMembership[] = []
    for (const [workspaceId, members] of this.memberships) {
      const role = members.get(userId)
      if (!role) continue
      const workspace = this.workspaceIndex.get(workspaceId)
      if (workspace) memberships.push({ workspace, role })
    }
    return memberships
  }

  async addWorkspaceMember(input: {
    userId: string
    workspace: WorkspaceInfo
    role: WorkspaceRole
  }): Promise<WorkspaceMembership> {
    if (!this.users.has(input.userId)) {
      throw new AuthBackendError("user_not_found", "Unknown user.")
    }
    this.workspaceIndex.set(input.workspace.id, input.workspace)
    const members = this.memberships.get(input.workspace.id) ?? new Map<string, WorkspaceRole>()
    members.set(input.userId, input.role)
    this.memberships.set(input.workspace.id, members)
    // Joining (or creating) a workspace repoints the session workspace;
    // `switchWorkspace` is the explicit path for users in several workspaces.
    this.activeWorkspace.set(input.userId, input.workspace.id)
    return { workspace: input.workspace, role: input.role }
  }

  async removeWorkspaceMember(userId: string, workspaceId: string): Promise<void> {
    this.memberships.get(workspaceId)?.delete(userId)
    if (this.activeWorkspace.get(userId) === workspaceId) {
      // Fall back to the home workspace on the next session issue.
      this.activeWorkspace.delete(userId)
    }
  }

  async createWorkspace(input: { userId: string; name: string }): Promise<WorkspaceMembership> {
    if (!this.users.has(input.userId)) {
      throw new AuthBackendError("user_not_found", "Unknown user.")
    }
    const name = input.name.trim()
    if (!name) {
      throw new AuthBackendError("invalid_input", "Workspace name is required.")
    }
    const workspace: WorkspaceInfo = {
      id: newWorkspaceId(),
      name,
      slug: slugifyWorkspace(name),
    }
    this.registerOwnedWorkspace(input.userId, workspace)
    return { workspace, role: "owner" }
  }

  async getWorkspace(workspaceId: string): Promise<WorkspaceInfo | null> {
    return this.workspaceIndex.get(workspaceId) ?? null
  }

  async switchWorkspace(userId: string, workspaceId: string): Promise<WorkspaceMembership | null> {
    const workspace = this.workspaceIndex.get(workspaceId)
    const role = workspace ? this.memberships.get(workspaceId)?.get(userId) : undefined
    if (!workspace || !role) return null
    this.activeWorkspace.set(userId, workspaceId)
    return { workspace, role }
  }

  async listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMemberInfo[]> {
    const members = this.memberships.get(workspaceId)
    if (!members) return []
    const roster: WorkspaceMemberInfo[] = []
    for (const [memberId, role] of members) {
      const member = this.users.get(memberId)
      if (member) roster.push({ user: this.publicUser(member), role })
    }
    return roster
  }

  async updateWorkspace(
    actorId: string,
    workspaceId: string,
    patch: { name: string },
  ): Promise<WorkspaceInfo | null> {
    const actorRole = this.memberships.get(workspaceId)?.get(actorId)
    if (!canManageMembers(actorRole)) return null
    const workspace = this.workspaceIndex.get(workspaceId)
    if (!workspace) return null
    const name = patch.name.trim()
    if (!name) {
      throw new AuthBackendError("invalid_input", "Workspace name is required.")
    }
    workspace.name = name
    workspace.slug = slugifyWorkspace(name)
    return workspace
  }

  async deleteWorkspace(actorId: string, workspaceId: string): Promise<boolean> {
    const members = this.memberships.get(workspaceId)
    if (!members || members.get(actorId) !== "owner") return false
    for (const memberId of members.keys()) {
      if (this.activeWorkspace.get(memberId) === workspaceId) {
        this.activeWorkspace.delete(memberId)
      }
    }
    this.memberships.delete(workspaceId)
    this.workspaceIndex.delete(workspaceId)
    return true
  }

  async setWorkspaceMemberRole(
    actorId: string,
    workspaceId: string,
    targetUserId: string,
    role: WorkspaceRole,
  ): Promise<WorkspaceMembership | null> {
    if (!isWorkspaceRole(role)) {
      throw new AuthBackendError("invalid_input", "Unknown workspace role.")
    }
    const members = this.memberships.get(workspaceId)
    const workspace = this.workspaceIndex.get(workspaceId)
    if (!members || !workspace) return null
    const actorRole = members.get(actorId)
    const targetRole = members.get(targetUserId)
    if (!actorRole || !targetRole) return null
    const holders = [...members.entries()].map(([id, memberRole]) => ({
      id,
      role: memberRole,
    }))
    const actor = holders.find((holder) => holder.id === actorId)
    const target = holders.find((holder) => holder.id === targetUserId)
    if (!actor || !target || !canChangeMemberRole(actor, target, holders, role)) return null
    members.set(targetUserId, role)
    return { workspace, role }
  }

  async kickWorkspaceMember(
    actorId: string,
    workspaceId: string,
    targetUserId: string,
  ): Promise<boolean> {
    const members = this.memberships.get(workspaceId)
    if (!members) return false
    const actorRole = members.get(actorId)
    const targetRole = members.get(targetUserId)
    if (!actorRole || !targetRole) return false
    const holders = [...members.entries()].map(([id, memberRole]) => ({
      id,
      role: memberRole,
    }))
    const actor = holders.find((holder) => holder.id === actorId)
    const target = holders.find((holder) => holder.id === targetUserId)
    if (!actor || !target || !canRemoveMember(actor, target, holders)) return false
    members.delete(targetUserId)
    if (this.activeWorkspace.get(targetUserId) === workspaceId) {
      this.activeWorkspace.delete(targetUserId)
    }
    if (members.size === 0) {
      this.memberships.delete(workspaceId)
      this.workspaceIndex.delete(workspaceId)
    }
    return true
  }

  async markEmailVerified(userId: string): Promise<void> {
    const user = this.users.get(userId)
    if (user) user.emailVerified = true
  }

  async setPassword(userId: string, password: string): Promise<void> {
    const user = this.users.get(userId)
    if (user) user.passwordHash = await hashPassword(password)
  }

  async revokeAllSessions(userId: string): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.userId === userId && session.revokedAt === null) {
        session.revokedAt = Date.now()
        for (const [hash, sid] of this.refreshIndex) {
          if (sid === session.id) this.refreshIndex.delete(hash)
        }
      }
    }
  }

  async startTotpEnrollment(userId: string): Promise<TotpEnrollment> {
    const user = this.users.get(userId)
    if (!user) throw new AuthBackendError("user_not_found", "Unknown user.")
    // A fresh secret replaces any unconfirmed one; backup codes are only
    // minted when the enrollment is confirmed.
    user.totpSecret = generateTotpSecret()
    user.totpEnabledAt = null
    user.backupCodes = []
    const secret = user.totpSecret
    const { buildOtpAuthUri } = await import("@/lib/auth/totp")
    return {
      secret,
      otpauthUrl: buildOtpAuthUri({ secret, accountName: user.email }),
      backupCodes: [],
    }
  }

  async confirmTotpEnrollment(userId: string, code: string): Promise<string[] | null> {
    const user = this.users.get(userId)
    if (!user?.totpSecret || user.totpEnabledAt) return null
    if (!/^\d{6,8}$/.test(code.replace(/\s/g, ""))) return null
    const ok = await verifyTotpCode(user.totpSecret, code)
    if (!ok) return null
    user.totpEnabledAt = new Date().toISOString()
    // Issue fresh backup codes only at activation time; plaintext is returned
    // once and only hashes are stored.
    const codes = generateBackupCodes()
    user.backupCodes = await Promise.all(codes.map(hashBackupCode))
    return codes
  }

  async disableTotp(userId: string, password: string): Promise<boolean> {
    const user = this.users.get(userId)
    if (!user?.passwordHash || !user.totpEnabledAt) return false
    if (!(await verifyPassword(password, user.passwordHash))) return false
    user.totpSecret = null
    user.totpEnabledAt = null
    user.backupCodes = []
    return true
  }

  async isTotpEnabled(userId: string): Promise<boolean> {
    const user = this.users.get(userId)
    return Boolean(user?.totpEnabledAt && user?.totpSecret)
  }

  async verifyUserTotp(userId: string, code: string): Promise<boolean> {
    const user = this.users.get(userId)
    if (!user?.totpSecret) return false
    if (await verifyTotpCode(user.totpSecret, code)) return true
    return this.consumeBackupCode(userId, code)
  }

  async consumeBackupCode(userId: string, code: string): Promise<boolean> {
    const user = this.users.get(userId)
    if (!user) return false
    const hash = await hashBackupCode(code)
    const index = user.backupCodes.indexOf(hash)
    if (index === -1) return false
    user.backupCodes.splice(index, 1)
    return true
  }

  private publicUser(user: StoredUser): AuthUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
    }
  }
}

// ---------------------------------------------------------------------------
// Factory + token TTL constants shared with routes
// ---------------------------------------------------------------------------

let backend: AuthBackend | undefined

/**
 * Single seam for the data layer. Returns the in-memory development backend
 * until a Prisma implementation lands (see prisma/AUTH-SCHEMA.md).
 */
export function getAuthBackend(): AuthBackend {
  backend ??= new MemoryAuthBackend()
  return backend
}

/** Test hook: replaces the backend (used by unit tests). */
export function setAuthBackendForTests(next: AuthBackend | undefined): void {
  backend = next
}

export const TOKEN_TTL = {
  magicLinkMs: MAGIC_LINK_TTL_MS,
  resetMs: RESET_TOKEN_TTL_MS,
  verifyMs: VERIFY_TOKEN_TTL_MS,
} as const
