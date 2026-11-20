import { ogImageContentType, ogImageSize, renderOgImage } from "@/lib/og-image"

export const alt = "Spindle platform — one workspace, end to end"
export const size = ogImageSize
export const contentType = ogImageContentType

export default function Image() {
  return renderOgImage({
    eyebrow: "Platform",
    title: "One workspace, end to end.",
    subtitle:
      "Files, a live lab, local search, automations, an agent, and team chat — everything a project needs, together.",
    url: "spindle.app/platform",
  })
}
