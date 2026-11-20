import type { NextConfig } from "next"
import createMDX from "@next/mdx"
import { withSentryConfig } from "@sentry/nextjs/config"
import withBundleAnalyzer from "@next/bundle-analyzer"

import { getBuildEnv, validateEnv } from "./src/lib/env.server"
import { securityHeaders } from "./src/lib/security-headers"

// `next build` and `next start` both load this config, so container
// entrypoints validate the same schema as the application.
validateEnv()

const buildEnv = getBuildEnv()

// Fold the deploy commit into the browser-visible release name so client
// events match the server/edge release and the release name withSentryConfig
// resolves for source-map upload. An explicit NEXT_PUBLIC_SENTRY_RELEASE wins;
// when nothing is set the key stays absent and the runtime falls back to
// DEFAULT_SENTRY_RELEASE.
const sentryRelease =
  buildEnv.NEXT_PUBLIC_SENTRY_RELEASE ?? buildEnv.VERCEL_GIT_COMMIT_SHA ?? buildEnv.GITHUB_SHA

const nextConfig: NextConfig = {
  // Temporary escape hatch for running a second dev server (e.g. visual
  // baselines) alongside a running `next dev`, which locks `.next/dev/lock`.
  distDir: process.env.NEXT_PRIVATE_DIST_DIR || ".next",
  reactStrictMode: true,
  env: sentryRelease ? { NEXT_PUBLIC_SENTRY_RELEASE: sentryRelease } : {},
  pageExtensions: ["js", "jsx", "md", "mdx", "ts", "tsx"],
  // The dev server is opened as http://127.0.0.1:3000 while Next binds
  // `localhost`; without this, Next blocks /_next/hmr and other dev assets
  // from that origin.
  allowedDevOrigins: ["127.0.0.1"],
  poweredByHeader: false,
  async headers() {
    // Policy lives in src/lib/security-headers.ts so it is unit-testable;
    // see that file's header comment for the CSP/HSTS/frame decisions.
    return securityHeaders()
  },
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
  enabled: buildEnv.ANALYZE === "true",
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
