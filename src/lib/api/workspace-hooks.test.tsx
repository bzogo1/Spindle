import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { api } from "./instance"
import {
  useAgentWorkspace,
  useChatWorkspace,
  useFilesWorkspace,
  useLabWorkspace,
} from "./workspace-hooks"

function setSearch(search: string) {
  window.history.replaceState(null, "", `/${search}`)
}

describe("workspace hooks (mock adapter)", () => {
  beforeEach(() => {
    setSearch("")
  })

  it("loads the files workspace and applies folder actions", async () => {
    const { result } = renderHook(() => useFilesWorkspace("prj_01"))

    expect(result.current.status).toBe("loading")
    await waitFor(() => expect(result.current.status).toBe("success"))
    expect(result.current.data.project.id).toBe("prj_01")
    expect(result.current.data.files.length).toBeGreaterThan(0)

    await act(async () => {
      const outcome = await result.current.actions.createFolder(null, "Workspace docs")
      expect(outcome.ok).toBe(true)
    })

    expect(result.current.data.files.some((file) => file.name === "Workspace docs")).toBe(true)
  })

  it("loads chat and sends a message through the workspace API", async () => {
    const { result } = renderHook(() => useChatWorkspace("prj_01"))

    await waitFor(() => expect(result.current.status).toBe("success"))
    expect(result.current.data.channels.length).toBeGreaterThan(0)

    const before = result.current.data.messages.length
    await act(async () => {
      const outcome = await result.current.actions.sendMessage("Hook message")
      expect(outcome.ok).toBe(true)
    })

    expect(result.current.data.messages.length).toBe(before + 1)
    expect(result.current.data.messages.at(-1)?.body).toBe("Hook message")
  })

  it("toggles the chat bot through the workspace API", async () => {
    const { result } = renderHook(() => useChatWorkspace("prj_bot_toggle"))

    await waitFor(() => expect(result.current.status).toBe("success"))
    expect(result.current.data.botEnabled).toBe(true)

    await act(async () => {
      const outcome = await result.current.actions.setBotEnabled(false)
      expect(outcome.ok).toBe(true)
    })

    expect(result.current.data.botEnabled).toBe(false)
  })

  it("routes bot-addressed messages to the chat bot reply", async () => {
    // A dedicated project id keeps this store isolated from other tests' sends.
    const { result } = renderHook(() => useChatWorkspace("prj_chat_bot"))

    await waitFor(() => expect(result.current.status).toBe("success"))
    const before = result.current.data.messages.length

    await act(async () => {
      const outcome = await result.current.actions.sendMessage("@bot hello?")
      expect(outcome.ok).toBe(true)
    })

    // Polling picks up the bot's canned reply without a manual refetch.
    await waitFor(
      () => {
        const reply = result.current.data.messages.at(-1)
        expect(reply?.bot).toBe(true)
        expect(reply?.authorId).toBe("bot-spindle")
      },
      { timeout: 5000 },
    )
    expect(result.current.data.messages.length).toBe(before + 2)
  })

  it("surfaces typing and the canned auto-reply through polling", async () => {
    // A dedicated project id keeps this store isolated from other tests' sends.
    const { result } = renderHook(() => useChatWorkspace("prj_chat_poll"))

    await waitFor(() => expect(result.current.status).toBe("success"))

    const before = result.current.data.messages.length
    await act(async () => {
      const outcome = await result.current.actions.sendMessage("Anyone around?")
      expect(outcome.ok).toBe(true)
    })

    // The send response already carries the typing entry for the mock reply.
    expect(result.current.data.typing.length).toBeGreaterThan(0)

    // Polling picks up the canned reply and the cleared typing entry without
    // any manual refetch.
    await waitFor(() => expect(result.current.data.messages.length).toBe(before + 2), {
      timeout: 4000,
    })
    await waitFor(() => expect(result.current.data.typing).toHaveLength(0), {
      timeout: 4000,
    })
  })

  it("pushes an app notification when the canned reply lands", async () => {
    const received: { title?: string; category?: string; href?: string; projectId?: string }[] = []
    const listener = (event: Event) => {
      received.push((event as CustomEvent).detail)
    }
    window.addEventListener("spindle:app-notification", listener)
    try {
      // A dedicated project id keeps this store isolated from other tests' sends.
      const { result } = renderHook(() => useChatWorkspace("prj_chat_notify"))

      await waitFor(() => expect(result.current.status).toBe("success"))
      // The primed snapshot (seeded history) must not notify.
      expect(received).toHaveLength(0)

      await act(async () => {
        const outcome = await result.current.actions.sendMessage("Anyone there?")
        expect(outcome.ok).toBe(true)
      })

      // The mock reply threads under the sent message, so it qualifies as a
      // "reply to your message" notification once polling picks it up.
      await waitFor(
        () =>
          expect(
            received.some((notification) =>
              notification.title?.includes("replied to your message"),
            ),
          ).toBe(true),
        { timeout: 5000 },
      )
      const notification = received.find((item) => item.title?.includes("replied to your message"))!
      expect(notification.category).toBe("activity")
      expect(notification.href).toBe("/projects/prj_chat_notify/chat")
      expect(notification.projectId).toBe("prj_chat_notify")
    } finally {
      window.removeEventListener("spindle:app-notification", listener)
    }
  })

  it("drifts chat presence across time buckets", async () => {
    vi.useFakeTimers()
    try {
      const signatures = new Set<string>()
      let sawOffline = false

      for (let i = 0; i < 8; i++) {
        const workspace = await api.workspace.getChat("prj_presence")
        signatures.add(workspace.members.map((member) => (member.online ? "1" : "0")).join(""))
        if (workspace.members.some((member) => member.id !== "user-bogdan" && !member.online)) {
          sawOffline = true
        }
        // The current user is always online.
        expect(workspace.members.find((member) => member.id === "user-bogdan")?.online).toBe(true)
        vi.setSystemTime(Date.now() + 16_000)
      }

      expect(signatures.size).toBeGreaterThan(1)
      expect(sawOffline).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it("loads lab environments and starts a stopped session", async () => {
    const { result } = renderHook(() => useLabWorkspace("prj_01"))

    await waitFor(() => expect(result.current.status).toBe("success"))
    const stopped = result.current.data.environments.find(
      (environment) => environment.status === "stopped",
    )
    expect(stopped).toBeDefined()

    await act(async () => {
      const outcome = await result.current.actions.startSession(stopped!.id)
      expect(outcome.ok).toBe(true)
    })

    expect(
      result.current.data.environments.find((environment) => environment.id === stopped!.id)
        ?.status,
    ).toBe("starting")
  })

  it("starts agent runs and keeps the active run id", async () => {
    const { result } = renderHook(() => useAgentWorkspace("prj_01"))

    await waitFor(() => expect(result.current.status).toBe("success"))
    let runId = ""

    await act(async () => {
      const outcome = await result.current.actions.startRun("Summarize the field notes")
      expect(outcome.ok).toBe(true)
      if (outcome.ok) runId = outcome.runId
    })

    expect(runId.length).toBeGreaterThan(0)
    expect(result.current.data.activeRunId).toBe(runId)
    expect(result.current.data.runs.some((run) => run.id === runId)).toBe(true)
  })

  it("forwards the abort signal and cancels the request on unmount", async () => {
    let signal: AbortSignal | undefined
    const spy = vi.spyOn(api.workspace, "getFiles").mockImplementation((_projectId, options) => {
      signal = options?.signal
      return new Promise<never>(() => undefined)
    })

    const { unmount } = renderHook(() => useFilesWorkspace("prj_01"))
    await waitFor(() => expect(spy).toHaveBeenCalled())

    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal?.aborted).toBe(false)

    unmount()
    expect(signal?.aborted).toBe(true)
  })
})
