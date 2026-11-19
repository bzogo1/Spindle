import * as Sentry from "@sentry/nextjs"

import { serverEnv } from "@/lib/env.server"

export async function register() {
  // Importing env.server validates the server schema before the first request.
  if (serverEnv.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config")
  }

  if (serverEnv.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config")
  }
}

export const onRequestError = Sentry.captureRequestError
