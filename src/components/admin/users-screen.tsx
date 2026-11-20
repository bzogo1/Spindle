"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Search, Users } from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

/**
 * Admin "Users" screen for `/app/admin/users`: a searchable, keyset-paginated
 * directory backed by `GET /api/admin/users` (Prisma `User` rows — id, email,
 * name, createdAt, updatedAt — plus a computed `admin` flag).
 *
 * There are no status/role/ban columns in the schema yet, so the table shows
 * exactly what the backend persists; per-user actions live on the detail
 * screen (`/app/admin/users/[id]`) and the sibling impersonation section.
 */

const USERS_API = "/api/admin/users"
const PAGE_SIZE = 50
const SEARCH_DEBOUNCE_MS = 300

export interface AdminUserRow {
  id: string
  email: string
  name: string | null
  createdAt: string
  updatedAt: string
  admin: boolean
}

interface UsersResponse {
  ok: boolean
  users?: AdminUserRow[]
  nextCursor?: string | null
  message?: string
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, { dateStyle: "medium" })
}

export function UsersScreen() {
  const [users, setUsers] = useState<AdminUserRow[] | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const requestSeq = useRef(0)

  // Debounce the search box so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  const load = useCallback(async (search: string, cursor: string | null, append: boolean) => {
    const seq = ++requestSeq.current
    if (append) setLoadingMore(true)
    else {
      setUsers(null)
      setError(null)
    }
    try {
      const params = new URLSearchParams({ size: String(PAGE_SIZE) })
      if (search) params.set("q", search)
      if (cursor) params.set("cursor", cursor)
      const response = await fetch(`${USERS_API}?${params.toString()}`, {
        cache: "no-store",
      })
      const data = (await response.json()) as UsersResponse
      if (seq !== requestSeq.current) return // a newer request superseded this one
      if (!response.ok || !data.ok) {
        setError(data.message ?? "Could not load users.")
        if (!append) setUsers([])
        return
      }
      const page = data.users ?? []
      setUsers((prev) => (append && prev ? [...prev, ...page] : page))
      setNextCursor(data.nextCursor ?? null)
    } catch {
      if (seq !== requestSeq.current) return
      setError("Could not load users. Check your connection and try again.")
      if (!append) setUsers([])
    } finally {
      if (seq === requestSeq.current) setLoadingMore(false)
    }
  }, [])

  // Reload the first page whenever the debounced query changes.
  useEffect(() => {
    void load(debouncedQuery, null, false)
  }, [debouncedQuery, load])

  const loading = users === null && error === null

  return (
    <section className="app-panel" aria-labelledby="admin-users-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="admin-users-heading">User directory</h2>
          <p>Registered accounts, newest first. Search by email or name; open a row for details.</p>
        </div>
        <div className="app-panel-head-actions">
          <form
            role="search"
            onSubmit={(event) => {
              event.preventDefault()
              setDebouncedQuery(query.trim())
            }}
          >
            <div className="relative">
              <Search
                aria-hidden="true"
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
              />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search email or name"
                aria-label="Search users"
                className="w-64 pl-8"
              />
            </div>
          </form>
        </div>
      </div>

      {error ? (
        <InlineError
          title="Users unavailable"
          message={
            <span className="flex flex-wrap items-center gap-2">
              <span>{error}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void load(debouncedQuery, null, false)}
              >
                Retry
              </Button>
            </span>
          }
        />
      ) : null}

      {loading ? (
        <LoadingPanel label="Loading users" variant="table" />
      ) : users !== null && users.length > 0 ? (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Badges</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(users ?? []).map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <Link
                      href={`/app/admin/users/${encodeURIComponent(user.id)}`}
                      className="text-foreground font-medium underline-offset-4 hover:underline"
                    >
                      {user.email}
                    </Link>
                  </TableCell>
                  <TableCell>{user.name ?? "—"}</TableCell>
                  <TableCell>{formatDate(user.createdAt)}</TableCell>
                  <TableCell>
                    {user.admin ? <Badge variant="secondary">Admin</Badge> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {nextCursor ? (
            <div className="mt-4 flex justify-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loadingMore}
                onClick={() => void load(debouncedQuery, nextCursor, true)}
              >
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          ) : null}
        </>
      ) : error ? null : (
        // Suppress the empty state when the load failed — the InlineError
        // above already explains why there is no data (matches
        // login-history-screen).
        <EmptyState
          icon={<Users aria-hidden="true" />}
          title={debouncedQuery ? "No matching users" : "No users yet"}
          body={
            debouncedQuery
              ? `Nothing matches "${debouncedQuery}". Try a different search.`
              : "Registered accounts will appear here."
          }
        />
      )}
    </section>
  )
}
