import { expect, test, type BrowserContext, type Page } from "playwright/test"

import { signInToMockApp } from "../visual/visual-helpers"

/**
 * Cross-browser coverage for the notification-schedule form on
 * `/app/account/notifications` — the app's most browser-sensitive inputs:
 *
 * - `input[type="datetime-local"]` (#schedule-fire-at): each engine ships a
 *   different picker UI and value serialization; `fill` must produce a value
 *   `new Date()` can parse in every engine.
 * - `input[type="time"]` (#schedule-time): same story for recurring schedules.
 * - `<select>` (#schedule-frequency) switching which input is rendered.
 * - localStorage persistence (`spindle-notification-schedules`) + hydration
 *   on reload, and locale-sensitive `toLocaleString` in the schedule summary
 *   (`formatDateTime` in src/components/app/format.ts).
 *
 * Runs under every project in playwright.crossbrowser.config.ts; each project
 * gets a fresh browser context, so schedules never leak between engines.
 */

const SCHEDULES_STORAGE_KEY = "spindle-notification-schedules"
const NOTIFICATIONS_PATH = "/app/account/notifications"

/** "YYYY-MM-DDTHH:mm" ~48h in the future, in the browser's local timezone. */
function futureLocalDateTime(): string {
  const date = new Date(Date.now() + 48 * 60 * 60 * 1000)
  const pad = (value: number) => String(value).padStart(2, "0")
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

async function gotoNotificationPrefs(
  page: Page,
  context: BrowserContext,
  baseURL: string | undefined,
) {
  await signInToMockApp(context, baseURL)
  await page.goto(NOTIFICATIONS_PATH)
  await expect(page.getByRole("heading", { name: "Scheduled notifications" })).toBeVisible({
    timeout: 15_000,
  })
}

test.describe("notification schedules — native date/time inputs", () => {
  test("creates a one-shot schedule via datetime-local and persists it", async ({
    page,
    context,
    baseURL,
  }) => {
    await gotoNotificationPrefs(page, context, baseURL)

    const fireAt = futureLocalDateTime()
    await page.locator("#schedule-title").fill("Cross-browser one-shot")
    await page.locator("#schedule-fire-at").fill(fireAt)
    // The fill must be readable back in the engine's own serialization —
    // WebKit is the engine most likely to reject a malformed value silently.
    await expect(page.locator("#schedule-fire-at")).toHaveValue(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)

    await page.getByRole("button", { name: "Schedule notification" }).click()

    const row = page.locator("li.app-pref-row", { hasText: "Cross-browser one-shot" })
    await expect(row).toBeVisible()
    // Summary is "Once · next <locale-formatted datetime>" — Intl output
    // differs per engine/locale, so only assert the stable parts.
    await expect(row.locator("small")).toContainText("Once")
    await expect(row.locator("small")).toContainText("next")

    // Persisted to localStorage and re-hydrated after a full reload.
    const stored = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      SCHEDULES_STORAGE_KEY,
    )
    expect(stored).toContain("Cross-browser one-shot")

    await page.reload()
    await expect(page.getByRole("heading", { name: "Scheduled notifications" })).toBeVisible({
      timeout: 15_000,
    })
    await expect(
      page.locator("li.app-pref-row", { hasText: "Cross-browser one-shot" }),
    ).toBeVisible()
  })

  test("creates a weekly schedule via the time input", async ({ page, context, baseURL }) => {
    await gotoNotificationPrefs(page, context, baseURL)

    await page.locator("#schedule-title").fill("Cross-browser weekly")
    await page.locator("#schedule-frequency").selectOption("weekly")
    // The once-only datetime input is swapped for a wall-clock time input.
    await expect(page.locator("#schedule-fire-at")).toBeHidden()
    await page.locator("#schedule-time").fill("09:30")
    await expect(page.locator("#schedule-time")).toHaveValue("09:30")

    await page.getByRole("button", { name: "Schedule notification" }).click()

    const row = page.locator("li.app-pref-row", { hasText: "Cross-browser weekly" })
    await expect(row).toBeVisible()
    // Summary shape: "Weekly · at 09:30 · on <weekday> · next <datetime>".
    await expect(row.locator("small")).toContainText("Weekly")
    await expect(row.locator("small")).toContainText("09:30")
  })

  test("rejects a one-shot schedule without a date and keeps the form usable", async ({
    page,
    context,
    baseURL,
  }) => {
    await gotoNotificationPrefs(page, context, baseURL)

    await page.locator("#schedule-title").fill("Missing date")
    await page.getByRole("button", { name: "Schedule notification" }).click()

    // Scoped by text: AppShell's RouteAnnouncer is a second role="status"
    // element on every (app) page, so a bare getByRole("status") is ambiguous.
    await expect(page.getByText("Pick a title and a valid date/time first.")).toBeVisible()
    // Form is not reset on failure — the title the user typed is still there.
    await expect(page.locator("#schedule-title")).toHaveValue("Missing date")
  })
})
