import { describe, expect, it } from "vitest"
import { Awareness, colorForUser, derivePresence, type AwarenessState } from "./awareness"

const state = (name: string, cursor: number, updatedAt: number): AwarenessState => ({
  user: { id: name, name, color: "#fff" },
  cursor,
  updatedAt,
})

describe("Awareness", () => {
  it("merges states with last-writer-wins per client", () => {
    const a = new Awareness()
    a.apply("u1", state("u1", 3, 100))
    a.apply("u1", state("u1", 7, 50)) // older timestamp loses
    expect(a.get("u1")?.cursor).toBe(3)
    a.apply("u1", state("u1", 9, 200))
    expect(a.get("u1")?.cursor).toBe(9)
  })

  it("keeps independent clients separate", () => {
    const a = new Awareness()
    a.apply("u1", state("u1", 1, 100))
    a.apply("u2", state("u2", 2, 100))
    expect(a.getAll().size).toBe(2)
  })

  it("notifies subscribers on change and remove", () => {
    const a = new Awareness()
    let calls = 0
    a.onChange(() => calls++)
    a.apply("u1", state("u1", 1, 1))
    a.remove("u1")
    expect(calls).toBe(2)
    expect(a.get("u1")).toBeUndefined()
  })

  it("assigns deterministic colours", () => {
    expect(colorForUser("alice")).toBe(colorForUser("alice"))
    expect(colorForUser("alice")).not.toBe(colorForUser("bob"))
  })

  it("apply returns false for stale states and true for equal/newer timestamps", () => {
    const a = new Awareness()
    expect(a.apply("u1", state("u1", 1, 100))).toBe(true)
    expect(a.apply("u1", state("u1", 2, 100))).toBe(true) // equal updatedAt wins
    expect(a.apply("u1", state("u1", 3, 99))).toBe(false) // stale loses
    expect(a.get("u1")?.cursor).toBe(2)
  })

  it("remove returns false for unknown clients and does not notify", () => {
    const a = new Awareness()
    let calls = 0
    a.onChange(() => calls++)
    expect(a.remove("ghost")).toBe(false)
    expect(calls).toBe(0)
    a.apply("u1", state("u1", 1, 1))
    expect(a.remove("u1")).toBe(true)
    expect(calls).toBe(2)
  })

  it("clear notifies only when non-empty; unsubscribe stops notifications", () => {
    const a = new Awareness()
    let calls = 0
    const unsub = a.onChange(() => calls++)
    a.clear() // empty — no notify
    expect(calls).toBe(0)
    a.apply("u1", state("u1", 1, 1))
    a.apply("u2", state("u2", 2, 1))
    a.clear()
    expect(calls).toBe(3)
    expect(a.getAll().size).toBe(0)
    unsub()
    a.apply("u3", state("u3", 3, 1))
    expect(calls).toBe(3)
  })
})

describe("derivePresence", () => {
  const now = 1_000_000
  const mk = (name: string, updatedAt: number, status?: AwarenessState["status"]) =>
    [
      name,
      {
        user: { id: name, name, color: "#fff" },
        cursor: 1,
        updatedAt,
        ...(status ? { status } : {}),
      } satisfies AwarenessState,
    ] as [string, AwarenessState]

  it("returns an empty roster for no states", () => {
    expect(derivePresence(new Map(), now)).toEqual([])
  })

  it("derives online/idle from updatedAt and the idle threshold", () => {
    const roster = derivePresence(
      new Map([mk("fresh", now - 5_000), mk("stale", now - 120_000)]),
      now,
      60_000,
    )
    expect(roster.find((e) => e.user.name === "fresh")?.status).toBe("online")
    const stale = roster.find((e) => e.user.name === "stale")
    expect(stale?.status).toBe("idle")
    expect(stale?.idleMs).toBe(120_000)
    expect(stale?.lastActiveAt).toBe(now - 120_000)
  })

  it("explicit status wins over derivation", () => {
    const roster = derivePresence(
      new Map([mk("gone", now, "away"), mk("busy", now - 10, "idle")]),
      now,
      60_000,
    )
    expect(roster.find((e) => e.user.name === "gone")?.status).toBe("away")
    expect(roster.find((e) => e.user.name === "busy")?.status).toBe("idle")
  })

  it("sorts online before idle before away, alphabetically within", () => {
    const roster = derivePresence(
      new Map([
        mk("zoe", now - 200_000), // idle
        mk("amy", now, "away"), // away
        mk("bob", now), // online
        mk("alice", now), // online
      ]),
      now,
      60_000,
    )
    expect(roster.map((e) => e.user.name)).toEqual(["alice", "bob", "zoe", "amy"])
  })

  it("accepts a plain iterable of pairs", () => {
    const roster = derivePresence([mk("solo", now)] as [string, AwarenessState][], now)
    expect(roster).toHaveLength(1)
    expect(roster[0].clientId).toBe("solo")
  })
})

describe("derivePresence explicit-online handling", () => {
  it("does not trust an explicit 'online' status on a stale peer", () => {
    const now = 1_000_000
    const staleOnline: AwarenessState = {
      user: { id: "x", name: "X", color: "#fff" },
      status: "online",
      updatedAt: now - 300_000,
    }
    const freshOnline: AwarenessState = { ...staleOnline, updatedAt: now - 10 }
    const roster = derivePresence(
      new Map([
        ["stale", staleOnline],
        ["fresh", freshOnline],
      ]),
      now,
      60_000,
    )
    expect(roster.find((e) => e.clientId === "stale")?.status).toBe("idle")
    expect(roster.find((e) => e.clientId === "fresh")?.status).toBe("online")
  })
})

describe("Awareness equal-timestamp tie-break", () => {
  it("converges regardless of the order equal-updatedAt states arrive", () => {
    const s1 = state("u1", 1, 100)
    const s2 = state("u1", 5, 100)
    const a = new Awareness()
    a.apply("u1", s1)
    a.apply("u1", s2)
    const b = new Awareness()
    b.apply("u1", s2)
    b.apply("u1", s1)
    expect(a.get("u1")?.cursor).toBe(b.get("u1")?.cursor)
    // Deterministic winner: lexicographically larger serialisation (cursor 5).
    expect(a.get("u1")?.cursor).toBe(5)
    expect(b.get("u1")?.cursor).toBe(5)
  })
})
