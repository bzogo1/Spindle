"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { FileText, Plus, Trash2 } from "lucide-react"

import { EmptyState } from "@/components/app/states/empty-state"
import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

/**
 * Admin "Email templates" screen for `/app/admin/email-templates`: a sidebar
 * list plus an editor (name / subject / plain-text body with `{{variable}}`
 * placeholders) and a live preview pane.
 *
 * Preview goes through `POST /api/admin/email-templates/preview` (debounced)
 * so the server-side `renderTemplate` in `src/lib/email-templates-editor.ts`
 * stays the single source of substitution — the client never re-implements
 * it. Variable *hints* are computed client-side with the same
 * `{{name}}` pattern purely for display; they are not authoritative.
 *
 * There is deliberately no "test send" button: the store is an editing
 * surface only and no recipient/send wiring exists yet (see the module docs
 * in `src/lib/email-templates-editor.ts`).
 *
 * Backed by the in-memory dev-seam store — changes are per-instance and lost
 * on restart.
 */

const API = "/api/admin/email-templates"
const PREVIEW_API = `${API}/preview`
const SUBJECT_MAX = 200
const BODY_MAX = 50_000
const NAME_MAX = 120
const PREVIEW_DEBOUNCE_MS = 400

/** Display-only mirror of the server placeholder pattern. */
const VARIABLE_HINT_PATTERN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g

export interface EditableTemplate {
  id: string
  name: string
  subject: string
  body: string
  variables: string[]
  createdAt: string
  updatedAt: string
}

interface TemplateListResponse {
  ok: boolean
  templates?: EditableTemplate[]
  message?: string
}

interface PreviewResponse {
  ok: boolean
  subject?: string
  body?: string
  message?: string
}

function extractVariableHints(text: string): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const match of `${text}`.matchAll(VARIABLE_HINT_PATTERN)) {
    const name = match[1]
    if (name && !seen.has(name)) {
      seen.add(name)
      names.push(name)
    }
  }
  return names
}

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

const EMPTY_DRAFT = { name: "", subject: "", body: "" }

