import { ogImageContentType, ogImageSize, renderOgImage } from "@/lib/og-image"

export const alt = "Spindle solutions — one workspace shaped around how you work"
export const size = ogImageSize
export const contentType = ogImageContentType

export default function Image() {
  return renderOgImage({
    eyebrow: "Solutions",
    title: "One workspace, shaped around how you work.",
    subtitle:
      "Individual researchers, labs, teams, and institutions use Spindle as a shared research workspace.",
    url: "spindle.app/solutions",
  })
}
