"use client"

import { useState, type FormEvent } from "react"
import Link from "next/link"
import { Check, UserPlus } from "lucide-react"

import { InlineError } from "@/components/app/states/inline-error"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { slugifyWorkspace, WORKSPACE_NAME_MAX as NAME_MAX } from "./create-workspace-dialog"

/**
 * "New workspace" screen for `/app/workspaces/new`: a single-field form that
 * POSTs `{ name }` to `/api/workspaces` (the creator becomes `owner` and the
 * workspace becomes the session's active workspace), then shows a success
 * state linking to the new workspace's settings and members pages — the
 * members page is also where invitations are sent, so it doubles as the
 * "invite teammates" entry point.
 *
 * The slug preview uses `slugifyWorkspace` from create-workspace-dialog.tsx,
 * which mirrors `slugifyWorkspace` in `src/lib/auth/backend.ts` (not
 * exported there).
 */

const WORKSPACES_API = "/api/workspaces"

interface CreatedWorkspace {
  id: string
  name: string
  slug: string
  role: string
  active: boolean
}

interface WorkspacesResponse {
  ok: boolean
  workspace?: CreatedWorkspace
  message?: string
}

export function CreateWorkspaceScreen() {
  const [name, setName] = useState("")
  const [nameError, setNameError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [created, setCreated] = useState<CreatedWorkspace | null>(null)

  const slug = slugifyWorkspace(name)

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setNameError("Enter a workspace name.")
      return
    }
    if (trimmed.length > NAME_MAX) {
      setNameError(`Workspace names are limited to ${NAME_MAX} characters.`)
      return
    }

    setSubmitting(true)
    setSubmitError(null)
    try {
      const response = await fetch(WORKSPACES_API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      })
      const data = (await response.json()) as WorkspacesResponse
      if (!response.ok || !data.ok || !data.workspace) {
        setSubmitError(data.message ?? "Could not create the workspace. Try again.")
        return
      }
      setCreated(data.workspace)
    } catch {
      setSubmitError("Could not create the workspace. Check your connection and try again.")
    } finally {
      setSubmitting(false)
    }
  }

  const reset = () => {
    setCreated(null)
    setName("")
    setNameError(null)
    setSubmitError(null)
  }

  if (created) {
    const membersHref = `/app/workspaces/${created.id}/members`
    const settingsHref = `/app/workspaces/${created.id}/settings`
    return (
      <div className="grid max-w-3xl gap-6">
        <section className="app-page-card" aria-labelledby="workspace-created-heading">
          <h2 id="workspace-created-heading" className="sr-only">
            Workspace created
          </h2>
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="bg-muted text-muted-foreground grid size-10 shrink-0 place-items-center rounded-full"
            >
              <Check className="size-5" />
            </span>
            <div className="grid gap-1">
              <p className="text-sm font-medium">Workspace created</p>
              <p className="text-muted-foreground text-sm">
                <span className="text-foreground font-medium">{created.name}</span> is ready and is
                now your active workspace. You joined as{" "}
                <Badge variant="secondary" size="sm" className="align-middle">
                  {created.role}
                </Badge>
                .
              </p>
            </div>
          </div>

          <div className="app-form-actions">
            <Button asChild>
              <Link href={membersHref}>
                <UserPlus aria-hidden="true" />
                Invite teammates
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={settingsHref}>Workspace settings</Link>
            </Button>
            <Button type="button" variant="ghost" onClick={reset}>
              Create another workspace
            </Button>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="grid max-w-3xl gap-6">
      <form className="app-form" onSubmit={(event) => void submit(event)}>
        <section className="app-page-card" aria-labelledby="create-workspace-heading">
          <h2 id="create-workspace-heading">Workspace details</h2>
          <p className="text-muted-foreground text-sm">
            Workspaces group your projects, members, and settings. You&apos;ll be the owner and the
            new workspace becomes your active workspace.
          </p>

          <div className="app-field">
            <label htmlFor="workspace-name">Workspace name</label>
            <Input
              id="workspace-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                if (nameError) setNameError(null)
                if (submitError) setSubmitError(null)
              }}
              maxLength={NAME_MAX}
              autoComplete="organization"
              placeholder="Acme Research"
              aria-invalid={nameError ? true : undefined}
              aria-describedby="workspace-name-hint"
            />
            <p id="workspace-name-hint" className="app-field-hint">
              {name.trim()
                ? `Slug preview: ${slug}`
                : "1–80 characters. The slug is generated from the name."}
            </p>
            {nameError ? <InlineError title={null} message={nameError} /> : null}
          </div>

          {submitError ? (
            <InlineError
              title="Could not create workspace"
              message={submitError}
              action={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={submitting}
                  onClick={() => void submit()}
                >
                  Try again
                </Button>
              }
            />
          ) : null}

          <div className="app-form-actions">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create workspace"}
            </Button>
            <Button asChild variant="ghost">
              <Link href="/app">Cancel</Link>
            </Button>
          </div>
        </section>
      </form>
    </div>
  )
}
