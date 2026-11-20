// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { WorkspaceMemberInfo } from "@/lib/auth/backend"
import { resetWorkspaceSettingsForTests, updateWorkspaceSettings } from "@/lib/workspace-settings"

import { buildWorkspaceExport } from "./workspace-export"

const getWorkspace = vi.hoisted(() => vi.fn())
const listWorkspaceMembers = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/backend")>()
  return {
    ...actual,
    getAuthBackend: () => ({ getWorkspace, listWorkspaceMembers }),
  }
})

const workspace = { id: "ws-1", name: "Research team", slug: "research-team" }

function member(
  id: string,
  email: string,
  name: string | null,
  role: WorkspaceMemberInfo["role"],
): WorkspaceMemberInfo {
  return {
    user: {
      id,
      email,
      name,
      emailVerified: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    role,
  }
}

beforeEach(() => {
  getWorkspace.mockReset()
  listWorkspaceMembers.mockReset()
  resetWorkspaceSettingsForTests()

  getWorkspace.mockResolvedValue(workspace)
  listWorkspaceMembers.mockResolvedValue([
    member("u1", "ada@example.com", "Ada", "owner"),
    member("u2", "bob@example.com", null, "member"),
  ])
})

describe("buildWorkspaceExport", () => {
  it("returns null for an unknown workspace", async () => {
    getWorkspace.mockResolvedValue(null)
    await expect(buildWorkspaceExport("ws-missing")).resolves.toBeNull()
  })

  it("assembles a JSON-serializable snapshot", async () => {
    updateWorkspaceSettings("ws-1", {
      allowMemberInvites: true,
      displayLabel: "Acme",
    })

    const exportData = await buildWorkspaceExport("ws-1", Date.parse("2026-03-01T00:00:00Z"))

    expect(exportData).toEqual({
      exportedAt: "2026-03-01T00:00:00.000Z",
      workspace: { id: "ws-1", name: "Research team", slug: "research-team" },
      settings: {
        allowMemberInvites: true,
        defaultJoinRole: "member",
        displayLabel: "Acme",
      },
      members: [
        { user: { id: "u1", email: "ada@example.com", name: "Ada" }, role: "owner" },
        { user: { id: "u2", email: "bob@example.com", name: null }, role: "member" },
      ],
    })
    // Round-trips cleanly through JSON.
    expect(JSON.parse(JSON.stringify(exportData))).toEqual(exportData)
  })

  it("strips sensitive user fields from member entries", async () => {
    listWorkspaceMembers.mockResolvedValue([
      {
        user: {
          id: "u1",
          email: "ada@example.com",
          name: "Ada",
          emailVerified: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          // Extra fields a real backend might carry must not leak.
          passwordHash: "secret",
        } as never,
        role: "admin",
      },
    ])

    const exportData = await buildWorkspaceExport("ws-1")
    const first = exportData?.members[0]
    expect(first?.user).toEqual({ id: "u1", email: "ada@example.com", name: "Ada" })
    expect(first?.user).not.toHaveProperty("passwordHash")
    expect(first?.user).not.toHaveProperty("emailVerified")
  })

  it("uses default settings when none were stored", async () => {
    const exportData = await buildWorkspaceExport("ws-1")
    expect(exportData?.settings).toEqual({
      allowMemberInvites: false,
      defaultJoinRole: "member",
      displayLabel: "",
    })
  })
})
