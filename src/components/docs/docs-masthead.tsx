/**
 * The "Spindle / Docs" lockup at the top of every docs page — large and
 * right-aligned, marking the docs as their own space inside the site.
 */
export function DocsMasthead() {
  return (
    <header className="docs-masthead">
      <div className="container docs-masthead-inner">
        <nav className="docs-masthead-nav" aria-label="Breadcrumb">
          <a className="docs-masthead-brand" href="/">
            Spindle
          </a>
          <span className="docs-masthead-sep" aria-hidden="true">
            /
          </span>
          <span className="docs-masthead-here">Docs</span>
        </nav>
      </div>
    </header>
  )
}
