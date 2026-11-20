"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { Check, Play, SearchCheck } from "lucide-react"

import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/toast"
import type {
  DirectorySyncOutcome,
  DirectorySyncPlan,
  DirectorySyncRecord,
} from "@/lib/directory-sync"

/**
 * Directory sync screen for `/app/workspaces/[id]/directory`.
 *
 * Owners/admins paste a JSON array of directory users, preview the diff
 * (`dryRun` POST), then apply it. The plan — adds, updates, removals,
 * errors — is rendered verbatim from the server so what you see is exactly
 * what will run. Members see the layout read-only with an explanatory note,
 * mirroring the settings screen.
 */

const MAX_USERS = 500

interface WorkspacePayload {
  id: string
  name: string
  slug: string
}

interface WorkspaceInfoResponse {
  ok: boolean
  workspace?: WorkspacePayload
  role?: string
  message?: string
}

interface SyncResponse {
  ok: boolean
  plan?: DirectorySyncPlan
  result?: DirectorySyncRecord | null
  message?: string
}

interface LastSyncResponse {
  ok: boolean
  result?: DirectorySyncRecord | null
  message?: string
}

function parseExport(raw: string): { users: unknown[] } | { error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { error: "The pasted text is not valid JSON." }
  }
  const users = Array.isArray(parsed) ? parsed : (parsed as { users?: unknown[] })?.users
  if (!Array.isArray(users)) {
    return { error: "Expected a JSON array of users (or an object with a `users` array)." }
  }
  if (users.length > MAX_USERS) {
    return { error: `Directory export is limited to ${MAX_USERS} users.` }
  }
  return { users }
}

function PlanSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </div>
  )
}

function PlanList({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm">{empty}</p>
  }
  return (
    <ul className="grid gap-1 text-sm">
      {items.map((item) => (
        <li key={item} className="font-mono text-xs">
          {item}
        </li>
      ))}
    </ul>
  )
}

