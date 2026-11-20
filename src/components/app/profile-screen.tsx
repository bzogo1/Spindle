"use client"

import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Check } from "lucide-react"

import { useMockSession } from "@/components/app/mock-session-provider"
import { formatDate } from "@/components/app/format"
import { ErrorState } from "@/components/app/states/error-state"
import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { ScreenSkeleton } from "@/components/app/states/skeleton"
import { UsernamePanel } from "@/components/app/username-panel"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toast"
import { request } from "@/lib/api/client"
import { useApiQuery } from "@/lib/api/use-api-query"
import { parseDisplayName, type ProfileData } from "@/lib/profile"

interface ProfileResponse {
  profile?: ProfileData
}

async function fetchProfile({ signal }: { signal?: AbortSignal }): Promise<ProfileData> {
  const body = await request<ProfileResponse>("", "/api/profile", { signal })
  if (!body.profile) {
    throw new Error("The profile response did not include profile data.")
  }
  return body.profile
}

async function saveProfileName(name: string): Promise<ProfileData> {
  const body = await request<ProfileResponse>("", "/api/profile", {
    method: "PUT",
    body: { name },
  })
  if (!body.profile) {
    throw new Error("The profile response did not include profile data.")
  }
  return body.profile
}

/**
 * Profile page for the signed-in user: avatar initial, editable display name,
 * read-only email, and member-since date.
 *
 * Profile data comes from `GET /api/profile` through `useApiQuery` so
 * `?mock=loading|error` behaves like every other screen; the session provides
 * the fallback while the request is in flight. Saving PUTs the display name
 * to the same endpoint.
 */
export function ProfileScreen() {
  const { user } = useMockSession()

  const fallback = useMemo<ProfileData>(
    () => ({
      name: user?.name ?? "",
      email: user?.email ?? "",
      handle: null,
      memberSince: null,
    }),
    [user?.name, user?.email],
  )

  const query = useApiQuery(fetchProfile, [], true, fallback)

  if (query.status === "loading" || query.status === "idle") {
    return (
      <div className="app-page">
        <LoadingPanel label="Loading profile" className="min-h-48">
          <ScreenSkeleton variant="settings" />
        </LoadingPanel>
      </div>
    )
  }

  if (query.status === "error") {
    return (
      <div className="app-page">
        <ErrorState
          title="Profile did not load"
          message="We could not load your profile. Try again to refresh your details."
          error={query.error}
          onRetry={query.refetch}
          isRetrying={query.isRetrying}
        />
      </div>
    )
  }

  return <ProfileContent profile={query.data ?? fallback} />
}

function ProfileContent({ profile }: { profile: ProfileData }) {
  const { toast } = useToast()
  const [displayName, setDisplayName] = useState(profile.name)
  const [handle, setHandle] = useState(profile.handle)
  const [nameError, setNameError] = useState("")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Resync the field when the loaded profile changes (e.g. after a refetch);
  // edits made after the last save are kept while the name is unchanged.
  useEffect(() => {
    setDisplayName(profile.name)
    setHandle(profile.handle)
    setNameError("")
    setSaved(false)
  }, [profile.name, profile.handle])

  const initial = displayName.trim().charAt(0).toUpperCase() || "?"

  async function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = parseDisplayName(displayName)
    if (!parsed.ok) {
      setNameError(parsed.error)
      return
    }

    setSaving(true)
    try {
      const updated = await saveProfileName(parsed.name)
      setDisplayName(updated.name)
      setNameError("")
      setSaved(true)
      toast({
        title: "Profile saved",
        description: "Your display name was updated.",
        variant: "success",
      })
    } catch {
      toast({
        title: "Couldn't save profile",
        description: "Something went wrong. Please try again.",
        variant: "error",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="app-page">
      <header className="app-page-head">
        <div>
          <h1>Profile</h1>
          <p className="app-page-subtitle">
            Your public profile details. The display name is editable; your email stays tied to your
            sign-in.
          </p>
        </div>
      </header>

      <div className="grid max-w-3xl gap-6">
        <form className="app-form" onSubmit={submitProfile}>
          <section className="app-page-card" aria-labelledby="profile-heading">
            <h2 id="profile-heading">Profile</h2>
            <div className="app-field">
              <span className="app-field-label" id="profile-avatar-label">
                Avatar
              </span>
              <div className="app-avatar-row">
                {/* Decorative: the display name is rendered as text right below. */}
                <span className="app-avatar app-avatar--lg" aria-hidden="true">
                  {initial}
                </span>
              </div>
              <p className="app-field-hint">
                Profile photos are not supported yet — this shows your initials.
              </p>
            </div>
            <div className="app-field">
              <label htmlFor="profile-display-name">Display name</label>
              <Input
                id="profile-display-name"
                value={displayName}
                onChange={(event) => {
                  setDisplayName(event.target.value)
                  setSaved(false)
                  if (nameError) setNameError("")
                }}
                maxLength={80}
                autoComplete="name"
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? "profile-display-name-error" : undefined}
              />
              {nameError ? (
                <InlineError id="profile-display-name-error" title={null} message={nameError} />
              ) : null}
            </div>
            <div className="app-field">
              <label htmlFor="profile-email">Email</label>
              <Input id="profile-email" type="email" value={profile.email} disabled readOnly />
              <p className="app-field-hint">
                Email changes require re-verification and are managed in account settings.
              </p>
            </div>
            <UsernamePanel handle={handle} onSaved={setHandle} />
            {profile.memberSince ? (
              <div className="app-field">
                <span className="app-field-label">Member since</span>
                <p>{formatDate(profile.memberSince)}</p>
              </div>
            ) : null}
          </section>

          <div className="app-form-actions app-form-actions--save">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save profile"}
            </Button>
            {saved ? (
              <p className="app-saved-note" role="status">
                <Check aria-hidden="true" />
                Changes saved.
              </p>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  )
}
