import { ogImageContentType, ogImageSize, renderOgImage } from "@/lib/og-image"

export const alt = "Spindle pricing — free forever, funded by donations"
export const size = ogImageSize
export const contentType = ogImageContentType

export default function Image() {
  return renderOgImage({
    eyebrow: "Pricing",
    title: "Free forever, funded by you",
    subtitle:
      "Every feature, 5 GB of storage, and real-time collaboration on the $0 Hobby plan. Donations keep the servers on; Enterprise is a custom agreement.",
    url: "spindle.app/pricing",
  })
}
