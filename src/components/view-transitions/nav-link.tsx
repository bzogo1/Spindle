import Link from "next/link"
import type { ComponentProps } from "react"

import { NAV_BACK, NAV_FORWARD } from "./vt-support"

export type NavDirection = typeof NAV_FORWARD | typeof NAV_BACK

type NavLinkProps = Omit<ComponentProps<typeof Link>, "transitionTypes"> & {
  /**
   * Directional transition type consumed by `PageTransition` on the
   * destination page. Defaults to `"nav-forward"` (deeper navigation);
   * pass `"nav-back"` for links that return the user to a previous page.
   * The type is opt-in metadata only — unsupported browsers ignore it.
   */
  direction?: NavDirection
}

/**
 * `next/link` wrapper that tags the navigation with a view-transition type.
 * Equivalent to `<Link transitionTypes={[direction]}>`; use it (or plain
 * `transitionTypes`) on links that should slide directionally.
 */
export function NavLink({ direction = NAV_FORWARD, ...props }: NavLinkProps) {
  return <Link transitionTypes={[direction]} {...props} />
}
