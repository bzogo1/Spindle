import { beforeEach, describe, expect, it } from "vitest"

import {
  computeSyncPlan,
  lastSyncResult,
  resetDirectorySyncForTests,
  setLastSyncResult,
  type DirectorySyncRecord,
} from "./directory-sync"

const owner = { id: "u-owner", email: "Owner@Example.com", name: "Owner", role: "owner" as const }
const admin = { id: "u-admin", email: "admin@example.com", name: "Admin", role: "admin" as const }
const member = {
  id: "u-member",
  email: "member@example.com",
  name: "Member",
  role: "member" as const,
}

describe("computeSyncPlan", () => {
  it("plans additions for desired users not in the roster", () => {
    const plan = computeSyncPlan(
      [owner, member],
      [
        { email: "member@example.com" },
        { email: "New@Example.com", name: "New Person", role: "admin" },
      ],
    )

    expect(plan.toAdd).toEqual([{ email: "new@example.com", name: "New Person", role: "admin" }])
    expect(plan.toUpdate).toEqual([])
    expect(plan.toRemove).toEqual([])
    expect(plan.unchanged).toBe(2) // member matched + owner kept (absent, removeAbsent off)
    expect(plan.errors).toEqual([])
  })

  it("defaults added users to member role and null name", () => {
    const plan = computeSyncPlan([], [{ email: "a@b.co" }])
    expect(plan.toAdd).toEqual([{ email: "a@b.co", name: null, role: "member" }])
  })

  it("matches emails case-insensitively", () => {
    const plan = computeSyncPlan([owner], [{ email: "OWNER@example.com" }])
    expect(plan.toAdd).toEqual([])
    expect(plan.toRemove).toEqual([])
    expect(plan.unchanged).toBe(1)
  })

  it("plans role and name updates for matched users", () => {
    const plan = computeSyncPlan(
      [member],
      [{ email: "member@example.com", name: "Renamed", role: "admin" }],
    )
    expect(plan.toUpdate).toEqual([
      {
        userId: "u-member",
        email: "member@example.com",
        from: { name: "Member", role: "member" },
        to: { name: "Renamed", role: "admin" },
      },
    ])
    expect(plan.unchanged).toBe(0)
  })

  it("keeps the current role when the desired role is omitted", () => {
    const plan = computeSyncPlan([admin], [{ email: "admin@example.com", name: "Admin Two" }])
    expect(plan.toUpdate).toHaveLength(1)
    expect(plan.toUpdate[0].to.role).toBe("admin")
  })

  it("removes absent members only when removeAbsent is set", () => {
    const current = [owner, member]
    const desired = [{ email: "owner@example.com" }]

    const kept = computeSyncPlan(current, desired)
    expect(kept.toRemove).toEqual([])
    expect(kept.unchanged).toBe(2)

    const removed = computeSyncPlan(current, desired, { removeAbsent: true })
    expect(removed.toRemove).toEqual([{ userId: "u-member", email: "member@example.com" }])
    expect(removed.unchanged).toBe(1)
  })

  it("never plans removing the last owner", () => {
    const plan = computeSyncPlan([owner, member], [{ email: "member@example.com" }], {
      removeAbsent: true,
    })
    expect(plan.toRemove).toEqual([])
    expect(plan.errors).toHaveLength(1)
    expect(plan.errors[0]).toMatch(/last owner/i)
  })

  it("still removes a non-last owner", () => {
    const secondOwner = {
      id: "u-owner2",
      email: "o2@example.com",
      name: null,
      role: "owner" as const,
    }
    const plan = computeSyncPlan([owner, secondOwner], [{ email: "owner@example.com" }], {
      removeAbsent: true,
    })
    expect(plan.toRemove).toEqual([{ userId: "u-owner2", email: "o2@example.com" }])
    expect(plan.errors).toEqual([])
  })

  it("never plans demoting the last owner", () => {
    const plan = computeSyncPlan([owner], [{ email: "owner@example.com", role: "member" }])
    expect(plan.toUpdate).toEqual([])
    expect(plan.unchanged).toBe(1)
    expect(plan.errors).toHaveLength(1)
    expect(plan.errors[0]).toMatch(/last owner/i)
  })

  it("allows demoting an owner when another owner remains", () => {
    const secondOwner = {
      id: "u-owner2",
      email: "o2@example.com",
      name: null,
      role: "owner" as const,
    }
    const plan = computeSyncPlan(
      [owner, secondOwner],
      [{ email: "owner@example.com", role: "admin" }, { email: "o2@example.com" }],
    )
    expect(plan.toUpdate).toHaveLength(1)
    expect(plan.toUpdate[0].to.role).toBe("admin")
    expect(plan.errors).toEqual([])
  })

  it("reports invalid desired emails and skips them", () => {
    const plan = computeSyncPlan([], [{ email: "not-an-email" }, { email: "ok@example.com" }])
    expect(plan.toAdd).toEqual([{ email: "ok@example.com", name: null, role: "member" }])
    expect(plan.errors).toHaveLength(1)
    expect(plan.errors[0]).toContain("not-an-email")
  })

  it("reports invalid roles and skips those entries", () => {
    const plan = computeSyncPlan(
      [],
      [{ email: "a@b.co", role: "superuser" as never }, { email: "c@d.co" }],
    )
    expect(plan.toAdd).toEqual([{ email: "c@d.co", name: null, role: "member" }])
    expect(plan.errors).toHaveLength(1)
  })

  it("keeps an existing member matched when the desired role is invalid", () => {
    const plan = computeSyncPlan(
      [member],
      [{ email: "MEMBER@example.com", name: "Renamed", role: "superuser" as never }],
      { removeAbsent: true },
    )
    // A malformed row must never cause removal — the member is matched and
    // counted unchanged, with the problem reported in errors.
    expect(plan.toRemove).toEqual([])
    expect(plan.toUpdate).toEqual([])
    expect(plan.toAdd).toEqual([])
    expect(plan.unchanged).toBe(1)
    expect(plan.errors).toHaveLength(1)
    expect(plan.errors[0]).toContain("superuser")
    expect(plan.errors[0]).toContain("member@example.com")
  })

  it("keeps an existing member matched when the desired name is invalid", () => {
    const plan = computeSyncPlan(
      [member],
      [{ email: "member@example.com", name: "x".repeat(201) }],
      { removeAbsent: true },
    )
    expect(plan.toRemove).toEqual([])
    expect(plan.toUpdate).toEqual([])
    expect(plan.unchanged).toBe(1)
    expect(plan.errors).toHaveLength(1)
    expect(plan.errors[0]).toMatch(/invalid name/i)
  })

  it("still skips adding new users whose rows are malformed", () => {
    const plan = computeSyncPlan([], [{ email: "new@example.com", role: "superuser" as never }])
    expect(plan.toAdd).toEqual([])
    expect(plan.errors).toHaveLength(1)
  })

  it("demotes at most ownerCount - 1 owners when the desired list demotes them all", () => {
    const o1 = { id: "o1", email: "o1@x.co", name: null, role: "owner" as const }
    const o2 = { id: "o2", email: "o2@x.co", name: null, role: "owner" as const }
    const o3 = { id: "o3", email: "o3@x.co", name: null, role: "owner" as const }
    const plan = computeSyncPlan(
      [o1, o2, o3],
      [
        { email: "o1@x.co", role: "admin" },
        { email: "o2@x.co", role: "admin" },
        { email: "o3@x.co", role: "admin" },
      ],
    )
    // Two demotions allowed (3 owners -> 1 remains); the third is refused.
    expect(plan.toUpdate).toHaveLength(2)
    expect(plan.toUpdate.map((u) => u.userId).sort()).toEqual(["o1", "o2"])
    expect(plan.unchanged).toBe(1)
    expect(plan.errors).toHaveLength(1)
    expect(plan.errors[0]).toMatch(/last owner/i)
  })

  it("spends the owner budget across demotions and absent-owner removals", () => {
    const o1 = { id: "o1", email: "o1@x.co", name: null, role: "owner" as const }
    const o2 = { id: "o2", email: "o2@x.co", name: null, role: "owner" as const }
    // Demoting o1 leaves only one owner, so absent o2 must be kept too.
    const plan = computeSyncPlan([o1, o2], [{ email: "o1@x.co", role: "admin" }], {
      removeAbsent: true,
    })
    expect(plan.toUpdate).toHaveLength(1)
    expect(plan.toUpdate[0].to.role).toBe("admin")
    expect(plan.toRemove).toEqual([])
    expect(plan.errors).toHaveLength(1)
    expect(plan.errors[0]).toMatch(/last owner/i)
  })

  it("dedupes desired emails case-insensitively, keeping the first", () => {
    const plan = computeSyncPlan(
      [],
      [
        { email: "Dup@Example.com", name: "First" },
        { email: "dup@example.com", name: "Second" },
      ],
    )
    expect(plan.toAdd).toEqual([{ email: "dup@example.com", name: "First", role: "member" }])
    expect(plan.errors).toHaveLength(1)
  })

  it("handles an empty desired list", () => {
    const plan = computeSyncPlan([owner, member], [], { removeAbsent: true })
    // owner is protected; member is removed.
    expect(plan.toRemove).toEqual([{ userId: "u-member", email: "member@example.com" }])
    expect(plan.unchanged).toBe(1)
    expect(plan.errors).toHaveLength(1)
    expect(plan.errors[0]).toMatch(/last owner/i)
  })
})

