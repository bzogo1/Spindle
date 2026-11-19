import type { NextConfig } from "next"
import createMDX from "@next/mdx"
import { withSentryConfig } from "@sentry/nextjs/config"
import withBundleAnalyzer from "@next/bundle-analyzer"

import { getBuildEnv, validateEnv } from "./src/lib/env.server"

// `next build` and `next start` both load this config, so container
// entrypoints validate the same schema as the application.
validateEnv()

const buildEnv = getBuildEnv()

const nextConfig: NextConfig = {
  reactStrictMode: true,
  pageExtensions: ["js", "jsx", "md", "mdx", "ts", "tsx"],
  // The dev server is opened as http://127.0.0.1:3000 while Next binds
  // `localhost`; without this, Next blocks /_next/hmr and other dev assets
  // from that origin.
  allowedDevOrigins: ["127.0.0.1"],
}

const withMDX = createMDX({
  options: {
    // YAML frontmatter is read by scripts/build-docs-content.mjs; this only
    // keeps the block out of the rendered MDX body.
    remarkPlugins: ["remark-frontmatter"],
    // Heading ids must match the table-of-contents ids in the docs manifest.
    rehypePlugins: ["rehype-slug"],
  },
})

// The analyzer only wraps the webpack build (`npm run analyze` passes
// `--webpack`); it is a no-op for normal Turbopack builds and dev.
const analyzeBundle = withBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
  openAnalyzer: false,
})

export default analyzeBundle(
  withSentryConfig(withMDX(nextConfig), {
    org: "bogdan-zogovic",
    project: "spindle",

    silent: !buildEnv.CI,

    authToken: buildEnv.SENTRY_AUTH_TOKEN,
    widenClientFileUpload: true,
  }),
)
