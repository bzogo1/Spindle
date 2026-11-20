"use client"

import { BrandedErrorScreen, brandedErrorStyles } from "@/components/site/branded-error-screen"
import { useErrorReference } from "@/components/site/use-error-reference"

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  const { reference, copied, copyReference } = useErrorReference(error)

  return (
    <html lang="en">
      <head>
        <title>Something went wrong — Spindle</title>
      </head>
      <body style={{ margin: 0, background: "#f6f7f5" }}>
        <BrandedErrorScreen
          eyebrow="Unexpected error"
          title="Something went wrong."
          description="The page could not render. Try again, or head back home while we look into it. No error details have been exposed."
          footer={
            reference ? (
              <span className={brandedErrorStyles.reference}>
                <span>
                  Error reference <code className={brandedErrorStyles.code}>{reference}</code>
                </span>
                <button type="button" className={brandedErrorStyles.copy} onClick={copyReference}>
                  {copied ? "Copied" : "Copy error reference"}
                </button>
              </span>
            ) : null
          }
        >
          <button
            type="button"
            className={`${brandedErrorStyles.action} ${brandedErrorStyles.primary}`}
            onClick={() => retry()}
          >
            Try again
          </button>
          <a href="/" className={`${brandedErrorStyles.action} ${brandedErrorStyles.ghost}`}>
            Back to home
          </a>
          <a
            href="/about#contact"
            className={`${brandedErrorStyles.action} ${brandedErrorStyles.ghost}`}
          >
            Contact support
          </a>
        </BrandedErrorScreen>
      </body>
    </html>
  )
}
