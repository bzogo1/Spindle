import { ogImageContentType, ogImageSize, renderOgImage } from "@/lib/og-image"

export const alt = "Spindle Collaboration — one project, everyone in sync"
export const size = ogImageSize
export const contentType = ogImageContentType

export default function Image() {
  return renderOgImage({
    eyebrow: "Collaboration",
    title: "One project. Everyone in sync.",
    subtitle:
      "Project channels, live-cursor document editing, roles and permissions — with anonymous messages routed through the Nym Mixnet.",
    url: "spindle.app/collaboration",
  })
}
