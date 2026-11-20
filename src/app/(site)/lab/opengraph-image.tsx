import { ogImageContentType, ogImageSize, renderOgImage } from "@/lib/og-image"

export const alt = "Spindle Lab — think in code, math, and pictures"
export const size = ogImageSize
export const contentType = ogImageContentType

export default function Image() {
  return renderOgImage({
    eyebrow: "The Lab",
    title: "Think in code, math, and pictures.",
    subtitle:
      "Python notebooks, R, script runs, duckdb-wasm SQL, Excalidraw canvas, Desmos graphing, and a symbolic math engine — all local-first.",
    url: "spindle.app/lab",
  })
}
