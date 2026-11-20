import { ogImageContentType, ogImageSize, renderOgImage } from "@/lib/og-image"

export const alt = "Spindle Automations — put your research on a schedule"
export const size = ogImageSize
export const contentType = ogImageContentType

export default function Image() {
  return renderOgImage({
    eyebrow: "Automations",
    title: "Put your research on a schedule.",
    subtitle:
      "Text an AI what you need, shape it with a friendly builder, or write the cron yourself — one set of guardrails.",
    url: "spindle.app/automations",
  })
}
