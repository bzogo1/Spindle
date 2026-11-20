import { describe, expect, it } from "vitest"

import {
  buildUserPageArgs,
  decodeUserCursor,
  DEFAULT_PAGE_SIZE,
  encodeUserCursor,
  MAX_PAGE_SIZE,
  paginateUserRows,
  resolvePageSize,
} from "./pagination"

describe("resolvePageSize", () => {
  it("defaults when input is missing or invalid", () => {
    expect(resolvePageSize(undefined)).toBe(DEFAULT_PAGE_SIZE)
    expect(resolvePageSize(null)).toBe(DEFAULT_PAGE_SIZE)
    expect(resolvePageSize("")).toBe(DEFAULT_PAGE_SIZE)
    expect(resolvePageSize("abc")).toBe(DEFAULT_PAGE_SIZE)
    expect(resolvePageSize(0)).toBe(DEFAULT_PAGE_SIZE)
    expect(resolvePageSize(-5)).toBe(DEFAULT_PAGE_SIZE)
  })

  it("parses numeric strings and clamps to MAX_PAGE_SIZE", () => {
    expect(resolvePageSize("25")).toBe(25)
    expect(resolvePageSize(10)).toBe(10)
    expect(resolvePageSize("9999")).toBe(MAX_PAGE_SIZE)
    expect(resolvePageSize(9999)).toBe(MAX_PAGE_SIZE)
  })
})

describe("user cursor codec", () => {
  const user = {
    id: "clx123",
    createdAt: new Date("2026-01-02T03:04:05.000Z"),
  }

  it("round-trips a cursor", () => {
    const cursor = encodeUserCursor(user)
    expect(decodeUserCursor(cursor)).toEqual({
      createdAt: "2026-01-02T03:04:05.000Z",
      id: "clx123",
    })
  })

  it("returns null for missing or malformed cursors", () => {
    expect(decodeUserCursor(null)).toBeNull()
    expect(decodeUserCursor(undefined)).toBeNull()
    expect(decodeUserCursor("")).toBeNull()
    expect(decodeUserCursor("not-base64-json")).toBeNull()
    expect(decodeUserCursor(Buffer.from('{"id":1}').toString("base64url"))).toBeNull()
    expect(
      decodeUserCursor(Buffer.from('{"createdAt":"not-a-date","id":"x"}').toString("base64url")),
    ).toBeNull()
  })
})

describe("buildUserPageArgs", () => {
  it("emits take = pageSize + 1 with deterministic order and no where on first page", () => {
    const args = buildUserPageArgs({ pageSize: 10 })
    expect(args.take).toBe(11)
    expect(args.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }])
    expect(args.where).toBeUndefined()
  })

  it("defaults to desc order and DEFAULT_PAGE_SIZE", () => {
    const args = buildUserPageArgs()
    expect(args.take).toBe(DEFAULT_PAGE_SIZE + 1)
    expect(args.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }])
  })

  it("builds a keyset where for desc order", () => {
    const cursor = encodeUserCursor({
      id: "abc",
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
    })
    const args = buildUserPageArgs({ cursor, pageSize: 5 })
    expect(args.take).toBe(6)
    expect(args.where).toEqual({
      OR: [
        { createdAt: { lt: new Date("2026-01-02T00:00:00.000Z") } },
        {
          createdAt: new Date("2026-01-02T00:00:00.000Z"),
          id: { lt: "abc" },
        },
      ],
    })
  })

  it("builds a keyset where for asc order", () => {
    const cursor = encodeUserCursor({
      id: "abc",
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
    })
    const args = buildUserPageArgs({ cursor, order: "asc" })
    expect(args.orderBy).toEqual([{ createdAt: "asc" }, { id: "asc" }])
    expect(args.where).toEqual({
      OR: [
        { createdAt: { gt: new Date("2026-01-02T00:00:00.000Z") } },
        {
          createdAt: new Date("2026-01-02T00:00:00.000Z"),
          id: { gt: "abc" },
        },
      ],
    })
  })

  it("ignores invalid cursors and returns the first page", () => {
    const args = buildUserPageArgs({ cursor: "garbage" })
    expect(args.where).toBeUndefined()
    expect(args.take).toBe(DEFAULT_PAGE_SIZE + 1)
  })
})

describe("paginateUserRows", () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `id-${i}`,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
    }))

  it("returns all rows and no cursor when there is no next page", () => {
    const page = paginateUserRows(rows(3), 3)
    expect(page.items).toHaveLength(3)
    expect(page.nextCursor).toBeNull()
  })

  it("trims the lookahead row and emits a cursor for the next page", () => {
    const page = paginateUserRows(rows(4), 3)
    expect(page.items).toHaveLength(3)
    expect(page.items[2].id).toBe("id-2")
    const cursor = decodeUserCursor(page.nextCursor)
    expect(cursor).toEqual({
      createdAt: rows(4)[2].createdAt.toISOString(),
      id: "id-2",
    })
  })

  it("handles an empty result set", () => {
    const page = paginateUserRows([], 10)
    expect(page.items).toEqual([])
    expect(page.nextCursor).toBeNull()
  })
})
