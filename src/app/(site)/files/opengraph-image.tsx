import { ogImageContentType, ogImageSize, renderOgImage } from "@/lib/og-image"

export const alt = "Spindle Files — every file, where the work happens"
export const size = ogImageSize
export const contentType = ogImageContentType

export default function Image() {
  return renderOgImage({
    eyebrow: "Files",
    title: "Every file, where the work happens.",
    subtitle:
      "Upload, organize, and preview 100+ formats inline — the same tree the Lab and the agent work in. 5 GB free.",
    url: "spindle.app/files",
  })
}
