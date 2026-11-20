import { beforeEach, describe, expect, it } from "vitest"

import {
  BETA_ENROLLMENTS_PER_PROGRAM_MAX,
  BETA_PROGRAMS_STORE_MAX,
  clearBetaAccessForTests,
  createProgram,
  enrollUser,
  getProgram,
  isEnrolled,
  listProgramEnrollments,
  listPrograms,
  listUserEnrollments,
  unenrollUser,
  updateProgramStatus,
} from "./beta-access"

beforeEach(() => {
  clearBetaAccessForTests()
})

describe("createProgram / listPrograms / getProgram", () => {
  it("creates an open program with an id and timestamp", () => {
    const program = createProgram({ name: "  AI copilot  ", description: " Try the new copilot " })
    expect(program.id).toMatch(/^beta_/)
    expect(program.name).toBe("AI copilot")
    expect(program.description).toBe("Try the new copilot")
    expect(program.status).toBe("open")
    expect(program.enrolledUserIds.size).toBe(0)
    expect(Date.parse(program.createdAt)).not.toBeNaN()
  })

  it("rejects a blank name", () => {
    expect(() => createProgram({ name: "   ", description: "" })).toThrow(/name/i)
  })

  it("lists programs newest first", () => {
    const first = createProgram({ name: "One", description: "" })
    const second = createProgram({ name: "Two", description: "" })
    // createdAt has ms resolution; force distinct ordering if needed.
    if (first.createdAt === second.createdAt) {
      first.createdAt = "2020-01-01T00:00:00.000Z"
    }
    const ids = listPrograms().map((p) => p.id)
    expect(ids).toEqual([second.id, first.id])
    expect(getProgram(second.id)).toBe(second)
    expect(getProgram("beta_missing")).toBeUndefined()
  })

  it("evicts the oldest program past the store bound", () => {
    const ids: string[] = []
    for (let i = 0; i < BETA_PROGRAMS_STORE_MAX + 1; i += 1) {
      ids.push(createProgram({ name: `P${i}`, description: "" }).id)
    }
    expect(listPrograms()).toHaveLength(BETA_PROGRAMS_STORE_MAX)
    expect(getProgram(ids[0])).toBeUndefined()
    expect(getProgram(ids[ids.length - 1])).toBeDefined()
  })
})

describe("updateProgramStatus", () => {
  it("opens and closes a program", () => {
    const program = createProgram({ name: "Beta", description: "" })
    expect(updateProgramStatus(program.id, "closed").status).toBe("closed")
    expect(updateProgramStatus(program.id, "open").status).toBe("open")
    expect(() => updateProgramStatus("beta_missing", "open")).toThrow(/not found/i)
    expect(() => updateProgramStatus(program.id, "bogus" as "open")).toThrow(/open.*closed/i)
  })
})

describe("enrollment", () => {
  it("enrolls and unenrolls users idempotently", () => {
    const program = createProgram({ name: "Beta", description: "" })
    enrollUser(program.id, "user:u1")
    enrollUser(program.id, "user:u1") // no-op
    expect(isEnrolled(program.id, "user:u1")).toBe(true)
    expect(program.enrolledUserIds.size).toBe(1)

    unenrollUser(program.id, "user:u1")
    unenrollUser(program.id, "user:u1") // no-op
    expect(isEnrolled(program.id, "user:u1")).toBe(false)
  })

  it("throws when enrolling into a missing program; unenroll is a no-op", () => {
    expect(() => enrollUser("beta_missing", "user:u1")).toThrow(/not found/i)
    expect(() => unenrollUser("beta_missing", "user:u1")).not.toThrow()
    expect(isEnrolled("beta_missing", "user:u1")).toBe(false)
  })

  it("allows admin enrollment into closed programs", () => {
    const program = createProgram({ name: "Beta", description: "" })
    updateProgramStatus(program.id, "closed")
    enrollUser(program.id, "user:u1")
    expect(isEnrolled(program.id, "user:u1")).toBe(true)
  })

  it("lists a user's enrollments across programs", () => {
    const a = createProgram({ name: "A", description: "" })
    const b = createProgram({ name: "B", description: "" })
    const c = createProgram({ name: "C", description: "" })
    // Ensure distinct createdAt ordering (ms resolution can tie).
    a.createdAt = "2020-01-01T00:00:00.000Z"
    b.createdAt = "2020-01-02T00:00:00.000Z"
    c.createdAt = "2020-01-03T00:00:00.000Z"
    enrollUser(a.id, "user:u1")
    enrollUser(b.id, "user:u1")
    enrollUser(c.id, "user:u2")

    expect(listUserEnrollments("user:u1").map((p) => p.id)).toEqual([b.id, a.id])
    expect(listUserEnrollments("user:u2").map((p) => p.id)).toEqual([c.id])
    expect(listUserEnrollments("nobody")).toEqual([])
  })

  it("lists program enrollments in enrollment order", () => {
    const program = createProgram({ name: "Beta", description: "" })
    enrollUser(program.id, "user:u2")
    enrollUser(program.id, "user:u1")
    expect(listProgramEnrollments(program.id)).toEqual(["user:u2", "user:u1"])
    expect(listProgramEnrollments("beta_missing")).toEqual([])
  })

  it("evicts the oldest enrollment past the per-program bound", () => {
    const program = createProgram({ name: "Beta", description: "" })
    for (let i = 0; i < BETA_ENROLLMENTS_PER_PROGRAM_MAX + 1; i += 1) {
      enrollUser(program.id, `user:u${i}`)
    }
    expect(program.enrolledUserIds.size).toBe(BETA_ENROLLMENTS_PER_PROGRAM_MAX)
    expect(isEnrolled(program.id, "user:u0")).toBe(false)
    expect(isEnrolled(program.id, `user:u${BETA_ENROLLMENTS_PER_PROGRAM_MAX}`)).toBe(true)
  })
})
