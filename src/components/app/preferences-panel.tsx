"use client"

import { useEffect, useRef, useState } from "react"
import { Check, RotateCcw } from "lucide-react"

import { ErrorState } from "@/components/app/states/error-state"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/toast"
import { request } from "@/lib/api/client"
import { useApiQuery } from "@/lib/api/use-api-query"
import { useProjects } from "@/lib/api"
import {
  USER_PREFERENCE_DENSITIES,
  USER_PREFERENCE_WEEK_STARTS,
  defaultUserPreferences,
  type UserPreferenceDensity,
  type UserPreferenceWeekStart,
  type UserPreferences,
  type UserPreferencesUpdate,
} from "@/lib/preferences"

const DENSITY_LABELS: Record<UserPreferenceDensity, string> = {
  comfortable: "Comfortable",
  compact: "Compact",
}

const DENSITY_COPY: Record<UserPreferenceDensity, string> = {
  comfortable: "Roomier rows and controls — the default spacing.",
  compact: "Tighter rows and controls so more fits on screen.",
}

const WEEK_START_LABELS: Record<UserPreferenceWeekStart, string> = {
  monday: "Monday",
  sunday: "Sunday",
}

/** Sentinel select value for "no default project" (the API stores null). */
const NO_DEFAULT_PROJECT = ""

/** The fields a user may change — every preference is editable. */
const EDITABLE_KEYS = [
  "density",
  "weekStartsOn",
  "defaultProjectId",
  "confirmDestructiveActions",
  "reduceMotion",
] as const

function isSamePreferences(a: UserPreferences, b: UserPreferences) {
  return EDITABLE_KEYS.every((key) => a[key] === b[key])
}

/** Builds the partial PUT body containing only the fields that changed. */
function preferencesDiff(draft: UserPreferences, baseline: UserPreferences): UserPreferencesUpdate {
  const update: UserPreferencesUpdate = {}
  for (const key of EDITABLE_KEYS) {
    if (draft[key] !== baseline[key]) {
      Object.assign(update, { [key]: draft[key] })
    }
  }
  return update
}

interface PreferencesResponse {
  preferences?: UserPreferences
}

async function fetchUserPreferences({
  signal,
}: {
  signal?: AbortSignal
}): Promise<UserPreferences> {
  const body = await request<PreferencesResponse>("", "/api/preferences", { signal })
  if (!body.preferences) {
    throw new Error("The preferences response did not include preferences data.")
  }
  return body.preferences
}

async function saveUserPreferences(update: UserPreferencesUpdate): Promise<UserPreferences> {
  const body = await request<PreferencesResponse>("", "/api/preferences", {
    method: "PUT",
    body: { preferences: update },
  })
  if (!body.preferences) {
    throw new Error("The preferences response did not include preferences data.")
  }
  return body.preferences
}

function PreferenceSwitch({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string
  description: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="app-pref-row">
      <div>
        <strong>{label}</strong>
        <small>{description}</small>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </div>
  )
}

