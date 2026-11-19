import type { ReactNode } from "react"

/** Centered account screen: brand mark, form card, and small print only. */
export function AuthShell({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="auth-main">
      <div className="auth-shell">
        <a href="/" className="auth-brand" aria-label="Spindle home">
          <span className="auth-brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <path
                d="M8 10.5C8 7.5 10.2 5 13 5h6c2.8 0 5 2.5 5 5.5v1.7c0 2.4-1.8 4.3-4.2 4.3h-3.6C13.8 21.5 12 23.4 12 25.8c0 .8.6 1.2 1.4 1.2h5.2c2.8 0 5-2.5 5-5.5"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
              <circle cx="8" cy="22" r="2.2" fill="currentColor" />
            </svg>
          </span>
          <span className="auth-brand-name">spindle</span>
        </a>

        <section className="auth-card">{children}</section>

        {footer ? <div className="auth-card-foot">{footer}</div> : null}

        <p className="auth-legal">
          <a href="/privacy">Privacy</a>
          <span aria-hidden="true">·</span>
          <a href="/terms">Terms</a>
          <span aria-hidden="true">·</span>
          <a href="/about#contact">Contact support</a>
        </p>
      </div>
    </main>
  )
}
