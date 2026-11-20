import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { EXAMPLE_VIDEO_ID, formatDuration, VIDEO_DOCS } from "./video-data"
import { VideoEmbed } from "./video-embed"

describe("video data", () => {
  it("uses a clearly-marked placeholder video id", () => {
    expect(EXAMPLE_VIDEO_ID).toContain("REPLACE")
    for (const video of VIDEO_DOCS) {
      expect(video.title.length).toBeGreaterThan(0)
    }
  })

  it("formats durations as m:ss / h:mm:ss", () => {
    expect(formatDuration(0)).toBe("0:00")
    expect(formatDuration(65)).toBe("1:05")
    expect(formatDuration(300)).toBe("5:00")
    expect(formatDuration(3725)).toBe("1:02:05")
    expect(formatDuration(-3)).toBe("0:00")
    expect(formatDuration(Number.NaN)).toBe("0:00")
  })
})

describe("VideoEmbed", () => {
  const youtubeVideo = {
    id: "yt",
    title: "YouTube guide",
    provider: "youtube" as const,
    videoId: "abc123",
    durationSeconds: 125,
    transcript: "Plain transcript text.",
  }

  it("renders a facade with title, duration, and no iframe until clicked", () => {
    const { container } = render(<VideoEmbed video={youtubeVideo} />)

    expect(screen.getByText("YouTube guide")).toBeInTheDocument()
    expect(screen.getByText("2:05")).toBeInTheDocument()
    expect(container.querySelector("iframe")).toBeNull()
    expect(container.querySelector("video")).toBeNull()
  })

  it("lazy-loads a privacy-friendly youtube-nocookie iframe on play", async () => {
    const user = userEvent.setup()
    const { container } = render(<VideoEmbed video={youtubeVideo} />)

    await user.click(screen.getByRole("button", { name: "Play video: YouTube guide" }))

    const iframe = container.querySelector("iframe")
    expect(iframe).not.toBeNull()
    expect(iframe?.src).toContain("youtube-nocookie.com/embed/abc123")
    expect(iframe?.src).toContain("autoplay=1")
  })

  it("renders the placeholder badge when using EXAMPLE_VIDEO_ID", () => {
    render(<VideoEmbed video={{ id: "ph", title: "Placeholder", provider: "youtube" }} />)
    expect(screen.getByText("Placeholder video")).toBeInTheDocument()
    expect(screen.getByText(EXAMPLE_VIDEO_ID)).toBeInTheDocument()
  })

  it("does not offer playback for the placeholder YouTube id", () => {
    const { container } = render(
      <VideoEmbed video={{ id: "ph2", title: "Placeholder two", provider: "youtube" }} />,
    )
    // Disabled facade: a div, not a button — nothing can be clicked to load
    // an embed for the REPLACE_WITH_YOUR_VIDEO_ID placeholder.
    expect(screen.queryByRole("button", { name: /Play video/ })).not.toBeInTheDocument()
    expect(container.querySelector("iframe")).toBeNull()
    expect(screen.getByText(/set/)).toBeInTheDocument()
  })

  it("disables playback for a local item without src and shows pendingNote", () => {
    render(
      <VideoEmbed
        video={{
          id: "local-missing",
          title: "Local pending",
          provider: "local",
          pendingNote: "Add an .mp4 under public/videos/ first.",
        }}
      />,
    )
    expect(screen.getByText("No video file")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Play video/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Add an \.mp4/)).toBeInTheDocument()
    // Local items must never show the YouTube placeholder badge/note.
    expect(screen.queryByText("Placeholder video")).not.toBeInTheDocument()
    expect(screen.queryByText(EXAMPLE_VIDEO_ID)).not.toBeInTheDocument()
  })

  it("mounts a native <video> element for local provider", async () => {
    const user = userEvent.setup()
    const { container } = render(
      <VideoEmbed
        video={{
          id: "local",
          title: "Local demo",
          provider: "local",
          src: "/videos/demo.mp4",
          captionsUrl: "/videos/demo.vtt",
        }}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Play video: Local demo" }))

    const video = container.querySelector("video")
    expect(video).not.toBeNull()
    expect(video?.getAttribute("src")).toBe("/videos/demo.mp4")
    expect(container.querySelector("track")).not.toBeNull()
  })

  it("exposes transcript cues and captions in a details slot", () => {
    render(
      <VideoEmbed
        video={{
          id: "t",
          title: "Transcripted",
          transcript: [{ startSeconds: 30, text: "Hello world" }],
          captionsUrl: "/v/captions.vtt",
        }}
      />,
    )

    expect(screen.getByText("Transcript & captions")).toBeInTheDocument()
    expect(screen.getByText("Hello world")).toBeInTheDocument()
    expect(screen.getByText("0:30")).toBeInTheDocument()
    expect(screen.getByText("/v/captions.vtt")).toBeInTheDocument()
  })
})