function UserPreferencesForm({ preferences }: { preferences: UserPreferences }) {
  const { toast } = useToast()
  const projects = useProjects()
  const [draft, setDraft] = useState(preferences)
  const [baseline, setBaseline] = useState(preferences)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  // Re-sync the draft only when the loaded preferences actually change
  // (e.g. after a retry), so in-progress edits are not wiped by rerenders.
  const loadedRef = useRef(preferences)

  useEffect(() => {
    if (loadedRef.current === preferences) return
    loadedRef.current = preferences
    setBaseline(preferences)
    setDraft(preferences)
    setSaved(false)
  }, [preferences])

  const dirty = !isSamePreferences(draft, baseline)
  const projectOptions = projects.data ?? []
  const storedProjectMissing =
    draft.defaultProjectId !== null &&
    !projectOptions.some((project) => project.id === draft.defaultProjectId)

  function patch(patchValue: Partial<UserPreferences>) {
    setDraft((current) => ({ ...current, ...patchValue }))
    setSaved(false)
  }

  async function submit() {
    const update = preferencesDiff(draft, baseline)
    if (Object.keys(update).length === 0) return

    setSaving(true)
    try {
      const savedPreferences = await saveUserPreferences(update)
      setBaseline(savedPreferences)
      setDraft(savedPreferences)
      loadedRef.current = savedPreferences
      setSaved(true)
      toast({
        title: "Preferences saved",
        description: "Your preferences were updated.",
        variant: "success",
      })
    } catch {
      toast({
        title: "Couldn't save preferences",
        description: "Something went wrong. Please try again.",
        variant: "error",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="app-page-card" aria-labelledby="user-preferences-heading">
      <h2 id="user-preferences-heading">Preferences</h2>
      <p>
        App-level preferences saved to your account and applied across devices. Email opt-ins live
        under notification settings; theme and in-app notification toggles stay on this browser.
      </p>

      <fieldset className="grid gap-2.5">
        <legend className="text-sm font-medium">Appearance</legend>
        <div className="app-field">
          <label htmlFor="user-pref-density">Interface density</label>
          <select
            id="user-pref-density"
            className="app-select"
            value={draft.density}
            onChange={(event) => patch({ density: event.target.value as UserPreferenceDensity })}
          >
            {USER_PREFERENCE_DENSITIES.map((density) => (
              <option key={density} value={density}>
                {DENSITY_LABELS[density]}
              </option>
            ))}
          </select>
          <p className="app-field-hint">{DENSITY_COPY[draft.density]}</p>
        </div>
        <PreferenceSwitch
          label="Reduce motion"
          description="Minimize animations and transitions across the app."
          checked={draft.reduceMotion}
          onCheckedChange={(reduceMotion) => patch({ reduceMotion })}
        />
      </fieldset>

      <fieldset className="grid gap-2.5">
        <legend className="text-sm font-medium">Workspace defaults &amp; safety</legend>
        <div className="app-field">
          <label htmlFor="user-pref-week-start">Week starts on</label>
          <select
            id="user-pref-week-start"
            className="app-select"
            value={draft.weekStartsOn}
            onChange={(event) =>
              patch({ weekStartsOn: event.target.value as UserPreferenceWeekStart })
            }
          >
            {USER_PREFERENCE_WEEK_STARTS.map((day) => (
              <option key={day} value={day}>
                {WEEK_START_LABELS[day]}
              </option>
            ))}
          </select>
          <p className="app-field-hint">First day shown in weekly calendar views.</p>
        </div>
        <div className="app-field">
          <label htmlFor="user-pref-default-project">Default project</label>
          <select
            id="user-pref-default-project"
            className="app-select"
            value={draft.defaultProjectId ?? NO_DEFAULT_PROJECT}
            onChange={(event) =>
              patch({
                defaultProjectId:
                  event.target.value === NO_DEFAULT_PROJECT ? null : event.target.value,
              })
            }
          >
            <option value={NO_DEFAULT_PROJECT}>No default — ask each time</option>
            {storedProjectMissing && draft.defaultProjectId ? (
              <option value={draft.defaultProjectId}>{draft.defaultProjectId} (unavailable)</option>
            ) : null}
            {projectOptions.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <p className="app-field-hint">
            {projects.status === "loading" || projects.status === "idle"
              ? "Loading projects…"
              : "Preselected when starting new work in this workspace."}
          </p>
        </div>
        <PreferenceSwitch
          label="Confirm destructive actions"
          description="Ask before archiving, deleting, or otherwise removing workspace data."
          checked={draft.confirmDestructiveActions}
          onCheckedChange={(confirmDestructiveActions) => patch({ confirmDestructiveActions })}
        />
      </fieldset>

      <div className="app-form-actions app-form-actions--save">
        <Button type="button" onClick={() => void submit()} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save preferences"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setDraft(defaultUserPreferences())
            setSaved(false)
          }}
          disabled={saving}
        >
          <RotateCcw aria-hidden="true" />
          Reset preferences to defaults
        </Button>
        {saved ? (
          <p className="app-saved-note" role="status">
            <Check aria-hidden="true" />
            Changes saved.
          </p>
        ) : dirty ? (
          <p className="text-muted-foreground text-sm" role="status">
            You have unsaved changes.
          </p>
        ) : null}
      </div>
    </section>
  )
}

/**
 * Account-level general preferences panel. Loads `GET /api/preferences` and
 * saves partial updates through `PUT /api/preferences`; renders its own
 * loading/error states so it can be embedded inside the settings screen.
 */
export function PreferencesPanel() {
  const query = useApiQuery(fetchUserPreferences, [], true, defaultUserPreferences())

  if (query.status === "loading" || query.status === "idle") {
    return (
      <section className="app-page-card" aria-labelledby="user-preferences-heading">
        <h2 id="user-preferences-heading">Preferences</h2>
        <LoadingPanel label="Loading preferences" className="min-h-24">
          <div className="grid gap-3">
            <div className="bg-muted h-4 w-2/3 animate-pulse rounded" />
            <div className="bg-muted h-4 w-1/2 animate-pulse rounded" />
          </div>
        </LoadingPanel>
      </section>
    )
  }

  if (query.status === "error" || !query.data) {
    return (
      <section className="app-page-card" aria-labelledby="user-preferences-heading">
        <h2 id="user-preferences-heading">Preferences</h2>
        <ErrorState
          title="Preferences did not load"
          message="We could not load your preferences. Try again to retry."
          error={query.error}
          onRetry={query.refetch}
          isRetrying={query.isRetrying}
        />
      </section>
    )
  }

  return <UserPreferencesForm preferences={query.data} />
}
