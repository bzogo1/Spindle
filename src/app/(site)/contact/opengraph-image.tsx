import { ogImageContentType, ogImageSize, renderOgImage } from "@/lib/og-image"

export const alt = "Contact Spindle — talk to a human"
export const size = ogImageSize
export const contentType = ogImageContentType

export default function Image() {
  return renderOgImage({
    eyebrow: "Contact",
    title: "Talk to a human.",
    subtitle:
      "Questions about Spindle, onboarding, or a walkthrough of your team's workflow — send us a message.",
    url: "spindle.app/contact",
  })
}
