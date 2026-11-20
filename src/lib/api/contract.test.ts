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
  daily: [
    { date: "2026-11-01T00:00:00.000Z", requests: 6, tokens: 600, costUsd: 0.3 },
    { date: "2026-11-02T00:00:00.000Z", requests: 4, tokens: 400, costUsd: 0.2 },
  ],
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

const fixtureRunLogEntry = {
  id: "runlog_01",
  projectId: "prj_01",
  projectName: "Fixture Project",
  prompt: "do a thing",
  status: "running" as const,
  actor: { id: fixtureUser.id, name: fixtureUser.name ?? fixtureUser.email },
  createdAt: "2026-11-19T12:00:00.000Z",
  startedAt: "2026-11-19T12:00:01.000Z",
  finishedAt: null,
  steps: [],
  approval: null,
  summary: null,
}

const fixtureWorkspaceMember = {
  id: "usr_02",
  email: "teammate@example.com",
  name: "Teammate",
  createdAt: "2026-11-19T12:00:00.000Z",
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

/* Workspace fixtures — ids mirror the mock store seeds (file-tidal,
 * channel-field-notes, lab-rstudio, agent-run-101, …) so the same inputs
 * exercise both adapters. */

const fixtureWorkspaceProject = {
  id: fixtureProject.id,
  name: fixtureProject.name,
  owner: fixtureUser.name ?? fixtureUser.email,
  storageLimitBytes: 5 * 1024 * 1024 * 1024,
}

const fixtureFileNode = {
  id: "file-tidal",
  name: "tidal-2026.csv",
  kind: "file" as const,
  parentId: "folder-data",
  mimeType: "text/csv",
  sizeBytes: 2_418_304,
  owner: "Mara",
  updatedAt: "2026-11-19T08:42:00.000Z",
}

const fixtureFolderNode = {
  id: "folder-data",
  name: "data",
  kind: "folder" as const,
  parentId: null,
  mimeType: "inode/directory",
  sizeBytes: 0,
  owner: "Mara",
  updatedAt: "2026-11-18T16:20:00.000Z",
}

const fixtureFilesWorkspace = {
  project: fixtureWorkspaceProject,
  files: [fixtureFolderNode, fixtureFileNode],
  uploads: [],
  storage: { usedBytes: 2_418_304, limitBytes: 5 * 1024 * 1024 * 1024 },
}

const fixtureChatWorkspace = {
  project: fixtureWorkspaceProject,
  activeChannelId: "channel-field-notes",
  anonymous: false,
  botEnabled: true,
  channels: [
    { id: "channel-field-notes", name: "field-notes", kind: "channel", memberCount: 8 },
    { id: "channel-data-cleaning", name: "data-cleaning", kind: "channel", memberCount: 5 },
  ],
  messages: [
    {
      id: "msg-1",
      channelId: "channel-field-notes",
      authorId: "user-mara",
      authorName: "Mara",
      anonymous: false,
      body: "New survey batch is in /data.",
      createdAt: "2026-11-19T09:14:00.000Z",
      status: "sent" as const,
    },
  ],
  members: [{ id: "user-mara", name: "Mara", online: true }],
  typing: [],
}

const fixtureLabWorkspace = {
  project: fixtureWorkspaceProject,
  activeEnvironmentId: "lab-rstudio",
  environments: [
    {
      id: "lab-rstudio",
      name: "RStudio",
      kind: "rstudio" as const,
      status: "running" as const,
      title: "coastal-resilience / analysis.R",
      statusLabel: "Kernel idle",
      lastActiveAt: "2026-11-19T09:20:00.000Z",
    },
    {
      id: "lab-jupyter",
      name: "JupyterLab",
      kind: "jupyter" as const,
      status: "stopped" as const,
      title: "coastal-resilience / analysis.ipynb",
      statusLabel: "Python 3.12 · stopped",
      lastActiveAt: null,
    },
  ],
}

const fixtureAgentWorkspace = {
  project: fixtureWorkspaceProject,
  quota: { dailyLimit: 20, bonus: 50, used: 14 },
  config: { model: "spindle-1" as const, scope: "project" as const },
  activeRunId: "agent-run-101",
  runs: [
    {
      id: "agent-run-101",
      prompt: "tidy the export",
      status: "succeeded" as const,
      steps: [],
      diff: null,
      createdAt: "2026-11-19T10:00:00.000Z",
      finishedAt: "2026-11-19T10:05:00.000Z",
      summary: "Done.",
      retryOf: null,
      config: { model: "spindle-1" as const, scope: "project" as const },
    },
  ],
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
    "GET /workspace/members": () => json([fixtureUser, fixtureWorkspaceMember]),
    [`POST /projects/${fixtureProject.id}/members`]: (body) =>
      json(
        {
          id: "member_new",
          user: fixtureWorkspaceMember,
          role: (body as { role?: string } | undefined)?.role ?? "member",
          joinedAt: "2026-11-19T12:00:00.000Z",
        },
        201,
      ),
    [`PATCH /projects/${fixtureProject.id}/members/member_new`]: () =>
      json({
        id: "member_new",
        user: fixtureWorkspaceMember,
        role: "admin",
        joinedAt: "2026-11-19T12:00:00.000Z",
      }),
    [`DELETE /projects/${fixtureProject.id}/members/member_new`]: () =>
      new Response(null, { status: 204 }),
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
    [`POST /dashboard/agent-runs/${fixtureRunLogEntry.id}/cancel`]: () =>
      json({
        ...fixtureRunLogEntry,
        status: "cancelled",
        finishedAt: "2026-11-19T12:05:00.000Z",
        summary: "Run cancelled.",
      }),
    // Mirrors the mock fixture: runlog_03 is already finished, so cancelling
    // it is a conflict rather than a transition.
    "POST /dashboard/agent-runs/runlog_03/cancel": () =>
      errorJson(409, "conflict", "Run is not active."),

    /* WorkspaceApi — canonical `/projects/:id/workspace/<screen>` scheme. */
    [`GET /projects/${fixtureProject.id}/workspace/files`]: () => json(fixtureFilesWorkspace),
    [`POST /projects/${fixtureProject.id}/workspace/files/folders`]: () =>
      json(fixtureFilesWorkspace),
    [`PATCH /projects/${fixtureProject.id}/workspace/files/nodes/file-tidal`]: () =>
      json(fixtureFilesWorkspace),
    [`POST /projects/${fixtureProject.id}/workspace/files/nodes/move`]: () =>
      json(fixtureFilesWorkspace),
    [`POST /projects/${fixtureProject.id}/workspace/files/nodes/trash`]: () =>
      json(fixtureFilesWorkspace),
    [`POST /projects/${fixtureProject.id}/workspace/files/nodes/file-tidal/versions/ver-tidal-v1/restore`]:
      () => json(fixtureFilesWorkspace),
    [`POST /projects/${fixtureProject.id}/workspace/files/uploads`]: () =>
      json({ accepted: ["upload-101"], rejected: [], workspace: fixtureFilesWorkspace }, 201),
    [`POST /projects/${fixtureProject.id}/workspace/files/uploads/tick`]: () =>
      json(fixtureFilesWorkspace),
    [`POST /projects/${fixtureProject.id}/workspace/files/uploads/upload-101/actions`]: () =>
      json(fixtureFilesWorkspace),

    [`GET /projects/${fixtureProject.id}/workspace/chat`]: () => json(fixtureChatWorkspace),
    [`POST /projects/${fixtureProject.id}/workspace/chat/channels/channel-data-cleaning/select`]:
      () => json(fixtureChatWorkspace),
    [`POST /projects/${fixtureProject.id}/workspace/chat/anonymous`]: () =>
      json(fixtureChatWorkspace),
    [`POST /projects/${fixtureProject.id}/workspace/chat/bot`]: () => json(fixtureChatWorkspace),
    [`POST /projects/${fixtureProject.id}/workspace/chat/channels`]: () =>
      json(fixtureChatWorkspace, 201),
    [`POST /projects/${fixtureProject.id}/workspace/chat/messages/msg-1/reactions`]: () =>
      json(fixtureChatWorkspace),
    [`POST /projects/${fixtureProject.id}/workspace/chat/messages`]: () =>
      json(fixtureChatWorkspace),
    [`POST /projects/${fixtureProject.id}/workspace/chat/messages/settle`]: () =>
      json(fixtureChatWorkspace),
    [`POST /projects/${fixtureProject.id}/workspace/chat/messages/msg-1/retry`]: () =>
      json(fixtureChatWorkspace),

    [`GET /projects/${fixtureProject.id}/workspace/lab`]: () => json(fixtureLabWorkspace),
    [`POST /projects/${fixtureProject.id}/workspace/lab/environments/lab-jupyter/select`]: () =>
      json(fixtureLabWorkspace),
    [`POST /projects/${fixtureProject.id}/workspace/lab/environments/lab-jupyter/start`]: () =>
      json(fixtureLabWorkspace),
    [`POST /projects/${fixtureProject.id}/workspace/lab/environments/lab-jupyter/complete`]: () =>
      json(fixtureLabWorkspace),
    [`POST /projects/${fixtureProject.id}/workspace/lab/environments/lab-jupyter/stop`]: () =>
      json(fixtureLabWorkspace),
    [`POST /projects/${fixtureProject.id}/workspace/lab/environments/lab-rstudio/ping`]: () =>
      json(fixtureLabWorkspace),

    [`GET /projects/${fixtureProject.id}/workspace/agent`]: () => json(fixtureAgentWorkspace),
    [`PATCH /projects/${fixtureProject.id}/workspace/agent/config`]: (body) =>
      json({
        ...fixtureAgentWorkspace,
        config: body,
      }),
    [`POST /projects/${fixtureProject.id}/workspace/agent/runs`]: () => json(fixtureAgentWorkspace),
    [`POST /projects/${fixtureProject.id}/workspace/agent/runs/agent-run-101/retry`]: () =>
      json(fixtureAgentWorkspace),
    [`POST /projects/${fixtureProject.id}/workspace/agent/runs/agent-run-101/cancel`]: () =>
      json(fixtureAgentWorkspace),
    [`POST /projects/${fixtureProject.id}/workspace/agent/runs/advance`]: () =>
      json(fixtureAgentWorkspace),
    [`POST /projects/${fixtureProject.id}/workspace/agent/runs/agent-run-101/review`]: () =>
      json(fixtureAgentWorkspace),
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

  it("transfers project ownership through updateProject (mock adapter)", async () => {
    const client = createMockClient()

    const before = await client.dashboard.getProjectHome("prj_01")
    expect(before.project.owner.id).toBe("usr_01")
    expect(before.project.members.some((member) => member.user.id === "usr_02")).toBe(true)

    await client.projects.updateProject("prj_01", { ownerId: "usr_02" })

    const after = await client.dashboard.getProjectHome("prj_01")
    expect(after.project.owner.id).toBe("usr_02")
    expect(after.project.members.find((member) => member.user.id === "usr_02")?.role).toBe("owner")
    // The previous owner stays on as a regular member.
    expect(after.project.members.find((member) => member.user.id === "usr_01")?.role).toBe("member")

    // Non-members cannot be promoted to owner.
    await expect(
      client.projects.updateProject("prj_01", { ownerId: "usr_missing" }),
    ).rejects.toMatchObject({ status: 422 })

    // A rejected transfer must not persist sibling field changes either.
    const nameBefore = (await client.projects.getProject("prj_01")).name
    await expect(
      client.projects.updateProject("prj_01", {
        name: "Should Not Persist",
        ownerId: "usr_missing",
      }),
    ).rejects.toMatchObject({ status: 422 })
    expect((await client.projects.getProject("prj_01")).name).toBe(nameBefore)
  })

  it("manages project members", async () => {
    const client = make()

    const roster = await client.dashboard.listWorkspaceMembers()
    expect(roster.length).toBeGreaterThan(0)

    const home = await client.dashboard.getProjectHome("prj_01")
    const memberUserIds = new Set(home.project.members.map((member) => member.user.id))
    const candidate = roster.find((user) => !memberUserIds.has(user.id))
    expect(candidate).toBeDefined()

    const added = await client.projects.addProjectMember("prj_01", {
      userId: candidate!.id,
      role: "member",
    })
    expect(added.user.id).toBe(candidate!.id)
    expect(added.role).toBe("member")

    const promoted = await client.projects.updateProjectMemberRole("prj_01", added.id, "admin")
    expect(promoted.role).toBe("admin")

    // Role updates may re-key the membership id, so remove via the fresh row.
    await expect(
      client.projects.removeProjectMember("prj_01", promoted.id),
    ).resolves.toBeUndefined()

    // Only the mock adapter persists mutations; its reads reflect them.
    if (name === "mock") {
      const after = await client.dashboard.getProjectHome("prj_01")
      expect(after.project.members.some((member) => member.user.id === candidate!.id)).toBe(false)
    }
  })

  it("clones a project from an existing one", async () => {
    const client = make()
    const source = (await client.projects.listProjects())[0]

    const clone = await client.projects.createProject({
      name: `${source.name} (copy)`,
      cloneFromProjectId: source.id,
    })

    expect(clone.name).toBe(`${source.name} (copy)`)
    expect(clone.id).not.toBe(source.id)
  })

  it("normalizes missing resources to ApiError 404", async () => {
    const client = make()
    await expectApiError(client.projects.getProject("missing-id"))
    await expectApiError(client.projects.addProjectMember("missing-id", { userId: "usr_x" }))
    await expectApiError(client.projects.removeProjectMember("missing-id", "mem_x"))
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

  it("cancels an agent run log entry", async () => {
    const client = make()

    const cancelled = await client.dashboard.cancelAgentRunLogEntry("runlog_01")
    expect(cancelled.status).toBe("cancelled")
    expect(cancelled.finishedAt).not.toBeNull()

    // Only the mock adapter persists mutations; its reads reflect the
    // transition on the next fetch (the HTTP stub is stateless).
    if (name === "mock") {
      const entries = await client.dashboard.listAgentRunLog()
      expect(entries.find((entry) => entry.id === "runlog_01")?.status).toBe("cancelled")
    }

    await expectApiError(client.dashboard.cancelAgentRunLogEntry("missing-id"))

    const conflict = await client.dashboard
      .cancelAgentRunLogEntry("runlog_03")
      .catch((error: unknown) => error)
    expect(conflict).toBeInstanceOf(ApiError)
    expect((conflict as ApiError).status).toBe(409)
    expect((conflict as ApiError).code).toBe("conflict")
  })

  it("serves the files workspace and applies file mutations", async () => {
    const client = make()

    const workspace = await client.workspace.getFiles("prj_01")
    expect(workspace.project.id).toBe("prj_01")
    expect(workspace.files.length).toBeGreaterThan(0)
    expect(workspace.storage.limitBytes).toBeGreaterThan(0)

    const folder = await client.workspace.createFolder("prj_01", {
      parentId: null,
      name: "contract-folder",
    })
    expect(folder.files).toEqual(expect.any(Array))

    const renamed = await client.workspace.renameFileNode("prj_01", {
      id: "file-tidal",
      name: "tidal-renamed.csv",
    })
    expect(renamed.files).toEqual(expect.any(Array))

    const moved = await client.workspace.moveFileNodes("prj_01", {
      ids: ["file-survey"],
      targetFolderId: "folder-archive",
    })
    expect(moved.files).toEqual(expect.any(Array))

    const trashed = await client.workspace.trashFileNodes("prj_01", { ids: ["file-figure"] })
    expect(trashed.files).toEqual(expect.any(Array))

    const restored = await client.workspace.restoreFileNodeVersion("prj_01", {
      id: "file-tidal",
      versionId: "ver-tidal-v1",
    })
    expect(restored.files).toEqual(expect.any(Array))

    const added = await client.workspace.addUploads("prj_01", {
      parentId: null,
      files: [{ name: "contract-upload.csv", sizeBytes: 128, mimeType: "text/csv" }],
    })
    expect(added.accepted.length).toBe(1)
    expect(added.rejected).toEqual([])

    const ticked = await client.workspace.tickUploads("prj_01")
    expect(ticked.uploads).toEqual(expect.any(Array))

    await expect(
      client.workspace.updateUpload("prj_01", added.accepted[0], "cancel"),
    ).resolves.toMatchObject({ files: expect.any(Array) })
  })

  it("serves the chat workspace and applies channel mutations", async () => {
    const client = make()

    const workspace = await client.workspace.getChat("prj_01")
    expect(workspace.channels.length).toBeGreaterThan(0)
    expect(workspace.activeChannelId).toEqual(expect.any(String))
    expect(workspace.members).toEqual(expect.any(Array))

    const selected = await client.workspace.selectChatChannel("prj_01", "channel-data-cleaning")
    expect(selected.channels).toEqual(expect.any(Array))

    const anonymous = await client.workspace.setChatAnonymous("prj_01", true)
    expect(anonymous).toMatchObject({ channels: expect.any(Array) })

    const botToggled = await client.workspace.setChatBotEnabled("prj_01", false)
    expect(botToggled).toMatchObject({ channels: expect.any(Array) })

    const created = await client.workspace.createChatChannel("prj_01", {
      name: "contract-channel",
    })
    expect(created.channels).toEqual(expect.any(Array))

    const reacted = await client.workspace.toggleChatReaction("prj_01", "msg-1", "🔥")
    expect(reacted.messages).toEqual(expect.any(Array))

    const sent = await client.workspace.sendChannelMessage("prj_01", {
      channelId: "channel-field-notes",
      body: "contract ping",
    })
    expect(sent.messages).toEqual(expect.any(Array))

    const settled = await client.workspace.settleChannelMessages("prj_01")
    expect(settled.messages).toEqual(expect.any(Array))
  })

  it("serves the lab workspace and drives environment lifecycle", async () => {
    const client = make()

    const workspace = await client.workspace.getLab("prj_01")
    expect(workspace.environments.length).toBeGreaterThan(0)
    expect(workspace.activeEnvironmentId).toEqual(expect.any(String))

    // lab-jupyter starts stopped: select → start → complete → stop.
    await expect(
      client.workspace.selectLabEnvironment("prj_01", "lab-jupyter"),
    ).resolves.toMatchObject({ environments: expect.any(Array) })
    await expect(
      client.workspace.startLabEnvironment("prj_01", "lab-jupyter"),
    ).resolves.toMatchObject({ environments: expect.any(Array) })
    await expect(
      client.workspace.completeLabEnvironmentStart("prj_01", "lab-jupyter"),
    ).resolves.toMatchObject({ environments: expect.any(Array) })
    await expect(
      client.workspace.stopLabEnvironment("prj_01", "lab-jupyter"),
    ).resolves.toMatchObject({ environments: expect.any(Array) })
    // lab-rstudio is seeded running, so ping succeeds.
    await expect(
      client.workspace.pingLabEnvironment("prj_01", "lab-rstudio"),
    ).resolves.toMatchObject({ environments: expect.any(Array) })
  })

  it("serves the agent workspace and manages runs end to end", async () => {
    const client = make()

    const workspace = await client.workspace.getAgent("prj_01")
    expect(workspace.quota.dailyLimit).toBeGreaterThan(0)
    expect(workspace.runs).toEqual(expect.any(Array))

    const configured = await client.workspace.updateAgentConfig("prj_01", {
      model: "spindle-1-mini",
      scope: "files",
    })
    expect(configured.config).toMatchObject({ model: "spindle-1-mini", scope: "files" })

    const started = await client.workspace.startAgentRun("prj_01", "contract prompt")
    const runId = started.activeRunId ?? started.runs.at(-1)?.id
    expect(runId).toEqual(expect.any(String))

    // The mock needs one advance per step before the diff waits for review.
    for (let i = 0; i < 4; i += 1) {
      await client.workspace.advanceAgentRuns("prj_01")
    }
    const reviewed = await client.workspace.reviewAgentDiff("prj_01", runId!, "approved")
    expect(reviewed.runs).toEqual(expect.any(Array))

    const second = await client.workspace.startAgentRun("prj_01", "second prompt")
    const secondRunId = second.activeRunId ?? second.runs.at(-1)?.id
    expect(secondRunId).toEqual(expect.any(String))

    await client.workspace.cancelAgentRun("prj_01", secondRunId!)
    const retried = await client.workspace.retryAgentRun("prj_01", secondRunId!)
    expect(retried.runs.length).toBeGreaterThan(0)
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

  it("rejects retrying a chat message that is not failed", async () => {
    const client = createMockClient()
    // msg-1 is seeded "sent"; only "failed" messages can be retried.
    await expect(client.workspace.retryChannelMessage("prj_01", "msg-1")).rejects.toMatchObject({
      status: 409,
      code: "conflict",
    })
  })

  it("retries a seeded failed chat message back to sending", async () => {
    const client = createMockClient()
    // msg-6 is seeded "failed" so the retry path has a real target.
    const retried = await client.workspace.retryChannelMessage("prj_01", "msg-6")
    const message = retried.messages.find((candidate) => candidate.id === "msg-6")
    expect(message?.status).toBe("sending")

    // A second retry conflicts while the message is still in flight.
    await expect(client.workspace.retryChannelMessage("prj_01", "msg-6")).rejects.toMatchObject({
      status: 409,
      code: "conflict",
    })

    const settled = await client.workspace.settleChannelMessages("prj_01")
    expect(settled.messages.find((candidate) => candidate.id === "msg-6")?.status).toBe("sent")
  })

  it("applies the project template when creating a project", async () => {
    const client = createMockClient()

    const project = await client.projects.createProject({
      name: "Reef Census",
      templateId: "field-study",
    })
    expect(project.templateId).toBe("field-study")

    const home = await client.dashboard.getProjectHome(project.id)
    expect(home.files.map((file) => file.path).sort()).toEqual([
      "field-protocol.md",
      "observations/log.csv",
      "samples/inventory.csv",
      "sites/sites.geojson",
    ])

    const workspace = await client.workspace.getFiles(project.id)
    const names = workspace.files.map((node) => node.name)
    expect(names).toEqual(expect.arrayContaining(["sites", "observations", "samples"]))
    expect(names).toContain("field-protocol.md")

    const chat = await client.workspace.getChat(project.id)
    expect(chat.channels.map((channel) => channel.name)).toEqual([
      "general",
      "field-crew",
      "logistics",
    ])
  })

  it("clones a project's files, visibility, and workspace state", async () => {
    const client = createMockClient()

    // Materialize the source workspace stores so the clone copies live state.
    await client.workspace.getFiles("prj_01")
    await client.workspace.getChat("prj_01")
    await client.workspace.getLab("prj_01")

    const clone = await client.projects.createProject({
      name: "Coastal Resilience (copy)",
      cloneFromProjectId: "prj_01",
    })

    // File records are duplicated under the new project id.
    const home = await client.dashboard.getProjectHome(clone.id)
    const sourceHome = await client.dashboard.getProjectHome("prj_01")
    expect(home.files.map((file) => file.path).sort()).toEqual(
      sourceHome.files.map((file) => file.path).sort(),
    )
    for (const file of home.files) expect(file.projectId).toBe(clone.id)

    // The visibility profile carries over; the clone is owned by the session user.
    expect(home.project.visibility).toBe("workspace")
    expect(home.project.owner.id).toBe("usr_01")

    // The workspace store was cloned: same file tree, threads, and environments.
    const files = await client.workspace.getFiles(clone.id)
    const sourceFiles = await client.workspace.getFiles("prj_01")
    expect(files.files.map((node) => node.name).sort()).toEqual(
      sourceFiles.files.map((node) => node.name).sort(),
    )
    const chat = await client.workspace.getChat(clone.id)
    const sourceChat = await client.workspace.getChat("prj_01")
    expect(chat.channels.map((channel) => channel.name)).toEqual(
      sourceChat.channels.map((channel) => channel.name),
    )
    const lab = await client.workspace.getLab(clone.id)
    const sourceLab = await client.workspace.getLab("prj_01")
    expect(lab.environments.map((env) => env.id)).toEqual(
      sourceLab.environments.map((env) => env.id),
    )
    expect(lab.project.name).toBe("Coastal Resilience (copy)")
  })

  it("clones a never-opened project with the same seeded workspace", async () => {
    const client = createMockClient()

    // prj_01 is cloned without any prior workspace read, so its store was
    // never materialized — the clone must still get the rich demo seed
    // rather than an empty "blank" workspace.
    const clone = await client.projects.createProject({
      name: "Coastal Resilience (copy)",
      cloneFromProjectId: "prj_01",
    })
    expect(clone.templateId).toBeUndefined()

    const sourceFiles = await client.workspace.getFiles("prj_01")
    const cloneFiles = await client.workspace.getFiles(clone.id)
    expect(cloneFiles.files.length).toBeGreaterThan(0)
    expect(cloneFiles.files.map((node) => node.name).sort()).toEqual(
      sourceFiles.files.map((node) => node.name).sort(),
    )

    const sourceChat = await client.workspace.getChat("prj_01")
    const cloneChat = await client.workspace.getChat(clone.id)
    expect(cloneChat.channels.map((channel) => channel.name)).toEqual(
      sourceChat.channels.map((channel) => channel.name),
    )
    expect(cloneChat.messages).toHaveLength(sourceChat.messages.length)

    const sourceLab = await client.workspace.getLab("prj_01")
    const cloneLab = await client.workspace.getLab(clone.id)
    expect(cloneLab.environments.map((env) => env.id)).toEqual(
      sourceLab.environments.map((env) => env.id),
    )
  })

  it("keeps cloned project profiles private to each mock client", async () => {
    const clientA = createMockClient()
    const clientB = createMockClient()

    // Both clients mint the same next id ("prj_04"); before the per-client
    // profile copy, clientA's clone wrote into the shared fixture record and
    // clientB's unrelated project inherited the clone's visibility profile.
    const cloneA = await clientA.projects.createProject({
      name: "A copy",
      cloneFromProjectId: "prj_01",
    })
    const homeA = await clientA.dashboard.getProjectHome(cloneA.id)
    expect(homeA.project.visibility).toBe("workspace")

    const fresh = await clientB.projects.createProject({ name: "B fresh" })
    const homeB = await clientB.dashboard.getProjectHome(fresh.id)
    expect(homeB.project.visibility).toBe("private")
    expect(homeB.project.id).toBe(fresh.id)
  })

  it("falls back to the blank template for unknown template ids", async () => {
    const client = createMockClient()

    const project = await client.projects.createProject({
      name: "Plain",
      templateId: "not-a-template",
    })
    expect(project.templateId).toBe("blank")

    const workspace = await client.workspace.getFiles(project.id)
    expect(workspace.files).toHaveLength(0)
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

  it("routes every workspace call through /projects/:id/workspace/<screen>", async () => {
    const { fetchMock, calls } = createStubFetch()
    vi.stubGlobal("fetch", fetchMock)
    const client = createHttpClient({ baseUrl: API_BASE })

    await client.workspace.getFiles("prj_01")
    await client.workspace.createFolder("prj_01", { parentId: null, name: "x" })
    await client.workspace.renameFileNode("prj_01", { id: "file-tidal", name: "y.csv" })
    await client.workspace.getChat("prj_01")
    await client.workspace.sendChannelMessage("prj_01", {
      channelId: "channel-field-notes",
      body: "hi",
    })
    await client.workspace.retryChannelMessage("prj_01", "msg-1")
    await client.workspace.getLab("prj_01")
    await client.workspace.startLabEnvironment("prj_01", "lab-jupyter")
    await client.workspace.getAgent("prj_01")
    await client.workspace.updateAgentConfig("prj_01", {
      model: "spindle-1",
      scope: "project",
    })
    await client.workspace.startAgentRun("prj_01", "prompt")
    await client.workspace.cancelAgentRun("prj_01", "agent-run-101")
    await client.workspace.advanceAgentRuns("prj_01")
    await client.workspace.reviewAgentDiff("prj_01", "agent-run-101", "approved")

    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET /projects/prj_01/workspace/files",
      "POST /projects/prj_01/workspace/files/folders",
      "PATCH /projects/prj_01/workspace/files/nodes/file-tidal",
      "GET /projects/prj_01/workspace/chat",
      "POST /projects/prj_01/workspace/chat/messages",
      "POST /projects/prj_01/workspace/chat/messages/msg-1/retry",
      "GET /projects/prj_01/workspace/lab",
      "POST /projects/prj_01/workspace/lab/environments/lab-jupyter/start",
      "GET /projects/prj_01/workspace/agent",
      "PATCH /projects/prj_01/workspace/agent/config",
      "POST /projects/prj_01/workspace/agent/runs",
      "POST /projects/prj_01/workspace/agent/runs/agent-run-101/cancel",
      "POST /projects/prj_01/workspace/agent/runs/advance",
      "POST /projects/prj_01/workspace/agent/runs/agent-run-101/review",
    ])
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
