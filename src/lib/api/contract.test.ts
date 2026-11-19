/**
 * Contract tests: the same behavioral suite runs against the mock adapter
 * and the HTTP adapter (with `fetch` stubbed to a local API fixture), so both
 * implementations are held to one `ApiClient` contract.
 */

import { afterEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "./client"
import { createHttpClient } from "./adapters/http"
import { createMockClient } from "./adapters/mock"
import type { ApiClient, Project } from "./types"

const API_BASE = "http://api.test"

const fixtureProject: Project = {
  id: "prj_01",
  name: "Fixture Project",
  slug: "fixture-project",
  status: "active",
  createdAt: "2026-11-19T12:00:00.000Z",
  updatedAt: "2026-11-19T12:00:00.000Z",
}

const fixtureFile = {
  id: "file_01",
  projectId: "prj_01",
  name: "README.md",
  path: "docs/README.md",
  sizeBytes: 2048,
  mimeType: "text/markdown",
  createdAt: "2026-11-19T12:00:00.000Z",
}

const fixtureSession = {
  id: "lab_01",
  projectId: "prj_01",
  title: "Baseline run",
  status: "completed" as const,
  createdAt: "2026-11-19T12:00:00.000Z",
  endedAt: "2026-11-19T12:00:00.000Z",
}

const fixtureMessage = {
  id: "msg_01",
  conversationId: "conv_01",
  role: "user" as const,
  content: "hello",
  createdAt: "2026-11-19T12:00:00.000Z",
}

const fixtureRun = {
  id: "run_01",
  projectId: "prj_01",
  prompt: "do a thing",
  status: "succeeded" as const,
  result: "done",
  createdAt: "2026-11-19T12:00:00.000Z",
  finishedAt: "2026-11-19T12:00:00.000Z",
}

const fixtureUser = {
  id: "usr_01",
  email: "demo@spindle.app",
  name: "Demo User",
  createdAt: "2026-11-19T12:00:00.000Z",
}

const fixtureUsage = {
  periodStart: "2026-11-01T00:00:00.000Z",
  periodEnd: "2026-11-30T23:59:59.000Z",
  requests: 10,
  tokens: 1000,
  costUsd: 0.5,
}

const fixtureProjectSummary = {
  ...fixtureProject,
  owner: fixtureUser,
  visibility: "workspace" as const,
  memberCount: 2,
  fileCount: 1,
  labSessionCount: 1,
  agentRunCount: 1,
  storageBytes: 2048,
  latestActivityAt: "2026-11-19T12:00:00.000Z",
}

const fixtureDashboard = {
  workspace: {
    id: "wsp_01",
    name: "Fixture Workspace",
    slug: "fixture",
    role: "owner" as const,
    createdAt: "2026-11-19T12:00:00.000Z",
  },
  user: fixtureUser,
  projects: [fixtureProjectSummary],
  activity: [
    {
      id: "act_01",
      projectId: fixtureProject.id,
      projectName: fixtureProject.name,
      kind: "agent" as const,
      actor: { id: fixtureUser.id, name: fixtureUser.name ?? fixtureUser.email },
      summary: "completed an agent run",
      target: "Fixture run",
      createdAt: "2026-11-19T12:00:00.000Z",
    },
  ],
  storage: {
    usedBytes: 4096,
    totalBytes: 1024 * 1024,
    fileBytes: 2048,
    computeBytes: 2048,
    availableBytes: 1024 * 1024 - 4096,
  },
  generatedAt: "2026-11-19T12:00:00.000Z",
}

const fixtureProjectHome = {
  project: {
    ...fixtureProject,
    visibility: "workspace" as const,
    owner: fixtureUser,
    members: [
      {
        id: "member_01",
        user: fixtureUser,
        role: "owner" as const,
        joinedAt: "2026-11-19T12:00:00.000Z",
      },
    ],
  },
  files: [fixtureFile],
  labSessions: [fixtureSession],
  agentRuns: [fixtureRun],
  chatConversationId: "conv_prj_01",
  chatMessages: [{ ...fixtureMessage, projectId: fixtureProject.id }],
  activity: fixtureDashboard.activity,
  storageBytes: 2048,
  generatedAt: "2026-11-19T12:00:00.000Z",
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-request-id": "test-request-id" },
  })
}

