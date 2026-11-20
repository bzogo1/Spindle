import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { api, useLabSessions, useLabWorkspace } from "@/lib/api"
import type { LabSession, LabWorkspace } from "@/lib/api"

import { LabScreen } from "./lab-screen"
import { APP_NOTIFICATION_EVENT, type AppNotification } from "./notifications-provider"

const navigationMocks = vi.hoisted(() => ({
  search: "",
}))

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(navigationMocks.search),
}))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    useLabWorkspace: vi.fn(),
    useLabSessions: vi.fn(),
  }
})

const workspaceQuery = vi.mocked(useLabWorkspace)
const sessionsQuery = vi.mocked(useLabSessions)

/**
 * Collect notifications pushed via `pushAppNotification` — they arrive as a
 * window CustomEvent carrying the materialized `AppNotification`.
 */
function collectNotifications() {
  const seen: AppNotification[] = []
  const listener = (event: Event) => {
    seen.push((event as CustomEvent<AppNotification>).detail)
  }
  window.addEventListener(APP_NOTIFICATION_EVENT, listener)
  return {
    seen,
    stop: () => window.removeEventListener(APP_NOTIFICATION_EVENT, listener),
  }
}

const now = "2026-11-19T12:00:00.000Z"

function buildWorkspace(): LabWorkspace {
  return {
    project: {
      id: "prj_01",
      name: "Coastal Resilience",
      owner: "bogdan",
      storageLimitBytes: 5 * 1024 * 1024 * 1024,
    },
    activeEnvironmentId: "lab-rstudio",
    environments: [
      {
        id: "lab-rstudio",
        name: "RStudio",
        kind: "rstudio",
        status: "running",
        title: "coastal-resilience / analysis.R",
        statusLabel: "Kernel idle",
        lastActiveAt: now,
      },
      {
        id: "lab-jupyter",
        name: "JupyterLab",
        kind: "jupyter",
        status: "stopped",
        title: "coastal-resilience / analysis.ipynb",
        statusLabel: "Python 3.12 · stopped",
        lastActiveAt: null,
      },
    ],
  }
}

function buildSession(overrides: Partial<LabSession> = {}): LabSession {
  return {
    id: "lab_01",
    projectId: "prj_01",
    title: "Tide analysis baseline",
    status: "completed",
    createdAt: "2026-11-19T08:10:00.000Z",
    endedAt: "2026-11-19T08:18:00.000Z",
    ...overrides,
  }
}

function mockWorkspace(workspace: LabWorkspace = buildWorkspace()) {
  workspaceQuery.mockReturnValue({
    status: "success",
    data: workspace,
    error: undefined,
    isEmpty: false,
    isRetrying: false,
    refetch: vi.fn(),
    actions: {
      selectEnvironment: vi.fn().mockResolvedValue({ ok: true }),
      startSession: vi.fn().mockResolvedValue({ ok: true }),
      stopSession: vi.fn().mockResolvedValue({ ok: true }),
      pingSession: vi.fn().mockResolvedValue({ ok: true }),
    },
  } as never)
}

function mockSessions(sessions: LabSession[] = [buildSession()]) {
  sessionsQuery.mockReturnValue({
    data: sessions,
    error: null,
    isLoading: false,
    isRetrying: false,
    isEmpty: sessions.length === 0,
    mode: "ready",
    status: "success",
    refetch: vi.fn(),
  })
}

/**
 * Snapshot names also render in the snapshot-history timeline, so queries
 * for catalog rows must be scoped to the flat snapshot list.
 */
function snapshotRows() {
  const list = document.querySelector<HTMLElement>(".app-lab-snapshot-list")
  if (!list) throw new Error("snapshot list not found")
  return within(list)
}

