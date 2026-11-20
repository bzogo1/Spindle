"use client"

import Link from "next/link"
import { useState } from "react"
import {
  ArrowLeft,
  Bell,
  CalendarClock,
  Mail,
  RotateCcw,
  Send,
  Trash2,
  Volume2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  NOTIFICATION_SCHEDULE_FREQUENCIES,
  type NotificationSchedule,
  type NotificationScheduleFrequency,
  type NotificationScheduleInput,
} from "@/lib/notifications/schedules"
import {
  NOTIFICATION_TEMPLATES,
  getNotificationTemplate,
  renderNotificationTemplate,
} from "@/lib/notifications/templates"

import { formatDateTime } from "./format"
import { CommunicationPreferencesPanel } from "./communication-preferences-panel"
import { NotificationPermissionBanner } from "./notification-permission-banner"
import {
  APP_NOTIFICATION_CATEGORIES,
  APP_NOTIFICATION_DIGEST_FREQUENCIES,
  APP_NOTIFICATION_SOUND_TONES,
  defaultNotificationPreferences,
  useAppNotifications,
  type AppNotificationCategory,
  type AppNotificationDigestFrequency,
  type AppNotificationPreferences,
  type AppNotificationSoundPreferences,
  type AppNotificationSoundTone,
} from "./notifications-provider"

export const CATEGORY_COPY: Record<
  AppNotificationCategory,
  { label: string; description: string }
> = {
  activity: {
    label: "Workspace activity",
    description: "Project updates, file syncs, and workspace events.",
  },
  agent: {
    label: "Agent runs",
    description: "Agent run progress, failures, and requests for review.",
  },
  automation: {
    label: "Automations",
    description: "Scheduled automations and workflow triggers.",
  },
  lab: {
    label: "Lab sessions",
    description: "Lab session starts, completions, and calibration results.",
  },
  mentions: {
    label: "Mentions",
    description: "When teammates mention you or reply in chat.",
  },
  product: {
    label: "Product updates",
    description: "Occasional news about new features and improvements.",
  },
  security: {
    label: "Security alerts",
    description: "Sign-ins, password changes, and other security events.",
  },
}

const DIGEST_COPY: Record<AppNotificationDigestFrequency, string> = {
  off: "No digest — notifications arrive as they happen.",
  daily: "A daily summary of missed notifications.",
  weekly: "A weekly summary of the last 7 days.",
}

const SOUND_TONE_LABELS: Record<AppNotificationSoundTone, string> = {
  chime: "Chime",
  bell: "Bell",
  blip: "Blip",
}

