import { Fragment, type ReactNode } from "react"

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Whitespace/punctuation-separated lowercase tokens of a query. */
export function queryTokens(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9+#.-]+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 1),
    ),
  )
}

/**
 * Render `text` with query-token matches wrapped in `<mark>` for the
 * typeahead dropdown. Case-insensitive; tokens are matched on word
 * boundaries produced by splitting on the same separators used for tokenizing.
 */
export function SearchHighlight({
  text,
  query,
  className,
}: {
  text: string
  query: string
  className?: string
}): ReactNode {
  const tokens = queryTokens(query)
  if (tokens.length === 0) return <>{text}</>

  const pattern = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "gi")
  const lowerTokens = new Set(tokens)

  const parts = text.split(pattern).map((part, index) =>
    lowerTokens.has(part.toLowerCase()) ? (
      <mark key={index} className={className}>
        {part}
      </mark>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  )

  return <>{parts}</>
}
