"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { FlaskConical } from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

/**
 * User "Beta programs" screen for `/app/beta`: lists the open beta programs
 * the caller can join plus any closed programs they are already enrolled in
 * (so they can leave), backed by `GET /api/beta`, with an Enroll/Unenroll
 * toggle posting to `POST /api/beta/[id]/enroll`. Enrolled programs carry a
 * "beta" badge — the opt-in surface described by the beta-access feature.
 *
 * Enrollment state is per-user and stored in the in-memory dev seam
 * (`src/lib/beta-access.ts`).
 */

const BETA_API = "/api/beta"

export interface BetaProgramRow {
  id: string
  name: string
  description: string
  status: "open" | "closed"
  enrolledCount: number
  createdAt: string
  enrolled: boolean
}

interface BetaListResponse {
  ok: boolean
  programs?: BetaProgramRow[]
  message?: string
}

interface EnrollResponse {
  ok: boolean
  enrolled?: boolean
  message?: string
}

export function BetaScreen() {
  const [programs, setPrograms] = useState<BetaProgramRow[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const seq = useRef(0)

  const load = useCallback(async () => {
    const current = ++seq.current
    setPrograms(null)
    setListError(null)
    try {
      const response = await fetch(BETA_API, { cache: "no-store" })
      const data = (await response.json()) as BetaListResponse
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

  const toggle = useCallback(async (program: BetaProgramRow) => {
    const next = !program.enrolled
    setPendingId(program.id)
    setActionError(null)
    // Optimistic update; rolled back on failure.
    setPrograms(
      (rows) =>
        rows?.map((row) =>
          row.id === program.id
            ? {
                ...row,
                enrolled: next,
                enrolledCount: row.enrolledCount + (next ? 1 : -1),
              }
            : row,
        ) ?? rows,
    )
    try {
      const response = await fetch(`${BETA_API}/${program.id}/enroll`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enrolled: next }),
      })
      const data = (await response.json()) as EnrollResponse
      if (!response.ok || !data.ok) {
        throw new Error(data.message ?? "Could not update enrollment.")
      }
      setPrograms(
        (rows) =>
          rows?.map((row) =>
            row.id === program.id ? { ...row, enrolled: data.enrolled ?? next } : row,
          ) ?? rows,
      )
    } catch (error) {
      setPrograms(
        (rows) =>
          rows?.map((row) =>
            row.id === program.id
              ? {
                  ...row,
                  enrolled: program.enrolled,
                  enrolledCount: program.enrolledCount,
                }
              : row,
          ) ?? rows,
      )
      setActionError(
        error instanceof Error ? error.message : "Could not update enrollment. Try again.",
      )
    } finally {
      setPendingId(null)
    }
  }, [])

  const loading = programs === null && listError === null
  const empty = programs !== null && programs.length === 0

  return (
    <section className="app-panel" aria-labelledby="beta-programs-heading">
      <div className="app-panel-head">
        <div>
          <h2 id="beta-programs-heading">Beta programs</h2>
          <p>
            Opt in to try features before they ship. Enrolled programs show a{" "}
            <Badge variant="secondary" size="sm">
              beta
            </Badge>{" "}
            badge wherever they appear.
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

      {actionError ? <InlineError title="Enrollment update failed" message={actionError} /> : null}

      {loading ? (
        <LoadingPanel label="Loading beta programs" variant="table" />
      ) : empty ? (
        <EmptyState
          icon={<FlaskConical aria-hidden="true" />}
          title="No beta programs right now"
          body="When admins open a beta program it will appear here so you can opt in."
        />
      ) : listError ? null : (
        <ul className="flex flex-col gap-3">
          {(programs ?? []).map((program) => (
            <li
              key={program.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-4"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{program.name}</span>
                  <Badge variant="secondary" size="sm">
                    beta
                  </Badge>
                  <Badge variant="outline" size="sm">
                    {program.status}
                  </Badge>
                </div>
                {program.description ? (
                  <p className="text-muted-foreground text-sm">{program.description}</p>
                ) : null}
                <p className="text-muted-foreground text-xs">
                  {program.enrolledCount}{" "}
                  {program.enrolledCount === 1 ? "participant" : "participants"}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant={program.enrolled ? "outline" : "default"}
                disabled={
                  pendingId === program.id ||
                  // Closed programs only reach this list when the caller is
                  // enrolled, so the only allowed action is leaving.
                  (program.status === "closed" && !program.enrolled)
                }
                onClick={() => void toggle(program)}
              >
                {pendingId === program.id
                  ? "Updating…"
                  : program.enrolled
                    ? "Unenrolled — leave"
                    : "Enroll"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
