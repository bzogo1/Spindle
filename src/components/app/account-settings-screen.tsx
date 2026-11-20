"use client"

import Link from "next/link"
import { useEffect, useRef, useState, type FormEvent } from "react"
import { Check, Download, KeyRound, MonitorSmartphone, ShieldCheck } from "lucide-react"

import { useMockSession } from "@/components/app/mock-session-provider"
import { useAppTheme } from "@/components/app/use-app-theme"
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
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/toast"
import { request } from "@/lib/api/client"
import { useApiQuery } from "@/lib/api/use-api-query"
import { parseDisplayName } from "@/lib/profile"
import { ErrorState } from "@/components/app/states/error-state"
import { InlineError } from "@/components/app/states/inline-error"
import { LoadingPanel } from "@/components/app/states/loading-panel"
import { ScreenSkeleton } from "@/components/app/states/skeleton"
import { BackupCodesPanel, type BackupCodesStatus } from "@/components/auth/backup-codes-panel"
import { EmergencyCodesPanel } from "@/components/auth/emergency-codes-panel"
import { TwoFactorRecoveryRequest } from "@/components/auth/two-factor-recovery-request"
import { TrustedDevicesPanel } from "@/components/auth/trusted-devices-panel"
import { TwoFactorRecoveryStatus } from "@/components/auth/two-factor-recovery-status"
import { EmailChangePanel } from "@/components/app/email-change-panel"
import { AvatarUpload } from "@/components/app/avatar-upload"

const TIMEZONES: string[] =
  typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone")
    : [
        "UTC",
        "Europe/London",
        "Europe/Berlin",
        "Europe/Zagreb",
        "America/New_York",
        "America/Chicago",
        "America/Denver",
        "America/Los_Angeles",
        "America/Sao_Paulo",
        "Asia/Dubai",
        "Asia/Kolkata",
        "Asia/Singapore",
        "Asia/Tokyo",
        "Australia/Sydney",
      ]

/** Mock recovery codes shown in the 2FA setup placeholder. */
const RECOVERY_CODES = [
  "K7X2-9Q4M-PL3D",
  "R8T4-W6N1-ZX5C",
  "H2J9-F4B7-VK8S",
  "M5Q1-L8D3-RT6Y",
  "P9W2-G7H4-NM1K",
  "T3Y8-U6I5-OL2P",
  "B4E7-A1S9-DK5F",
  "C6R2-T9Y4-WQ8Z",
]

type ThemePreference = "light" | "dark"

interface AccountProfile {
  name: string
  email: string
}

type ExportStatus = "idle" | "working" | "ready"

interface PasswordErrors {
  current?: string
  next?: string
  confirm?: string
}

function passwordStrength(password: string): { score: number; label: string } {
  if (!password) return { score: 0, label: "" }
  let score = 0
  if (password.length >= 8) score += 1
  if (password.length >= 12) score += 1
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1
  if (/\d/.test(password)) score += 1
  if (/[^a-zA-Z0-9]/.test(password)) score += 1
  const label = score <= 1 ? "Weak" : score === 2 ? "Fair" : score === 3 ? "Good" : "Strong"
  return { score, label }
}

