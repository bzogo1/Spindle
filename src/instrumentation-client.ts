import * as Sentry from "@sentry/nextjs"

import { clientEnv, DEFAULT_SENTRY_RELEASE } from "@/lib/env"
import { hasConsent, onConsentChange } from "@/lib/consent"

// Replay, feedback, and console capture are non-essential Sentry components,
// so they are registered on demand: error monitoring and tracing start
// immediately, but replay waits for session replay consent and the feedback
// widget / console capture wait for the page to go idle. Nothing is recorded
// until session replay consent is present.
const DEFAULT_TRACES_SAMPLE_RATE = 0.1

const replayOptions: Parameters<typeof Sentry.replayIntegration>[0] = {
  maskAllText: true,
  blockAllMedia: true,
  mask: [
    "#searchInput",
    "#chatInput",
    "#chatComposer",
    "#chatForm",
    "#inviteEmail",
    ".ui-auth-form",
  ],
  block: [".ui-dialog"],
}

Sentry.init({
  dsn: clientEnv.NEXT_PUBLIC_SENTRY_DSN,

  environment: clientEnv.NODE_ENV === "development" ? "development" : "production",
  // next.config.ts folds the deploy commit SHA (VERCEL_GIT_COMMIT_SHA /
  // GITHUB_SHA) into NEXT_PUBLIC_SENTRY_RELEASE at build time; the explicit
  // override wins, then the shared fallback keeps all runtimes aligned.
  release: clientEnv.NEXT_PUBLIC_SENTRY_RELEASE || DEFAULT_SENTRY_RELEASE,

  // Browser tracing must be registered at init so it can instrument the
  // pageload/navigation spans; sampling stays low to keep trace volume (and
  // the span-processing cost on the main thread) bounded. Override with
  // NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE when a higher rate is needed.
  tracesSampleRate: clientEnv.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? DEFAULT_TRACES_SAMPLE_RATE,

  integrations: [Sentry.browserTracingIntegration()],

  // Applied when the replay integration is added after consent.
  replaysSessionSampleRate: 1.0,
  replaysOnErrorSampleRate: 1.0,

  beforeSend(event) {
    // A failed Server Components render reaches the browser only as React's
    // generic #441 text with a digest. The server already reports the real
    // error (message and stack), so this event is a duplicate with no detail.
    const exception = event.exception?.values?.[0]
    const value = exception?.value
    if (value?.startsWith("An error occurred in the Server Components render")) {
      return null
    }

    // In development, captureConsole forwards dev-tooling noise that isn't an
    // app defect: React dev warnings, Fast Refresh reloads, HMR messages, and
    // forwarded browser logs. Real exceptions use other mechanisms and still
    // get reported.
    if (
      clientEnv.NODE_ENV === "development" &&
      event.exception?.values?.some(
        (entry) => entry.mechanism?.type === "auto.core.capture_console",
      )
    ) {
      return null
    }

    // Next.js logs this when an RSC payload fetch fails, then falls back to a
    // full browser navigation — the user still gets the page, so it isn't a
    // defect worth an issue.
    const consoleArgs = event.extra?.arguments
    const consoleText = Array.isArray(consoleArgs)
      ? consoleArgs.filter((arg) => typeof arg === "string").join(" ")
      : ""
    if (consoleText.includes("Failed to fetch RSC payload")) {
      return null
    }

    // axe-core (used only by the Playwright a11y suite) warns when its CSSOM
    // preload fetch fails during a scan. Sentry's console capture forwards the
    // warning even though no user-facing code path produces it, so it's test
    // noise, not an app defect.
    const exceptionText = (event.exception?.values ?? [])
      .map((entry) => entry.value)
      .filter((value): value is string => typeof value === "string")
      .join(" ")
    const consolePayload = `${event.message ?? ""} ${exceptionText} ${consoleText}`
    if (consolePayload.includes("Couldn't load preload assets")) {
      return null
    }

    return event
  },
})

// The feedback widget and console capture are registered after the page goes
// idle so their setup cost stays off the critical rendering path. Global error
// handlers are already active from Sentry.init, so exceptions are still
// reported; console capture simply starts a little later.
function registerDeferredIntegrations() {
  const client = Sentry.getClient()
  if (!client) return

  client.addIntegration(Sentry.feedbackIntegration({ colorScheme: "system" }))
  client.addIntegration(Sentry.captureConsoleIntegration({ levels: ["error", "warn"] }))
}

function deferUntilIdle(callback: () => void) {
  const schedule = () => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(callback, { timeout: 3000 })
    } else {
      setTimeout(callback, 0)
    }
  }

  if (document.readyState === "complete") {
    schedule()
  } else {
    window.addEventListener("load", schedule, { once: true })
  }
}

deferUntilIdle(registerDeferredIntegrations)

function startReplay() {
  const client = Sentry.getClient()
  if (!client) return

  const replay = Sentry.getReplay()
  if (replay) {
    replay.start()
    return
  }

  client.addIntegration(Sentry.replayIntegration(replayOptions))
}

function stopReplay() {
  // Do not flush the pending segment: a withdrawn choice means no further data
  // leaves the browser.
  void Sentry.getReplay()?.stop({ flush: false })

  try {
    sessionStorage.removeItem("sentryReplaySession")
  } catch {
    // Storage can be unavailable in a locked-down browser; nothing to clear.
  }
}

function syncReplay() {
  if (hasConsent("replay")) {
    startReplay()
  } else {
    stopReplay()
  }
}

syncReplay()
onConsentChange(syncReplay)

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
