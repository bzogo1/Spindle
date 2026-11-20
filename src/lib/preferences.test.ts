import { beforeEach, describe, expect, it } from "vitest"

import {
  defaultUserPreferences,
  getUserPreferences,
  mergeUserPreferences,
  resetUserPreferencesForTests,
  updateUserPreferences,
  userPreferencesUpdateSchema,
} from "./preferences"

beforeEach(() => {
  resetUserPreferencesForTests()
})

describe("defaultUserPreferences", () => {
  it("returns the documented defaults", () => {
    expect(defaultUserPreferences()).toEqual({
      density: "comfortable",
      weekStartsOn: "monday",
      defaultProjectId: null,
      confirmDestructiveActions: true,
      reduceMotion: false,
    })
  })
})

describe("mergeUserPreferences", () => {
  it("returns defaults for non-object stored values", () => {
    for (const value of [undefined, null, "x", 42, []]) {
      expect(mergeUserPreferences(value)).toEqual(defaultUserPreferences())
    }
  })

  it("merges valid fields over defaults and ignores invalid ones", () => {
    expect(
      mergeUserPreferences({
        density: "compact",
        weekStartsOn: "sunday",
        defaultProjectId: "prj_123",
        confirmDestructiveActions: false,
        reduceMotion: true,
        unknownField: "ignored",
      }),
    ).toEqual({
      density: "compact",
      weekStartsOn: "sunday",
      defaultProjectId: "prj_123",
      confirmDestructiveActions: false,
      reduceMotion: true,
    })
  })

  it("falls back per-field on corrupt values", () => {
    expect(
      mergeUserPreferences({
        density: "huge",
        weekStartsOn: 7,
        defaultProjectId: 42,
        confirmDestructiveActions: "yes",
        reduceMotion: null,
      }),
    ).toEqual(defaultUserPreferences())
  })

  it("treats null and blank project ids as no default", () => {
    expect(mergeUserPreferences({ defaultProjectId: null }).defaultProjectId).toBeNull()
    expect(mergeUserPreferences({ defaultProjectId: "   " }).defaultProjectId).toBeNull()
    expect(mergeUserPreferences({ defaultProjectId: " prj_9 " }).defaultProjectId).toBe("prj_9")
  })
})

describe("userPreferencesUpdateSchema", () => {
  it("accepts partial updates and rejects unknown keys", () => {
    expect(userPreferencesUpdateSchema.safeParse({ density: "compact" }).success).toBe(true)
    expect(userPreferencesUpdateSchema.safeParse({}).success).toBe(true)
    expect(userPreferencesUpdateSchema.safeParse({ density: "huge" }).success).toBe(false)
    expect(userPreferencesUpdateSchema.safeParse({ locale: "uk" }).success).toBe(false)
    expect(userPreferencesUpdateSchema.safeParse({ defaultProjectId: null }).success).toBe(true)
    expect(userPreferencesUpdateSchema.safeParse({ defaultProjectId: "" }).success).toBe(false)
  })
})

describe("per-principal store", () => {
  it("returns defaults for unknown principals", () => {
    expect(getUserPreferences("user:nobody")).toEqual(defaultUserPreferences())
  })

  it("applies partial updates and merges subsequent ones", () => {
    updateUserPreferences("user:a", { density: "compact" })
    const merged = updateUserPreferences("user:a", { reduceMotion: true })
    expect(merged.density).toBe("compact")
    expect(merged.reduceMotion).toBe(true)
    expect(getUserPreferences("user:a")).toEqual(merged)
  })

  it("keeps overrides scoped per principal", () => {
    updateUserPreferences("user:a", { density: "compact" })
    expect(getUserPreferences("user:b").density).toBe("comfortable")
    expect(getUserPreferences("mock:a@example.com").density).toBe("comfortable")
  })

  it("clears the default project with an explicit null", () => {
    updateUserPreferences("user:a", { defaultProjectId: "prj_1" })
    const cleared = updateUserPreferences("user:a", { defaultProjectId: null })
    expect(cleared.defaultProjectId).toBeNull()
  })
})
