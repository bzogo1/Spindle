import { describe, expect, it } from "vitest"

import { getNodeType, isTriggerType, NODE_TYPES } from "./registry"
import { portTypesCompatible } from "./types"
import type { NodeTypeDef } from "./types"

describe("NODE_TYPES registry", () => {
  it("has unique type keys", () => {
    const types = NODE_TYPES.map((def) => def.type)
    expect(new Set(types).size).toBe(types.length)
  })

  it("covers every node category", () => {
    const categories = new Set(NODE_TYPES.map((def) => def.category))
    expect(categories).toEqual(new Set(["trigger", "transform", "logic", "action"]))
  })

  it("gives every node at least one output and sane port ids", () => {
    for (const def of NODE_TYPES) {
      expect(def.outputs.length, `${def.type} has no outputs`).toBeGreaterThan(0)
      const portIds = [...def.inputs, ...def.outputs].map((p) => p.id)
      expect(new Set(portIds).size, `${def.type} has duplicate port ids`).toBe(portIds.length)
    }
  })

  it("triggers have no inputs", () => {
    for (const def of NODE_TYPES.filter((d) => d.category === "trigger")) {
      expect(def.inputs).toEqual([])
    }
  })

  it("declares well-formed config fields", () => {
    for (const def of NODE_TYPES) {
      for (const field of def.configFields) {
        expect(field.key, `${def.type} field without key`).toBeTruthy()
        expect(field.label, `${def.type}.${field.key} without label`).toBeTruthy()
        if (field.kind === "select") {
          expect(
            field.options?.length,
            `${def.type}.${field.key} select without options`,
          ).toBeGreaterThan(0)
        }
      }
    }
  })

  it("defaultConfig covers declared config fields", () => {
    for (const def of NODE_TYPES) {
      for (const field of def.configFields) {
        expect(
          Object.prototype.hasOwnProperty.call(def.defaultConfig, field.key),
          `${def.type} defaultConfig missing ${field.key}`,
        ).toBe(true)
      }
    }
  })
})

describe("getNodeType / isTriggerType", () => {
  it("resolves known types and rejects unknown ones", () => {
    expect(getNodeType("trigger.schedule")?.label).toBe("Schedule trigger")
    expect(getNodeType("trigger.webhook")?.category).toBe("trigger")
    expect(getNodeType("action.webhook")?.category).toBe("action")
    expect(getNodeType("nope")).toBeUndefined()
    expect(getNodeType("")).toBeUndefined()
  })

  it("identifies trigger types", () => {
    expect(isTriggerType("trigger.schedule")).toBe(true)
    expect(isTriggerType("trigger.event")).toBe(true)
    expect(isTriggerType("trigger.webhook")).toBe(true)
    expect(isTriggerType("transform")).toBe(false)
    expect(isTriggerType("bogus")).toBe(false)
  })
})

describe("registry port types", () => {
  it("only uses valid port types", () => {
    const valid = new Set(["any", "string", "number", "boolean", "json"])
    for (const def of NODE_TYPES as readonly NodeTypeDef[]) {
      for (const port of [...def.inputs, ...def.outputs]) {
        expect(valid.has(port.type), `${def.type}.${port.id} bad port type`).toBe(true)
      }
    }
  })

  it("port compatibility follows the documented wildcard rules", () => {
    // `any` is a wildcard on both sides; `json` accepts any source type.
    expect(portTypesCompatible("string", "json")).toBe(true)
    expect(portTypesCompatible("any", "number")).toBe(true)
    expect(portTypesCompatible("number", "any")).toBe(true)
    expect(portTypesCompatible("boolean", "string")).toBe(false)
    expect(portTypesCompatible("json", "string")).toBe(false)
  })
})