describe("LabScreen", () => {
  beforeEach(() => {
    navigationMocks.search = ""
    mockWorkspace()
    mockSessions()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it("renders environments, the tool grid, and seeded run history", () => {
    render(<LabScreen projectId="prj_01" />)

    expect(screen.getByRole("heading", { name: "Lab" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /RStudio/ })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /JupyterLab/ })).toBeInTheDocument()

    expect(screen.getByRole("heading", { name: "Lab tools" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Harmonic decomposition/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Validate a survey export/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Rasterize occurrence/ })).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /Package the latest run outputs/ }),
    ).toBeInTheDocument()

    expect(screen.getByRole("heading", { name: "Run history" })).toBeInTheDocument()
    expect(screen.getByText("Tide analysis baseline")).toBeInTheDocument()

    expect(screen.getByRole("heading", { name: "Snapshots" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Snapshot history" })).toBeInTheDocument()
    expect(screen.getAllByText("Pre-analysis baseline").length).toBeGreaterThan(0)
  })

  it("shows the selected tool's parameter form and validates required fields", async () => {
    render(<LabScreen projectId="prj_01" />)

    // Default tool is tide-analysis; switch to survey-clean which has a
    // required free-text field left empty.
    fireEvent.click(screen.getByRole("button", { name: /Validate a survey export/ }))

    expect(screen.getByRole("heading", { name: "Run Survey data cleaning" })).toBeInTheDocument()
    expect(screen.getByLabelText(/Input file/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Run tool" }))

    expect(await screen.findByText("Input file is required.")).toBeInTheDocument()
  })

  it("runs a tool, records a session, and completes the run", async () => {
    vi.useFakeTimers()
    const createSession = vi
      .spyOn(api.lab, "createLabSession")
      .mockResolvedValue(buildSession({ id: "lab_new", title: "ignored", status: "queued" }))

    render(<LabScreen projectId="prj_01" />)

    fireEvent.click(screen.getByRole("button", { name: "Run tool" }))

    // The title appears in both the history row and the detail panel.
    expect(screen.getAllByText("Tide analysis run").length).toBeGreaterThan(0)
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ projectId: "prj_01" }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })

    expect(screen.getByText(/Run completed successfully/)).toBeInTheDocument()
    expect(screen.getByText(/Rows processed: 1,284/)).toBeInTheDocument()
  })

  it("marks a run as failed when the simulated failure flag is set", async () => {
    vi.useFakeTimers()
    vi.spyOn(api.lab, "createLabSession").mockResolvedValue(
      buildSession({ id: "lab_new", status: "queued" }),
    )

    render(<LabScreen projectId="prj_01" />)

    fireEvent.click(screen.getByRole("button", { name: /Rasterize occurrence/ }))
    fireEvent.change(screen.getByLabelText("Species *"), { target: { value: "Larus argentatus" } })
    fireEvent.click(screen.getByRole("checkbox", { name: /Simulate a failed run/ }))
    fireEvent.click(screen.getByRole("button", { name: "Run tool" }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })

    expect(screen.getByText(/Run failed: simulated failure requested/)).toBeInTheDocument()
  })

  it("shows an empty history state and restores a snapshot", async () => {
    mockSessions([])
    render(<LabScreen projectId="prj_01" />)

    expect(screen.getByText("No runs yet")).toBeInTheDocument()

    const snapshotRow = snapshotRows().getByText("Pre-analysis baseline").closest("li")
    expect(snapshotRow).not.toBeNull()
    fireEvent.click(within(snapshotRow as HTMLElement).getByRole("button", { name: "Restore" }))

    expect(
      within(snapshotRow as HTMLElement).getByRole("button", { name: "Restored" }),
    ).toBeDisabled()
  })

  it("compares two selected snapshots", async () => {
    // jsdom has no 2D canvas; force the diff's "unavailable" fallback.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null)
    render(<LabScreen projectId="prj_01" />)

    const compareButtons = screen.getAllByRole("button", { name: "Compare" })
    expect(compareButtons.length).toBeGreaterThanOrEqual(2)

    fireEvent.click(compareButtons[0])
    expect(screen.getByText(/selected — pick one more snapshot/)).toBeInTheDocument()

    fireEvent.click(compareButtons[1])

    expect(screen.getByText("Snapshot comparison")).toBeInTheDocument()
    expect(screen.getByText(/Pre-analysis baseline vs/)).toBeInTheDocument()

    // The canvas diff resolves to "unavailable" under jsdom; metadata and
    // previews still render.
    expect(await screen.findByText(/Pixel diff is unavailable in this browser/)).toBeInTheDocument()
  })

  it("keeps comparison annotations when the same pair is reopened", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null)
    render(<LabScreen projectId="prj_01" />)

    const compareButtons = screen.getAllByRole("button", { name: "Compare" })
    fireEvent.click(compareButtons[0])
    fireEvent.click(compareButtons[1])
    expect(screen.getByText("Snapshot comparison")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Add note" }))
    fireEvent.change(screen.getByLabelText("Annotation note"), {
      target: { value: "Pair note persists" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Add annotation" }))
    expect(screen.getByText("Pair note persists")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Close comparison" }))
    expect(screen.queryByText("Snapshot comparison")).not.toBeInTheDocument()

    fireEvent.click(compareButtons[0])
    fireEvent.click(compareButtons[1])
    expect(screen.getByText("Snapshot comparison")).toBeInTheDocument()
    expect(screen.getByText("Pair note persists")).toBeInTheDocument()
  })

  it("badges the seeded baseline and switches it to another snapshot", () => {
    render(<LabScreen projectId="prj_01" />)

    const baselineRow = snapshotRows().getByText("Pre-analysis baseline").closest("li")
    const candidateRow = snapshotRows().getByText("Post-review state").closest("li")
    expect(baselineRow).not.toBeNull()
    expect(candidateRow).not.toBeNull()

    // snap-01 is the seeded RStudio baseline; snap-05 is a second RStudio
    // capture that can take over.
    expect(within(baselineRow as HTMLElement).getByText("Baseline")).toBeInTheDocument()
    expect(within(candidateRow as HTMLElement).queryByText("Baseline")).not.toBeInTheDocument()

    fireEvent.click(
      within(candidateRow as HTMLElement).getByRole("button", { name: "Set baseline" }),
    )

    expect(within(candidateRow as HTMLElement).getByText("Baseline")).toBeInTheDocument()
    expect(within(baselineRow as HTMLElement).queryByText("Baseline")).not.toBeInTheDocument()
    // The old baseline's "Set baseline" is re-enabled; the new one's is not.
    expect(
      within(baselineRow as HTMLElement).getByRole("button", { name: "Set baseline" }),
    ).toBeEnabled()
    expect(
      within(candidateRow as HTMLElement).getByRole("button", { name: "Set baseline" }),
    ).toBeDisabled()
  })

  it("compares a snapshot against its environment baseline", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null)
    render(<LabScreen projectId="prj_01" />)

    const candidateRow = snapshotRows().getByText("Post-review state").closest("li")
    expect(candidateRow).not.toBeNull()

    // The baseline snapshot itself has no baseline to compare against.
    const baselineRow = snapshotRows().getByText("Pre-analysis baseline").closest("li")
    expect(
      within(baselineRow as HTMLElement).getByRole("button", { name: "Compare to baseline" }),
    ).toBeDisabled()

    fireEvent.click(
      within(candidateRow as HTMLElement).getByRole("button", { name: "Compare to baseline" }),
    )

    expect(screen.getByText("Snapshot comparison")).toBeInTheDocument()
    // Baseline takes the "A" slot.
    expect(screen.getByText(/Pre-analysis baseline vs/)).toBeInTheDocument()
    expect(await screen.findByText(/Pixel diff is unavailable in this browser/)).toBeInTheDocument()
    // The baseline figure is tagged in the comparison.
    expect(screen.getAllByText("Baseline").length).toBeGreaterThanOrEqual(2)
  })

  it("opens the comparison from a shared ?compare= link", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null)
    navigationMocks.search = "compare=snap-02,snap-04"
    render(<LabScreen projectId="prj_01" />)

    expect(await screen.findByText("Snapshot comparison")).toBeInTheDocument()
    // Ordered pair: snap-02 is "A", snap-04 is "B".
    // The <strong>A</strong>/<strong>B</strong> markers split the text nodes.
    expect(screen.getByText(/Clean survey inputs vs\s+Export bundle/)).toBeInTheDocument()
  })

  it("opens a shared ?snapshot= link against its environment baseline", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null)
    // snap-05 is an RStudio capture; snap-01 is the seeded RStudio baseline.
    navigationMocks.search = "snapshot=snap-05"
    render(<LabScreen projectId="prj_01" />)

    expect(await screen.findByText("Snapshot comparison")).toBeInTheDocument()
    // Baseline takes the "A" slot, snap-05 is "B".
    expect(screen.getByText(/Pre-analysis baseline vs\s+Post-review state/)).toBeInTheDocument()
  })

  it("ignores share params with unknown snapshot ids", () => {
    navigationMocks.search = "compare=snap-01,nope&snapshot=also-nope"
    render(<LabScreen projectId="prj_01" />)

    expect(screen.queryByText("Snapshot comparison")).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Snapshots" })).toBeInTheDocument()
  })

  it("copies a share link for a snapshot and for the open comparison", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null)
    render(<LabScreen projectId="prj_01" />)

    const baselineRow = snapshotRows().getByText("Pre-analysis baseline").closest("li")
    expect(baselineRow).not.toBeNull()
    await userEvent.click(within(baselineRow as HTMLElement).getByRole("button", { name: "Share" }))

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const snapshotUrl = new URL(writeText.mock.calls[0][0] as string)
    expect(snapshotUrl.searchParams.get("snapshot")).toBe("snap-01")
    expect(snapshotUrl.searchParams.get("compare")).toBeNull()

    // Open a comparison and copy its link — the ordered pair is encoded.
    const compareButtons = screen.getAllByRole("button", { name: "Compare" })
    fireEvent.click(compareButtons[0])
    fireEvent.click(compareButtons[1])
    expect(await screen.findByText("Snapshot comparison")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Copy link" }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))
    const compareUrl = new URL(writeText.mock.calls[1][0] as string)
    expect(compareUrl.searchParams.get("compare")).toBe("snap-01,snap-02")
    expect(compareUrl.searchParams.get("snapshot")).toBeNull()
  })

  it("badges seeded review statuses and flips them via Approve/Reject", () => {
    render(<LabScreen projectId="prj_01" />)

    // snap-01 is seeded approved; snap-02 is seeded pending.
    const approvedRow = snapshotRows()
      .getByText("Pre-analysis baseline")
      .closest("li") as HTMLElement
    expect(within(approvedRow).getByText("Approved")).toBeInTheDocument()
    expect(within(approvedRow).getByRole("button", { name: "Approve" })).toBeDisabled()
    expect(within(approvedRow).getByRole("button", { name: "Reject" })).toBeEnabled()

    const pendingRow = snapshotRows().getByText("Clean survey inputs").closest("li") as HTMLElement
    expect(within(pendingRow).getByText("Pending")).toBeInTheDocument()

    fireEvent.click(within(pendingRow).getByRole("button", { name: "Approve" }))
    expect(within(pendingRow).getByText("Approved")).toBeInTheDocument()
    expect(within(pendingRow).getByRole("button", { name: "Approve" })).toBeDisabled()
    expect(within(pendingRow).getByRole("button", { name: "Reject" })).toBeEnabled()

    fireEvent.click(within(pendingRow).getByRole("button", { name: "Reject" }))
    expect(within(pendingRow).getByText("Rejected")).toBeInTheDocument()
    expect(within(pendingRow).getByRole("button", { name: "Reject" })).toBeDisabled()
    expect(within(pendingRow).getByRole("button", { name: "Approve" })).toBeEnabled()
  })

  it("filters snapshots by review status", async () => {
    render(<LabScreen projectId="prj_01" />)

    await userEvent.click(
      screen.getByRole("combobox", { name: "Filter snapshots by review status" }),
    )
    const listbox = await screen.findByRole("listbox")
    await userEvent.click(within(listbox).getByRole("option", { name: "Rejected" }))

    // snap-04 is the only seeded rejection; it also shows in the history
    // timeline, so scope the catalog-row assertion to the snapshot list.
    expect(snapshotRows().getByText("Export bundle")).toBeInTheDocument()
    expect(screen.queryByText("Pre-analysis baseline")).not.toBeInTheDocument()
    expect(screen.queryByText("Clean survey inputs")).not.toBeInTheDocument()
    expect(screen.queryByText("Post-review state")).not.toBeInTheDocument()
  })

  it("shows an empty state when the status filter matches nothing", async () => {
    render(<LabScreen projectId="prj_01" />)

    await userEvent.click(
      screen.getByRole("combobox", { name: "Filter snapshots by review status" }),
    )
    const listbox = await screen.findByRole("listbox")
    await userEvent.click(within(listbox).getByRole("option", { name: "Rejected" }))

    // Approve the only rejected snapshot — the filtered list becomes empty.
    const row = snapshotRows().getByText("Export bundle").closest("li") as HTMLElement
    fireEvent.click(within(row).getByRole("button", { name: "Approve" }))

    expect(screen.getByText("No snapshots match")).toBeInTheDocument()
    expect(screen.queryByText("Export bundle")).not.toBeInTheDocument()
  })

  it("lists snapshot history grouped by environment, oldest first", () => {
    render(<LabScreen projectId="prj_01" />)

    const heading = screen.getByRole("heading", { name: "Snapshot history" })
    const history = heading.closest("section") as HTMLElement
    expect(history).not.toBeNull()

    // Groups are ordered by most recent capture; entries run oldest → newest.
    const groups = within(history).getAllByRole("region")
    expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual([
      "RStudio snapshot history",
      "JupyterLab snapshot history",
      "VS Code snapshot history",
      "Terminal snapshot history",
    ])

    const rstudio = within(history).getByRole("region", {
      name: "RStudio snapshot history",
    })
    const rstudioItems = within(rstudio).getAllByRole("listitem")
    expect(rstudioItems).toHaveLength(2)
    expect(rstudioItems[0]).toHaveTextContent("Pre-analysis baseline")
    expect(rstudioItems[0]).toHaveTextContent("First capture for RStudio")
    expect(rstudioItems[0]).toHaveTextContent("Capture 1 of 2")
    expect(rstudioItems[1]).toHaveTextContent("Post-review state")
    expect(rstudioItems[1]).toHaveTextContent("vs previous:")
    expect(rstudioItems[1]).toHaveTextContent("Capture 2 of 2")

    // snap-06 (Nov 16) precedes snap-02 (Nov 17) even though the catalog
    // lists them in the opposite order.
    const jupyter = within(history).getByRole("region", {
      name: "JupyterLab snapshot history",
    })
    const jupyterItems = within(jupyter).getAllByRole("listitem")
    expect(jupyterItems[0]).toHaveTextContent("Raw survey dump")
    expect(jupyterItems[1]).toHaveTextContent("Clean survey inputs")

    // Single-capture environments show a lone "first capture" entry.
    const terminal = within(history).getByRole("region", {
      name: "Terminal snapshot history",
    })
    const terminalItems = within(terminal).getAllByRole("listitem")
    expect(terminalItems).toHaveLength(1)
    expect(terminalItems[0]).toHaveTextContent("Export bundle")
    expect(terminalItems[0]).toHaveTextContent("First capture for Terminal")
    expect(
      within(terminalItems[0]).getByRole("button", { name: "Compare with previous" }),
    ).toBeDisabled()
  })

  it("compares a history capture with the one before it", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null)
    render(<LabScreen projectId="prj_01" />)

    const history = screen
      .getByRole("heading", { name: "Snapshot history" })
      .closest("section") as HTMLElement

    // First captures have no predecessor to compare against.
    const firstItem = within(history).getByText("Pre-analysis baseline").closest("li")
    expect(firstItem).not.toBeNull()
    expect(
      within(firstItem as HTMLElement).getByRole("button", { name: "Compare with previous" }),
    ).toBeDisabled()

    const secondItem = within(history).getByText("Post-review state").closest("li")
    expect(secondItem).not.toBeNull()
    fireEvent.click(
      within(secondItem as HTMLElement).getByRole("button", {
        name: "Compare with previous",
      }),
    )

    expect(await screen.findByText("Snapshot comparison")).toBeInTheDocument()
    // The earlier capture takes the "A" (reference) slot.
    expect(screen.getByText(/Pre-analysis baseline vs\s+Post-review state/)).toBeInTheDocument()
  })

  it("pushes lab notifications for snapshot review decisions", () => {
    const feed = collectNotifications()
    try {
      render(<LabScreen projectId="prj_01" />)

      const pendingRow = snapshotRows()
        .getByText("Clean survey inputs")
        .closest("li") as HTMLElement

      fireEvent.click(within(pendingRow).getByRole("button", { name: "Approve" }))
      expect(
        feed.seen.find((n) => n.title === "Snapshot approved: Clean survey inputs"),
      ).toMatchObject({
        type: "success",
        category: "lab",
        projectId: "prj_01",
        href: "/projects/prj_01/lab",
      })

      fireEvent.click(within(pendingRow).getByRole("button", { name: "Reject" }))
      expect(
        feed.seen.find((n) => n.title === "Snapshot rejected: Clean survey inputs"),
      ).toMatchObject({
        type: "warning",
        category: "lab",
        projectId: "prj_01",
      })
    } finally {
      feed.stop()
    }
  })

  it("pushes a lab notification when a snapshot becomes the baseline", () => {
    const feed = collectNotifications()
    try {
      render(<LabScreen projectId="prj_01" />)

      const candidateRow = snapshotRows()
        .getByText("Post-review state")
        .closest("li") as HTMLElement
      fireEvent.click(within(candidateRow).getByRole("button", { name: "Set baseline" }))

      expect(feed.seen.find((n) => n.title === "Baseline updated: RStudio")).toMatchObject({
        type: "success",
        category: "lab",
        projectId: "prj_01",
        href: "/projects/prj_01/lab",
      })
    } finally {
      feed.stop()
    }
  })

  it("pushes an error notification when a comparison exceeds the fail threshold", async () => {
    const feed = collectNotifications()
    // jsdom has no canvas: stub a 2D context whose two `getImageData` reads
    // return an all-black vs all-white frame, so every pixel "changes" and
    // the diff ratio lands far above the 0.5% fail threshold. `Image` is
    // stubbed to fire `onload` immediately since jsdom never decodes.
    let imageDataCalls = 0
    const context = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => {
        imageDataCalls += 1
        const value = imageDataCalls === 1 ? 0 : 255
        return {
          data: new Uint8ClampedArray(320 * 200 * 4).fill(value),
          width: 320,
          height: 200,
        }
      }),
      createImageData: vi.fn((width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
      })),
      putImageData: vi.fn(),
    }
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as never)
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:,")
    vi.stubGlobal(
      "Image",
      class {
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        set src(_value: string) {
          this.onload?.()
        }
      },
    )
    try {
      render(<LabScreen projectId="prj_01" />)

      const compareButtons = screen.getAllByRole("button", { name: "Compare" })
      fireEvent.click(compareButtons[0])
      fireEvent.click(compareButtons[1])

      await waitFor(() => {
        expect(feed.seen.some((n) => n.type === "error" && n.category === "lab")).toBe(true)
      })
      const notification = feed.seen.find((n) => n.type === "error")
      expect(notification).toMatchObject({
        category: "lab",
        projectId: "prj_01",
        href: "/projects/prj_01/lab",
      })
      expect(notification?.title).toBe("Snapshot comparison failed: Clean survey inputs")
      expect(notification?.body).toContain("100.000%")
      expect(notification?.body).toContain("fail threshold")
    } finally {
      feed.stop()
      vi.unstubAllGlobals()
    }
  })
})