function TwoFactorDialog({
  mode,
  code,
  onCodeChange,
  onClose,
  onConfirm,
}: {
  mode: "enable" | "disable"
  code: string
  onCodeChange: (value: string) => void
  onClose: () => void
  onConfirm: () => void
}) {
  const isEnable = mode === "enable"
  const codeValid = /^\d{6}$/.test(code)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEnable ? "Set up two-factor authentication" : "Disable two-factor authentication"}
          </DialogTitle>
          <DialogDescription>
            {isEnable
              ? "Scan the QR code with your authenticator app, then enter the 6-digit code to finish setup. This flow is a placeholder until the 2FA API lands."
              : "You will no longer need a verification code at sign-in. Your account becomes less secure. This is a local preview — nothing changes on the server."}
          </DialogDescription>
        </DialogHeader>

        {isEnable ? (
          <div className="app-2fa-setup">
            <div className="app-qr-placeholder" role="img" aria-label="QR code placeholder">
              QR code
              <br />
              placeholder
            </div>
            <div className="app-field">
              <label htmlFor="account-totp-code">Verification code</label>
              <Input
                id="account-totp-code"
                value={code}
                onChange={(event) =>
                  onCodeChange(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                maxLength={6}
              />
            </div>
            <div className="app-field">
              <span className="app-field-label">Recovery codes</span>
              <ul className="app-recovery-codes">
                {RECOVERY_CODES.map((recoveryCode) => (
                  <li key={recoveryCode}>
                    <code>{recoveryCode}</code>
                  </li>
                ))}
              </ul>
              <p className="app-field-hint">Store these somewhere safe. Each code works once.</p>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={isEnable ? "default" : "destructive"}
            disabled={isEnable && !codeValid}
            onClick={onConfirm}
          >
            {isEnable ? "Enable two-factor" : "Disable two-factor"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Account settings for the signed-in user: profile, preferences, password,
 * two-factor, sessions, and data export.
 *
 * The screen loads through `useApiQuery` so `?mock=loading|error` behaves like
 * every other screen. The display name saves through `PUT /api/profile`; most
 * remaining sections have no backend yet (`AuthApi` only covers
 * session/login/logout), so their mutations are validated locally and
 * confirmed with toasts that call out the missing endpoint — see
 * issues/frontend/039. Sessions are the exception: the card here links to
 * the real `/app/sessions` screen backed by `GET /api/auth/sessions`.
 */
export function AccountSettingsScreen() {
  const { user, workspace } = useMockSession()
  const profile: AccountProfile = { name: user?.name ?? "", email: user?.email ?? "" }

  const query = useApiQuery(async () => profile, [], true, profile)

  if (query.status === "loading" || query.status === "idle") {
    return (
      <div className="app-page">
        <LoadingPanel label="Loading account settings" className="min-h-48">
          <ScreenSkeleton variant="settings" />
        </LoadingPanel>
      </div>
    )
  }

  if (query.status === "error") {
    return (
      <div className="app-page">
        <ErrorState
          title="Account settings did not load"
          message="We could not load your account settings. Try again to refresh your profile and security options."
          error={query.error}
          onRetry={query.refetch}
          isRetrying={query.isRetrying}
        />
      </div>
    )
  }

  return (
    <AccountSettingsContent profile={query.data ?? profile} workspaceName={workspace?.name ?? ""} />
  )
}

function AccountSettingsContent({
  profile,
  workspaceName,
}: {
  profile: AccountProfile
  workspaceName: string
}) {
  const { toast } = useToast()
  const { dark, set: setDarkTheme } = useAppTheme()
  const theme: ThemePreference = dark ? "dark" : "light"

  // Profile
  const [displayName, setDisplayName] = useState(profile.name)
  const [nameError, setNameError] = useState("")
  const [profileSaving, setProfileSaving] = useState(false)

  // Preferences
  const [timezone, setTimezone] = useState("")
  const [notifyProduct, setNotifyProduct] = useState(true)
  const [notifyDigest, setNotifyDigest] = useState(false)

  // Password
  const [password, setPassword] = useState({ current: "", next: "", confirm: "" })
  const [passwordErrors, setPasswordErrors] = useState<PasswordErrors>({})
  const [passwordSaving, setPasswordSaving] = useState(false)

  // Two-factor. The enable/disable dialog is still a local preview, but the
  // real enabled state comes from GET /api/auth/2fa/backup-codes (`enabled`)
  // so security UI (backup codes) only appears for accounts that actually
  // have 2FA on. The local override keeps the stub dialog responsive.
  const twoFactorStatus = useApiQuery(
    async () => request<BackupCodesStatus>("", "/api/auth/2fa/backup-codes"),
    [],
  )
  const apiTwoFactorEnabled = twoFactorStatus.data?.enabled === true
  const [twoFactorEnabledOverride, setTwoFactorEnabledOverride] = useState<boolean | null>(null)
  const twoFactorEnabled = twoFactorEnabledOverride ?? apiTwoFactorEnabled
  const [twoFactorDialog, setTwoFactorDialog] = useState<"enable" | "disable" | null>(null)
  const [totpCode, setTotpCode] = useState("")

  // Sessions live on the dedicated /app/sessions screen now — this card only
  // links there.

  // Data export
  const [exportStatus, setExportStatus] = useState<ExportStatus>("idle")
  const [exportUrl, setExportUrl] = useState<string | null>(null)

  const [savedSection, setSavedSection] = useState<"profile" | "preferences" | null>(null)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const passwordTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const exportTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const exportUrlRef = useRef<string | null>(null)
  exportUrlRef.current = exportUrl

  useEffect(() => {
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC")
  }, [])

  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current)
      if (passwordTimer.current) clearTimeout(passwordTimer.current)
      if (exportTimer.current) clearTimeout(exportTimer.current)
      if (exportUrlRef.current) URL.revokeObjectURL(exportUrlRef.current)
    },
    [],
  )

  function markSaved(section: "profile" | "preferences") {
    setSavedSection(section)
    if (savedTimer.current) clearTimeout(savedTimer.current)
    savedTimer.current = setTimeout(() => setSavedSection(null), 4000)
  }

  async function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = parseDisplayName(displayName)
    if (!parsed.ok) {
      setNameError(parsed.error)
      return
    }
    setNameError("")

    setProfileSaving(true)
    try {
      await request("", "/api/profile", { method: "PUT", body: { name: parsed.name } })
      markSaved("profile")
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
      setProfileSaving(false)
    }
  }

  function submitPreferences(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    markSaved("preferences")
    toast({
      title: "Preferences saved",
      description:
        "Your preferences are stored locally — the settings endpoint is not wired up yet.",
      variant: "success",
    })
  }

  function updatePasswordField(field: keyof typeof password, value: string) {
    setPassword((current) => ({ ...current, [field]: value }))
    setPasswordErrors((current) => ({ ...current, [field]: undefined }))
  }

  function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const errors: PasswordErrors = {}
    if (!password.current) errors.current = "Enter your current password."
    if (password.next.length < 8) errors.next = "Use at least 8 characters."
    if (password.confirm !== password.next) errors.confirm = "Passwords do not match."
    setPasswordErrors(errors)
    if (Object.values(errors).some(Boolean)) return

    setPasswordSaving(true)
    passwordTimer.current = setTimeout(() => {
      setPasswordSaving(false)
      setPassword({ current: "", next: "", confirm: "" })
      setPasswordErrors({})
      toast({
        title: "Password updated",
        description:
          "Your new password was accepted locally — the change-password endpoint is not wired up yet.",
        variant: "success",
      })
    }, 700)
  }

  const strength = passwordStrength(password.next)

  function confirmTwoFactor() {
    const enabling = twoFactorDialog === "enable"
    setTwoFactorDialog(null)
    setTotpCode("")
    setTwoFactorEnabledOverride(enabling)
    toast({
      title: enabling ? "Two-factor authentication enabled" : "Two-factor authentication disabled",
      description: enabling
        ? "A verification code will be required at sign-in (local preview)."
        : "Sign-in no longer requires a verification code (local preview).",
      variant: enabling ? "success" : "warning",
    })
  }

  function requestExport() {
    if (exportUrl) URL.revokeObjectURL(exportUrl)
    setExportUrl(null)
    setExportStatus("working")
    exportTimer.current = setTimeout(() => {
      const payload = {
        exportedAt: new Date().toISOString(),
        note: "Local preview export — the data export API is not wired up yet.",
        user: { name: profile.name, email: profile.email },
        workspace: workspaceName || null,
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      })
      const url = URL.createObjectURL(blob)
      setExportUrl(url)
      setExportStatus("ready")
      toast({
        title: "Export ready",
        description: "Your data export is ready to download.",
        variant: "success",
      })
    }, 800)
  }

  return (
    <div className="app-page">
      <header className="app-page-head">
        <div>
          <h1>Account settings</h1>
          <p className="app-page-subtitle">
            Manage your profile, security, and data. Security and export sections are local previews
            until their APIs land; sessions live on the dedicated Sessions page.
          </p>
        </div>
      </header>

      <div className="grid max-w-3xl gap-6">
        <form className="app-form" onSubmit={submitProfile}>
          <section className="app-page-card" aria-labelledby="account-profile-heading">
            <h2 id="account-profile-heading">Profile</h2>
            <AvatarUpload name={displayName || profile.name} size="lg" />
            <div className="app-field">
              <label htmlFor="account-display-name">Display name</label>
              <Input
                id="account-display-name"
                value={displayName}
                onChange={(event) => {
                  setDisplayName(event.target.value)
                  if (nameError) setNameError("")
                }}
                maxLength={80}
                autoComplete="name"
                aria-invalid={nameError ? true : undefined}
              />
              {nameError ? <InlineError title={null} message={nameError} /> : null}
            </div>
            <EmailChangePanel currentEmail={profile.email} />
          </section>

          <div className="app-form-actions app-form-actions--save">
            <Button type="submit" disabled={profileSaving}>
              {profileSaving ? "Saving…" : "Save profile"}
            </Button>
            {savedSection === "profile" ? (
              <p className="app-saved-note" role="status">
                <Check aria-hidden="true" />
                Changes saved.
              </p>
            ) : null}
          </div>
        </form>

        <form className="app-form" onSubmit={submitPreferences}>
          <section className="app-page-card" aria-labelledby="account-preferences-heading">
            <h2 id="account-preferences-heading">Preferences</h2>
            <div className="app-field">
              <label htmlFor="account-theme">Theme</label>
              <select
                id="account-theme"
                className="app-select"
                value={theme}
                onChange={(event) => setDarkTheme(event.target.value === "dark")}
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </div>
            <div className="app-field">
              <label htmlFor="account-timezone">Timezone</label>
              <select
                id="account-timezone"
                className="app-select"
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
              >
                {TIMEZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </div>
            <fieldset className="app-field app-notification-group">
              <legend>Notifications</legend>
              <div className="app-pref-row">
                <div>
                  <strong>Product updates</strong>
                  <small>Occasional news about new features and improvements.</small>
                </div>
                <Switch
                  checked={notifyProduct}
                  onCheckedChange={setNotifyProduct}
                  aria-label="Product updates"
                />
              </div>
              <div className="app-pref-row">
                <div>
                  <strong>Weekly digest</strong>
                  <small>A summary of workspace activity every Monday.</small>
                </div>
                <Switch
                  checked={notifyDigest}
                  onCheckedChange={setNotifyDigest}
                  aria-label="Weekly digest"
                />
              </div>
              <div className="app-pref-row">
                <div>
                  <strong>Security alerts</strong>
                  <small>Sign-ins, password changes, and other security events.</small>
                </div>
                <Switch checked disabled aria-label="Security alerts (always on)" />
              </div>
            </fieldset>
          </section>

          <div className="app-form-actions app-form-actions--save">
            <Button type="submit">Save preferences</Button>
            {savedSection === "preferences" ? (
              <p className="app-saved-note" role="status">
                <Check aria-hidden="true" />
                Changes saved.
              </p>
            ) : null}
          </div>
        </form>

        <form className="app-form" onSubmit={submitPassword}>
          <section className="app-page-card" aria-labelledby="account-password-heading">
            <h2 id="account-password-heading">Password</h2>
            <p>
              Change the password used to sign in. Password changes are validated locally and will
              sync once the endpoint lands.
            </p>
            <div className="app-form-grid">
              <div className="app-field">
                <label htmlFor="account-password-current">Current password</label>
                <Input
                  id="account-password-current"
                  type="password"
                  value={password.current}
                  onChange={(event) => updatePasswordField("current", event.target.value)}
                  autoComplete="current-password"
                  aria-invalid={passwordErrors.current ? true : undefined}
                />
                {passwordErrors.current ? (
                  <InlineError title={null} message={passwordErrors.current} />
                ) : null}
              </div>
              <div className="app-field">
                <label htmlFor="account-password-new">New password</label>
                <Input
                  id="account-password-new"
                  type="password"
                  value={password.next}
                  onChange={(event) => updatePasswordField("next", event.target.value)}
                  autoComplete="new-password"
                  aria-invalid={passwordErrors.next ? true : undefined}
                />
                {passwordErrors.next ? (
                  <InlineError title={null} message={passwordErrors.next} />
                ) : null}
              </div>
            </div>
            <div className="app-field">
              <label htmlFor="account-password-confirm">Confirm new password</label>
              <Input
                id="account-password-confirm"
                type="password"
                value={password.confirm}
                onChange={(event) => updatePasswordField("confirm", event.target.value)}
                autoComplete="new-password"
                aria-invalid={passwordErrors.confirm ? true : undefined}
              />
              {passwordErrors.confirm ? (
                <InlineError title={null} message={passwordErrors.confirm} />
              ) : null}
            </div>
            <div className="app-field app-strength">
              <div className="app-strength-label">
                Password strength{strength.label ? `: ${strength.label}` : ""}
              </div>
              <Progress value={(strength.score / 5) * 100} aria-label="Password strength" />
            </div>
          </section>

          <div className="app-form-actions">
            <Button type="submit" disabled={passwordSaving}>
              <KeyRound aria-hidden="true" />
              {passwordSaving ? "Updating…" : "Update password"}
            </Button>
          </div>
        </form>

        <section className="app-page-card" aria-labelledby="account-2fa-heading">
          <h2 id="account-2fa-heading">Two-factor authentication</h2>
          <div className="app-pref-row">
            <div>
              <strong>Authenticator app</strong>
              <small>
                {twoFactorEnabled
                  ? "Enabled — a verification code is required at sign-in."
                  : "Disabled — only your password protects your account."}
              </small>
            </div>
            <Badge variant={twoFactorEnabled ? "default" : "outline"}>
              {twoFactorEnabled ? "On" : "Off"}
            </Badge>
          </div>
          <p className="app-field-hint" style={{ marginTop: 10 }}>
            Two-factor setup is a placeholder until the 2FA API lands; changes apply locally only.
          </p>
          <div className="app-form-actions" style={{ marginTop: 12 }}>
            {twoFactorEnabled ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setTotpCode("")
                  setTwoFactorDialog("disable")
                }}
              >
                <ShieldCheck aria-hidden="true" />
                Disable two-factor
              </Button>
            ) : (
              <Button
                type="button"
                onClick={() => {
                  setTotpCode("")
                  setTwoFactorDialog("enable")
                }}
              >
                <ShieldCheck aria-hidden="true" />
                Enable two-factor
              </Button>
            )}
          </div>
          {apiTwoFactorEnabled ? (
            <>
              <BackupCodesPanel />
              {/* Lost-device recovery: status shows any pending/cooling-down
                  recovery (self-hides when none); the request panel emails a
                  single-use recovery link. Both are real API surfaces, so
                  they gate on the same `apiTwoFactorEnabled` flag. */}
              <TwoFactorRecoveryStatus />
              <TwoFactorRecoveryRequest />
            </>
          ) : null}
        </section>

        <section className="app-page-card" aria-labelledby="account-emergency-heading">
          <h2 id="account-emergency-heading">Emergency access</h2>
          <p>
            Break-glass codes for the rare case where you cannot sign in any other way — lost
            password, lost authenticator, and no inbox access. Using a code at{" "}
            <code>/emergency-access</code> never signs you in directly: it forces a password reset
            and signs out every device.
          </p>
          <EmergencyCodesPanel />
        </section>

        <section className="app-page-card" aria-labelledby="account-sessions-heading">
          <h2 id="account-sessions-heading">Sessions</h2>
          <p>Devices currently signed in to your account.</p>
          <div className="app-form-actions" style={{ marginTop: 12 }}>
            <Button asChild variant="outline">
              <Link href="/app/sessions">
                <MonitorSmartphone aria-hidden="true" />
                Manage sessions
              </Link>
            </Button>
          </div>
          <p className="app-field-hint" style={{ marginTop: 10 }}>
            View every device signed in to your account and sign out everywhere from the Sessions
            page.
          </p>
        </section>

        {/* Device trust: real API surface (/api/auth/device-trust) — the panel
            fetches and manages grants itself, so it mounts as a standalone
            section like the other auth panels. */}
        <TrustedDevicesPanel />

        <section className="app-page-card" aria-labelledby="account-export-heading">
          <h2 id="account-export-heading">Data export</h2>
          <p>Download a copy of your profile and workspace data as JSON.</p>
          <div className="app-form-actions" style={{ marginTop: 12 }}>
            <Button
              type="button"
              variant="outline"
              onClick={requestExport}
              disabled={exportStatus === "working"}
            >
              <Download aria-hidden="true" />
              {exportStatus === "working"
                ? "Preparing export…"
                : exportStatus === "ready"
                  ? "Request a new export"
                  : "Request data export"}
            </Button>
            {exportStatus === "ready" && exportUrl ? (
              <Button asChild variant="default" size="sm">
                <a href={exportUrl} download="spindle-account-export.json">
                  <Download aria-hidden="true" />
                  Download export
                </a>
              </Button>
            ) : null}
          </div>
          <p
            className={`app-export-status${exportStatus === "ready" ? "app-export-ready" : ""}`}
            role={exportStatus === "idle" ? undefined : "status"}
            style={{ marginTop: 10 }}
          >
            {exportStatus === "working"
              ? "Preparing your export…"
              : exportStatus === "ready"
                ? "Export ready — download it before requesting a new one."
                : "Exports are generated locally for now; the export endpoint is not wired up yet."}
          </p>
        </section>
      </div>

      {twoFactorDialog ? (
        <TwoFactorDialog
          mode={twoFactorDialog}
          code={totpCode}
          onCodeChange={setTotpCode}
          onClose={() => {
            setTwoFactorDialog(null)
            setTotpCode("")
          }}
          onConfirm={confirmTwoFactor}
        />
      ) : null}
    </div>
  )
}
