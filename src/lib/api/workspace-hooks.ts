"use client"

/**
 * Screen-facing hooks for the project workspace.
 *
 * Each hook loads its snapshot through `useApiQuery` (which aborts the
 * in-flight request on unmount) and calls the same operations through
 * `api.workspace`, so the files, lab, chat, and agent screens work against
 * either adapter with no direct access to the mock store.
 */

import { useCallback, useEffect, useRef, useState } from "react"

import { pushAppNotification } from "@/components/app/notifications-provider"

import type { ApiError } from "./client"
import { chatNotificationInput, chatNotificationKind } from "./chat-notifications"
import {
  createEmptyAgentWorkspace,
  createEmptyChatWorkspace,
  createEmptyFilesWorkspace,
  createEmptyLabWorkspace,
} from "./empty"
import { api } from "./instance"
import { toApiError, useApiQuery } from "./use-api-query"
import type {
  AgentConfig,
  AgentWorkspace,
  CallOptions,
  ChatMention,
  ChatWorkspace,
  FilesWorkspace,
  LabWorkspace,
  RejectedUpload,
  UploadAction,
  UploadFileInput,
  WorkspaceActionResult,
} from "./types"

export type WorkspaceStatus = "loading" | "error" | "success"

export interface WorkspaceQueryResult<T> {
  status: WorkspaceStatus
  data: T
  error: ApiError | undefined
  isEmpty: boolean
  isRetrying: boolean
  refetch: () => void
}

export type AddUploadsActionResult =
  { ok: true; accepted: string[]; rejected: RejectedUpload[] } | { ok: false; error: string }

export type StartAgentRunActionResult = { ok: true; runId: string } | { ok: false; error: string }

function workspaceStatus(status: string): WorkspaceStatus {
  if (status === "error") return "error"
  if (status === "success") return "success"
  return "loading"
}

function useWorkspaceQuery<T>(
  projectId: string,
  fetcher: (projectId: string, options: CallOptions) => Promise<T>,
  empty: T,
) {
  const query = useApiQuery((options) => fetcher(projectId, options), [projectId], true, empty)
  const [local, setLocal] = useState<{ projectId: string; value: T } | null>(null)

  useEffect(() => {
    if (query.data !== undefined) setLocal({ projectId, value: query.data })
  }, [projectId, query.data])

  const apply = useCallback((value: T) => setLocal({ projectId, value }), [projectId])
  const data = local?.projectId === projectId ? local.value : (query.data ?? empty)

  return { query, data, apply }
}

export interface FilesWorkspaceActions {
  createFolder(parentId: string | null, name: string): Promise<WorkspaceActionResult>
  renameNode(id: string, name: string): Promise<WorkspaceActionResult>
  moveNodes(ids: string[], targetFolderId: string | null): Promise<WorkspaceActionResult>
  trashNodes(ids: string[]): Promise<WorkspaceActionResult>
  restoreVersion(id: string, versionId: string): Promise<WorkspaceActionResult>
  addUploads(parentId: string | null, files: UploadFileInput[]): Promise<AddUploadsActionResult>
  updateUpload(id: string, action: UploadAction): Promise<WorkspaceActionResult>
}

export interface FilesWorkspaceResult extends WorkspaceQueryResult<FilesWorkspace> {
  actions: FilesWorkspaceActions
}