describe("lastSyncResult / setLastSyncResult", () => {
  beforeEach(() => resetDirectorySyncForTests())

  it("returns null before anything is recorded", () => {
    expect(lastSyncResult("ws-x")).toBeNull()
  })

  it("stores and returns the latest record per workspace", () => {
    const record: DirectorySyncRecord = {
      at: "2026-01-01T00:00:00.000Z",
      dryRun: true,
      applied: false,
      plan: computeSyncPlan([], [{ email: "a@b.co" }]),
      outcome: null,
    }
    setLastSyncResult("ws-1", record)
    setLastSyncResult("ws-2", { ...record, dryRun: false })

    expect(lastSyncResult("ws-1")).toEqual(record)
    expect(lastSyncResult("ws-2")?.dryRun).toBe(false)
    expect(lastSyncResult("ws-3")).toBeNull()

    const next: DirectorySyncRecord = { ...record, at: "2026-01-02T00:00:00.000Z" }
    setLastSyncResult("ws-1", next)
    expect(lastSyncResult("ws-1")?.at).toBe("2026-01-02T00:00:00.000Z")
  })
})

describe("resetDirectorySyncForTests", () => {
  it("clears stored results", () => {
    setLastSyncResult("ws-1", {
      at: "2026-01-01T00:00:00.000Z",
      dryRun: true,
      applied: false,
      plan: computeSyncPlan([], []),
      outcome: null,
    })
    resetDirectorySyncForTests()
    expect(lastSyncResult("ws-1")).toBeNull()
  })
})

describe("unused imports sanity", () => {
  it("keeps admin/member fixtures referenced", () => {
    expect([admin, member].map((m) => m.role)).toEqual(["admin", "member"])
  })
})
