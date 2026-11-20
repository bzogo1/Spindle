import { cn } from "@/lib/utils"

/**
 * Displays a user's avatar: the uploaded image when `src` is set, otherwise
 * the codebase-standard initials fallback.
 *
 * Follows the `app-avatar` CSS convention used across the app shell
 * (`user-menu.tsx`, `profile-screen.tsx`): the fallback letter is rendered
 * via `data-initial` + CSS `content` so it stays out of the DOM text and
 * cannot trip axe's label-content-name-mismatch rule.
 */

export type UserAvatarSize = "sm" | "md" | "lg"

const SIZE_CLASSES: Record<UserAvatarSize, string | null> = {
  sm: "app-avatar--sm",
  md: null,
  lg: "app-avatar--lg",
}

function initialFor(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?"
}

export function UserAvatar({
  src,
  name,
  size = "md",
  className,
  alt,
}: {
  /** Image URL (e.g. the avatar `data:` URL). `null`/`undefined` shows initials. */
  src?: string | null
  /** Display name used for the initials fallback and default image alt text. */
  name: string
  size?: UserAvatarSize
  className?: string
  /**
   * Accessible name for the image. Defaults to "<name>'s avatar"; pass `""`
   * when the avatar is purely decorative next to a visible name.
   */
  alt?: string
}) {
  const sizeClass = SIZE_CLASSES[size]
  const classes = cn("app-avatar", sizeClass, className)

  if (src) {
    return (
      <span className={classes}>
        <img src={src} alt={alt ?? `${name} avatar`} />
      </span>
    )
  }

  return <span className={classes} aria-hidden="true" data-initial={initialFor(name)} />
}
