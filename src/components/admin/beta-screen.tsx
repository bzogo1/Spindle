"use client"

import { Fragment, useCallback, useEffect, useRef, useState } from "react"
import { FlaskConical, Plus } from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

/**
 * Admin "Beta programs" screen for `/app/admin/beta`: program list backed by
 * `GET /api/admin/beta`, a create form (`POST`), and per-program management —
 * open/close (`PATCH { status }`) plus enroll/unenroll by user id or email
 * (`PATCH { action, userId|email }`, enrollments listed via
 * `GET /api/admin/beta/[id]`). All endpoints are admin-only; the store is
 * the in-memory dev seam in `src/lib/beta-access.ts`.
 */

const BETA_API = "/api/admin/beta"
const NAME_MAX = 120
const DESCRIPTION_MAX = 2000

export interface BetaProgramRow {
  id: string
  name: string
  description: string
  status: "open" | "closed"
  enrolledCount: number
  createdAt: string
}

interface ProgramsResponse {
  ok: boolean
  programs?: BetaProgramRow[]
  program?: BetaProgramRow
  enrollments?: string[]
  message?: string
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, { dateStyle: "medium" })
}

function statusBadgeVariant(status: "open" | "closed") {
  return status === "open" ? ("secondary" as const) : ("outline" as const)
}

/** Detail panel state for the expanded program. */
interface ProgramDetail {
  enrollments: string[] | null
  error: string | null
  identifier: string
  busy: boolean
  notice: string | null
}

