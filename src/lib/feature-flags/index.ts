export * from "./types"
export * from "./flags"
export * from "./evaluate"
// NOTE: `./server` is intentionally not re-exported here — it reads
// `process.env` and must stay out of the client bundle. Server components and
// route handlers import it directly: `@/lib/feature-flags/server`.
//
// The React hook lives under src/components/feature-flags (per repo
// conventions) but is re-exported so `@/lib/feature-flags` is the single
// import surface; the "use client" boundary applies to that export only.
export { useFeatureFlag } from "@/components/feature-flags/use-feature-flag"
export { FeatureFlagsProvider } from "@/components/feature-flags/feature-flags-provider"
