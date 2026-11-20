import { beforeEach, describe, expect, it } from "vitest"

import {
  createTemplate,
  deleteTemplate,
  EMAIL_TEMPLATE_VAR_VALUE_MAX,
  EmailTemplateError,
  extractVariables,
  getTemplate,
  listTemplates,
  previewTemplateSchema,
  renderTemplate,
  resetEmailTemplateStoreForTests,
  seedStarterTemplates,
  updateTemplate,
} from "./email-templates-editor"

beforeEach(() => {
  resetEmailTemplateStoreForTests()
})

describe("extractVariables", () => {
  it("returns distinct names in first-appearance order", () => {
    expect(extractVariables("Hi {{name}}, see {{url}} and {{name}} again {{ other }}")).toEqual([
      "name",
      "url",
      "other",
    ])
  })

  it("returns an empty array when there are no placeholders", () => {
    expect(extractVariables("plain text {{ not a var }}")).toEqual([])
    expect(extractVariables("")).toEqual([])
  })
})

describe("renderTemplate", () => {
  it("substitutes provided variables in subject and body", () => {
    const rendered = renderTemplate(
      { subject: "Hi {{name}}", body: "Link: {{url}}" },
      { name: "Ada", url: "https://example.com" },
    )
    expect(rendered).toEqual({ subject: "Hi Ada", body: "Link: https://example.com" })
  })

  it("renders missing variables as empty strings", () => {
    const rendered = renderTemplate({ subject: "Hi {{name}}", body: "{{missing}}" }, {})
    expect(rendered.subject).toBe("Hi ")
    expect(rendered.body).toBe("")
  })

  it("tolerates whitespace inside braces", () => {
    const rendered = renderTemplate({ subject: "{{ name }}!", body: "x" }, { name: "Bo" })
    expect(rendered.subject).toBe("Bo!")
  })

  it("renders prototype-named placeholders as empty strings, not Object.prototype members", () => {
    // `toString`, `constructor`, and `__proto__` are valid per
    // VARIABLE_PATTERN but must not resolve to inherited Object members.
    const rendered = renderTemplate(
      { subject: "{{toString}}|{{constructor}}|{{__proto__}}", body: "{{hasOwnProperty}}" },
      {},
    )
    expect(rendered.subject).toBe("||")
    expect(rendered.body).toBe("")
  })

  it("still substitutes own properties whose names shadow Object.prototype", () => {
    const vars: Record<string, string> = { toString: "Ada", constructor: "Bo" }
    const rendered = renderTemplate({ subject: "{{toString}} {{constructor}}", body: "x" }, vars)
    expect(rendered.subject).toBe("Ada Bo")
  })
})

describe("previewTemplateSchema", () => {
  it("rejects variable values longer than EMAIL_TEMPLATE_VAR_VALUE_MAX", () => {
    const result = previewTemplateSchema.safeParse({
      subject: "s",
      body: "b",
      vars: { name: "x".repeat(EMAIL_TEMPLATE_VAR_VALUE_MAX + 1) },
    })
    expect(result.success).toBe(false)
  })

  it("accepts variable values at the bound", () => {
    const result = previewTemplateSchema.safeParse({
      subject: "s",
      body: "b",
      vars: { name: "x".repeat(EMAIL_TEMPLATE_VAR_VALUE_MAX) },
    })
    expect(result.success).toBe(true)
  })
})

describe("template store", () => {
  it("creates, lists, gets, updates, and deletes templates", () => {
    const created = createTemplate({
      name: "Welcome",
      subject: "Hi {{name}}",
      body: "Body {{url}}",
    })
    expect(created.id).toMatch(/^tpl_/)
    expect(created.variables).toEqual(["name", "url"])
    expect(created.createdAt).toBe(created.updatedAt)

    expect(listTemplates()).toHaveLength(1)
    expect(getTemplate(created.id)).toMatchObject({ name: "Welcome" })
    expect(getTemplate("tpl_missing")).toBeNull()

    const updated = updateTemplate(created.id, { subject: "Hey {{name}}", body: "New {{extra}}" })
    expect(updated).toMatchObject({ subject: "Hey {{name}}", body: "New {{extra}}" })
    expect(updated?.variables).toEqual(["name", "extra"])
    if (!updated) throw new Error("expected updateTemplate to return a template")
    expect(updated.updatedAt >= created.updatedAt).toBe(true)

    expect(deleteTemplate(created.id)).toBe(true)
    expect(deleteTemplate(created.id)).toBe(false)
    expect(listTemplates()).toHaveLength(0)
  })

  it("rejects invalid input", () => {
    expect(() => createTemplate({ name: "", subject: "s", body: "b" })).toThrow(EmailTemplateError)
    expect(() => createTemplate({ name: "n", subject: "", body: "b" })).toThrow(EmailTemplateError)
    expect(() => createTemplate({ name: "n", subject: "s", body: "" })).toThrow(EmailTemplateError)
    expect(() => updateTemplate("tpl_x", {})).toThrow(EmailTemplateError)
  })

  it("returns null when updating or rendering an unknown id", () => {
    expect(updateTemplate("tpl_missing", { name: "x" })).toBeNull()
  })

  it("seeds starter templates on demand and stays idempotent", () => {
    // The default reset suppresses lazy seeding, so the store starts empty.
    expect(listTemplates()).toHaveLength(0)
    const count = seedStarterTemplates()
    expect(count).toBeGreaterThanOrEqual(3)
    expect(listTemplates()).toHaveLength(count)
    seedStarterTemplates()
    expect(listTemplates()).toHaveLength(count)
  })

  it("seeds lazily on first access when re-armed", () => {
    resetEmailTemplateStoreForTests({ seed: true })
    expect(listTemplates().length).toBeGreaterThanOrEqual(3)
    expect(getTemplate("tpl_seed_welcome")?.name).toBe("Welcome")
  })
})