export function EmailTemplateEditorScreen() {
  const [templates, setTemplates] = useState<EditableTemplate[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [vars, setVars] = useState<Record<string, string>>({})

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [formNotice, setFormNotice] = useState<string | null>(null)

  const [preview, setPreview] = useState<{ subject: string; body: string } | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const previewSeq = useRef(0)

  // Load the template list.
  useEffect(() => {
    let cancelled = false
    setTemplates(null)
    setListError(null)
    void (async () => {
      try {
        const response = await fetch(API, { cache: "no-store" })
        const data = (await response.json()) as TemplateListResponse
        if (cancelled) return
        if (!response.ok || !data.ok) {
          setListError(data.message ?? "Could not load email templates.")
          setTemplates([])
          return
        }
        setTemplates(data.templates ?? [])
      } catch {
        if (cancelled) return
        setListError("Could not load email templates. Check your connection and try again.")
        setTemplates([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const variableHints = extractVariableHints(`${draft.subject}\n${draft.body}`)

  // Debounced live preview through the server endpoint (single source of
  // substitution). Skips the request entirely when both fields are empty.
  useEffect(() => {
    const seq = ++previewSeq.current
    const subject = draft.subject
    const body = draft.body
    if (!subject.trim() && !body.trim()) {
      setPreview(null)
      setPreviewError(null)
      setPreviewLoading(false)
      return
    }
    setPreviewLoading(true)
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(PREVIEW_API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subject, body, vars }),
          })
          const data = (await response.json()) as PreviewResponse
          if (seq !== previewSeq.current) return
          if (!response.ok || !data.ok) {
            setPreview(null)
            setPreviewError(data.message ?? "Preview failed.")
          } else {
            setPreview({ subject: data.subject ?? "", body: data.body ?? "" })
            setPreviewError(null)
          }
        } catch {
          if (seq !== previewSeq.current) return
          setPreview(null)
          setPreviewError("Preview failed. Check your connection and try again.")
        } finally {
          if (seq === previewSeq.current) setPreviewLoading(false)
        }
      })()
    }, PREVIEW_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [draft.subject, draft.body, vars])

  const selectTemplate = useCallback((template: EditableTemplate) => {
    setEditingId(template.id)
    setDraft({ name: template.name, subject: template.subject, body: template.body })
    setVars({})
    setDirty(false)
    setFormError(null)
    setFormNotice(null)
  }, [])

  const newTemplate = useCallback(() => {
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
    setVars({})
    setDirty(false)
    setFormError(null)
    setFormNotice(null)
  }, [])

  const save = useCallback(async () => {
    if (!draft.name.trim() || !draft.subject.trim() || !draft.body.trim()) {
      setFormError("Name, subject, and body are all required.")
      return
    }
    setSaving(true)
    setFormError(null)
    setFormNotice(null)
    try {
      const response = await fetch(editingId ? `${API}/${editingId}` : API, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          subject: draft.subject,
          body: draft.body,
        }),
      })
      const data = (await response.json()) as { ok: boolean; message?: string }
      if (!response.ok || !data.ok) {
        setFormError(data.message ?? "Could not save the template.")
        return
      }
      setDirty(false)
      setFormNotice(editingId ? "Template saved." : "Template created.")
      setReloadKey((key) => key + 1)
    } catch {
      setFormError("Could not save the template. Check your connection and try again.")
    } finally {
      setSaving(false)
    }
  }, [draft, editingId])

  const remove = useCallback(async () => {
    if (!editingId) return
    setDeleting(true)
    setFormError(null)
    try {
      const response = await fetch(`${API}/${editingId}`, { method: "DELETE" })
      const data = (await response.json()) as { ok: boolean; message?: string }
      if (!response.ok || !data.ok) {
        setFormError(data.message ?? "Could not delete the template.")
        setConfirmDelete(false)
        return
      }
      setConfirmDelete(false)
      newTemplate()
      setReloadKey((key) => key + 1)
    } catch {
      setFormError("Could not delete the template. Check your connection and try again.")
      setConfirmDelete(false)
    } finally {
      setDeleting(false)
    }
  }, [editingId, newTemplate])

  const loading = templates === null && listError === null
  const empty = templates !== null && templates.length === 0
  const canSave = Boolean(draft.name.trim() && draft.subject.trim() && draft.body.trim()) && !saving

  return (
    <div className="flex flex-col gap-6">
      <section className="app-panel" aria-labelledby="email-templates-heading">
        <div className="app-panel-head">
          <div>
            <h2 id="email-templates-heading">Templates</h2>
            <p>
              Plain-text email templates with <code>{"{{variable}}"}</code> placeholders. Preview
              renders server-side; nothing is sent from this screen.
            </p>
          </div>
          <div className="app-panel-head-actions">
            <Button type="button" size="sm" variant="outline" onClick={newTemplate}>
              <Plus aria-hidden="true" className="size-4" />
              New template
            </Button>
          </div>
        </div>

        {listError ? (
          <InlineError
            title="Templates unavailable"
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

        {loading ? (
          <LoadingPanel label="Loading templates" variant="table" />
        ) : empty ? (
          <EmptyState
            icon={<FileText aria-hidden="true" />}
            title="No email templates"
            body="Create a template or seed the starter set — it will appear here."
          />
        ) : listError ? null : (
          <ul className="flex flex-col gap-2">
            {(templates ?? []).map((template) => (
              <li key={template.id}>
                <button
                  type="button"
                  onClick={() => selectTemplate(template)}
                  className={`flex w-full flex-col gap-1 rounded-md border px-3 py-2 text-left transition-colors ${
                    editingId === template.id
                      ? "border-primary bg-accent"
                      : "border-border hover:bg-accent/50"
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">{template.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {formatDateTime(template.updatedAt)}
                    </span>
                  </span>
                  <span className="text-muted-foreground truncate text-sm">{template.subject}</span>
                  {template.variables.length > 0 ? (
                    <span className="flex flex-wrap gap-1">
                      {template.variables.map((variable) => (
                        <Badge key={variable} variant="outline">
                          {`{{${variable}}}`}
                        </Badge>
                      ))}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="app-panel" aria-labelledby="email-template-editor-heading">
        <div className="app-panel-head">
          <div>
            <h2 id="email-template-editor-heading">
              {editingId ? "Edit template" : "New template"}
            </h2>
            <p>
              Variables are written as <code>{"{{name}}"}</code> in the subject or body. Missing
              values render as empty strings in the preview.
            </p>
          </div>
          <div className="app-panel-head-actions">
            {editingId ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={deleting}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 aria-hidden="true" className="size-4" />
                {deleting ? "Deleting…" : "Delete"}
              </Button>
            ) : null}
            <Button type="button" size="sm" disabled={!canSave} onClick={() => void save()}>
              {saving ? "Saving…" : editingId ? "Save changes" : "Create template"}
            </Button>
          </div>
        </div>

        {formError ? <p className="text-destructive mb-3 text-sm">{formError}</p> : null}
        {formNotice ? <p className="text-muted-foreground mb-3 text-sm">{formNotice}</p> : null}
        {dirty ? <p className="text-muted-foreground mb-3 text-sm">Unsaved changes.</p> : null}

        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (canSave) void save()
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="template-name" className="text-muted-foreground text-xs">
                Name
              </label>
              <Input
                id="template-name"
                value={draft.name}
                onChange={(event) => {
                  setDraft((d) => ({ ...d, name: event.target.value }))
                  setDirty(true)
                }}
                placeholder="e.g. Welcome series — day 0"
                maxLength={NAME_MAX}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="template-subject" className="text-muted-foreground text-xs">
                Subject
              </label>
              <Input
                id="template-subject"
                value={draft.subject}
                onChange={(event) => {
                  setDraft((d) => ({ ...d, subject: event.target.value }))
                  setDirty(true)
                }}
                placeholder="Email subject"
                maxLength={SUBJECT_MAX}
                required
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="template-body" className="text-muted-foreground text-xs">
              Body (plain text)
            </label>
            <Textarea
              id="template-body"
              value={draft.body}
              onChange={(event) => {
                setDraft((d) => ({ ...d, body: event.target.value }))
                setDirty(true)
              }}
              placeholder={"Hi {{name}},\n\nWrite the email body here…"}
              rows={10}
              maxLength={BODY_MAX}
              showCount
              autoResize
              minRows={8}
            />
          </div>
        </form>

        {variableHints.length > 0 ? (
          <div className="mt-4 flex flex-col gap-2">
            <p className="text-muted-foreground text-xs">
              Detected variables — fill in values to see them in the preview:
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {variableHints.map((variable) => (
                <div key={variable} className="flex flex-col gap-1">
                  <label
                    htmlFor={`template-var-${variable}`}
                    className="text-muted-foreground text-xs"
                  >
                    <code>{`{{${variable}}}`}</code>
                  </label>
                  <Input
                    id={`template-var-${variable}`}
                    value={vars[variable] ?? ""}
                    onChange={(event) =>
                      setVars((current) => ({ ...current, [variable]: event.target.value }))
                    }
                    placeholder={`Value for ${variable}`}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className="app-panel" aria-labelledby="email-template-preview-heading">
        <div className="app-panel-head">
          <div>
            <h2 id="email-template-preview-heading">Preview</h2>
            <p>
              Rendered server-side with the variable values above (missing values render as empty).
              Updates automatically as you type.
            </p>
          </div>
        </div>

        {previewError ? (
          <InlineError title="Preview failed" message={previewError} />
        ) : previewLoading && !preview ? (
          <LoadingPanel label="Rendering preview" />
        ) : preview ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">Subject</span>
              <p className="text-sm font-medium">{preview.subject || "(empty subject)"}</p>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">Body</span>
              <pre className="border-border bg-muted/40 overflow-x-auto rounded-md border p-3 text-sm whitespace-pre-wrap">
                {preview.body || "(empty body)"}
              </pre>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            Enter a subject or body to see the rendered preview.
          </p>
        )}
      </section>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete template?</DialogTitle>
            <DialogDescription>
              “{draft.name || "Untitled"}” will be permanently removed from the store. This cannot
              be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => void remove()}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
