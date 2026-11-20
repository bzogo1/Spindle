import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { AgentRunTemplateGallery } from "./agent-run-template-gallery"
import type { AgentRunTemplate } from "@/lib/agent-runs/ops/templates"

const customTemplates: AgentRunTemplate[] = [
  {
    id: "tpl.test.one",
    name: "Test template",
    version: 2,
    description: "A test preset.",
    category: "testing",
    prompt: "Do the thing.",
    config: { model: "m-x", maxSteps: 4, tags: ["t1"] },
    featured: true,
  },
]

describe("AgentRunTemplateGallery", () => {
  it("renders builtin templates grouped by category", () => {
    render(<AgentRunTemplateGallery />)
    expect(screen.getByText("Code review")).toBeInTheDocument()
    expect(screen.getByText("Docs summarizer")).toBeInTheDocument()
    // "engineering" is both a category heading and a tag badge on cards.
    expect(screen.getAllByText("engineering").length).toBeGreaterThan(0)
  })

  it("instantiates a run and reports it via onInstantiate", async () => {
    const user = userEvent.setup()
    const onInstantiate = vi.fn()
    render(<AgentRunTemplateGallery templates={customTemplates} onInstantiate={onInstantiate} />)
    await user.click(screen.getByRole("button", { name: /instantiate/i }))
    expect(onInstantiate).toHaveBeenCalledTimes(1)
    const run = onInstantiate.mock.calls[0][0]
    expect(run.status).toBe("queued")
    expect(run.templateId).toBe("tpl.test.one")
    expect(run.prompt).toBe("Do the thing.")
    expect(run.model).toBe("m-x")
    expect(run.tags).toContain("t1")
    // Without a handler the created run id is shown inline.
    render(<AgentRunTemplateGallery templates={customTemplates} />)
    await user.click(screen.getAllByRole("button", { name: /instantiate/i })[0])
    expect(screen.getByText(/Instantiated run/)).toBeInTheDocument()
  })
})
