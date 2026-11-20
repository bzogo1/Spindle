import { describe, expect, it } from "vitest"

import {
  canDelete,
  canMoveTo,
  canMutate,
  clearRole,
  effectiveRole,
  isRoleAtLeast,
  loadPermissions,
  savePermissions,
  setRole,
} from "./permissions"
import { createNode, type FileTreeNode } from "./tree"

const file = (id: string): FileTreeNode => createNode({ id, name: id, type: "file" })
const dir = (id: string, children: FileTreeNode[] = []): FileTreeNode =>
  createNode({ id, name: id, type: "dir", children })

/** root > [src>[a.ts, b.ts], docs>[c.md]] */
const tree = (): FileTreeNode =>
  dir("root", [dir("src", [file("a"), file("b")]), dir("docs", [file("c")])])

describe("role helpers", () => {
  it("ranks roles hierarchically", () => {
    expect(isRoleAtLeast("admin", "editor")).toBe(true)
    expect(isRoleAtLeast("editor", "viewer")).toBe(true)
    expect(isRoleAtLeast("viewer", "editor")).toBe(false)
    expect(isRoleAtLeast("viewer", "viewer")).toBe(true)
  })

  it("setRole/clearRole return new maps", () => {
    const base = {}
    const next = setRole(base, "a", "viewer")
    expect(next).not.toBe(base)
    expect(next.a).toBe("viewer")
    expect(base).toEqual({})
    expect(clearRole(next, "a")).toEqual({})
  })
})

describe("effectiveRole", () => {
  it("inherits from the nearest ancestor assignment", () => {
    const t = tree()
    expect(effectiveRole(t, "a", { src: "viewer" })).toBe("viewer")
    expect(effectiveRole(t, "a", { src: "viewer", a: "admin" })).toBe("admin")
    expect(effectiveRole(t, "a", {})).toBe("admin") // default
    expect(effectiveRole(t, "a", {}, "viewer")).toBe("viewer")
    expect(effectiveRole(t, "missing", { root: "viewer" })).toBe("admin") // unknown node -> default
  })
})

describe("enforcement helpers", () => {
  it("canMutate requires editor+", () => {
    const t = tree()
    const perms = { src: "viewer" as const }
    expect(canMutate(t, "a", perms)).toBe(false)
    expect(canMutate(t, "a", { src: "editor" })).toBe(true)
    expect(canMutate(t, "docs", perms)).toBe(true) // docs unaffected
  })

  it("canMoveTo checks both node and destination", () => {
    const t = tree()
    // a is viewer under src; moving it anywhere is denied.
    expect(canMoveTo(t, "a", "docs", { src: "viewer" })).toBe(false)
    // Moving docs (admin) into src (viewer) denied — dest not editable.
    expect(canMoveTo(t, "docs", "src", { src: "viewer" })).toBe(false)
    // Moving docs to top level is fine.
    expect(canMoveTo(t, "docs", null, { src: "viewer" })).toBe(true)
  })

  it("canDelete requires edit rights on node and parent", () => {
    const t = tree()
    expect(canDelete(t, "a", { a: "viewer" })).toBe(false)
    // node editable but parent src is viewer -> denied
    expect(canDelete(t, "a", { src: "viewer" })).toBe(false)
    expect(canDelete(t, "a", {})).toBe(true)
  })
})

describe("persistence", () => {
  it("load/save round-trips and ignores junk", () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    }
    savePermissions({ a: "editor", b: "viewer" }, storage)
    expect(loadPermissions(storage)).toEqual({ a: "editor", b: "viewer" })
    store.set("spindle:tree-permissions", "{bad json")
    expect(loadPermissions(storage)).toEqual({})
    store.set("spindle:tree-permissions", '{"a":"superuser","b":"viewer"}')
    expect(loadPermissions(storage)).toEqual({ b: "viewer" })
  })
})
