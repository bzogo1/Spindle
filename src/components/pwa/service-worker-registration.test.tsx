import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/env", () => ({
  clientEnv: { NODE_ENV: "production" },
}))

import { ServiceWorkerRegistration } from "./service-worker-registration"

const SERVICE_WORKER_URL = "/sw.js"

interface FakeRegistration extends EventTarget {
  waiting: unknown
  installing: unknown
  update: ReturnType<typeof vi.fn>
}

interface FakeWorker extends EventTarget {
  state: string
  postMessage: ReturnType<typeof vi.fn>
}

function makeWorker(state = "installed"): FakeWorker {
  const worker = new EventTarget() as FakeWorker
  worker.state = state
  worker.postMessage = vi.fn()
  return worker
}

function makeRegistration(waiting?: unknown): FakeRegistration {
  const registration = new EventTarget() as FakeRegistration
  registration.waiting = waiting
  registration.installing = null
  registration.update = vi.fn(async () => {})
  return registration
}

let serviceWorker: EventTarget & {
  register: ReturnType<typeof vi.fn>
  controller: unknown
}
let registration: FakeRegistration

beforeEach(() => {
  registration = makeRegistration()
  serviceWorker = new EventTarget() as typeof serviceWorker
  serviceWorker.register = vi.fn(async () => registration)
  serviceWorker.controller = null
  Object.defineProperty(navigator, "serviceWorker", {
    value: serviceWorker,
    configurable: true,
  })
})

// navigator.serviceWorker stays defined: React cleanup in vitest.setup.ts runs
// afterEach hooks and the component's effect cleanup touches the mock.

describe("ServiceWorkerRegistration", () => {
  it("registers /sw.js at scope / in production", async () => {
    render(<ServiceWorkerRegistration />)

    await waitFor(() =>
      expect(serviceWorker.register).toHaveBeenCalledWith(SERVICE_WORKER_URL, { scope: "/" }),
    )
    // Nothing to show for a first install with no waiting worker.
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("shows the update prompt when a waiting worker exists under a controller", async () => {
    const waiting = makeWorker()
    registration = makeRegistration(waiting)
    serviceWorker.controller = { fake: "controller" }
    serviceWorker.register = vi.fn(async () => registration)

    render(<ServiceWorkerRegistration />)

    expect(await screen.findByText(/new version of Spindle/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Reload" }))
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" })
  })

  it("dismisses the update prompt with Later", async () => {
    registration = makeRegistration(makeWorker())
    serviceWorker.controller = {}
    serviceWorker.register = vi.fn(async () => registration)

    render(<ServiceWorkerRegistration />)
    await screen.findByText(/new version of Spindle/i)

    fireEvent.click(screen.getByRole("button", { name: "Dismiss update prompt" }))

    await waitFor(() => expect(screen.queryByRole("status")).toBeNull())
  })

  it("surfaces an update discovered via updatefound -> installed", async () => {
    serviceWorker.controller = {}
    render(<ServiceWorkerRegistration />)
    await waitFor(() => expect(serviceWorker.register).toHaveBeenCalled())

    const installing = makeWorker("installing")
    registration.installing = installing
    registration.dispatchEvent(new Event("updatefound"))

    // Still installing — no prompt yet.
    expect(screen.queryByRole("status")).toBeNull()

    installing.state = "installed"
    installing.dispatchEvent(new Event("statechange"))

    expect(await screen.findByText(/new version of Spindle/i)).toBeInTheDocument()
  })

  it("ignores a finished install when no controller exists (first install)", async () => {
    serviceWorker.controller = null
    render(<ServiceWorkerRegistration />)
    await waitFor(() => expect(serviceWorker.register).toHaveBeenCalled())

    const installing = makeWorker("installing")
    registration.installing = installing
    registration.dispatchEvent(new Event("updatefound"))
    installing.state = "installed"
    installing.dispatchEvent(new Event("statechange"))

    // Give effects a tick; a first install must not prompt for reload.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("checks for updates on an interval and when the tab becomes visible", async () => {
    vi.useFakeTimers()
    try {
      render(<ServiceWorkerRegistration />)
      // Flush the register() promise chain so the interval listener is armed.
      await vi.advanceTimersByTimeAsync(0)
      expect(serviceWorker.register).toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
      expect(registration.update).toHaveBeenCalledTimes(1)

      document.dispatchEvent(new Event("visibilitychange"))
      expect(registration.update).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
