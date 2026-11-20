"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, VenetianMask } from "lucide-react"

import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { AdminUserRow } from "@/components/admin/users-screen"

/**
 * Admin user detail for `/app/admin/users/[id]`: renders the directory record
 * from `GET /api/admin/users/[id]` and offers the only mutation the backend
 * supports today — editing the user's display `name` via PATCH.
 *
 * Auth-backend enrichment (emailVerified, 2FA, session count, workspace
 * memberships) is shown when the id resolves in the auth store; it usually
 * does not because Prisma ids and dev auth-backend ids are independent.
 *
 * Suspend/delete/role/session-revocation are NOT possible yet — there is no
 * status column on `User` and `AuthBackend` mutations key on its own ids
 * (see the route's doc comment and prisma/AUTH-SCHEMA.md).
 */

interface AuthEnrichment {
  authUserId: string
  emailVerified: boolean
  totpEnabled: boolean
  activeSessionCount: number
  memberships: { workspace: string; role: string }[]
}

interface UserDetailResponse {
  ok: boolean
  user?: AdminUserRow
  auth?: AuthEnrichment | null
  message?: string
}

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

export function AdminUserDetail({ userId }: { userId: string }) {
  const [user, setUser] = useState<AdminUserRow | null>(null)
  const [auth, setAuth] = useState<AuthEnrichment | null>(null)
  const [authResolved, setAuthResolved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [nameDraft, setNameDraft] = useState("")
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
        cache: "no-store",
      })
      const data = (await response.json()) as UserDetailResponse
      if (response.status === 404) {
        setNotFound(true)
        setUser(null)
        return
      }
      if (!response.ok || !data.ok || !data.user) {
        setError(data.message ?? "Could not load this user.")
        setUser(null)
        return
      }
      setNotFound(false)
      setUser(data.user)
      setAuth(data.auth ?? null)
      setAuthResolved(true)
      setNameDraft(data.user.name ?? "")
    } catch {
      setError("Could not load this user. Check your connection and try again.")
      setUser(null)
    }
  }, [userId])

  useEffect(() => {
    void load()
  }, [load])

  const saveName = useCallback(async () => {
    if (!user) return
    const trimmed = nameDraft.trim()
    setSaving(true)
    setSaveMessage(null)
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed === "" ? null : trimmed }),
      })
      const data = (await response.json()) as UserDetailResponse
      if (!response.ok || !data.ok || !data.user) {
        setSaveMessage(data.message ?? "Could not save the name.")
        return
      }
      setUser(data.user)
      setNameDraft(data.user.name ?? "")
      setSaveMessage("Name updated.")
    } catch {
      setSaveMessage("Could not save the name. Check your connection and try again.")
    } finally {
      setSaving(false)
    }
  }, [user, userId, nameDraft])

  const loading = user === null && error === null && !notFound

  return (
    <section className="app-panel" aria-labelledby="admin-user-detail-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="admin-user-detail-heading">User details</h2>
          <p>
            <Link
              href="/app/admin/users"
              className="text-muted-foreground inline-flex items-center gap-1 underline-offset-4 hover:underline"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              Back to user directory
            </Link>
          </p>
        </div>
      </div>

      {error ? (
        <InlineError
          title="User unavailable"
          message={
            <span className="flex flex-wrap items-center gap-2">
              <span>{error}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                Retry
              </Button>
            </span>
          }
        />
      ) : null}

      {notFound ? (
        <InlineError
          title="User not found"
          message="This account does not exist in the directory."
        />
      ) : null}

      {loading ? <LoadingPanel label="Loading user" variant="table" /> : null}

      {user ? (
        <div className="grid gap-6">
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground text-sm">Email</dt>
              <dd className="font-medium">{user.email}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">Badges</dt>
              <dd>{user.admin ? <Badge variant="secondary">Admin</Badge> : <span>—</span>}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">Created</dt>
              <dd>{formatDateTime(user.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">Updated</dt>
              <dd>{formatDateTime(user.updatedAt)}</dd>
            </div>
          </dl>

          <form
            className="grid max-w-md gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void saveName()
            }}
          >
            <Label htmlFor="admin-user-name">Display name</Label>
            <div className="flex gap-2">
              <Input
                id="admin-user-name"
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                maxLength={120}
                placeholder="No name set"
              />
              <Button type="submit" size="sm" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
            <p className="text-muted-foreground text-sm">
              Leave empty to clear the name. This is the only editable field — the schema has no
              status, role, or suspension columns yet.
            </p>
            {saveMessage ? (
              <p className="text-muted-foreground text-sm" role="status">
                {saveMessage}
              </p>
            ) : null}
          </form>

          {authResolved ? (
            <div className="grid gap-3">
              <h3 className="text-sm font-medium">Auth account</h3>
              {auth ? (
                <dl className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground text-sm">Email verified</dt>
                    <dd>{auth.emailVerified ? "Yes" : "No"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-sm">Two-factor</dt>
                    <dd>{auth.totpEnabled ? "Enabled" : "Disabled"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-sm">Active sessions</dt>
                    <dd>{auth.activeSessionCount}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-sm">Workspaces</dt>
                    <dd>
                      {auth.memberships.length === 0
                        ? "—"
                        : auth.memberships.map((m) => `${m.workspace} (${m.role})`).join(", ")}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="text-muted-foreground text-sm">
                  No matching auth-backend account — directory and auth user ids are independent
                  stores, so this record may belong to a different system.
                </p>
              )}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button asChild variant="outline" size="sm">
              <Link href="/app/admin/impersonation">
                <VenetianMask aria-hidden="true" />
                Open in impersonation
              </Link>
            </Button>
            <p className="text-muted-foreground text-sm">
              Suspend, delete, role changes, and session revocation are not supported by the backend
              yet.
            </p>
          </div>
        </div>
      ) : null}
    </section>
  )
}
