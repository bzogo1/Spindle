import type { ReactNode } from "react"

/** Shared scaffold for the mocked app screens until the real pages land. */
export function AppPage({
  title,
  lede,
  children,
}: {
  title: string
  lede: string
  children?: ReactNode
}) {
  return (
    <div className="app-page">
      <h1 className="app-page-title">{title}</h1>
      <p className="app-page-lede">{lede}</p>
      {children}
    </div>
  )
}
