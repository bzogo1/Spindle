import type { ComponentPropsWithoutRef, ReactNode } from "react"
import Link from "next/link"

import { CodeBlock, type CodeBlockProps } from "@/components/site/code-block"
import type { DocIcon } from "@/lib/docs"

/**
 * MDX headings get their base id from rehype-slug. Prefix it with the guide
 * slug so heading anchors match the old single-page docs ids.
 */
export function createDocHeading(prefix?: string) {
  return function DocHeading({ children, ...props }: ComponentPropsWithoutRef<"h2">) {
    return (
      <h2
        data-doc-heading
        tabIndex={-1}
        {...props}
        id={prefix && props.id ? `${prefix}-${props.id}` : props.id}
      >
        {children}
      </h2>
    )
  }
}

const iconHrefs: Record<DocIcon, string> = {
  folder: "#i-folder",
  bolt: "#i-bolt",
  sparkle: "#i-sparkle",
}

export function DocNote({ children }: { children: ReactNode }) {
  return <div className="doc-note">{children}</div>
}

export function DocSteps({ children }: { children: ReactNode }) {
  return <ol className="doc-steps">{children}</ol>
}

export function DocStep({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="doc-step">
      <div>
        <strong>{title}</strong> {children}
      </div>
    </li>
  )
}

export function DocLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link className="text-link" href={href}>
      {children}{" "}
      <svg className="icon icon--xs" aria-hidden="true">
        <use href="#i-arrow-right" />
      </svg>
    </Link>
  )
}

export function DocGuideGrid({ children }: { children: ReactNode }) {
  return <div className="feature-grid doc-guides">{children}</div>
}

export function DocGuideCard({
  title,
  description,
  href,
  icon,
}: {
  title: string
  description: string
  href: string
  icon: DocIcon
}) {
  return (
    <Link href={href} className="feature-card">
      <span className="card-icon">
        <svg className="icon icon--sm" aria-hidden="true">
          <use href={iconHrefs[icon]} />
        </svg>
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
    </Link>
  )
}

export async function DocCode({
  footerLeft,
  footerRight,
  ...props
}: Omit<CodeBlockProps, "footer"> & {
  footerLeft?: string
  footerRight?: string
}) {
  return (
    <CodeBlock
      {...props}
      footer={
        footerLeft || footerRight ? (
          <>
            <span className="mono">{footerLeft}</span>
            <span className="mono">{footerRight}</span>
          </>
        ) : undefined
      }
    />
  )
}