export function useFilesWorkspace(projectId: string): FilesWorkspaceResult {
  const { query, data, apply } = useWorkspaceQuery(
    projectId,
    (id, options) => api.workspace.getFiles(id, options),
    createEmptyFilesWorkspace(projectId),
  )
  const { refetch } = query

  const runAction = useCallback(
    async (run: () => Promise<FilesWorkspace>): Promise<WorkspaceActionResult> => {
      try {
        apply(await run())
        return { ok: true }
      } catch (error) {
        refetch()
        return { ok: false, error: toApiError(error).message }
      }
    },
    [apply, refetch],
  )

  const createFolder = useCallback(
    (parentId: string | null, name: string) =>
      runAction(() => api.workspace.createFolder(projectId, { parentId, name })),
    [projectId, runAction],
  )

  const renameNode = useCallback(
    (id: string, name: string) =>
      runAction(() => api.workspace.renameFileNode(projectId, { id, name })),
    [projectId, runAction],
  )

  const moveNodes = useCallback(
    (ids: string[], targetFolderId: string | null) =>
      runAction(() => api.workspace.moveFileNodes(projectId, { ids, targetFolderId })),
    [projectId, runAction],
  )

  const trashNodes = useCallback(
    (ids: string[]) => runAction(() => api.workspace.trashFileNodes(projectId, { ids })),
    [projectId, runAction],
  )

  const restoreVersion = useCallback(
    (id: string, versionId: string) =>
      runAction(() => api.workspace.restoreFileNodeVersion(projectId, { id, versionId })),
    [projectId, runAction],
  )

  const addUploads = useCallback(
    async (parentId: string | null, files: UploadFileInput[]): Promise<AddUploadsActionResult> => {
      try {
        const result = await api.workspace.addUploads(projectId, { parentId, files })
        apply(result.workspace)
        return { ok: true, accepted: result.accepted, rejected: result.rejected }
      } catch (error) {
        refetch()
        return { ok: false, error: toApiError(error).message }
      }
    },
    [apply, projectId, refetch],
  )

  const updateUpload = useCallback(
    (id: string, action: UploadAction) =>
      runAction(() => api.workspace.updateUpload(projectId, id, action)),
    [projectId, runAction],
  )

  const hasActiveUploads = data.uploads.some(
    (upload) => upload.status === "queued" || upload.status === "uploading",
  )

  useEffect(() => {
    if (!hasActiveUploads) return
    const controller = new AbortController()
    let cancelled = false
    const interval = window.setInterval(() => {
      api.workspace
        .tickUploads(projectId, { signal: controller.signal })
        .then((next) => {
          if (!cancelled) apply(next)
        })
        .catch(() => undefined)
    }, 250)
    return () => {
      cancelled = true
      controller.abort()
      window.clearInterval(interval)
    }
  }, [apply, hasActiveUploads, projectId])

  return {
    status: workspaceStatus(query.status),
    data,
    error: query.error ?? undefined,
    isEmpty: query.isEmpty,
    isRetrying: query.isRetrying,
    refetch,
    actions: {
      createFolder,
      renameNode,
      moveNodes,
      trashNodes,
      restoreVersion,
      addUploads,
      updateUpload,
    },
  }
}

export interface ChatWorkspaceActions {
  selectChannel(channelId: string): Promise<WorkspaceActionResult>
  setAnonymous(anonymous: boolean): Promise<WorkspaceActionResult>
  setBotEnabled(enabled: boolean): Promise<WorkspaceActionResult>
  createThread(name: string): Promise<WorkspaceActionResult>
  toggleReaction(messageId: string, emoji: string): Promise<WorkspaceActionResult>
  sendMessage(
    body: string,
    attachments?: { name: string; sizeBytes: number }[],
    mentions?: ChatMention[],
    replyToId?: string,
  ): Promise<WorkspaceActionResult>
  retryMessage(messageId: string): Promise<WorkspaceActionResult>
}

export interface ChatWorkspaceResult extends WorkspaceQueryResult<ChatWorkspace> {
  actions: ChatWorkspaceActions
}

