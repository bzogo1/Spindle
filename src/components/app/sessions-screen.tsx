"use client"

import { useCallback, useEffect, useState } from "react"
import { MonitorSmartphone } from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { RevokeAllSessionsButton } from "@/components/app/revoke-all-sessions-button"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { ActiveSessionInfo } from "@/lib/auth/backend"

/**
 * "Sessions" screen for `/app/sessions`: lists the signed-in user's active
 * sessions (devices where they're currently signed in) from
 * `GET /api/auth/sessions`, marks the session that belongs to this browser,
 * and offers "Sign out everywhere" via `RevokeAllSessionsButton`.
 *
 * Per-session revocation is NOT available: `AuthBackend.revokeSession`
 * takes the session's refresh token, which is never exposed to clients, so
 * the only revocation surface is `POST /api/auth/sessions/revoke-all`.
 * User agents and last-used timestamps are likewise not stored on sessions
 * yet (see prisma/AUTH-SCHEMA.md), so rows show only id/created/expires.
 */

const SESSIONS_API = "/api/auth/sessions"

interface SessionsResponse {
  ok: boolean
  sessions?: ActiveSessionInfo[]
  currentSessionId?: string
  supported?: boolean
  message?: string
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

/** Short, stable label for a session id (full id stays in the title attr). */
function sessionLabel(id: string): string {
  return `Session ${id.slice(0, 8)}`
}

export function SessionsScreen() {
  const [sessions, setSessions] = useState<ActiveSessionInfo[] | null>(null)
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [supported, setSupported] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const response = await fetch(SESSIONS_API, { cache: "no-store" })
      const data = (await response.json()) as SessionsResponse
      if (!response.ok || !data.ok) {
        setError(data.message ?? "Could not load your sessions.")
        setSessions([])
        return
      }
      setSupported(data.supported !== false)
      setSessions(data.sessions ?? [])
      setCurrentSessionId(data.currentSessionId ?? null)
    } catch {
      setError("Could not load your sessions. Check your connection and try again.")
      setSessions([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const loading = sessions === null && error === null
  const empty = sessions !== null && sessions.length === 0

  return (
    <section className="app-panel" aria-labelledby="sessions-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="sessions-heading">Active sessions</h2>
          <p>
            Devices where your account is currently signed in, newest first. If you don&apos;t
            recognize a session, sign out everywhere and change your password.
          </p>
        </div>
        <div className="app-panel-head-actions">
          <RevokeAllSessionsButton size="sm" />
        </div>
      </div>

      {error ? (
        <InlineError
          title="Sessions unavailable"
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

      {loading ? (
        <LoadingPanel label="Loading sessions" variant="table" />
      ) : !supported ? (
        <EmptyState
          icon={<MonitorSmartphone aria-hidden="true" />}
          title="Session listing unavailable"
          body="Your auth backend does not support listing active sessions yet. You can still sign out everywhere to revoke all sessions."
        />
      ) : empty ? (
        <EmptyState
          icon={<MonitorSmartphone aria-hidden="true" />}
          title="No active sessions"
          body="Sessions appear here while you are signed in on a device."
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Session</TableHead>
                <TableHead>Signed in</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions?.map((session) => {
                const isCurrent = session.id === currentSessionId
                return (
                  <TableRow key={session.id} data-current={isCurrent || undefined}>
                    <TableCell>
                      <span className="font-medium" title={session.id}>
                        {sessionLabel(session.id)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <time dateTime={session.createdAt}>{formatTimestamp(session.createdAt)}</time>
                    </TableCell>
                    <TableCell>
                      <time dateTime={session.expiresAt}>{formatTimestamp(session.expiresAt)}</time>
                    </TableCell>
                    <TableCell>
                      {isCurrent ? (
                        <Badge variant="secondary" size="sm">
                          This device
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">Other device</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <p className="app-field-hint">
            Sessions can&apos;t be revoked individually yet — device names and last-active times
            aren&apos;t recorded. Use &quot;Sign out everywhere&quot; to revoke all sessions at
            once.
          </p>
        </>
      )}
    </section>
  )
}
