import { ogImageContentType, ogImageSize, renderOgImage } from "@/lib/og-image"

export const alt = "Spindle Agent — an agent that works the project"
export const size = ogImageSize
export const contentType = ogImageContentType

export default function Image() {
  return renderOgImage({
    eyebrow: "Agent",
    title: "An agent that works the project.",
    subtitle:
      "It reads your files, edits them in place, and keeps going until the task is done — every change arrives as a reviewable diff.",
    url: "spindle.app/agent",
  })
}
