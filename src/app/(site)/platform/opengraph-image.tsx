import { ogImageContentType, ogImageSize, renderOgImage } from "@/lib/og-image"

export const alt = "Spindle platform — files, lab, search, agent, collaboration, and automation"
export const size = ogImageSize
export const contentType = ogImageContentType

export default function Image() {
  return renderOgImage({
    eyebrow: "Platform",
    title: "The research operating system, in one project.",
    subtitle:
      "Files, a live lab, local search, automations, an agent, collaboration, integrations, and trust controls — one project home.",
    url: "spindle.app/platform",
  })
}
