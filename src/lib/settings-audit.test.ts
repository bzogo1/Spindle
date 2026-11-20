import { renderHook, act } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { isActivityEvent } from "./activity/events"
import {
  readSettingsAudit,
  recordSettingsAudit,
  toActivityEvent,
  useSettingsAuditLog,
} from "./settings-audit"

vi.mock("./activity/client", () => ({
  pushActivityEvent: vi.fn(),
}))

const actor = { id: "usr_01", name: "Bogdan", email: "bogdan@example.com" }

beforeEach(() => {
  window.localStorage.clear()
})

describe("recordSettingsAudit / readSettingsAudit", () => {
  it("persists entries newest-first per scope", () => {
    recordSettingsAudit("workspace", { actor, summary: "updated workspace settings" })
    recordSettingsAudit("project:prj_01", {
      actor,
      summary: "created a webhook",
      target: "https://example.com/hook",
    })
    recordSettingsAudit("workspace", {
      actor,
      summary: "updated workspace settings",
      target: "name",
    })

    const workspaceEntries = readSettingsAudit("workspace")
    expect(workspaceEntries).toHaveLength(2)
    expect(workspaceEntries[0].target).toBe("name")
    expect(workspaceEntries[0].actorName).toBe("Bogdan")
    expect(workspaceEntries[1].actorName).toBe("Bogdan")

    const projectEntries = readSettingsAudit("project:prj_01")
    expect(projectEntries).toHaveLength(1)
    expect(projectEntries[0].summary).toBe("created a webhook")
    expect(projectEntries[0].target).toBe("https://example.com/hook")
  })

  it("falls back to email then 'You' for the actor name", () => {
    recordSettingsAudit("workspace", { actor: { id: "u", email: "a@b.c" }, summary: "did a thing" })
    recordSettingsAudit("workspace", { summary: "did another thing" })

    const entries = readSettingsAudit("workspace")
    expect(entries[0].actorName).toBe("You")
    expect(entries[1].actorName).toBe("a@b.c")
  })

  it("returns [] for unknown scopes and corrupt payloads", () => {
    expect(readSettingsAudit("nope")).toEqual([])
    window.localStorage.setItem("spindle.settings-audit.v1.bad", "{not json")
    expect(readSettingsAudit("bad")).toEqual([])
    window.localStorage.setItem("spindle.settings-audit.v1.wrong", JSON.stringify([{ foo: 1 }]))
    expect(readSettingsAudit("wrong")).toEqual([])
  })
})

describe("useSettingsAuditLog", () => {
  it("returns stored entries and updates when a change is recorded", () => {
    recordSettingsAudit("workspace", { actor, summary: "first change" })

    const { result } = renderHook(() => useSettingsAuditLog("workspace"))
    expect(result.current).toHaveLength(1)
    expect(result.current[0].summary).toBe("first change")

    act(() => {
      recordSettingsAudit("workspace", { actor, summary: "second change" })
    })
    expect(result.current).toHaveLength(2)
    expect(result.current[0].summary).toBe("second change")
  })

  it("ignores changes recorded for other scopes", () => {
    const { result } = renderHook(() => useSettingsAuditLog("workspace"))

    act(() => {
      recordSettingsAudit("project:prj_01", { actor, summary: "project change" })
    })
    expect(result.current).toEqual([])
  })
})

describe("toActivityEvent", () => {
  it("produces a valid ActivityEvent for the shared feed", () => {
    const entry = recordSettingsAudit("project:prj_01", {
      actor,
      summary: "updated project settings",
      target: "name, description",
    })
    const event = toActivityEvent(entry)

    expect(isActivityEvent(event)).toBe(true)
    expect(event.kind).toBe("system")
    expect(event.projectId).toBe("prj_01")
    expect(event.actor.name).toBe("Bogdan")
    expect(event.target).toBe("name, description")
  })

  it("omits projectId for workspace-scoped entries", () => {
    const entry = recordSettingsAudit("workspace", { actor, summary: "updated workspace settings" })
    expect(toActivityEvent(entry).projectId).toBeUndefined()
  })
})

describe("recordSettingsAudit live delivery", () => {
  it("fans the change out to the activity channel", async () => {
    const { pushActivityEvent } = await import("./activity/client")
    recordSettingsAudit("workspace", { actor, summary: "updated workspace settings" })
    expect(pushActivityEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "system", summary: "updated workspace settings" }),
    )
  })
})
