const LINKS = [
  { href: "/developers", label: "Overview" },
  { href: "/developers/getting-started", label: "Getting started" },
  { href: "/developers/authentication", label: "Authentication" },
  { href: "/developers/permissions", label: "Permissions" },
  { href: "/developers/review", label: "Review process" },
  { href: "/developers/analytics", label: "Analytics" },
  { href: "/developers/playground", label: "API playground" },
  { href: "/developers/changelog", label: "Changelog" },
]

/** Secondary nav shared by the developer portal pages. */
export function DeveloperNav() {
  return (
    <nav className="developer-nav" aria-label="Developer portal">
      <div className="container">
        <ul>
          {LINKS.map((link) => (
            <li key={link.href}>
              <a href={link.href}>{link.label}</a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  )
}
