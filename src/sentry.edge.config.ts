import * as Sentry from "@sentry/nextjs"

import { clientEnv, DEFAULT_SENTRY_RELEASE } from "@/lib/env"
import { serverEnv } from "@/lib/env.server"

// Same default and override as sentry.server.config.ts: edge requests emit
// one transaction each, so the shared 0.1 keeps trace volume/cost bounded
// while error events remain unsampled. See that file for rationale.
const DEFAULT_TRACES_SAMPLE_RATE = 0.1

Sentry.init({
  dsn: serverEnv.SENTRY_DSN,

  environment: serverEnv.NODE_ENV === "development" ? "development" : "production",
  release:
    serverEnv.SENTRY_RELEASE ||
    serverEnv.VERCEL_GIT_COMMIT_SHA ||
    serverEnv.GITHUB_SHA ||
    DEFAULT_SENTRY_RELEASE,

  tracesSampleRate: clientEnv.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? DEFAULT_TRACES_SAMPLE_RATE,
})
