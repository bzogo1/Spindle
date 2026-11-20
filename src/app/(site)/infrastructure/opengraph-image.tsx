import { ogImageContentType, ogImageSize, renderOgImage } from "@/lib/og-image"

export const alt = "Spindle Infrastructure — your data is not a product"
export const size = ogImageSize
export const contentType = ogImageContentType

export default function Image() {
  return renderOgImage({
    eyebrow: "Infrastructure",
    title: "Your data is not a product.",
    subtitle:
      "HTTPS/TLS, Cloudflare Turnstile and Tunnels, and private Backblaze B2 storage keep every project secure.",
    url: "spindle.app/infrastructure",
  })
}