export function useChatWorkspace(projectId: string): ChatWorkspaceResult {
  const { query, data, apply } = useWorkspaceQuery(
    projectId,
    (id, options) => api.workspace.getChat(id, options),
    createEmptyChatWorkspace(projectId),
  )
  const { refetch } = query

  const runAction = useCallback(
    async (run: () => Promise<ChatWorkspace>): Promise<WorkspaceActionResult> => {
      try {
        apply(await run())
        return { ok: true }
      } catch (error) {
        refetch()
        return { ok: false, error: toApiError(error).message }
      }
    },
    [apply, refetch],
  )

  const selectChannel = useCallback(
    (channelId: string) => runAction(() => api.workspace.selectChatChannel(projectId, channelId)),
    [projectId, runAction],
  )

  const setAnonymous = useCallback(
    (anonymous: boolean) => runAction(() => api.workspace.setChatAnonymous(projectId, anonymous)),
    [projectId, runAction],
  )

  const setBotEnabled = useCallback(
    (enabled: boolean) => runAction(() => api.workspace.setChatBotEnabled(projectId, enabled)),
    [projectId, runAction],
  )

  const createThread = useCallback(
    (name: string) =>
      runAction(() => api.workspace.createChatChannel(projectId, { name, kind: "channel" })),
    [projectId, runAction],
  )

  const toggleReaction = useCallback(
    (messageId: string, emoji: string) =>
      runAction(() => api.workspace.toggleChatReaction(projectId, messageId, emoji)),
    [projectId, runAction],
  )

  const sendMessage = useCallback(
    async (
      body: string,
      attachments?: { name: string; sizeBytes: number }[],
      mentions?: ChatMention[],
      replyToId?: string,
    ): Promise<WorkspaceActionResult> => {
      const result = await runAction(() =>
        api.workspace.sendChannelMessage(projectId, {
          channelId: data.activeChannelId,
          body,
          anonymous: data.anonymous,
          attachments,
          mentions,
          replyToId,
        }),
      )
      if (result.ok) {
        // Placeholder: the mock adapter queues a reply ~1.1s after each send
        // (the chat bot for mentions/commands, else a canned member reply);
        // refetch once it has landed so the thread updates.
        window.setTimeout(() => refetch(), 1400)
      }
      return result
    },
    [data.activeChannelId, data.anonymous, projectId, refetch, runAction],
  )

  const retryMessage = useCallback(
    (messageId: string) => runAction(() => api.workspace.retryChannelMessage(projectId, messageId)),
    [projectId, runAction],
  )

  const hasSending = data.messages.some((message) => message.status === "sending")
  const hasTyping = data.typing.length > 0

  useEffect(() => {
    // Poll while messages are settling or a typing entry is on screen so the
    // canned auto-reply and typing transitions surface promptly.
    if (!hasSending && !hasTyping) return
    const controller = new AbortController()
    let cancelled = false
    const interval = window.setInterval(() => {
      api.workspace
        .settleChannelMessages(projectId, { signal: controller.signal })
        .then((next) => {
          if (!cancelled) apply(next)
        })
        .catch(() => undefined)
    }, 700)
    return () => {
      cancelled = true
      controller.abort()
      window.clearInterval(interval)
    }
  }, [apply, hasSending, hasTyping, projectId])

  useEffect(() => {
    // Low-frequency poll so presence drift and delayed canned replies surface
    // even when nothing is actively sending or typing.
    const controller = new AbortController()
    let cancelled = false
    const interval = window.setInterval(() => {
      api.workspace
        .getChat(projectId, { signal: controller.signal })
        .then((next) => {
          if (!cancelled) apply(next)
        })
        .catch(() => undefined)
    }, 4000)
    return () => {
      cancelled = true
      controller.abort()
      window.clearInterval(interval)
    }
  }, [apply, projectId])

  // Chat → notifications bridge: diff each settled snapshot against the ids
  // already seen and push an app notification for incoming messages that
  // @mention the current user or reply to one of their messages (see
  // `chat-notifications.ts`). The first snapshot per project only primes the
  // seen-set so pre-existing history never notifies; "sending" messages stay
  // unmarked until they settle so the terminal state is what gets evaluated.
  const seenChatMessages = useRef<{ projectId: string; primed: boolean; ids: Set<string> } | null>(
    null,
  )
  useEffect(() => {
    if (query.status !== "success") return
    const seen =
      seenChatMessages.current?.projectId === projectId
        ? seenChatMessages.current
        : { projectId, primed: false, ids: new Set<string>() }
    seenChatMessages.current = seen

    const pending: { message: (typeof data.messages)[number]; kind: "mention" | "reply" }[] = []
    for (const message of data.messages) {
      if (seen.ids.has(message.id) || message.status === "sending") continue
      seen.ids.add(message.id)
      if (!seen.primed) continue
      const kind = chatNotificationKind(message, data.messages)
      if (kind) pending.push({ message, kind })
    }
    seen.primed = true

    for (const { message, kind } of pending) {
      pushAppNotification(
        chatNotificationInput(
          message,
          kind,
          data.channels.find((channel) => channel.id === message.channelId),
          projectId,
        ),
      )
    }
  }, [data.channels, data.messages, projectId, query.status])

  return {
    status: workspaceStatus(query.status),
    data,
    error: query.error ?? undefined,
    isEmpty: query.isEmpty,
    isRetrying: query.isRetrying,
    refetch,
    actions: {
      selectChannel,
      setAnonymous,
      setBotEnabled,
      createThread,
      toggleReaction,
      sendMessage,
      retryMessage,
    },
  }
}

