import { Fragment, type CSSProperties, type ReactNode } from "react"
import type { ThemedToken } from "shiki/types"

import { CodeCopyButton } from "@/components/site/code-copy-button"
import { getLanguageLabel, highlightCode, parseLineHighlights } from "@/lib/code-highlight"

export type CodeBlockProps = {
  code: string
  language?: string
  /** Primary header label, such as "Project layout". Defaults to the filename or language. */
  title?: string
  /** Optional filename shown next to the title. */
  filename?: string
  /** Secondary header text, such as "Example" or "Weekly". */
  meta?: string
  /** 1-based line numbers or ranges, for example "2,5-7" or "{2,5-7}". */
  highlightLines?: string
  /** Marks +/− lines as added or removed. Implied by language="diff". */
  diff?: boolean
  footer?: ReactNode
}

function tokenStyle(token: ThemedToken): CSSProperties | undefined {
  const style: CSSProperties = {}

  if (token.color) style.color = token.color
  if (token.fontStyle) {
    if (token.fontStyle & 1) style.fontStyle = "italic"
    if (token.fontStyle & 2) style.fontWeight = 600
    if (token.fontStyle & 4) style.textDecoration = "underline"
  }

  return Object.keys(style).length > 0 ? style : undefined
}

/**
 * Server-rendered code card. Shiki highlights the code during the build and
 * the only client JavaScript is the small copy button.
 */
export async function CodeBlock({
  code,
  language = "text",
  title,
  filename,
  meta,
  highlightLines,
  diff = false,
  footer,
}: CodeBlockProps) {
  const lines = await highlightCode(code, language)
  const highlighted = parseLineHighlights(highlightLines)
  const sourceLines = code.split("\n")
  const isDiff = diff || language.trim().toLowerCase() === "diff"
  const languageLabel = getLanguageLabel(language)
  const primaryLabel = title ?? filename ?? languageLabel
  const copyLabel = title ?? filename ?? languageLabel

  return (
    <div className="code-card code-block-card" data-code-block>
      <div className="code-card-head">
        <span className="code-card-label">
          <span className="code-card-title">{primaryLabel}</span>
          {title && filename ? <span className="code-filename">{filename}</span> : null}
        </span>
        <span className="code-card-actions">
          {title || filename ? (
            <span className="code-lang" aria-hidden="true">
              {languageLabel}
            </span>
          ) : null}
          {meta ? <span className="mono code-meta">{meta}</span> : null}
          <CodeCopyButton code={code} label={copyLabel} />
        </span>
      </div>
      <pre className="code-block" tabIndex={0} aria-label={`${primaryLabel} code`}>
        <code>
          {lines.map((line, lineIndex) => {
            const lineNumber = lineIndex + 1
            const sourceLine = sourceLines[lineIndex] ?? ""
            const className = ["code-line"]

            if (highlighted.has(lineNumber)) className.push("code-line--highlighted")

            if (isDiff) {
              if (sourceLine.startsWith("+") && !sourceLine.startsWith("+++")) {
                className.push("code-line--added")
              } else if (sourceLine.startsWith("-") && !sourceLine.startsWith("---")) {
                className.push("code-line--removed")
              }
            }

            return (
              <Fragment key={lineNumber}>
                <span className={className.join(" ")} data-line={lineNumber}>
                  {line.map((token, tokenIndex) => (
                    <span key={tokenIndex} style={tokenStyle(token)}>
                      {token.content}
                    </span>
                  ))}
                </span>
                {lineIndex < lines.length - 1 ? "\n" : null}
              </Fragment>
            )
          })}
        </code>
      </pre>
      {footer ? <div className="code-card-foot">{footer}</div> : null}
    </div>
  )
}
