import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = { title: "Page not found" }

export default function AppNotFound() {
  return (
    <div className="app-page">
      <h1 className="app-page-title">Page not found</h1>
      <p className="app-page-lede">
        The page you are looking for does not exist or may have moved.
      </p>
      <div className="app-page-card">
        <p>
          <Link href="/dashboard">Back to dashboard</Link>
        </p>
      </div>
    </div>
  )
}
