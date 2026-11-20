import { clientEnv } from "@/lib/env"

import { ApiError } from "./client"

export type MockStateMode = "ready" | "loading" | "empty" | "error"

export const MOCK_STATE_EVENT = "spindle:mock-state-change"

const DEFAULT_LATENCY_MS = 0
const MAX_LATENCY_MS = 10_000

/** Query controls are dev/test-only and only apply while the mock adapter is active. */
export function mockStateControlsEnabled() {
  return clientEnv.NEXT_PUBLIC_API_MODE === "mock" && clientEnv.NODE_ENV !== "production"
}

function paramsFrom(search?: string) {
  if (search !== undefined) return new URLSearchParams(search)
  if (typeof window === "undefined") return new URLSearchParams()
  return new URLSearchParams(window.location.search)
}

export function getMockState(search?: string): MockStateMode {
  if (!mockStateControlsEnabled()) return "ready"

  // `demo` is accepted as an alias so `?demo=loading` works for demos/screenshots.
  const params = paramsFrom(search)
  const raw = params.get("mock") ?? params.get("mockState") ?? params.get("demo")
  switch (raw) {
    case "loading":
      return "loading"
    case "empty":
      return "empty"
    case "error":
      return "error"
    default:
      return "ready"
  }
}

export function getMockLatencyMs(search?: string) {
  if (!mockStateControlsEnabled()) return 0

  const params = paramsFrom(search)
  const raw =
    params.get("mockLatency") ??
    params.get("mockDelay") ??
    params.get("demoLatency") ??
    params.get("demoDelay")
  const parsed = raw === null ? Number.NaN : Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_LATENCY_MS
  return Math.min(Math.round(parsed), MAX_LATENCY_MS)
}

export function createMockStateError() {
  return new ApiError({
    status: 503,
    code: "mock_error",
    message: "The mock adapter was asked to fail for state review.",
    requestId: `mock-${Date.now().toString(36)}`,
  })
}

export function setMockStateParam(state: MockStateMode) {
  if (typeof window === "undefined" || !mockStateControlsEnabled()) return

  const url = new URL(window.location.href)
  if (state === "ready") {
    url.searchParams.delete("mock")
    url.searchParams.delete("mockState")
  } else {
    url.searchParams.set("mock", state)
  }
  window.history.replaceState(null, "", url)
  window.dispatchEvent(new CustomEvent(MOCK_STATE_EVENT))
}

export function notifyMockStateChange() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(MOCK_STATE_EVENT))
}
