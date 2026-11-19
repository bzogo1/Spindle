/**
 * The selected `ApiClient` singleton.
 *
 * `NEXT_PUBLIC_API_MODE` picks the adapter: `mock` (default) serves fixture
 * data from `adapters/mock`, `http` calls the backend through `adapters/http`.
 * Kept separate from `index.ts` so hooks can import it without a cycle.
 */

import { clientEnv, type ClientEnv } from "@/lib/env"

import { createHttpClient } from "./adapters/http"
import { createMockClient } from "./adapters/mock"
import type { ApiClient } from "./types"

type ApiEnv = Pick<ClientEnv, "NEXT_PUBLIC_API_MODE" | "NEXT_PUBLIC_API_URL">

export function createApiClient(env: ApiEnv = clientEnv): ApiClient {
  if (env.NEXT_PUBLIC_API_MODE === "http") {
    // An empty NEXT_PUBLIC_API_URL targets same-origin /api routes.
    return createHttpClient({ baseUrl: env.NEXT_PUBLIC_API_URL ?? "/api" })
  }
  return createMockClient()
}

export const api: ApiClient = createApiClient()
