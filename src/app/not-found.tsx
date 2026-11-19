import type { Metadata } from "next"

import { BrandedErrorScreen, brandedErrorStyles } from "@/components/site/branded-error-screen"

export const metadata: Metadata = {
  title: "Page not found — Spindle",
  description:
    "The page you are looking for does not exist. Head back to Spindle, read the docs, or search the site.",
}

export default function NotFound() {
  return (
    <BrandedErrorScreen
      eyebrow="404 — page not found"
      title="This page slipped out of the notebook."
      description="The link may be old, or the page may have moved. The rest of Spindle is still here."
      footer={
        <>
          Looking for something specific? <a href="/#search">Search the site</a> or browse the{" "}
          <a href="/changelog">changelog</a>.
        </>
      }
    >
      <a href="/" className={`${brandedErrorStyles.action} ${brandedErrorStyles.primary}`}>
        Back to home
      </a>
      <a href="/docs" className={`${brandedErrorStyles.action} ${brandedErrorStyles.ghost}`}>
        Read the docs
      </a>
      <a href="/pricing" className={`${brandedErrorStyles.action} ${brandedErrorStyles.ghost}`}>
        Pricing
      </a>
    </BrandedErrorScreen>
  )
}
