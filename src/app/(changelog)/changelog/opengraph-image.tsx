import { ogImageContentType, ogImageSize, renderOgImage } from "@/lib/og-image"

export const alt = "Spindle changelog — what shipped and what changed"
export const size = ogImageSize
export const contentType = ogImageContentType

export default function Image() {
  return renderOgImage({
    eyebrow: "Changelog",
    title: "What shipped and what changed.",
    subtitle: "Release notes for Spindle — new features, fixes, and improvements.",
    url: "spindle.app/changelog",
  })
}
