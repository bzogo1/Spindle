import { socials } from "@/lib/socials"

export function SocialLinks() {
  return (
    <>
      {socials.map((social) => (
        <a
          key={social.label}
          href={social.href}
          aria-label={social.label}
          target={social.external ? "_blank" : undefined}
          rel={social.external ? "noopener noreferrer" : undefined}
        >
          <svg className="icon icon--sm" aria-hidden="true">
            <use href={`#${social.icon}`} />
          </svg>
        </a>
      ))}
    </>
  )
}
