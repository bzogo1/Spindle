"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { Plus } from "lucide-react"

import { InlineError } from "@/components/app/states/inline-error"
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

export const WORKSPACE_NAME_MAX = 80

/**
 * Mirrors `slugifyWorkspace` in `src/lib/auth/backend.ts` (not exported
 * there) and the preview in create-workspace-screen.tsx: lowercase,
 * non-alphanumeric runs collapse to `-`, edges trimmed, capped at 48 chars,
 * falling back to "workspace".
 */
export function slugifyWorkspace(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "")
  return slug || "workspace"
}

/**
 * "Create workspace" modal launched from the workspace switcher's quick
 * action. Collects a name and delegates the actual creation to `onCreate`,
 * which resolves on success (the dialog then closes) or throws an `Error`
 * with a user-facing message shown inline so the user can retry.
 */
export function CreateWorkspaceDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (name: string) => Promise<void>
}) {
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus the name field each time the dialog opens and reset stale state.
  useEffect(() => {
    if (!open) return
    setName("")
    setError(null)
    setBusy(false)
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || busy) return
    if (trimmed.length > WORKSPACE_NAME_MAX) {
      setError(`Workspace names are limited to ${WORKSPACE_NAME_MAX} characters.`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onCreate(trimmed)
      onOpenChange(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the workspace.")
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return
        setError(null)
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create workspace</DialogTitle>
          <DialogDescription>
            Workspaces group your projects, members, and settings. You&apos;ll be the owner.
          </DialogDescription>
        </DialogHeader>

        <form className="app-form" onSubmit={(event) => void submit(event)}>
          <div className="app-field">
            <label htmlFor="create-workspace-name">Workspace name</label>
            <Input
              id="create-workspace-name"
              ref={inputRef}
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                if (error) setError(null)
              }}
              maxLength={WORKSPACE_NAME_MAX}
              autoComplete="organization"
              placeholder="Acme Research"
              aria-invalid={error ? true : undefined}
            />
            {name.trim() ? (
              <p className="app-field-hint">Slug preview: {slugifyWorkspace(name)}</p>
            ) : null}
          </div>

          {error ? <InlineError title="Could not create workspace" message={error} /> : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              <Plus aria-hidden="true" />
              {busy ? "Creating…" : "Create workspace"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
