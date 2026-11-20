import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { AUTOMATION_TEMPLATES } from "@/lib/automation-graph"

import { TemplatePicker } from "./template-picker"

describe("TemplatePicker", () => {
  it("lists every template and reports the chosen one", async () => {
    const user = userEvent.setup()
    const onLoadTemplate = vi.fn()
    render(<TemplatePicker onLoadTemplate={onLoadTemplate} />)

    await user.click(screen.getByRole("button", { name: "Templates" }))

    for (const template of AUTOMATION_TEMPLATES) {
      expect(screen.getByRole("menuitem", { name: new RegExp(template.name) })).toBeInTheDocument()
    }

    await user.click(screen.getByRole("menuitem", { name: /Daily digest/ }))
    expect(onLoadTemplate).toHaveBeenCalledTimes(1)
    expect(onLoadTemplate.mock.calls[0][0].id).toBe("daily-digest")
  })
})
