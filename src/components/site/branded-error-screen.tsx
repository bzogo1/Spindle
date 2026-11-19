import type { ReactNode } from "react"

import styles from "@/components/site/branded-error.module.css"

type BrandedErrorScreenProps = {
  eyebrow: string
  title: string
  description: string
  children: ReactNode
  footer?: ReactNode
}

/** A full-viewport branded screen for 404s and errors that render without a layout. */
export function BrandedErrorScreen({
  eyebrow,
  title,
  description,
  children,
  footer,
}: BrandedErrorScreenProps) {
  return (
    <main className={styles.screen}>
      <div className={styles.center}>
        <div className={styles.panel}>
          <a href="/" className={styles.brand} aria-label="Spindle home">
            <span className={styles.brandMark}>
              <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
                <path
                  d="M8 10.5C8 7.5 10.2 5 13 5h6c2.8 0 5 2.5 5 5.5v1.7c0 2.4-1.8 4.3-4.2 4.3h-3.6C13.8 21.5 12 23.4 12 25.8c0 .8.6 1.2 1.4 1.2h5.2c2.8 0 5-2.5 5-5.5"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                />
                <circle cx="8" cy="22" r="2.2" fill="currentColor" />
              </svg>
            </span>
            <span>spindle</span>
          </a>

          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.description}>{description}</p>
          <div className={styles.actions}>{children}</div>
          {footer ? <div className={styles.footer}>{footer}</div> : null}
        </div>
      </div>
    </main>
  )
}

export { styles as brandedErrorStyles }