export function DirectorySyncScreen({ workspaceId }: { workspaceId: string }) {
  const { toast } = useToast()
  const [role, setRole] = useState<string | null>(null)
  const [lastSync, setLastSync] = useState<DirectorySyncRecord | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [exportText, setExportText] = useState("")
  const [removeAbsent, setRemoveAbsent] = useState(false)
  const [plan, setPlan] = useState<DirectorySyncPlan | null>(null)
  const [outcome, setOutcome] = useState<DirectorySyncOutcome | null>(null)
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null)
  const [applied, setApplied] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [infoRes, syncRes] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}`, { cache: "no-store" }),
        fetch(`/api/workspaces/${workspaceId}/directory-sync`, { cache: "no-store" }),
      ])
      const info = (await infoRes.json()) as WorkspaceInfoResponse
      if (!infoRes.ok || !info.ok || !info.workspace) {
        setError(info.message ?? "Could not load workspace.")
        return
      }
      setRole(info.role ?? null)
      const sync = (await syncRes.json()) as LastSyncResponse
      if (syncRes.ok && sync.ok) {
        setLastSync(sync.result ?? null)
      }
    } catch {
      setError("Could not load workspace. Check your connection and try again.")
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void load()
  }, [load])

  const canManage = role === "owner" || role === "admin"
  const parsed = exportText.trim() ? parseExport(exportText) : null
  const exportInvalid = parsed !== null && "error" in parsed

  async function postSync(dryRun: boolean) {
    if (!parsed || "error" in parsed || busy || !canManage) return
    setBusy(dryRun ? "preview" : "apply")
    setError(null)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/directory-sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          users: parsed.users,
          dryRun,
          removeAbsent,
        }),
      })
      const data = (await response.json()) as SyncResponse
      if (!response.ok || !data.ok || !data.plan) {
        toast({
          title: dryRun ? "Preview failed" : "Directory sync failed",
          description: data.message ?? "Please try again.",
          variant: "error",
        })
        return
      }
      setPlan(data.plan)
      setOutcome(data.result?.outcome ?? null)
      setApplied(!dryRun)
      if (data.result) setLastSync(data.result)
      if (!dryRun) {
        toast({
          title: "Directory sync applied",
          description: `${data.result?.outcome?.added ?? 0} added, ${data.result?.outcome?.updated ?? 0} updated, ${data.result?.outcome?.removed ?? 0} removed.`,
          variant: "success",
        })
      }
    } catch {
      toast({
        title: dryRun ? "Preview failed" : "Directory sync failed",
        description: "Check your connection and try again.",
        variant: "error",
      })
    } finally {
      setBusy(null)
    }
  }

  const addItems =
    plan?.toAdd.map((u) => `${u.email} → ${u.role}${u.name ? ` (${u.name})` : ""}`) ?? []
  const updateItems =
    plan?.toUpdate.map(
      (u) => `${u.email}: ${u.from.role}/${u.from.name ?? "—"} → ${u.to.role}/${u.to.name ?? "—"}`,
    ) ?? []
  const removeItems = plan?.toRemove.map((r) => r.email) ?? []

  return (
    <section className="app-page-card" aria-labelledby="directory-sync-heading">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="directory-sync-heading">Directory sync</h2>
        {role ? (
          <Badge variant="secondary" size="sm">
            {role}
          </Badge>
        ) : null}
      </div>
      <p className="text-muted-foreground text-sm">
        Paste a JSON array of directory users to preview and apply membership changes. Emails are
        matched case-insensitively; the last workspace owner is never removed or demoted.
      </p>

      {error ? (
        <InlineError
          title="Directory sync unavailable"
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
        <LoadingPanel label="Loading directory sync" variant="table" />
      ) : (
        <>
          {!canManage ? (
            <p className="text-muted-foreground text-sm" role="note">
              Only workspace owners and admins can run a directory sync. You&apos;re a{" "}
              {role ?? "member"} of this workspace, so the controls below are read-only.
            </p>
          ) : null}

          {lastSync ? (
            <p className="text-muted-foreground text-sm" role="status">
              Last sync {lastSync.dryRun ? "preview" : "applied"} at {lastSync.at}
              {lastSync.outcome
                ? ` — ${lastSync.outcome.added} added, ${lastSync.outcome.updated} updated, ${lastSync.outcome.removed} removed`
                : ""}
            </p>
          ) : null}

          <div className="app-field">
            <label htmlFor="directory-export">Directory export (JSON)</label>
            <Textarea
              id="directory-export"
              value={exportText}
              onChange={(event) => {
                setExportText(event.target.value)
                setPlan(null)
                setOutcome(null)
                setApplied(false)
              }}
              placeholder='[{"email":"ada@example.com","name":"Ada","role":"member"}]'
              rows={8}
              className="font-mono text-xs"
              disabled={!canManage}
            />
            <p className="app-field-hint">
              Array of objects with `email` (required), `name`, and `role`
              (`owner`/`admin`/`member`). Up to {MAX_USERS} users.
            </p>
            {exportInvalid ? (
              <p className="text-destructive text-sm" role="alert">
                {parsed.error}
              </p>
            ) : null}
          </div>

          <div className="app-pref-row">
            <div>
              <strong>Remove absent members</strong>
              <small>
                When on, workspace members missing from the export are removed (the last owner is
                always kept).
              </small>
            </div>
            <Checkbox
              checked={removeAbsent}
              onCheckedChange={(checked) => {
                setRemoveAbsent(checked === true)
                setPlan(null)
                setOutcome(null)
                setApplied(false)
              }}
              disabled={!canManage}
              aria-label="Remove absent members"
            />
          </div>

          <div className="app-form-actions">
            <Button
              type="button"
              variant="outline"
              onClick={() => void postSync(true)}
              disabled={!canManage || !parsed || exportInvalid || busy !== null}
            >
              <SearchCheck aria-hidden="true" />
              {busy === "preview" ? "Previewing…" : "Preview"}
            </Button>
            <Button
              type="button"
              onClick={() => void postSync(false)}
              disabled={!canManage || !parsed || exportInvalid || busy !== null || plan === null}
            >
              <Play aria-hidden="true" />
              {busy === "apply" ? "Applying…" : "Apply"}
            </Button>
          </div>

          {plan ? (
            <div className="grid gap-4" aria-live="polite">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-medium">
                  {applied ? "Applied plan" : "Preview"} — {plan.toAdd.length} to add,{" "}
                  {plan.toUpdate.length} to update, {plan.toRemove.length} to remove,{" "}
                  {plan.unchanged} unchanged
                </h3>
                {applied ? (
                  <Badge variant="secondary" size="sm">
                    applied
                  </Badge>
                ) : (
                  <Badge variant="outline" size="sm">
                    dry run
                  </Badge>
                )}
              </div>

              {outcome ? (
                <p className="text-muted-foreground text-sm" role="status">
                  Result: {outcome.added} added, {outcome.updated} updated, {outcome.removed}{" "}
                  removed
                  {outcome.failed.length > 0
                    ? `, ${outcome.failed.length} failed (${outcome.failed
                        .map((f) => f.email)
                        .join(", ")})`
                    : ""}
                </p>
              ) : null}

              <PlanSection title={`Add (${plan.toAdd.length})`}>
                <PlanList items={addItems} empty="No users to add." />
              </PlanSection>
              <PlanSection title={`Update (${plan.toUpdate.length})`}>
                <PlanList items={updateItems} empty="No members to update." />
              </PlanSection>
              <PlanSection title={`Remove (${plan.toRemove.length})`}>
                <PlanList items={removeItems} empty="No members to remove." />
              </PlanSection>

              {plan.errors.length > 0 ? (
                <div className="grid gap-1">
                  <h3 className="text-sm font-medium">Problems</h3>
                  <ul className="grid gap-1 text-sm">
                    {plan.errors.map((message) => (
                      <li key={message} className="text-destructive">
                        {message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {applied ? (
                <p className="app-saved-note" role="status">
                  <Check aria-hidden="true" />
                  Sync applied.
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
