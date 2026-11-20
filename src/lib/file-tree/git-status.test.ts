import { describe, expect, it } from "vitest"

import {
  GIT_STATUS_META,
  LocalGitStatusProvider,
  functionGitStatusProvider,
  gitStatusProviderFromMap,
} from "./git-status"

describe("LocalGitStatusProvider", () => {
  it("returns seeded statuses by node id", () => {
    const provider = new LocalGitStatusProvider({
      a: "modified",
      b: { kind: "untracked", short: "U" },
    })
    expect(provider.get("a")).toEqual({ kind: "modified" })
    expect(provider.get("b")).toEqual({ kind: "untracked", short: "U" })
    expect(provider.get("missing")).toBeUndefined()
  })

  it("supports set/delete/clear", () => {
    const provider = new LocalGitStatusProvider()
    provider.set("x", "added")
    expect(provider.get("x")?.kind).toBe("added")
    provider.set("x", { kind: "deleted", staged: true })
    expect(provider.get("x")).toMatchObject({ kind: "deleted", staged: true })
    provider.delete("x")
    expect(provider.get("x")).toBeUndefined()
    provider.set("y", "conflicted")
    provider.clear()
    expect(provider.get("y")).toBeUndefined()
  })

  it("exposes entries for bulk consumers", () => {
    const provider = new LocalGitStatusProvider({ a: "modified", b: "renamed" })
    expect([...provider.entries!()]).toHaveLength(2)
  })
})

describe("adapters", () => {
  it("gitStatusProviderFromMap wraps a record", () => {
    const provider = gitStatusProviderFromMap({ f: "modified" })
    expect(provider.get("f")?.kind).toBe("modified")
  })

  it("functionGitStatusProvider adapts a lookup fn", () => {
    const provider = functionGitStatusProvider((id) => (id === "z" ? "deleted" : undefined))
    expect(provider.get("z")?.kind).toBe("deleted")
    expect(provider.get("nope")).toBeUndefined()
  })
})

describe("GIT_STATUS_META", () => {
  it("covers every status kind", () => {
    for (const kind of [
      "modified",
      "added",
      "deleted",
      "untracked",
      "renamed",
      "conflicted",
    ] as const) {
      expect(GIT_STATUS_META[kind].short).toBeTruthy()
      expect(GIT_STATUS_META[kind].label).toBeTruthy()
    }
  })
})