function errorJson(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status)
}

/** A tiny in-memory stand-in for the future backend, keyed by method+path. */
function createStubFetch() {
  const calls: { url: string; method: string; body: unknown }[] = []

  const routes: Record<string, (body?: unknown) => Response> = {
    "GET /projects": () => json([fixtureProject]),
    [`GET /projects/${fixtureProject.id}`]: () => json(fixtureProject),
    "POST /projects": (body) =>
      json({ ...fixtureProject, id: "prj_new", ...(body as object) }, 201),
    [`PATCH /projects/${fixtureProject.id}`]: (body) =>
      json({ ...fixtureProject, ...(body as object) }),
    [`DELETE /projects/${fixtureProject.id}`]: () => new Response(null, { status: 204 }),
    "GET /files": () => json([fixtureFile]),
    [`GET /files/${fixtureFile.id}`]: () => json(fixtureFile),
    [`DELETE /files/${fixtureFile.id}`]: () => new Response(null, { status: 204 }),
    "GET /lab/sessions": () => json([fixtureSession]),
    [`GET /lab/sessions/${fixtureSession.id}`]: () => json(fixtureSession),
    "POST /lab/sessions": (body) =>
      json({ ...fixtureSession, id: "lab_new", status: "queued", ...(body as object) }, 201),
    [`GET /chat/conversations/conv_01/messages`]: () => json([fixtureMessage]),
    "POST /chat/messages": (body) =>
      json({ ...fixtureMessage, ...(body as object), role: "user" }, 201),
    "GET /agent/runs": () => json([fixtureRun]),
    [`GET /agent/runs/${fixtureRun.id}`]: () => json(fixtureRun),
    "POST /agent/runs": (body) =>
      json({ ...fixtureRun, id: "run_new", status: "queued", ...(body as object) }, 201),
    [`POST /agent/runs/${fixtureRun.id}/cancel`]: () =>
      json({ ...fixtureRun, status: "cancelled" }),
    "GET /auth/session": () => json(fixtureUser),
    "POST /auth/login": () => json(fixtureUser),
    "POST /auth/logout": () => new Response(null, { status: 204 }),
    "GET /usage/summary": () => json(fixtureUsage),
    "GET /dashboard": () => json(fixtureDashboard),
    [`GET /projects/${fixtureProject.id}/home`]: () => json(fixtureProjectHome),
  }

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), API_BASE)
    const method = init?.method ?? "GET"
    const key = `${method} ${url.pathname}`
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined
    calls.push({ url: url.pathname + url.search, method, body })

    const route = routes[key] ?? routes[`${method} ${url.pathname}`]
    if (route) return route(body)

    // Generic /:id fallbacks so adapter-generated ids resolve like real ones.
    const seg = url.pathname.split("/").filter(Boolean)
    const id = seg[seg.length - 1]
    const collection = seg.slice(0, -1).join("/")
    const fixtures: Record<string, unknown> = {
      projects: fixtureProject,
      files: fixtureFile,
      "lab/sessions": fixtureSession,
      "agent/runs": fixtureRun,
    }
    const fixture = fixtures[collection]
    if (id === "missing-id" && fixture) {
      return errorJson(404, "not_found", `${collection} not found`)
    }
    if (fixture) {
      if (method === "GET") return json({ ...(fixture as object), id })
      if (method === "PATCH") return json({ ...(fixture as object), id, ...(body as object) })
      if (method === "DELETE") return new Response(null, { status: 204 })
    }
    if (seg[0] === "agent" && seg[1] === "runs" && seg[3] === "cancel" && method === "POST") {
      return json({ ...fixtureRun, id: seg[2], status: "cancelled" })
    }
    return errorJson(404, "not_found", `No route for ${key}`)
  })

  return { fetchMock, calls }
}

