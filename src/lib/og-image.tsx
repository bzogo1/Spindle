import { ImageResponse } from "next/og"

export const ogImageSize = {
  width: 1200,
  height: 630,
} as const

export const ogImageContentType = "image/png"

type OgCardProps = {
  /** Small uppercase label above the headline, e.g. "Pricing". */
  eyebrow: string
  /** Main headline on the card. */
  title: string
  /** Supporting line under the headline. */
  subtitle: string
  /** Bottom-left URL shown on the card, e.g. "spindle.app/pricing". */
  url: string
}

/**
 * Shared 1200×630 social card rendered by the `opengraph-image` route files.
 * Mirrors the visual style of `src/app/(site)/about/opengraph-image.tsx`.
 */
export function renderOgImage({ eyebrow, title, subtitle, url }: OgCardProps) {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px 80px",
        background: "#0d0f0e",
        color: "#e9ede8",
        fontFamily: "geist",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            background: "#c8f083",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 26,
            fontWeight: 700,
            color: "#0d0f0e",
          }}
        >
          S
        </div>
        <span style={{ fontSize: 34, fontWeight: 600, letterSpacing: "-0.02em" }}>spindle</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div
          style={{
            fontSize: 22,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "#9aa49c",
          }}
        >
          {eyebrow}
        </div>
        <div
          style={{
            fontSize: title.length > 48 ? 52 : 64,
            fontWeight: 600,
            lineHeight: 1.1,
            letterSpacing: "-0.03em",
            maxWidth: 1000,
          }}
        >
          {title}
        </div>
        <div style={{ fontSize: 28, color: "#9aa49c", maxWidth: 900 }}>{subtitle}</div>
      </div>
      <div style={{ display: "flex", fontSize: 22, color: "#6d766e" }}>{url}</div>
    </div>,
    ogImageSize,
  )
}
