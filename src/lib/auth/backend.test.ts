import { beforeEach, describe, expect, it } from "vitest"

import { generateTotpCode } from "./totp"
import { verifyAuthToken } from "./token-codec"
import { AuthBackendError, MemoryAuthBackend, type AuthBackend } from "./backend"

let backend: AuthBackend

beforeEach(() => {
  backend = new MemoryAuthBackend()
})

async function signUpAndIn() {
  await backend.signUp({
    email: "Researcher@Lab.Edu",
    password: "correct horse",
    workspaceName: "Research Team",
  })
  const result = await backend.signIn("researcher@lab.edu", "correct horse")
  if (result.status !== "ok") throw new Error(`expected ok, got ${result.status}`)
  return result.tokens
}

describe("MemoryAuthBackend", () => {
  it("signs up, normalizes email, and issues a session", async () => {
    const { user, workspace } = await backend.signUp({
      email: "A@B.CO",
      password: "password123",
      workspaceName: "My Lab",
    })
    expect(user.email).toBe("a@b.co")
    expect(workspace.slug).toBe("my-lab")
    expect(user.emailVerified).toBe(false)
  })

  it("rejects duplicate emails", async () => {
    await backend.signUp({ email: "a@b.co", password: "password123", workspaceName: "One" })
    await expect(
      backend.signUp({ email: "A@B.CO", password: "password123", workspaceName: "Two" }),
    ).rejects.toMatchObject({ code: "email_taken" })
  })

  it("returns invalid for wrong password and unknown email identically", async () => {
    await backend.signUp({ email: "a@b.co", password: "password123", workspaceName: "One" })
    const wrong = await backend.signIn("a@b.co", "wrong-password")
    const unknown = await backend.signIn("nobody@b.co", "password123")
    expect(wrong.status).toBe("invalid")
    expect(unknown.status).toBe("invalid")
  })

  it("rotates refresh tokens: old token is dead after refresh", async () => {
    const tokens = await signUpAndIn()
    const refreshed = await backend.refreshSession(tokens.refreshToken)
    expect(refreshed).not.toBeNull()
    expect(refreshed!.refreshToken).not.toBe(tokens.refreshToken)

    // Replay of the rotated-out token must fail.
    await expect(backend.refreshSession(tokens.refreshToken)).resolves.toBeNull()
    // The new token still works.
    await expect(backend.refreshSession(refreshed!.refreshToken)).resolves.not.toBeNull()
  })

  it("revokes sessions on logout", async () => {
    const tokens = await signUpAndIn()
    await backend.revokeSession(tokens.refreshToken)
    await expect(backend.refreshSession(tokens.refreshToken)).resolves.toBeNull()
  })

  it("revokes all sessions on password reset", async () => {
    const tokens = await signUpAndIn()
    const user = await backend.getUserByEmail("researcher@lab.edu")
    await backend.revokeAllSessions(user!.id)
    await expect(backend.refreshSession(tokens.refreshToken)).resolves.toBeNull()
  })

  it("access tokens verify through the codec with the right purpose", async () => {
    const tokens = await signUpAndIn()
    const payload = verifyAuthToken(tokens.accessToken, "access")
    expect(payload?.uid).toBe(tokens.session.user.id)
    expect(payload?.sid).toBe(tokens.session.sessionId)
    // Purpose confusion must fail.
    expect(verifyAuthToken(tokens.accessToken, "totp-challenge")).toBeNull()
  })

  it("issues, consumes once, and expires one-time tokens", async () => {
    await backend.signUp({ email: "a@b.co", password: "password123", workspaceName: "One" })
    const user = (await backend.getUserByEmail("a@b.co"))!
    const raw = await backend.issueOneTimeToken({
      kind: "magic",
      email: user.email,
      userId: user.id,
      ttlMs: 60_000,
    })
    const first = await backend.consumeOneTimeToken(raw, "magic")
    expect(first.ok).toBe(true)
    const second = await backend.consumeOneTimeToken(raw, "magic")
    expect(second).toEqual({ ok: false, reason: "used" })
    // Wrong kind is invalid, not usable.
    const resetRaw = await backend.issueOneTimeToken({
      kind: "reset",
      email: user.email,
      userId: user.id,
      ttlMs: 60_000,
    })
    expect(await backend.consumeOneTimeToken(resetRaw, "magic")).toEqual({
      ok: false,
      reason: "invalid",
    })
  })

  it("reports expired one-time tokens", async () => {
    await backend.signUp({ email: "a@b.co", password: "password123", workspaceName: "One" })
    const raw = await backend.issueOneTimeToken({
      kind: "reset",
      email: "a@b.co",
      ttlMs: -1, // already expired
    })
    expect(await backend.consumeOneTimeToken(raw, "reset")).toEqual({
      ok: false,
      reason: "expired",
    })
  })

  it("marks email verified", async () => {
    const user = await backend.getUserByEmail("a@b.co")
    void user
    await backend.signUp({ email: "a@b.co", password: "password123", workspaceName: "One" })
    const created = (await backend.getUserByEmail("a@b.co"))!
    await backend.markEmailVerified(created.id)
    expect((await backend.getUserById(created.id))!.emailVerified).toBe(true)
  })

  it("enrolls TOTP, requires a valid code, and honors backup codes", async () => {
    const tokens = await signUpAndIn()
    const userId = tokens.session.user.id

    const enrollment = await backend.startTotpEnrollment(userId)
    expect(enrollment.secret).toMatch(/^[A-Z2-7]{32}$/)
    expect(enrollment.otpauthUrl).toContain("otpauth://totp/")

    // Wrong code cannot confirm.
    await expect(backend.confirmTotpEnrollment(userId, "000000")).resolves.toBeNull()

    const code = await generateTotpCode(enrollment.secret)
    const backupCodes = await backend.confirmTotpEnrollment(userId, code)
    expect(backupCodes).not.toBeNull()
    expect(backupCodes).toHaveLength(8)

    // Sign-in now pauses on the TOTP challenge.
    const challenged = await backend.signIn("researcher@lab.edu", "correct horse")
    expect(challenged.status).toBe("totp_required")
    if (challenged.status !== "totp_required") return

    // Bad code rejected.
    await expect(backend.verifyTotpLogin(challenged.challenge, "000000")).resolves.toBeNull()

    // Backup code works once.
    const viaBackup = await backend.verifyTotpLogin(challenged.challenge, backupCodes![0])
    expect(viaBackup).not.toBeNull()
    // Backup codes are single-use.
    const challenged2 = await backend.signIn("researcher@lab.edu", "correct horse")
    if (challenged2.status !== "totp_required") throw new Error("expected challenge")
    await expect(
      backend.verifyTotpLogin(challenged2.challenge, backupCodes![0]),
    ).resolves.toBeNull()

    // TOTP code completes login.
    const viaCode = await backend.verifyTotpLogin(
      challenged2.challenge,
      await generateTotpCode(enrollment.secret),
    )
    expect(viaCode).not.toBeNull()
  })

  it("disables TOTP only with the correct password", async () => {
    const tokens = await signUpAndIn()
    const userId = tokens.session.user.id
    const enrollment = await backend.startTotpEnrollment(userId)
    await backend.confirmTotpEnrollment(userId, await generateTotpCode(enrollment.secret))
    await expect(backend.disableTotp(userId, "wrong")).resolves.toBe(false)
    await expect(backend.disableTotp(userId, "correct horse")).resolves.toBe(true)
    const result = await backend.signIn("researcher@lab.edu", "correct horse")
    expect(result.status).toBe("ok")
  })

  it("upserts OAuth users idempotently", async () => {
    const first = await backend.upsertOAuthUser({
      email: "oauth@lab.edu",
      name: "OAuth User",
      provider: "github",
    })
    expect(first.created).toBe(true)
    const second = await backend.upsertOAuthUser({
      email: "OAUTH@lab.edu",
      provider: "github",
    })
    expect(second.created).toBe(false)
    expect(second.user.id).toBe(first.user.id)
    expect(second.user.emailVerified).toBe(true)
  })

  it("records workspace memberships and switches the session workspace on join", async () => {
    const { workspace } = await backend.signUp({
      email: "owner@acme.dev",
      password: "password123",
      workspaceName: "Acme Research",
    })

    // Invitee: OAuth-provisioned account starts in its own personal workspace.
    const { user: invitee } = await backend.upsertOAuthUser({
      email: "invitee@acme.dev",
      provider: "invitation",
    })
    const before = await backend.getSessionContext(invitee.id)
    expect(before?.workspace?.name).toBe("Personal workspace")

    // Joining records the invited role and repoints session resolution.
    const membership = await backend.addWorkspaceMember({
      userId: invitee.id,
      workspace,
      role: "admin",
    })
    expect(membership).toEqual({ workspace, role: "admin" })

    const memberships = await backend.listWorkspaceMemberships(invitee.id)
    expect(memberships).toContainEqual({ workspace, role: "admin" })
    expect(memberships).toContainEqual(
      expect.objectContaining({
        workspace: expect.objectContaining({ name: "Personal workspace" }),
        role: "owner",
      }),
    )

    const context = await backend.getSessionContext(invitee.id)
    expect(context?.workspace).toMatchObject({ id: workspace.id, name: "Acme Research" })

    // A session issued after the join carries the joined workspace.
    const tokens = await backend.createSessionForUser(invitee.id)
    expect(tokens.session.workspace).toMatchObject({ id: workspace.id })
  })

  it("removeWorkspaceMember rolls back a join and falls back to the home workspace", async () => {
    const { workspace } = await backend.signUp({
      email: "owner@acme.dev",
      password: "password123",
      workspaceName: "Acme Research",
    })
    const { user: invitee } = await backend.upsertOAuthUser({
      email: "invitee@acme.dev",
      provider: "invitation",
    })
    await backend.addWorkspaceMember({ userId: invitee.id, workspace, role: "member" })

    await backend.removeWorkspaceMember(invitee.id, workspace.id)
    const memberships = await backend.listWorkspaceMemberships(invitee.id)
    expect(memberships).toHaveLength(1)
    expect(memberships[0].workspace.name).toBe("Personal workspace")
    expect((await backend.getSessionContext(invitee.id))?.workspace?.name).toBe(
      "Personal workspace",
    )

    // Removing a non-membership is a no-op.
    await expect(backend.removeWorkspaceMember(invitee.id, "ws_missing")).resolves.toBeUndefined()
  })

  it("addWorkspaceMember rejects unknown users", async () => {
    await expect(
      backend.addWorkspaceMember({
        userId: "missing",
        workspace: { id: "ws_x", name: "X", slug: "x" },
        role: "member",
      }),
    ).rejects.toBeInstanceOf(AuthBackendError)
  })

  it("setPassword enables later password sign-in", async () => {
    const { user } = await backend.upsertOAuthUser({ email: "oauth@lab.edu", provider: "github" })
    await expect(backend.signIn("oauth@lab.edu", "anything")).resolves.toEqual({
      status: "invalid",
    })
    await backend.setPassword(user.id, "new-password1")
    const result = await backend.signIn("oauth@lab.edu", "new-password1")
    expect(result.status).toBe("ok")
  })

  it("throws AuthBackendError for unknown user operations", async () => {
    await expect(backend.startTotpEnrollment("missing")).rejects.toBeInstanceOf(AuthBackendError)
  })
})
