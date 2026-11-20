import * as Sentry from "@sentry/nextjs"

import { clientEnv, DEFAULT_SENTRY_RELEASE } from "@/lib/env"
import { serverEnv } from "@/lib/env.server"

// Matches the browser default in instrumentation-client.ts. Server spans
// don't affect page-load TBT, but each request emits a transaction, so
// per-request volume — not main-thread cost — is what sampling bounds.
// Error events are never sampled, so 0.1 keeps full error fidelity while
// still yielding enough server perf data for p95-style analysis. Raise
// NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE when a higher server rate is needed;
// there is no server-only override yet.
const DEFAULT_TRACES_SAMPLE_RATE = 0.1

Sentry.init({
  dsn: serverEnv.SENTRY_DSN,

  environment: serverEnv.NODE_ENV === "development" ? "development" : "production",
  // Explicit SENTRY_RELEASE wins; otherwise tie events to the deploy commit
  // (Vercel / GitHub Actions), then fall back to the shared default so the
  // release matches the browser bundle's.
  release:
    serverEnv.SENTRY_RELEASE ||
    serverEnv.VERCEL_GIT_COMMIT_SHA ||
    serverEnv.GITHUB_SHA ||
    DEFAULT_SENTRY_RELEASE,

  tracesSampleRate: clientEnv.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? DEFAULT_TRACES_SAMPLE_RATE,

  integrations: [
    Sentry.captureConsoleIntegration({
      levels: ["error", "warn"],
    }),
  ],

  beforeSend(event) {
    // In development, captureConsole forwards dev-tooling noise that isn't an
    // app defect: forwarded browser logs, React dev warnings relayed by the
    // dev server, HMR messages, and blocked-origin notices. Real exceptions
    // use other mechanisms and still get reported.
    if (
      serverEnv.NODE_ENV === "development" &&
      event.exception?.values?.some(
        (entry) => entry.mechanism?.type === "auto.core.capture_console",
      )
    ) {
      return null
    }

    return event
  },
})
