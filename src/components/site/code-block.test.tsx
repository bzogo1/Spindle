import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { CodeBlock } from "@/components/site/code-block"

describe("CodeBlock", () => {
  it("labels the block and marks highlighted and diff lines", async () => {
    render(
      await CodeBlock({
        code: "+added line\n-removed line\n unchanged line",
        language: "diff",
        filename: "notes.patch",
        highlightLines: "3",
      }),
    )

    expect(screen.getByText("notes.patch")).toBeInTheDocument()
    expect(screen.getByText("Diff")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Copy notes.patch code" })).toBeInTheDocument()

    expect(document.querySelector(".code-line--added")).toHaveTextContent("+added line")
    expect(document.querySelector(".code-line--removed")).toHaveTextContent("-removed line")
    expect(document.querySelector(".code-line--highlighted")).toHaveTextContent("unchanged line")
  })

  it("keeps long whitespace runs exact", async () => {
    const code = "  /data           measurements\n  /notebooks      analysis"
    render(await CodeBlock({ code, language: "text" }))

    expect(document.querySelector("pre code")?.textContent).toBe(code)
  })
})
