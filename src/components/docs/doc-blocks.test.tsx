import type { ReactNode } from "react"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { DocIcon } from "@/lib/docs"
import type { CodeBlockProps } from "@/components/site/code-block"

import {
  createDocHeading,
  DocCode,
  DocGuideCard,
  DocGuideGrid,
  DocLink,
  DocNote,
  DocStep,
  DocSteps,
} from "./doc-blocks"

// CodeBlock is an async server component (Shiki highlighting); DocCode only
// maps its footer props, so a synchronous stand-in keeps the test in jsdom.
vi.mock("@/components/site/code-block", () => ({
  CodeBlock: ({
    code,
    language,
    title,
    filename,
    meta,
    footer,
  }: CodeBlockProps & { footer?: ReactNode }) => (
    <div data-testid="code-block">
      <span data-testid="label">
        {title}
        {filename ? ` ${filename}` : ""}
        {meta ? ` ${meta}` : ""}
      </span>
      <span data-testid="lang">{language}</span>
      <pre>
        <code>{code}</code>
      </pre>
      <footer data-testid="footer">{footer}</footer>
    </div>
  ),
}))

describe("createDocHeading", () => {
  it("prefixes the rehype-slug id with the guide slug", () => {
    const Heading = createDocHeading("install")
    render(<Heading id="quick-start">Quick start</Heading>)

    const heading = screen.getByRole("heading", { name: "Quick start" })
    expect(heading).toHaveAttribute("id", "install-quick-start")
    expect(heading).toHaveAttribute("data-doc-heading")
    expect(heading).toHaveAttribute("tabindex", "-1")
  })

  it("keeps the bare id when no prefix is given", () => {
    const Heading = createDocHeading()
    render(<Heading id="usage">Usage</Heading>)

    expect(screen.getByRole("heading", { name: "Usage" })).toHaveAttribute("id", "usage")
  })

  it("leaves the id undefined when the slug produced none", () => {
    const Heading = createDocHeading("install")
    const { container } = render(<Heading>No id</Heading>)

    expect(container.querySelector("h2")).not.toHaveAttribute("id")
  })
})

describe("doc note and steps", () => {
  it("renders a note wrapper", () => {
    const { container } = render(<DocNote>Heads up</DocNote>)
    expect(container.querySelector(".doc-note")).toHaveTextContent("Heads up")
  })

  it("renders ordered steps with titles", () => {
    const { container } = render(
      <DocSteps>
        <DocStep title="Install">Run the installer.</DocStep>
        <DocStep title="Configure">Edit the config.</DocStep>
      </DocSteps>,
    )

    const steps = container.querySelector("ol.doc-steps")
    expect(steps).not.toBeNull()
    expect(steps!.querySelectorAll("li.doc-step")).toHaveLength(2)
    expect(screen.getByText("Install")).toBeInTheDocument()
    expect(screen.getByText("Configure")).toBeInTheDocument()
  })
})

describe("DocLink", () => {
  it("renders an external-style link with an arrow icon", () => {
    const { container } = render(<DocLink href="/docs/install">Installation</DocLink>)

    const link = screen.getByRole("link", { name: /Installation/ })
    expect(link).toHaveAttribute("href", "/docs/install")
    expect(link).toHaveClass("text-link")
    expect(container.querySelector("use")).toHaveAttribute("href", "#i-arrow-right")
  })
})

describe("DocGuideGrid and DocGuideCard", () => {
  it("renders cards linking to their guide with the matching icon", () => {
    const icons: DocIcon[] = ["folder", "bolt", "sparkle"]
    const iconHrefs: Record<DocIcon, string> = {
      folder: "#i-folder",
      bolt: "#i-bolt",
      sparkle: "#i-sparkle",
    }

    const { container } = render(
      <DocGuideGrid>
        {icons.map((icon, index) => (
          <DocGuideCard
            key={icon}
            title={`Guide ${index}`}
            description="What it covers."
            href={`/docs/guide-${index}`}
            icon={icon}
          />
        ))}
      </DocGuideGrid>,
    )

    expect(container.querySelector(".doc-guides")).not.toBeNull()

    for (const [index, icon] of icons.entries()) {
      const card = screen.getByRole("link", { name: new RegExp(`Guide ${index}`) })
      expect(card).toHaveAttribute("href", `/docs/guide-${index}`)
      expect(card.querySelector("use")).toHaveAttribute("href", iconHrefs[icon])
      expect(card).toHaveTextContent("What it covers.")
    }
  })
})

describe("DocCode", () => {
  it("passes footers through to the code card", async () => {
    render(
      await DocCode({
        code: "const answer = 42",
        language: "ts",
        title: "Example",
        footerLeft: "Terminal",
        footerRight: "zsh",
      }),
    )

    expect(screen.getByText("Terminal")).toBeInTheDocument()
    expect(screen.getByText("zsh")).toBeInTheDocument()
    expect(document.querySelector("pre code")).toHaveTextContent("const answer = 42")
    expect(screen.getByTestId("lang")).toHaveTextContent("ts")
  })

  it("renders without a footer when none is provided", async () => {
    render(await DocCode({ code: "echo hi", language: "bash" }))

    expect(screen.getByTestId("footer")).toBeEmptyDOMElement()
    expect(document.querySelector("pre code")).toHaveTextContent("echo hi")
  })

  it("renders a footer when only one side is provided", async () => {
    render(await DocCode({ code: "ls", language: "bash", footerRight: "~/project" }))

    const footer = screen.getByTestId("footer")
    expect(footer.querySelectorAll(".mono")).toHaveLength(2)
    expect(footer).toHaveTextContent("~/project")
  })
})
