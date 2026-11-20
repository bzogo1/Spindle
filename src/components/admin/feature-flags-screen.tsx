"use client"

import { useCallback, useEffect, useState } from "react"
import { Flag, Pencil, Plus, Trash2 } from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"

/**
 * Admin "Feature flags" screen for `/app/admin/feature-flags`: flag table
 * with inline enable toggles, a create/edit form, delete confirmation, and
 * a test-evaluation input backed by
 * `GET|POST /api/admin/feature-flags`,
 * `GET|PATCH|DELETE /api/admin/feature-flags/[id]`, and
 * `POST /api/admin/feature-flags/evaluate`.
 *
 * Flags are evaluated at runtime by `isFeatureEnabled` /
 * `listEnabledFlagKeys` in `src/lib/feature-flags.ts`; the store behind the
 * API is the in-memory dev seam described there.
 */

const API = "/api/admin/feature-flags"
const EVALUATE_API = "/api/admin/feature-flags/evaluate"

export interface FeatureFlagRow {
  id: string
  key: string
  name: string
  description: string
  enabled: boolean
  rolloutPercent?: number
  targetUserIds?: string[]
  targetEmails?: string[]
  createdAt: string
  updatedAt: string
}

interface ListResponse {
  ok: boolean
  flags?: FeatureFlagRow[]
  message?: string
}

interface SingleResponse {
  ok: boolean
  flag?: FeatureFlagRow
  message?: string
}

interface FlagDraft {
  key: string
  name: string
  description: string
  enabled: boolean
  /** Empty string means "no percentage rollout". */
  rolloutPercent: string
  targetUserIds: string
  targetEmails: string
}

const EMPTY_DRAFT: FlagDraft = {
  key: "",
  name: "",
  description: "",
  enabled: false,
  rolloutPercent: "",
  targetUserIds: "",
  targetEmails: "",
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, { dateStyle: "medium" })
}

function targetCount(flag: FeatureFlagRow): number {
  return (flag.targetUserIds?.length ?? 0) + (flag.targetEmails?.length ?? 0)
}

function linesToList(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function draftFromFlag(flag: FeatureFlagRow): FlagDraft {
  return {
    key: flag.key,
    name: flag.name,
    description: flag.description,
    enabled: flag.enabled,
    rolloutPercent: flag.rolloutPercent === undefined ? "" : String(flag.rolloutPercent),
    targetUserIds: (flag.targetUserIds ?? []).join("\n"),
    targetEmails: (flag.targetEmails ?? []).join("\n"),
  }
}

function draftPayload(draft: FlagDraft, isEdit: boolean) {
  const rollout = draft.rolloutPercent.trim()
  const userIds = linesToList(draft.targetUserIds)
  const emails = linesToList(draft.targetEmails)
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    enabled: draft.enabled,
    // On edit, a blank input means "clear the rollout %" — the API treats
    // `null` as delete, while omitting the field would leave it unchanged.
    ...(rollout !== ""
      ? { rolloutPercent: Number(rollout) }
      : isEdit
        ? { rolloutPercent: null }
        : {}),
    targetUserIds: userIds,
    targetEmails: emails,
  }
}

