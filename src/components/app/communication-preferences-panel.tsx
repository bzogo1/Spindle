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
import {
  COMMUNICATION_DIGEST_FREQUENCIES,
  defaultCommunicationPreferences,
  type CommunicationDigestFrequency,
  type CommunicationPreferences,
  type CommunicationPreferencesUpdate,
} from "@/lib/communication-preferences"

const DIGEST_COPY: Record<CommunicationDigestFrequency, string> = {
  off: "No digest emails — only time-sensitive messages are sent.",
  daily: "A daily summary of workspace activity by email.",
  weekly: "A weekly summary every Monday by email.",
}

const DIGEST_LABELS: Record<CommunicationDigestFrequency, string> = {
  off: "Off",
  daily: "Daily",
  weekly: "Weekly",
}

/** The fields a user may change; securityAlerts is locked on. */
const EDITABLE_KEYS = [
  "productUpdates",
  "digestFrequency",
  "feedbackRequests",
  "referralProgram",
] as const

function isSamePreferences(a: CommunicationPreferences, b: CommunicationPreferences) {
  return EDITABLE_KEYS.every((key) => a[key] === b[key])
}

/** Builds the partial PUT body containing only the fields that changed. */
function preferencesDiff(
  draft: CommunicationPreferences,
  baseline: CommunicationPreferences,
): CommunicationPreferencesUpdate {
  const update: CommunicationPreferencesUpdate = {}
  for (const key of EDITABLE_KEYS) {
    if (draft[key] !== baseline[key]) {
      Object.assign(update, { [key]: draft[key] })
    }
  }
  return update
}

interface CommunicationPreferencesResponse {
  preferences?: CommunicationPreferences
}

async function fetchCommunicationPreferences({
  signal,
}: {
  signal?: AbortSignal
}): Promise<CommunicationPreferences> {
  const body = await request<CommunicationPreferencesResponse>(
    "",
    "/api/communication-preferences",
    { signal },
  )
  if (!body.preferences) {
    throw new Error("The preferences response did not include preferences data.")
  }
  return body.preferences
}

async function saveCommunicationPreferences(
  update: CommunicationPreferencesUpdate,
): Promise<CommunicationPreferences> {
  const body = await request<CommunicationPreferencesResponse>(
    "",
    "/api/communication-preferences",
    { method: "PUT", body: { preferences: update } },
  )
  if (!body.preferences) {
    throw new Error("The preferences response did not include preferences data.")
  }
  return body.preferences
}

function PreferenceSwitch({
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="app-pref-row">
      <div>
        <strong>{label}</strong>
        <small>{description}</small>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        aria-label={label}
      />
    </div>
  )
}

function CommunicationPreferencesForm({ preferences }: { preferences: CommunicationPreferences }) {
  const { toast } = useToast()
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

  function patch(patchValue: Partial<CommunicationPreferences>) {
    setDraft((current) => ({ ...current, ...patchValue }))
    setSaved(false)
  }

  async function submit() {
    const update = preferencesDiff(draft, baseline)
    if (Object.keys(update).length === 0) return

    setSaving(true)
    try {
      const savedPreferences = await saveCommunicationPreferences(update)
      setBaseline(savedPreferences)
      setDraft(savedPreferences)
      loadedRef.current = savedPreferences
      setSaved(true)
      toast({
        title: "Preferences saved",
        description: "Your communication preferences were updated.",
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
    <section className="app-page-card" aria-labelledby="communication-prefs-heading">
      <h2 id="communication-prefs-heading">Email &amp; product communications</h2>
      <p>
        Choose which emails we send you. These preferences are saved to your account and apply
        across devices; the in-app toggles above stay on this browser.
      </p>

      <div className="grid gap-2.5">
        <PreferenceSwitch
          label="Product updates"
          description="Occasional news about new features and improvements."
          checked={draft.productUpdates}
          onCheckedChange={(productUpdates) => patch({ productUpdates })}
        />
        <PreferenceSwitch
          label="Security alerts"
          description="Sign-ins, password changes, and other security events. Always on to protect your account."
          checked={draft.securityAlerts}
          disabled
          onCheckedChange={() => {}}
        />
        <PreferenceSwitch
          label="Feedback requests"
          description="Occasional invitations to share feedback about the product."
          checked={draft.feedbackRequests}
          onCheckedChange={(feedbackRequests) => patch({ feedbackRequests })}
        />
        <PreferenceSwitch
          label="Referral program"
          description="Announcements and rewards for referring teammates."
          checked={draft.referralProgram}
          onCheckedChange={(referralProgram) => patch({ referralProgram })}
        />
      </div>

      <div className="app-field">
        <label htmlFor="communication-digest-frequency">Email digest frequency</label>
        <select
          id="communication-digest-frequency"
          className="app-select"
          value={draft.digestFrequency}
          onChange={(event) =>
            patch({
              digestFrequency: event.target.value as CommunicationDigestFrequency,
            })
          }
        >
          {COMMUNICATION_DIGEST_FREQUENCIES.map((frequency) => (
            <option key={frequency} value={frequency}>
              {DIGEST_LABELS[frequency]}
            </option>
          ))}
        </select>
        <p className="app-field-hint">{DIGEST_COPY[draft.digestFrequency]}</p>
      </div>

      <div className="app-form-actions app-form-actions--save">
        <Button type="button" onClick={() => void submit()} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save preferences"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setDraft(defaultCommunicationPreferences())
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
 * Account-level communication preferences panel. Loads
 * `GET /api/communication-preferences` and saves partial updates through
 * `PUT /api/communication-preferences`; renders its own loading/error states
 * so it can be embedded inside the notification preferences screen.
 */
export function CommunicationPreferencesPanel() {
  const query = useApiQuery(
    fetchCommunicationPreferences,
    [],
    true,
    defaultCommunicationPreferences(),
  )

  if (query.status === "loading" || query.status === "idle") {
    return (
      <section className="app-page-card" aria-labelledby="communication-prefs-heading">
        <h2 id="communication-prefs-heading">Email &amp; product communications</h2>
        <LoadingPanel label="Loading communication preferences" className="min-h-24">
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
      <section className="app-page-card" aria-labelledby="communication-prefs-heading">
        <h2 id="communication-prefs-heading">Email &amp; product communications</h2>
        <ErrorState
          title="Communication preferences did not load"
          message="We could not load your email preferences. Try again to retry."
          error={query.error}
          onRetry={query.refetch}
          isRetrying={query.isRetrying}
        />
      </section>
    )
  }

  return <CommunicationPreferencesForm preferences={query.data} />
}
