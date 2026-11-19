import * as Sentry from "@sentry/nextjs"

import { clientEnv } from "@/lib/env"
import { hasConsent, onConsentChange } from "@/lib/consent"

// Replay is the only non-essential Sentry component, so it is registered on
// demand: error monitoring, tracing, feedback, and console capture start
// immediately, but nothing is recorded until session replay consent is present.
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
  release: "spindle@1.0.0",

  tracesSampleRate: 1.0,

  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.feedbackIntegration({
      colorScheme: "system",
    }),
    Sentry.captureConsoleIntegration({
      levels: ["error", "warn"],
    }),
  ],

  // Applied when the replay integration is added after consent.
  replaysSessionSampleRate: 1.0,
  replaysOnErrorSampleRate: 1.0,

  beforeSend(event) {
    // A failed Server Components render reaches the browser only as React's
    // generic #441 text with a digest. The server already reports the real
    // error (message and stack), so this event is a duplicate with no detail.
    const value = event.exception?.values?.[0]?.value
    if (value?.startsWith("An error occurred in the Server Components render")) {
      return null
    }

    return event
  },
})

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
