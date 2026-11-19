import { AuthDialog } from "@/components/site/auth-dialog"
import { MainNav, MobileNav } from "@/components/site/site-nav"

/** Shared header: brand, desktop navigation, sign-in, and mobile menu. */
export function SiteHeader() {
  return (
    <header className="site-header" id="header">
      <div className="container header-inner">
        <a href="/" className="brand" aria-label="Spindle home">
          <span className="brand-mark">
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
          <span className="brand-name">spindle</span>
        </a>

        <div className="nav-desktop-slot">
          <MainNav />
        </div>

        <div className="header-actions">
          <AuthDialog />
          <a href="/#get-started" className="btn btn--primary btn--sm">
            Start free
          </a>
          <button
            className="menu-toggle"
            id="menuToggle"
            aria-label="Open menu"
            aria-expanded="false"
            aria-controls="mobileNav"
          >
            <svg className="icon icon--open">
              <use href="#i-menu" />
            </svg>
            <svg className="icon icon--close">
              <use href="#i-close" />
            </svg>
          </button>
        </div>
      </div>

      <nav className="nav-mobile" id="mobileNav" aria-label="Mobile navigation">
        <MobileNav />
      </nav>
    </header>
  )
}
