import type { Components } from "react-markdown"
import ReactMarkdown from "react-markdown"

/**
 * Notification rows are themselves a `<Link>` or `<button>`, so markdown must
 * never emit interactive elements — a nested `<a>` would break hydration and
 * cause double navigation. Links render as styled, non-interactive spans.
 * Raw HTML stays escaped (react-markdown default; no rehype-raw).
 */
const components: Components = {
  a: ({ href, children }) => (
    <span className="app-notification-md-link" title={href}>
      {children}
    </span>
  ),
}

/**
 * Renders notification body markdown (bold, links, inline code, lists).
 * Block elements are kept semantic; `.app-notification-body` CSS keeps them
 * compact inside the clamped notification row.
 */
export function NotificationMarkdown({ children }: { children: string }) {
  return <ReactMarkdown components={components}>{children}</ReactMarkdown>
}
