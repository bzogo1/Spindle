import type { SVGProps } from "react"

/**
 * Renders an icon from the shared SVG sprite defined by `IconSprite`
 * (`icon-sprite.tsx`, mounted once in the site/app layouts).
 *
 * `name` is the symbol id without the leading `#`, e.g. `"i-lock"`.
 * Decorative by default: `aria-hidden="true"` is always applied so screen
 * readers ignore the icon; pass `aria-hidden={false}` plus an accessible
 * name via `aria-label`/`title` when the icon carries meaning on its own.
 */
export function Icon({
  name,
  className = "icon icon--xs",
  ...props
}: {
  /** Sprite symbol id without `#` (e.g. `"i-lock"`). */
  name: string
  className?: string
} & Omit<SVGProps<SVGSVGElement>, "name" | "children">) {
  return (
    <svg className={className} aria-hidden="true" {...props}>
      <use href={`#${name}`} />
    </svg>
  )
}