export function BetaAdminScreen() {
  const [programs, setPrograms] = useState<BetaProgramRow[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const seq = useRef(0)

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createNotice, setCreateNotice] = useState<string | null>(null)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, ProgramDetail>>({})
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const current = ++seq.current
    setPrograms(null)
    setListError(null)
    try {
      const response = await fetch(BETA_API, { cache: "no-store" })
      const data = (await response.json()) as ProgramsResponse
      if (current !== seq.current) return
      if (!response.ok || !data.ok) {
        setListError(data.message ?? "Could not load beta programs.")
        setPrograms([])
        return
      }
      setPrograms(data.programs ?? [])
    } catch {
      if (current !== seq.current) return
      setListError("Could not load beta programs. Check your connection and try again.")
      setPrograms([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  const create = useCallback(async () => {
    setCreating(true)
    setCreateError(null)
    setCreateNotice(null)
    try {
      const response = await fetch(BETA_API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
        }),
      })
      const data = (await response.json()) as ProgramsResponse
      if (!response.ok || !data.ok) {
        setCreateError(data.message ?? "Could not create the beta program.")
        return
      }
      setName("")
      setDescription("")
      setCreateNotice("Beta program created.")
      setReloadKey((key) => key + 1)
    } catch {
      setCreateError("Could not create the beta program. Check your connection and try again.")
    } finally {
      setCreating(false)
    }
  }, [name, description])

  const patchProgram = useCallback(
    async (programId: string, body: Record<string, unknown>): Promise<ProgramsResponse | null> => {
      const response = await fetch(`${BETA_API}/${programId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = (await response.json()) as ProgramsResponse
      if (!response.ok || !data.ok) {
        throw new Error(data.message ?? "Request failed.")
      }
      return data
    },
    [],
  )

  const toggleStatus = useCallback(
    async (program: BetaProgramRow) => {
      const next = program.status === "open" ? "closed" : "open"
      setStatusBusyId(program.id)
      setStatusError(null)
      try {
        const data = await patchProgram(program.id, { status: next })
        if (data?.program) {
          setPrograms(
            (rows) =>
              rows?.map((row) => (row.id === program.id ? { ...row, ...data.program } : row)) ??
              rows,
          )
        }
      } catch (error) {
        setStatusError(
          error instanceof Error ? error.message : "Could not update the program status.",
        )
      } finally {
        setStatusBusyId(null)
      }
    },
    [patchProgram],
  )

  const loadDetail = useCallback(async (programId: string) => {
    setDetails((current) => ({
      ...current,
      [programId]: {
        enrollments: current[programId]?.enrollments ?? null,
        error: null,
        identifier: current[programId]?.identifier ?? "",
        busy: current[programId]?.busy ?? false,
        notice: null,
      },
    }))
    try {
      const response = await fetch(`${BETA_API}/${programId}`, { cache: "no-store" })
      const data = (await response.json()) as ProgramsResponse
      if (!response.ok || !data.ok) {
        throw new Error(data.message ?? "Could not load enrollments.")
      }
      setDetails((current) => ({
        ...current,
        [programId]: {
          enrollments: data.enrollments ?? [],
          error: null,
          identifier: current[programId]?.identifier ?? "",
          busy: current[programId]?.busy ?? false,
          notice: null,
        },
      }))
    } catch (error) {
      setDetails((current) => ({
        ...current,
        [programId]: {
          enrollments: current[programId]?.enrollments ?? null,
          error: error instanceof Error ? error.message : "Could not load enrollments.",
          identifier: current[programId]?.identifier ?? "",
          busy: current[programId]?.busy ?? false,
          notice: null,
        },
      }))
    }
  }, [])

  const toggleExpanded = useCallback(
    (programId: string) => {
      setExpandedId((current) => {
        const next = current === programId ? null : programId
        if (next !== null && !details[next]) {
          void loadDetail(next)
        }
        return next
      })
    },
    [details, loadDetail],
  )

  const setDetail = useCallback((programId: string, patch: Partial<ProgramDetail>) => {
    setDetails((current) => {
      const base: ProgramDetail = current[programId] ?? {
        enrollments: null,
        error: null,
        identifier: "",
        busy: false,
        notice: null,
      }
      return { ...current, [programId]: { ...base, ...patch } }
    })
  }, [])

  const runMembershipAction = useCallback(
    async (program: BetaProgramRow, action: "enroll" | "unenroll", userId?: string) => {
      const detail = details[program.id]
      const identifier = (userId ?? detail?.identifier ?? "").trim()
      if (!identifier) return
      setDetail(program.id, { busy: true, notice: null, error: null })
      try {
        // `user:`/`mock:` principals are sent verbatim as userId even when
        // they contain "@"; anything else with "@" is treated as an email.
        const isPrincipal = /^(user|mock):/.test(identifier)
        const isEmail = !isPrincipal && identifier.includes("@")
        const data = await patchProgram(program.id, {
          action,
          ...(isEmail ? { email: identifier } : { userId: identifier }),
        })
        if (data?.program) {
          setPrograms(
            (rows) =>
              rows?.map((row) => (row.id === program.id ? { ...row, ...data.program } : row)) ??
              rows,
          )
        }
        setDetail(program.id, {
          busy: false,
          identifier: "",
          notice: action === "enroll" ? "User enrolled." : "User unenrolled.",
        })
        await loadDetail(program.id)
      } catch (error) {
        setDetail(program.id, {
          busy: false,
          error: error instanceof Error ? error.message : "Enrollment action failed.",
        })
      }
    },
    [details, loadDetail, patchProgram, setDetail],
  )

  const canSubmit = name.trim().length > 0 && !creating

  const loading = programs === null && listError === null
  const empty = programs !== null && programs.length === 0

  return (
    <div className="flex flex-col gap-6">
      <section className="app-panel" aria-labelledby="admin-beta-list-heading">
        <div className="app-panel-head">
          <div>
            <h2 id="admin-beta-list-heading">Beta programs</h2>
            <p>
              Programs users can opt in to from <code>/app/beta</code>. Closing a program stops new
              self-service sign-ups; existing enrollees stay enrolled. Enrollment is stored in
              memory (dev seam).
            </p>
          </div>
        </div>

        {listError ? (
          <InlineError
            title="Beta programs unavailable"
            message={
              <span className="flex flex-wrap items-center gap-2">
                <span>{listError}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setReloadKey((key) => key + 1)}
                >
                  Retry
                </Button>
              </span>
            }
          />
        ) : null}
        {statusError ? <InlineError title="Status update failed" message={statusError} /> : null}

        {loading ? (
          <LoadingPanel label="Loading beta programs" variant="table" />
        ) : empty ? (
          <EmptyState
            icon={<FlaskConical aria-hidden="true" />}
            title="No beta programs yet"
            body="Create your first beta program with the form below."
          />
        ) : listError ? null : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Enrolled</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(programs ?? []).map((program) => {
                const detail = details[program.id]
                const expanded = expandedId === program.id
                return (
                  <Fragment key={program.id}>
                    <TableRow>
                      <TableCell className="font-medium">
                        <div className="flex flex-col">
                          <span>{program.name}</span>
                          {program.description ? (
                            <span className="text-muted-foreground max-w-md truncate text-xs font-normal">
                              {program.description}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(program.status)}>{program.status}</Badge>
                      </TableCell>
                      <TableCell>{program.enrolledCount}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatDate(program.createdAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={statusBusyId === program.id}
                            onClick={() => void toggleStatus(program)}
                          >
                            {program.status === "open" ? "Close" : "Open"}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleExpanded(program.id)}
                          >
                            {expanded ? "Hide" : "Manage"}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {expanded ? (
                      <TableRow>
                        <TableCell colSpan={5}>
                          <ProgramDetailPanel
                            program={program}
                            detail={detail}
                            onIdentifierChange={(value) =>
                              setDetail(program.id, { identifier: value })
                            }
                            onEnroll={() => void runMembershipAction(program, "enroll")}
                            onUnenroll={(userId) =>
                              void runMembershipAction(program, "unenroll", userId)
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="app-panel" aria-labelledby="admin-beta-create-heading">
        <div className="app-panel-head">
          <div>
            <h2 id="admin-beta-create-heading">New beta program</h2>
            <p>
              New programs start <strong>open</strong> — users can self-enroll from{" "}
              <code>/app/beta</code> until you close them.
            </p>
          </div>
        </div>

        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (!canSubmit) return
            void create()
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="beta-program-name" className="text-muted-foreground text-xs">
              Name
            </label>
            <Input
              id="beta-program-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Program name"
              maxLength={NAME_MAX}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="beta-program-description" className="text-muted-foreground text-xs">
              Description
            </label>
            <Textarea
              id="beta-program-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What are users testing? (plain text)"
              rows={3}
              maxLength={DESCRIPTION_MAX}
              showCount
            />
          </div>

          {createError ? <p className="text-destructive text-sm">{createError}</p> : null}
          {createNotice ? <p className="text-muted-foreground text-sm">{createNotice}</p> : null}
          <div>
            <Button type="submit" size="sm" disabled={!canSubmit}>
              <Plus aria-hidden="true" className="size-4" />
              {creating ? "Creating…" : "Create program"}
            </Button>
          </div>
        </form>
      </section>
    </div>
  )
}

function ProgramDetailPanel({
  program,
  detail,
  onIdentifierChange,
  onEnroll,
  onUnenroll,
}: {
  program: BetaProgramRow
  detail: ProgramDetail | undefined
  onIdentifierChange: (value: string) => void
  onEnroll: () => void
  onUnenroll: (userId: string) => void
}) {
  const enrollments = detail?.enrollments ?? null
  const busy = detail?.busy ?? false
  const identifier = detail?.identifier ?? ""

  return (
    <div className="flex flex-col gap-3 py-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-56 flex-1 flex-col gap-1">
          <label htmlFor={`beta-enroll-${program.id}`} className="text-muted-foreground text-xs">
            Enroll by user ID or email
          </label>
          <Input
            id={`beta-enroll-${program.id}`}
            value={identifier}
            onChange={(event) => onIdentifierChange(event.target.value)}
            placeholder="user:<id>, mock:<email>, or name@example.com"
            disabled={busy}
          />
          <p className="text-muted-foreground text-xs">
            Email lookups resolve real accounts to <code>user:&lt;id&gt;</code>; with mock auth
            enabled, unmatched emails enroll the <code>mock:&lt;email&gt;</code> principal.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          disabled={busy || identifier.trim().length === 0}
          onClick={onEnroll}
        >
          Enroll
        </Button>
      </div>

      {detail?.error ? <p className="text-destructive text-sm">{detail.error}</p> : null}
      {detail?.notice ? <p className="text-muted-foreground text-sm">{detail.notice}</p> : null}

      {enrollments === null ? (
        <LoadingPanel label="Loading enrollments" variant="table" />
      ) : enrollments.length === 0 ? (
        <p className="text-muted-foreground text-sm">No users enrolled yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {enrollments.map((userId) => (
            <li key={userId} className="flex items-center justify-between gap-2 text-sm">
              <code className="truncate">{userId}</code>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => onUnenroll(userId)}
              >
                Unenroll
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