export interface LabWorkspaceActions {
  selectEnvironment(environmentId: string): Promise<WorkspaceActionResult>
  startSession(environmentId: string): Promise<WorkspaceActionResult>
  stopSession(environmentId: string): Promise<WorkspaceActionResult>
  pingSession(environmentId: string): Promise<WorkspaceActionResult>
}

export interface LabWorkspaceResult extends WorkspaceQueryResult<LabWorkspace> {
  actions: LabWorkspaceActions
}

export function useLabWorkspace(projectId: string): LabWorkspaceResult {
  const { query, data, apply } = useWorkspaceQuery(
    projectId,
    (id, options) => api.workspace.getLab(id, options),
    createEmptyLabWorkspace(projectId),
  )
  const { refetch } = query

  const runAction = useCallback(
    async (run: () => Promise<LabWorkspace>): Promise<WorkspaceActionResult> => {
      try {
        apply(await run())
        return { ok: true }
      } catch (error) {
        refetch()
        return { ok: false, error: toApiError(error).message }
      }
    },
    [apply, refetch],
  )

  const selectEnvironment = useCallback(
    (environmentId: string) =>
      runAction(() => api.workspace.selectLabEnvironment(projectId, environmentId)),
    [projectId, runAction],
  )

  const startSession = useCallback(
    (environmentId: string) =>
      runAction(() => api.workspace.startLabEnvironment(projectId, environmentId)),
    [projectId, runAction],
  )

  const stopSession = useCallback(
    (environmentId: string) =>
      runAction(() => api.workspace.stopLabEnvironment(projectId, environmentId)),
    [projectId, runAction],
  )

  const pingSession = useCallback(
    (environmentId: string) =>
      runAction(() => api.workspace.pingLabEnvironment(projectId, environmentId)),
    [projectId, runAction],
  )

  const startingId = data.environments.find((environment) => environment.status === "starting")?.id

  useEffect(() => {
    if (!startingId) return
    const controller = new AbortController()
    let cancelled = false
    const timer = window.setTimeout(() => {
      api.workspace
        .completeLabEnvironmentStart(projectId, startingId, { signal: controller.signal })
        .then((next) => {
          if (!cancelled) apply(next)
        })
        .catch(() => undefined)
    }, 900)
    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [apply, projectId, startingId])

  return {
    status: workspaceStatus(query.status),
    data,
    error: query.error ?? undefined,
    isEmpty: query.isEmpty,
    isRetrying: query.isRetrying,
    refetch,
    actions: { selectEnvironment, startSession, stopSession, pingSession },
  }
}

export interface AgentWorkspaceActions {
  updateConfig(config: AgentConfig): Promise<WorkspaceActionResult>
  startRun(prompt: string, config?: AgentConfig): Promise<StartAgentRunActionResult>
  retryRun(runId: string): Promise<StartAgentRunActionResult>
  cancelRun(runId: string): Promise<WorkspaceActionResult>
  reviewDiff(runId: string, decision: "approved" | "rejected"): Promise<WorkspaceActionResult>
}

export interface AgentWorkspaceResult extends WorkspaceQueryResult<AgentWorkspace> {
  actions: AgentWorkspaceActions
}

export function useAgentWorkspace(projectId: string): AgentWorkspaceResult {
  const { query, data, apply } = useWorkspaceQuery(
    projectId,
    (id, options) => api.workspace.getAgent(id, options),
    createEmptyAgentWorkspace(projectId),
  )
  const { refetch } = query

  const updateConfig = useCallback(
    async (config: AgentConfig): Promise<WorkspaceActionResult> => {
      try {
        apply(await api.workspace.updateAgentConfig(projectId, config))
        return { ok: true }
      } catch (error) {
        refetch()
        return { ok: false, error: toApiError(error).message }
      }
    },
    [apply, projectId, refetch],
  )

  const startRun = useCallback(
    async (prompt: string, config?: AgentConfig): Promise<StartAgentRunActionResult> => {
      try {
        const next = await api.workspace.startAgentRun(projectId, prompt, config)
        apply(next)
        const runId = next.activeRunId ?? next.runs.at(-1)?.id
        if (!runId) {
          return { ok: false, error: "The agent could not start a run." }
        }
        return { ok: true, runId }
      } catch (error) {
        refetch()
        return { ok: false, error: toApiError(error).message }
      }
    },
    [apply, projectId, refetch],
  )

  const retryRun = useCallback(
    async (runId: string): Promise<StartAgentRunActionResult> => {
      try {
        const next = await api.workspace.retryAgentRun(projectId, runId)
        apply(next)
        const nextRunId = next.activeRunId ?? next.runs.at(-1)?.id
        if (!nextRunId) {
          return { ok: false, error: "The agent could not retry the run." }
        }
        return { ok: true, runId: nextRunId }
      } catch (error) {
        refetch()
        return { ok: false, error: toApiError(error).message }
      }
    },
    [apply, projectId, refetch],
  )

  const cancelRun = useCallback(
    async (runId: string): Promise<WorkspaceActionResult> => {
      try {
        apply(await api.workspace.cancelAgentRun(projectId, runId))
        return { ok: true }
      } catch (error) {
        refetch()
        return { ok: false, error: toApiError(error).message }
      }
    },
    [apply, projectId, refetch],
  )

  const reviewDiff = useCallback(
    async (runId: string, decision: "approved" | "rejected"): Promise<WorkspaceActionResult> => {
      try {
        apply(await api.workspace.reviewAgentDiff(projectId, runId, decision))
        return { ok: true }
      } catch (error) {
        refetch()
        return { ok: false, error: toApiError(error).message }
      }
    },
    [apply, projectId, refetch],
  )

  const hasRunning = data.runs.some((run) => run.status === "running")

  useEffect(() => {
    if (!hasRunning) return
    const controller = new AbortController()
    let cancelled = false
    const interval = window.setInterval(() => {
      api.workspace
        .advanceAgentRuns(projectId, { signal: controller.signal })
        .then((next) => {
          if (!cancelled) apply(next)
        })
        .catch(() => undefined)
    }, 700)
    return () => {
      cancelled = true
      controller.abort()
      window.clearInterval(interval)
    }
  }, [apply, hasRunning, projectId])

  return {
    status: workspaceStatus(query.status),
    data,
    error: query.error ?? undefined,
    isEmpty: query.isEmpty,
    isRetrying: query.isRetrying,
    refetch,
    actions: { updateConfig, startRun, retryRun, cancelRun, reviewDiff },
  }
}
