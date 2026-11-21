import type { Metadata } from "next"
import Link from "next/link"

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
          Looking for something specific? <Link href="/#search">Search the site</Link> or browse the{" "}
          <Link href="/changelog">changelog</Link>.
        </>
      }
    >
      <Link href="/" className={`${brandedErrorStyles.action} ${brandedErrorStyles.primary}`}>
        Back to home
      </Link>
      <Link href="/docs" className={`${brandedErrorStyles.action} ${brandedErrorStyles.ghost}`}>
        Read the docs
      </Link>
      <Link href="/pricing" className={`${brandedErrorStyles.action} ${brandedErrorStyles.ghost}`}>
        Pricing
      </Link>
    </BrandedErrorScreen>
  )
}
