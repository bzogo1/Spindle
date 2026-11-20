import { ImageResponse } from "next/og"

export const alt = "About Spindle — one workspace for the whole research project"
export const size = {
  width: 1200,
  height: 630,
}
export const contentType = "image/png"

export default function Image() {
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
          About
        </div>
        <div style={{ fontSize: 64, fontWeight: 600, lineHeight: 1.1, letterSpacing: "-0.03em" }}>
          One workspace for the whole project.
        </div>
        <div style={{ fontSize: 28, color: "#9aa49c", maxWidth: 900 }}>
          Files, a live lab, local search, automations, an agent, and your team — in one place.
        </div>
      </div>
      <div style={{ display: "flex", fontSize: 22, color: "#6d766e" }}>spindle.app/about</div>
    </div>,
    size,
  )
}
