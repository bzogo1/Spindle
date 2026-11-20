import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { api } from "./instance"
import {
  useAgentRuns,
  useChatMessages,
  useFiles,
  useLabSessions,
  useMutation,
  useProject,
  useProjectHome,
  useProjects,
  useSession,
  useUsageSummary,
} from "./hooks"
import { ApiError } from "./client"

describe("api hooks (mock adapter)", () => {
  it("useProjects resolves fixture data", async () => {
    const { result } = renderHook(() => useProjects())

    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.error).toBeNull()
    expect(result.current.data?.length).toBeGreaterThan(0)
    expect(result.current.data?.[0]).toMatchObject({ id: expect.any(String) })
  })

  it("useProject stays idle without an id and fetches with one", async () => {
    const idle = renderHook(() => useProject(undefined))
    await waitFor(() => expect(idle.result.current.isLoading).toBe(false))
    expect(idle.result.current.data).toBeUndefined()
    idle.unmount()

    const { result } = renderHook(() => useProject("prj_01"))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data?.id).toBe("prj_01")
  })

  it("useFiles returns an empty-safe list", async () => {
    const { result } = renderHook(() => useFiles())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(Array.isArray(result.current.data)).toBe(true)
  })

  it("list hooks resolve their resource collections", async () => {
    const lab = renderHook(() => useLabSessions())
    const chat = renderHook(() => useChatMessages("conv_01"))
    const agent = renderHook(() => useAgentRuns())
    const usage = renderHook(() => useUsageSummary())

    await waitFor(() => {
      expect(lab.result.current.isLoading).toBe(false)
      expect(chat.result.current.isLoading).toBe(false)
      expect(agent.result.current.isLoading).toBe(false)
      expect(usage.result.current.isLoading).toBe(false)
    })

    expect(Array.isArray(lab.result.current.data)).toBe(true)
    expect(Array.isArray(chat.result.current.data)).toBe(true)
    expect(Array.isArray(agent.result.current.data)).toBe(true)
    expect(usage.result.current.data?.requests).toEqual(expect.any(Number))
  })

  it("useSession resolves the mock user", async () => {
    const { result } = renderHook(() => useSession())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data?.email).toBeTruthy()
  })

  it("surfaces ApiError from failing queries", async () => {
    const spy = vi
      .spyOn(api.projects, "getProject")
      .mockRejectedValue(
        new ApiError({ status: 500, code: "server_error", message: "boom", requestId: "r1" }),
      )

    const { result } = renderHook(() => useProject("prj_01"))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.error).toMatchObject({
      status: 500,
      code: "server_error",
      requestId: "r1",
    })
    spy.mockRestore()
  })

  it("useMutation resolves and exposes errors", async () => {
    const { result } = renderHook(() =>
      useMutation((name: string) => api.projects.createProject({ name })),
    )

    let created: { name: string } | undefined
    await act(async () => {
      created = await result.current.mutate("Hook Project")
    })

    expect(created?.name).toBe("Hook Project")
    expect(result.current.data?.name).toBe("Hook Project")
    expect(result.current.error).toBeNull()

    act(() => result.current.reset())
    expect(result.current.data).toBeUndefined()
    expect(result.current.error).toBeNull()

    const failing = renderHook(() => useMutation(() => api.projects.getProject("missing-id")))
    await act(async () => {
      await expect(failing.result.current.mutate()).rejects.toBeInstanceOf(ApiError)
    })
    expect(failing.result.current.error).toMatchObject({ status: 404, code: "not_found" })
  })

  it("refetch reloads data", async () => {
    const { result } = renderHook(() => useProjects())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const before = result.current.data?.length

    await act(async () => {
      result.current.refetch()
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data?.length).toBe(before)
  })

  it("forwards the abort signal for aggregate queries and aborts on unmount", async () => {
    let signal: AbortSignal | undefined
    const spy = vi
      .spyOn(api.dashboard, "getProjectHome")
      .mockImplementation((_projectId, options) => {
        signal = options?.signal
        return new Promise<never>(() => undefined)
      })

    const { unmount } = renderHook(() => useProjectHome("prj_01"))
    await waitFor(() => expect(spy).toHaveBeenCalled())

    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal?.aborted).toBe(false)

    unmount()
    expect(signal?.aborted).toBe(true)
  })
})