type AdapterFactory = () => ApiClient

const adapters: Record<string, AdapterFactory> = {
  mock: () => createMockClient(),
  http: () => {
    const { fetchMock } = createStubFetch()
    vi.stubGlobal("fetch", fetchMock)
    return createHttpClient({ baseUrl: API_BASE })
  },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

async function expectApiError(promise: Promise<unknown>) {
  const error = await promise.catch((e: unknown) => e)
  expect(error).toBeInstanceOf(ApiError)
  const apiError = error as ApiError
  expect(apiError.status).toBe(404)
  expect(apiError.code).toBe("not_found")
  expect(apiError.message.length).toBeGreaterThan(0)
  expect(typeof apiError.requestId).toBe("string")
  return apiError
}

describe.each(Object.keys(adapters))("ApiClient contract — %s adapter", (name) => {
  const make = adapters[name]

  it("lists and fetches projects", async () => {
    const client = make()
    const projects = await client.projects.listProjects()
    expect(projects.length).toBeGreaterThan(0)
    expect(projects[0]).toMatchObject({ id: expect.any(String), name: expect.any(String) })

    const project = await client.projects.getProject(projects[0].id)
    expect(project.id).toBe(projects[0].id)
  })

  it("creates, updates and deletes projects", async () => {
    const client = make()
    const created = await client.projects.createProject({ name: "Contract Project" })
    expect(created.name).toBe("Contract Project")

    const updated = await client.projects.updateProject(created.id, { status: "archived" })
    expect(updated.status).toBe("archived")

    await expect(client.projects.deleteProject(created.id)).resolves.toBeUndefined()
  })

  it("normalizes missing resources to ApiError 404", async () => {
    const client = make()
    await expectApiError(client.projects.getProject("missing-id"))
    await expectApiError(client.files.getFile("missing-id"))
    await expectApiError(client.lab.getLabSession("missing-id"))
    await expectApiError(client.agent.getAgentRun("missing-id"))
  })

  it("lists files, optionally filtered by project", async () => {
    const client = make()
    const files = await client.files.listFiles()
    expect(files.length).toBeGreaterThan(0)
    expect(files[0]).toMatchObject({ id: expect.any(String), projectId: expect.any(String) })

    const filtered = await client.files.listFiles("prj_01")
    for (const file of filtered) expect(file.projectId).toBe("prj_01")

    const file = await client.files.getFile(files[0].id)
    expect(file.id).toBe(files[0].id)
    await expect(client.files.deleteFile(file.id)).resolves.toBeUndefined()
  })

  it("manages lab sessions", async () => {
    const client = make()
    const sessions = await client.lab.listLabSessions()
    expect(sessions[0]).toMatchObject({ id: expect.any(String), status: expect.any(String) })

    const created = await client.lab.createLabSession({ title: "New run" })
    expect(created.title).toBe("New run")

    const filtered = await client.lab.listLabSessions("prj_01")
    for (const session of filtered) {
      expect(session.projectId === undefined || session.projectId === "prj_01").toBe(true)
    }
  })

  it("lists and sends chat messages", async () => {
    const client = make()
    const messages = await client.chat.listMessages("conv_01")
    expect(messages.length).toBeGreaterThan(0)
    expect(messages[0]).toMatchObject({ role: expect.any(String), content: expect.any(String) })

    const sent = await client.chat.sendMessage({ conversationId: "conv_01", content: "hi" })
    expect(sent.content).toBe("hi")
  })

  it("manages agent runs", async () => {
    const client = make()
    const runs = await client.agent.listAgentRuns()
    expect(runs[0]).toMatchObject({ id: expect.any(String), status: expect.any(String) })

    const created = await client.agent.createAgentRun({ prompt: "contract" })
    expect(created.prompt).toBe("contract")

    const cancelled = await client.agent.cancelAgentRun(created.id)
    expect(cancelled.status).toBe("cancelled")

    const filtered = await client.agent.listAgentRuns("prj_01")
    for (const run of filtered) {
      expect(run.projectId === undefined || run.projectId === "prj_01").toBe(true)
    }
  })

  it("exposes the session and usage summary", async () => {
    const client = make()
    const session = await client.auth.getSession()
    expect(session === null || typeof session?.email === "string").toBe(true)

    const usage = await client.usage.getUsageSummary()
    expect(usage).toMatchObject({ requests: expect.any(Number), tokens: expect.any(Number) })

    await expect(client.auth.logout()).resolves.toBeUndefined()
  })

  it("serves dashboard and project home aggregates", async () => {
    const client = make()

    const dashboard = await client.dashboard.getWorkspaceDashboard()
    expect(dashboard.projects.length).toBeGreaterThan(0)
    expect(dashboard.projects[0]).toMatchObject({
      id: expect.any(String),
      owner: expect.any(Object),
      visibility: expect.any(String),
    })
    expect(dashboard.storage.usedBytes).toBeGreaterThanOrEqual(0)

    const home = await client.dashboard.getProjectHome("prj_01")
    expect(home.project.id).toBe("prj_01")
    for (const file of home.files) expect(file.projectId).toBe("prj_01")
    for (const run of home.agentRuns) {
      expect(run.projectId === undefined || run.projectId === "prj_01").toBe(true)
    }

    await expectApiError(client.dashboard.getProjectHome("missing-id"))
  })
})

describe("mock adapter specifics", () => {
  it("rejects invalid logins and clears the session on logout", async () => {
    const client = createMockClient()

    await expect(client.auth.login({ email: "not-an-email", password: "x" })).rejects.toMatchObject(
      { status: 401, code: "unauthorized" },
    )

    const user = await client.auth.login({ email: "a@b.co", password: "secret" })
    expect(user.email).toBe("a@b.co")

    await client.auth.logout()
    await expect(client.auth.getSession()).resolves.toBeNull()
  })

  it("rejects updates and deletes for unknown ids", async () => {
    const client = createMockClient()
    await expectApiError(client.projects.updateProject("missing-id", { name: "x" }))
    await expectApiError(client.projects.deleteProject("missing-id"))
    await expectApiError(client.files.deleteFile("missing-id"))
    await expectApiError(client.agent.cancelAgentRun("missing-id"))
  })
})

describe("http adapter transport details", () => {
  it("sends credentials, JSON headers and the request body", async () => {
    const { fetchMock, calls } = createStubFetch()
    vi.stubGlobal("fetch", fetchMock)
    const client = createHttpClient({ baseUrl: API_BASE })

    await client.projects.createProject({ name: "Wire Check" })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.credentials).toBe("include")
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json")
    expect(calls[0].method).toBe("POST")
    expect(calls[0].body).toEqual({ name: "Wire Check" })
  })

  it("passes query params for filtered lists", async () => {
    const { fetchMock } = createStubFetch()
    vi.stubGlobal("fetch", fetchMock)
    const client = createHttpClient({ baseUrl: API_BASE })

    await client.files.listFiles("prj_42")
    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    expect(url).toContain("projectId=prj_42")
  })

  it("maps a 401 session response to null and rethrows other failures", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), API_BASE).pathname
      if (path === "/auth/session") {
        return errorJson(401, "unauthorized", "No session")
      }
      return errorJson(500, "server_error", "Boom")
    })
    vi.stubGlobal("fetch", fetchMock)
    const client = createHttpClient({ baseUrl: API_BASE })

    await expect(client.auth.getSession()).resolves.toBeNull()
    await expect(client.projects.listProjects()).rejects.toMatchObject({
      status: 500,
      code: "server_error",
    })
  })
})
