"use client"

import { useState, type FormEvent } from "react"
import { AlertTriangle } from "lucide-react"

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/components/ui/toast"

/**
 * Workspace settings screen for `/dashboard/settings`.
 *
 * Frontend-only preview (DEV-272): all form state is local and seeded from a
 * mock workspace. There is no workspace settings API yet, so "Save changes"
 * only updates the local baseline and the danger-zone confirmations show an
 * informational toast instead of calling a backend. Members and Billing are
 * rendered as disabled tab stubs to reserve their slots.
 */

const MOCK_WORKSPACE = {
  name: "Northlight Research",
  slug: "northlight",
  description: "Independent research workspace.",
}

const NAME_MAX_LENGTH = 80
const DESCRIPTION_MAX_LENGTH = 240
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

type DangerAction = "delete" | "leave" | null

export function DashboardWorkspaceSettingsScreen() {
  const { toast } = useToast()

  const [baseline, setBaseline] = useState(MOCK_WORKSPACE)
  const [name, setName] = useState(MOCK_WORKSPACE.name)
  const [slug, setSlug] = useState(MOCK_WORKSPACE.slug)
  const [slugDirty, setSlugDirty] = useState(false)
  const [description, setDescription] = useState(MOCK_WORKSPACE.description)
  const [nameError, setNameError] = useState("")
  const [slugError, setSlugError] = useState("")
  const [dangerAction, setDangerAction] = useState<DangerAction>(null)

  const dirty =
    name.trim() !== baseline.name ||
    slug.trim() !== baseline.slug ||
    description.trim() !== baseline.description

  function reset() {
    setName(baseline.name)
    setSlug(baseline.slug)
    setSlugDirty(false)
    setDescription(baseline.description)
    setNameError("")
    setSlugError("")
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    let valid = true
    if (!name.trim()) {
      setNameError("Workspace name is required.")
      valid = false
    } else if (name.trim().length > NAME_MAX_LENGTH) {
      setNameError(`Workspace name must be ${NAME_MAX_LENGTH} characters or fewer.`)
      valid = false
    } else {
      setNameError("")
    }
    if (!SLUG_PATTERN.test(slug.trim())) {
      setSlugError("Slug must use lowercase letters, numbers, and hyphens.")
      valid = false
    } else {
      setSlugError("")
    }
    if (!valid) return

    // Local-only persistence: there is no workspace settings API yet, so the
    // submitted values become the new baseline.
    setBaseline({
      name: name.trim(),
      slug: slug.trim(),
      description: description.trim(),
    })
    setSlugDirty(false)
    toast({
      variant: "success",
      title: "Workspace settings saved",
      description: "Changes are stored locally until the workspace settings API lands.",
    })
  }

  function confirmDangerAction() {
    const action = dangerAction
    setDangerAction(null)
    if (!action) return
    toast({
      variant: "info",
      title: action === "delete" ? "Delete workspace confirmed" : "Leave workspace confirmed",
      description:
        "This is a local preview — workspace lifecycle actions are not wired to a backend yet.",
    })
  }

  const dangerCopy =
    dangerAction === "delete"
      ? {
          title: `Delete ${baseline.name}?`,
          description:
            "Deleting a workspace permanently removes it and everything in it — projects, members, settings, and history. This cannot be undone.",
          confirmLabel: "Delete workspace",
        }
      : {
          title: `Leave ${baseline.name}?`,
          description:
            "You will lose access to this workspace and its projects. An owner will need to invite you again to rejoin.",
          confirmLabel: "Leave workspace",
        }

  return (
    <Tabs defaultValue="general">
      <TabsList>
        <TabsTrigger value="general">General</TabsTrigger>
        <TabsTrigger value="members" disabled>
          Members
          <span className="text-muted-foreground text-xs">(soon)</span>
        </TabsTrigger>
        <TabsTrigger value="billing" disabled>
          Billing
          <span className="text-muted-foreground text-xs">(soon)</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="general">
        <form className="app-form" onSubmit={submit}>
          <section className="app-page-card" aria-labelledby="dashboard-ws-general-heading">
            <h2 id="dashboard-ws-general-heading">General</h2>
            <div className="app-field">
              <label htmlFor="dashboard-ws-name">Workspace name</label>
              <Input
                id="dashboard-ws-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  if (nameError) setNameError("")
                  if (!slugDirty) setSlug(slugify(event.target.value))
                }}
                required
                maxLength={NAME_MAX_LENGTH}
                autoComplete="organization"
                aria-invalid={nameError ? true : undefined}
              />
              {nameError ? <InlineError title={null} message={nameError} /> : null}
            </div>
            <div className="app-form-grid">
              <div className="app-field">
                <label htmlFor="dashboard-ws-slug">Slug</label>
                <Input
                  id="dashboard-ws-slug"
                  value={slug}
                  onChange={(event) => {
                    setSlug(slugify(event.target.value))
                    setSlugDirty(true)
                    if (slugError) setSlugError("")
                  }}
                  required
                  maxLength={NAME_MAX_LENGTH}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  aria-invalid={slugError ? true : undefined}
                />
                {slugError ? (
                  <InlineError title={null} message={slugError} />
                ) : (
                  <p className="app-field-hint">
                    Used in workspace URLs. Lowercase letters, numbers, and hyphens only.
                  </p>
                )}
              </div>
            </div>
            <div className="app-field">
              <label htmlFor="dashboard-ws-description">Description</label>
              <textarea
                id="dashboard-ws-description"
                className="app-textarea"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What is this workspace for?"
                rows={3}
                maxLength={DESCRIPTION_MAX_LENGTH}
              />
            </div>
            <div className="app-form-actions app-form-actions--save">
              <Button type="submit" disabled={!dirty}>
                Save changes
              </Button>
              <Button type="button" variant="outline" onClick={reset} disabled={!dirty}>
                Reset
              </Button>
            </div>
          </section>
        </form>

        <section
          className="app-page-card app-page-card--danger"
          aria-labelledby="dashboard-ws-danger-heading"
        >
          <h2 id="dashboard-ws-danger-heading">Danger zone</h2>
          <p className="text-muted-foreground text-sm">
            Permanently delete this workspace, or leave it and lose access to its projects. Both
            actions ask for confirmation first — and both are local-only previews until the
            workspace API lands.
          </p>
          <div className="app-danger-actions">
            <Button
              type="button"
              variant="destructive"
              onClick={() => setDangerAction("delete")}
            >
              <AlertTriangle aria-hidden="true" />
              Delete workspace
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDangerAction("leave")}
            >
              Leave workspace
            </Button>
          </div>
        </section>
      </TabsContent>

      {/* Members and Billing tabs are reserved as disabled stubs above; their
          content lands with the workspace members and billing APIs. */}

      <Dialog
        open={dangerAction !== null}
        onOpenChange={(open) => {
          if (!open) setDangerAction(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dangerCopy.title}</DialogTitle>
            <DialogDescription>{dangerCopy.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDangerAction(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant={dangerAction === "delete" ? "destructive" : "default"}
              onClick={confirmDangerAction}
            >
              {dangerCopy.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Tabs>
  )
}
