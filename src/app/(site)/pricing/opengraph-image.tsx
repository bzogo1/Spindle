import { ogImageContentType, ogImageSize, renderOgImage } from "@/lib/og-image"

export const alt = "Spindle pricing — start free, bring a project"
export const size = ogImageSize
export const contentType = ogImageContentType

export default function Image() {
  return renderOgImage({
    eyebrow: "Pricing",
    title: "Start free. Bring a project.",
    subtitle:
      "Free for one researcher with 5 GB of storage. Team and Enterprise plans add shared workspaces, more storage, and dedicated support.",
    url: "spindle.app/pricing",
  })
}
