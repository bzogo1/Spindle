import * as Sentry from "@sentry/nextjs"

import { serverEnv } from "@/lib/env.server"

Sentry.init({
  dsn: serverEnv.SENTRY_DSN,

  environment: serverEnv.NODE_ENV === "development" ? "development" : "production",
  release: serverEnv.SENTRY_RELEASE || "spindle@1.0.0",

  tracesSampleRate: 1.0,

  integrations: [
    Sentry.captureConsoleIntegration({
      levels: ["error", "warn"],
    }),
  ],
})
