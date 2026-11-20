import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { ChangelogRelease } from "@/lib/changelog"

import { ChangelogReleaseArticle } from "./changelog-release"

const baseRelease: ChangelogRelease = {
  slug: "2-0",
  version: "2.0",
  date: "2026-12-01",
  title: "Search, rebuilt",
  summary: "A rebuilt search pipeline.",
  tags: ["Search"],
  body: [
    { type: "paragraph", text: "Search now runs locally first." },
    {
      type: "list",
      items: [{ label: "Index", text: "rebuilt from scratch" }],
    },
  ],
}

describe("ChangelogReleaseArticle", () => {
  it("links the title and permalink to the release path", () => {
    render(<ChangelogReleaseArticle release={baseRelease} />)

    const article = screen.getByRole("article")
    expect(article).toHaveAttribute("id", "release-2-0")
    expect(article).toHaveAttribute("data-permalink", "/changelog/2-0")

    expect(screen.getByRole("link", { name: "Search, rebuilt" })).toHaveAttribute(
      "href",
      "/changelog/2-0",
    )
    expect(screen.getByRole("link", { name: "Permalink" })).toHaveAttribute(
      "href",
      "/changelog/2-0",
    )
  })

  it("exposes the permalink path on the copy-link button", () => {
    render(<ChangelogReleaseArticle release={baseRelease} />)

    expect(screen.getByRole("button", { name: "Copy link" })).toHaveAttribute(
      "data-url",
      "/changelog/2-0",
    )
  })

  it("renders an image release inside a figure", () => {
    render(
      <ChangelogReleaseArticle
        release={{
          ...baseRelease,
          media: {
            kind: "image",
            src: "/media/search.png",
            alt: "New search UI",
            width: 1200,
            height: 675,
          },
        }}
      />,
    )

    const figure = document.querySelector("figure.cl-figure")
    expect(figure).not.toBeNull()
    const img = figure!.querySelector("img.cl-media")
    expect(img).toHaveAttribute("src", "/media/search.png")
    expect(img).toHaveAttribute("alt", "New search UI")
    expect(img).toHaveAttribute("width", "1200")
    expect(img).toHaveAttribute("height", "675")
    expect(figure!.querySelector("video")).toBeNull()
  })

  it("renders a video release with controls and poster", () => {
    render(
      <ChangelogReleaseArticle
        release={{
          ...baseRelease,
          media: {
            kind: "video",
            src: "/media/demo.mp4",
            alt: "Demo",
            width: 1280,
            height: 720,
            poster: "/media/demo-poster.jpg",
          },
        }}
      />,
    )

    const video = document.querySelector("figure.cl-figure video.cl-media")
    expect(video).not.toBeNull()
    expect(video).toHaveAttribute("controls")
    expect(video).toHaveAttribute("poster", "/media/demo-poster.jpg")
    expect(video!.querySelector("source")).toHaveAttribute("src", "/media/demo.mp4")
    expect(document.querySelector("figure.cl-figure img")).toBeNull()
  })

  it("omits the figure when the release has no media", () => {
    const { container } = render(<ChangelogReleaseArticle release={baseRelease} />)

    expect(container.querySelector("figure")).toBeNull()
    expect(screen.getByText("Search now runs locally first.")).toBeInTheDocument()
    expect(screen.getByText("Index")).toBeInTheDocument()
  })
})