const SCHEDULE_FREQUENCY_LABELS: Record<NotificationScheduleFrequency, string> = {
  once: "Once",
  daily: "Daily",
  weekly: "Weekly",
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const

function ChannelSwitch({
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

function asCategory(value: string | undefined): AppNotificationCategory | undefined {
  return APP_NOTIFICATION_CATEGORIES.includes(value as AppNotificationCategory)
    ? (value as AppNotificationCategory)
    : undefined
}

function scheduleSummary(schedule: NotificationSchedule): string {
  const parts = [SCHEDULE_FREQUENCY_LABELS[schedule.frequency]]
  if (schedule.frequency !== "once" && schedule.time) parts.push(`at ${schedule.time}`)
  if (schedule.frequency === "weekly" && schedule.weekday !== undefined) {
    parts.push(`on ${WEEKDAY_LABELS[schedule.weekday]}`)
  }
  parts.push(`next ${formatDateTime(schedule.fireAt)}`)
  return parts.join(" · ")
}

/**
 * Notification preferences screen. Every control writes straight through to
 * `AppNotificationsProvider.updatePreferences`, which persists to
 * localStorage — there is no save button because changes apply immediately.
 * Email toggles are stored for when the email API lands; the in-app feed is
 * gated live by the same preferences.
 */
export function NotificationPreferencesScreen() {
  const {
    notifications,
    preferences,
    updatePreferences,
    notify,
    schedules,
    addSchedule,
    removeSchedule,
    updateSchedule,
  } = useAppNotifications()

  const [scheduleTitle, setScheduleTitle] = useState("")
  const [scheduleBody, setScheduleBody] = useState("")
  const [scheduleFrequency, setScheduleFrequency] = useState<NotificationScheduleFrequency>("once")
  const [scheduleFireAt, setScheduleFireAt] = useState("")
  const [scheduleTime, setScheduleTime] = useState("09:00")
  const [scheduleWeekday, setScheduleWeekday] = useState("1")
  const [scheduleCategory, setScheduleCategory] = useState("")
  const [scheduleStatus, setScheduleStatus] = useState<string | null>(null)

  const [templateId, setTemplateId] = useState<string>(NOTIFICATION_TEMPLATES[0]?.id ?? "")
  const template = getNotificationTemplate(templateId)
  const templatePreview = template ? renderNotificationTemplate(template) : null

  const [digestStatus, setDigestStatus] = useState<string | null>(null)
  const [digestBusy, setDigestBusy] = useState(false)

  function patch(patchValue: Partial<AppNotificationPreferences>) {
    updatePreferences((current) => ({ ...current, ...patchValue }))
  }

  function patchSound(patchValue: Partial<AppNotificationSoundPreferences>) {
    updatePreferences((current) => ({
      ...current,
      sound: { ...current.sound, ...patchValue },
    }))
  }

  function patchCategory(
    category: AppNotificationCategory,
    channel: "inApp" | "email",
    checked: boolean,
  ) {
    updatePreferences((current) => ({
      ...current,
      categories: {
        ...current.categories,
        [category]: { ...current.categories[category], [channel]: checked },
      },
    }))
  }

  function submitSchedule() {
    const input: NotificationScheduleInput = {
      title: scheduleTitle,
      body: scheduleBody || undefined,
      frequency: scheduleFrequency,
      category: asCategory(scheduleCategory || undefined),
      ...(scheduleFrequency === "once"
        ? { fireAt: scheduleFireAt ? new Date(scheduleFireAt).toISOString() : undefined }
        : {
            time: scheduleTime,
            ...(scheduleFrequency === "weekly"
              ? { weekday: Number.parseInt(scheduleWeekday, 10) }
              : {}),
          }),
    }
    const created = addSchedule(input)
    if (!created) {
      setScheduleStatus("Pick a title and a valid date/time first.")
      return
    }
    setScheduleStatus(null)
    setScheduleTitle("")
    setScheduleBody("")
    setScheduleFireAt("")
  }

  function sendTestNotification() {
    if (!template || !templatePreview) return
    notify({
      type: templatePreview.type,
      title: templatePreview.title,
      body: templatePreview.body,
      href: templatePreview.href,
      category: asCategory(templatePreview.category),
      demo: true,
    })
  }

  async function sendDigestNow() {
    if (preferences.digestFrequency === "off" || digestBusy) return
    setDigestBusy(true)
    setDigestStatus("Sending…")
    try {
      const response = await fetch("/api/notifications/digest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          frequency: preferences.digestFrequency,
          notifications: notifications.map((notification) => ({
            title: notification.title,
            body: notification.body,
            href: notification.href,
            category: notification.category,
            createdAt: notification.createdAt,
          })),
          preferences: {
            email: preferences.email,
            categories: Object.fromEntries(
              APP_NOTIFICATION_CATEGORIES.map((category) => [
                category,
                { email: preferences.categories[category].email },
              ]),
            ),
          },
        }),
      })
      const data = (await response.json().catch(() => ({}))) as {
        delivery?: string
        itemCount?: number
        error?: string
      }
      if (!response.ok) {
        setDigestStatus(data.error ?? "The digest could not be sent.")
        return
      }
      if (data.delivery === "unconfigured") {
        setDigestStatus("Email isn't configured on this deployment — nothing was sent.")
      } else if (data.delivery === "disabled") {
        setDigestStatus("Email notifications are off — enable the email channel first.")
      } else if (data.delivery === "empty" || data.delivery === "not-due") {
        setDigestStatus("No eligible notifications for a digest right now.")
      } else {
        setDigestStatus(
          `Digest sent — ${data.itemCount ?? 0} notification${data.itemCount === 1 ? "" : "s"} included.`,
        )
      }
    } catch {
      setDigestStatus("The digest request failed. Try again later.")
    } finally {
      setDigestBusy(false)
    }
  }

  return (
    <div className="app-page">
      <header className="app-page-head">
        <div>
          <h1>Notification preferences</h1>
          <p className="app-page-subtitle">
            Choose which updates reach you and how often. Changes apply immediately and are stored
            in this browser.
          </p>
        </div>
        <div className="app-page-actions">
          <Button asChild variant="outline">
            <Link href="/dashboard/notifications">
              <ArrowLeft aria-hidden="true" />
              Back to notifications
            </Link>
          </Button>
        </div>
      </header>

      <div className="grid max-w-3xl gap-6">
        <section className="app-page-card" aria-labelledby="notification-prefs-channels">
          <h2 id="notification-prefs-channels">Delivery channels</h2>
          <div className="grid gap-2.5">
            <ChannelSwitch
              label="In-app notifications"
              description="Show notifications in the bell and the notifications page."
              checked={preferences.inApp}
              disabled={preferences.muted}
              onCheckedChange={(inApp) => patch({ inApp })}
            />
            <ChannelSwitch
              label="Email notifications"
              description="Email updates for the categories you enable below. Email delivery is not wired up yet — preferences are stored for when it lands."
              checked={preferences.email}
              onCheckedChange={(email) => patch({ email })}
            />
            <ChannelSwitch
              label="System notifications"
              description="Mirror delivered notifications to the OS notification center. Requires browser permission — see below."
              checked={preferences.system}
              onCheckedChange={(system) => patch({ system })}
            />
            <ChannelSwitch
              label="Pause all notifications"
              description="Mute the in-app feed until you turn this off."
              checked={preferences.muted}
              onCheckedChange={(muted) => patch({ muted })}
            />
          </div>
        </section>

        <NotificationPermissionBanner />

        <section className="app-page-card" aria-labelledby="notification-prefs-categories">
          <h2 id="notification-prefs-categories">Categories</h2>
          <p>
            Per-category delivery for each channel. In-app toggles take effect immediately; email
            toggles apply once email delivery lands.
          </p>
          <div className="grid gap-2.5">
            {APP_NOTIFICATION_CATEGORIES.map((category) => {
              const copy = CATEGORY_COPY[category]
              const categoryPrefs = preferences.categories[category]
              return (
                <div key={category} className="app-pref-row">
                  <div>
                    <strong>{copy.label}</strong>
                    <small>{copy.description}</small>
                  </div>
                  <div className="flex items-center gap-4">
                    <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
                      <Bell aria-hidden="true" className="size-3.5" />
                      In-app
                      <Switch
                        checked={categoryPrefs.inApp}
                        disabled={!preferences.inApp || preferences.muted}
                        onCheckedChange={(checked) => patchCategory(category, "inApp", checked)}
                        aria-label={`${copy.label} in-app`}
                      />
                    </label>
                    <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
                      <Mail aria-hidden="true" className="size-3.5" />
                      Email
                      <Switch
                        checked={categoryPrefs.email}
                        disabled={!preferences.email}
                        onCheckedChange={(checked) => patchCategory(category, "email", checked)}
                        aria-label={`${copy.label} email`}
                      />
                    </label>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <section className="app-page-card" aria-labelledby="notification-prefs-schedules">
          <h2 id="notification-prefs-schedules">Scheduled notifications</h2>
          <p>
            Schedule a notification for later. One-shot reminders fire once; daily and weekly
            schedules repeat. Schedules only fire while the app is open in a tab.
          </p>

          {schedules.length > 0 ? (
            <ul className="mb-4 grid gap-2">
              {schedules.map((schedule) => (
                <li key={schedule.id} className="app-pref-row">
                  <div>
                    <strong>{schedule.title}</strong>
                    <small>{scheduleSummary(schedule)}</small>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={schedule.enabled}
                      onCheckedChange={(enabled) => updateSchedule(schedule.id, { enabled })}
                      aria-label={`Enable schedule ${schedule.title}`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete schedule ${schedule.title}`}
                      onClick={() => removeSchedule(schedule.id)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground mb-4 text-sm">No scheduled notifications yet.</p>
          )}

          <div className="grid gap-3">
            <div className="app-field">
              <label htmlFor="schedule-title">Title</label>
              <input
                id="schedule-title"

                value={scheduleTitle}
                onChange={(event) => setScheduleTitle(event.target.value)}
                placeholder="Reminder title"
                maxLength={200}
              />
            </div>
            <div className="app-field">
              <label htmlFor="schedule-body">Message (optional)</label>
              <input
                id="schedule-body"

                value={scheduleBody}
                onChange={(event) => setScheduleBody(event.target.value)}
                placeholder="Notification body"
                maxLength={2000}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="app-field">
                <label htmlFor="schedule-frequency">Repeats</label>
                <select
                  id="schedule-frequency"
                  className="app-select"
                  value={scheduleFrequency}
                  onChange={(event) =>
                    setScheduleFrequency(event.target.value as NotificationScheduleFrequency)
                  }
                >
                  {NOTIFICATION_SCHEDULE_FREQUENCIES.map((frequency) => (
                    <option key={frequency} value={frequency}>
                      {SCHEDULE_FREQUENCY_LABELS[frequency]}
                    </option>
                  ))}
                </select>
              </div>
              {scheduleFrequency === "once" ? (
                <div className="app-field">
                  <label htmlFor="schedule-fire-at">Date &amp; time</label>
                  <input
                    id="schedule-fire-at"
                    type="datetime-local"

                    value={scheduleFireAt}
                    onChange={(event) => setScheduleFireAt(event.target.value)}
                  />
                </div>
              ) : (
                <>
                  <div className="app-field">
                    <label htmlFor="schedule-time">Time of day</label>
                    <input
                      id="schedule-time"
                      type="time"

                      value={scheduleTime}
                      onChange={(event) => setScheduleTime(event.target.value)}
                    />
                  </div>
                  {scheduleFrequency === "weekly" ? (
                    <div className="app-field">
                      <label htmlFor="schedule-weekday">Day of week</label>
                      <select
                        id="schedule-weekday"
                        className="app-select"
                        value={scheduleWeekday}
                        onChange={(event) => setScheduleWeekday(event.target.value)}
                      >
                        {WEEKDAY_LABELS.map((label, index) => (
                          <option key={label} value={index}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </>
              )}
              <div className="app-field">
                <label htmlFor="schedule-category">Category</label>
                <select
                  id="schedule-category"
                  className="app-select"
                  value={scheduleCategory}
                  onChange={(event) => setScheduleCategory(event.target.value)}
                >
                  <option value="">Uncategorized</option>
                  {APP_NOTIFICATION_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {CATEGORY_COPY[category].label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="app-form-actions">
              <Button type="button" onClick={submitSchedule}>
                <CalendarClock aria-hidden="true" />
                Schedule notification
              </Button>
              {scheduleStatus ? (
                <p className="text-muted-foreground text-sm" role="status">
                  {scheduleStatus}
                </p>
              ) : null}
            </div>
          </div>
        </section>

        <section className="app-page-card" aria-labelledby="notification-prefs-templates">
          <h2 id="notification-prefs-templates">Notification templates</h2>
          <p>
            Predefined copy for common events. Pick a template to preview it, then send a test
            notification to see how it lands in the feed.
          </p>
          <div className="grid gap-3">
            <div className="app-field">
              <label htmlFor="notification-template">Template</label>
              <select
                id="notification-template"
                className="app-select"
                value={templateId}
                onChange={(event) => setTemplateId(event.target.value)}
              >
                {NOTIFICATION_TEMPLATES.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
              {template ? <p className="app-field-hint">{template.description}</p> : null}
            </div>
            {templatePreview ? (
              <div className="app-pref-row">
                <div>
                  <strong>{templatePreview.title}</strong>
                  <small>{templatePreview.body}</small>
                </div>
              </div>
            ) : null}
            <div className="app-form-actions">
              <Button type="button" variant="outline" onClick={sendTestNotification}>
                <Send aria-hidden="true" />
                Send test notification
              </Button>
            </div>
          </div>
        </section>

        <section className="app-page-card" aria-labelledby="notification-prefs-digest">
          <h2 id="notification-prefs-digest">Digest</h2>
          <div className="app-field">
            <label htmlFor="notification-digest-frequency">Digest frequency</label>
            <select
              id="notification-digest-frequency"
              className="app-select"
              value={preferences.digestFrequency}
              onChange={(event) =>
                patch({
                  digestFrequency: event.target.value as AppNotificationDigestFrequency,
                })
              }
            >
              {APP_NOTIFICATION_DIGEST_FREQUENCIES.map((frequency) => (
                <option key={frequency} value={frequency}>
                  {frequency === "off" ? "Off" : frequency === "daily" ? "Daily" : "Weekly"}
                </option>
              ))}
            </select>
            <p className="app-field-hint">{DIGEST_COPY[preferences.digestFrequency]}</p>
          </div>
          <div className="app-form-actions">
            <Button
              type="button"
              variant="outline"
              onClick={sendDigestNow}
              disabled={preferences.digestFrequency === "off" || digestBusy}
            >
              <Send aria-hidden="true" />
              {digestBusy ? "Sending…" : "Send digest now"}
            </Button>
            {digestStatus ? (
              <p className="text-muted-foreground text-sm" role="status">
                {digestStatus}
              </p>
            ) : null}
          </div>
        </section>

        <section className="app-page-card" aria-labelledby="notification-prefs-sound">
          <h2 id="notification-prefs-sound">Sound</h2>
          <div className="grid gap-2.5">
            <ChannelSwitch
              label="Notification sounds"
              description="Play a short sound in this browser when a notification arrives. Sounds only play for notifications that reach the in-app feed."
              checked={preferences.sound.enabled}
              onCheckedChange={(enabled) => patchSound({ enabled })}
            />
            <div className="app-field">
              <label htmlFor="notification-sound-tone">Sound tone</label>
              <select
                id="notification-sound-tone"
                className="app-select"
                value={preferences.sound.tone}
                disabled={!preferences.sound.enabled}
                onChange={(event) =>
                  patchSound({ tone: event.target.value as AppNotificationSoundTone })
                }
              >
                {APP_NOTIFICATION_SOUND_TONES.map((tone) => (
                  <option key={tone} value={tone}>
                    {SOUND_TONE_LABELS[tone]}
                  </option>
                ))}
              </select>
              <p className="app-field-hint">
                <Volume2 aria-hidden="true" className="mr-1 inline size-3.5" />
                Preview: the selected tone plays the next time a notification arrives.
              </p>
            </div>
          </div>
        </section>

        {/* Account-level email/product communication prefs (server-backed). */}
        <CommunicationPreferencesPanel />

        <div className="app-form-actions">
          <Button
            type="button"
            variant="outline"
            onClick={() => updatePreferences(defaultNotificationPreferences())}
          >
            <RotateCcw aria-hidden="true" />
            Reset to defaults
          </Button>
        </div>
      </div>
    </div>
  )
}
