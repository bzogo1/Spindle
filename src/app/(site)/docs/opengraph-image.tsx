import { ogImageContentType, ogImageSize, renderOgImage } from "@/lib/og-image"

export const alt = "Spindle docs — everything you need to get going"
export const size = ogImageSize
export const contentType = ogImageContentType

export default function Image() {
  return renderOgImage({
    eyebrow: "Documentation",
    title: "Everything you need to get going.",
    subtitle:
      "Set up a workspace, connect a lab session, run local search, and write automations for your research project.",
    url: "spindle.app/docs",
  })
}
