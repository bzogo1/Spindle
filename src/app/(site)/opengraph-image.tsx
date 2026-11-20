import { ogImageContentType, ogImageSize, renderOgImage } from "@/lib/og-image"
import { defaultSiteDescription } from "@/lib/seo"

export const alt = "Spindle — one workspace for the whole research project"
export const size = ogImageSize
export const contentType = ogImageContentType

export default function Image() {
  return renderOgImage({
    eyebrow: "Spindle",
    title: "One place for all your research.",
    subtitle: defaultSiteDescription,
    url: "spindle.app",
  })
}
