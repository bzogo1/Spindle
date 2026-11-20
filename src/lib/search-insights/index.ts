export * from "./schema"
export * from "./anonymous-id"
export * from "./store"
export * from "./tracker"
export * from "./analytics"
export * from "./conversions"
export * from "./performance"
export * from "./experiments"

// NOTE: `./use-search-insights` is intentionally NOT re-exported here — it is
// a "use client" React hook and consumers should deep-import it directly:
//   import { useTrackedSearch } from "@/lib/search-insights/use-search-insights"
// Keeping it out of the barrel avoids pulling React hook code into any
// server-side consumer of the analytics modules.