export function FeatureFlagsScreen() {
  const [flags, setFlags] = useState<FeatureFlagRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<FlagDraft>(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [formNotice, setFormNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [evalEmail, setEvalEmail] = useState("")
  const [evalResult, setEvalResult] = useState<{ email: string; flags: string[] } | null>(null)
  const [evalError, setEvalError] = useState<string | null>(null)
  const [evaluating, setEvaluating] = useState(false)

  const load = useCallback(async () => {
    try {
      const response = await fetch(API, { cache: "no-store" })
      const data = (await response.json()) as ListResponse
      if (!response.ok || !data.ok) {
        setError(data.message ?? "Could not load feature flags.")
        setFlags([])
        return
      }
      setError(null)
      setFlags(data.flags ?? [])
    } catch {
      setError("Could not load feature flags.")
      setFlags([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  const resetForm = () => {
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
    setFormError(null)
    setFormNotice(null)
  }

  const startEdit = (flag: FeatureFlagRow) => {
    setEditingId(flag.id)
    setDraft(draftFromFlag(flag))
    setFormError(null)
    setFormNotice(null)
  }

  const save = async () => {
    setSaving(true)
    setFormError(null)
    setFormNotice(null)
    try {
      const isEdit = editingId !== null
      const payload = draftPayload(draft, isEdit)
      const response = await fetch(isEdit ? `${API}/${editingId}` : API, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(isEdit ? payload : { key: draft.key.trim(), ...payload }),
      })
      const data = (await response.json()) as SingleResponse
      if (!response.ok || !data.ok) {
        setFormError(data.message ?? "Could not save the flag.")
        return
      }
      setFormNotice(isEdit ? `Updated "${data.flag?.key}".` : `Created "${data.flag?.key}".`)
      resetForm()
      setReloadKey((key) => key + 1)
    } catch {
      setFormError("Could not save the flag.")
    } finally {
      setSaving(false)
    }
  }

  const toggleEnabled = async (flag: FeatureFlagRow, enabled: boolean) => {
    setBusyId(flag.id)
    setError(null)
    try {
      const response = await fetch(`${API}/${flag.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      })
      const data = (await response.json()) as SingleResponse
      if (!response.ok || !data.ok) {
        setError(data.message ?? "Could not update the flag.")
        return
      }
      setFlags(
        (current) =>
          current?.map((row) => (row.id === flag.id ? { ...row, enabled } : row)) ?? current,
      )
    } catch {
      setError("Could not update the flag.")
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (flag: FeatureFlagRow) => {
    if (!window.confirm(`Delete feature flag "${flag.key}"? Callers will lose it immediately.`)) {
      return
    }
    setBusyId(flag.id)
    setError(null)
    try {
      const response = await fetch(`${API}/${flag.id}`, { method: "DELETE" })
      const data = (await response.json()) as { ok?: boolean; message?: string }
      if (!response.ok || !data.ok) {
        setError(data.message ?? "Could not delete the flag.")
        return
      }
      if (editingId === flag.id) resetForm()
      setReloadKey((key) => key + 1)
    } catch {
      setError("Could not delete the flag.")
    } finally {
      setBusyId(null)
    }
  }

  const evaluate = async () => {
    const email = evalEmail.trim()
    if (!email) return
    setEvaluating(true)
    setEvalError(null)
    setEvalResult(null)
    try {
      const response = await fetch(EVALUATE_API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const data = (await response.json()) as { ok?: boolean; flags?: string[]; message?: string }
      if (!response.ok || !data.ok) {
        setEvalError(data.message ?? "Evaluation failed.")
        return
      }
      setEvalResult({ email, flags: data.flags ?? [] })
    } catch {
      setEvalError("Evaluation failed.")
    } finally {
      setEvaluating(false)
    }
  }

  const rolloutValid =
    draft.rolloutPercent.trim() === "" ||
    (Number.isFinite(Number(draft.rolloutPercent)) &&
      Number(draft.rolloutPercent) >= 0 &&
      Number(draft.rolloutPercent) <= 100)

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{editingId ? "Edit flag" : "Create flag"}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="ff-key">Key</Label>
              <Input
                id="ff-key"
                value={draft.key}
                onChange={(event) => setDraft({ ...draft, key: event.target.value })}
                placeholder="new-dashboard"
                disabled={editingId !== null}
                maxLength={128}
              />
              <p className="text-muted-foreground text-xs">
                Stable identifier used by code. Cannot be changed after creation.
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ff-name">Name</Label>
              <Input
                id="ff-name"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="New dashboard"
                maxLength={200}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ff-description">Description</Label>
            <Textarea
              id="ff-description"
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              placeholder="What this flag gates and when it should be removed."
              rows={2}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ff-rollout">Rollout % (optional)</Label>
              <Input
                id="ff-rollout"
                type="number"
                min={0}
                max={100}
                value={draft.rolloutPercent}
                onChange={(event) => setDraft({ ...draft, rolloutPercent: event.target.value })}
                placeholder="e.g. 25"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ff-users">Target user IDs</Label>
              <Textarea
                id="ff-users"
                value={draft.targetUserIds}
                onChange={(event) => setDraft({ ...draft, targetUserIds: event.target.value })}
                placeholder={"One per line\nuser-123"}
                rows={2}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ff-emails">Target emails</Label>
              <Textarea
                id="ff-emails"
                value={draft.targetEmails}
                onChange={(event) => setDraft({ ...draft, targetEmails: event.target.value })}
                placeholder={"One per line\nuser@example.com"}
                rows={2}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="ff-enabled"
              checked={draft.enabled}
              onCheckedChange={(checked) => setDraft({ ...draft, enabled: checked })}
            />
            <Label htmlFor="ff-enabled">Enabled</Label>
          </div>
          {!rolloutValid && (
            <p className="text-destructive text-sm">
              Rollout % must be a number between 0 and 100.
            </p>
          )}
          {formError && <InlineError message={formError} />}
          {formNotice && <p className="text-muted-foreground text-sm">{formNotice}</p>}
          <div className="flex gap-2">
            <Button onClick={() => void save()} disabled={saving || !rolloutValid}>
              {editingId ? "Save changes" : "Create flag"}
            </Button>
            {editingId && (
              <Button variant="outline" onClick={resetForm} disabled={saving}>
                Cancel
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Test evaluation</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <p className="text-muted-foreground text-sm">
            Enter an email to see which flags would be enabled for that user.
          </p>
          <div className="flex gap-2">
            <Input
              type="email"
              value={evalEmail}
              onChange={(event) => setEvalEmail(event.target.value)}
              placeholder="user@example.com"
              aria-label="Email to evaluate"
            />
            <Button onClick={() => void evaluate()} disabled={evaluating || !evalEmail.trim()}>
              Evaluate
            </Button>
          </div>
          {evalError && <InlineError message={evalError} />}
          {evalResult && (
            <div className="grid gap-2">
              <p className="text-sm">
                <span className="font-medium">{evalResult.email}</span> would see{" "}
                {evalResult.flags.length === 0
                  ? "no flags"
                  : `${evalResult.flags.length} flag${evalResult.flags.length === 1 ? "" : "s"}`}
                :
              </p>
              {evalResult.flags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {evalResult.flags.map((key) => (
                    <Badge key={key} variant="secondary">
                      {key}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Flags</CardTitle>
        </CardHeader>
        <CardContent>
          {error && <InlineError message={error} />}
          {flags === null ? (
            <LoadingPanel label="Loading feature flags" variant="table" />
          ) : flags.length === 0 ? (
            <EmptyState
              icon={<Flag aria-hidden="true" />}
              title="No feature flags yet"
              body="Create a flag above to start targeting users."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Key</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead>Rollout</TableHead>
                  <TableHead>Targets</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {flags.map((flag) => (
                  <TableRow key={flag.id}>
                    <TableCell className="font-mono text-xs">{flag.key}</TableCell>
                    <TableCell>{flag.name}</TableCell>
                    <TableCell>
                      <Switch
                        checked={flag.enabled}
                        onCheckedChange={(checked) => void toggleEnabled(flag, checked)}
                        disabled={busyId === flag.id}
                        aria-label={`Toggle ${flag.key}`}
                      />
                    </TableCell>
                    <TableCell>
                      {flag.rolloutPercent === undefined ? "—" : `${flag.rolloutPercent}%`}
                    </TableCell>
                    <TableCell>{targetCount(flag)}</TableCell>
                    <TableCell>{formatDate(flag.updatedAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => startEdit(flag)}
                          disabled={busyId === flag.id}
                        >
                          <Pencil aria-hidden="true" /> Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void remove(flag)}
                          disabled={busyId === flag.id}
                        >
                          <Trash2 aria-hidden="true" /> Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {flags !== null && flags.length > 0 && (
            <p className="text-muted-foreground mt-3 text-xs">
              <Plus aria-hidden="true" className="mr-1 inline size-3" />
              New flags are created disabled by default — enable them once targeting is set.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
