"use client"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

const socials = [
  { label: "GitHub", icon: "i-github", href: "#github" },
  { label: "X", icon: "i-x-social", href: "#x" },
  { label: "Discord", icon: "i-discord", href: "#discord" },
]

/** Footer social links with the hover tooltips from the original island. */
export function SocialLinks() {
  return (
    <>
      {socials.map((social) => (
        <Tooltip key={social.label}>
          <TooltipTrigger asChild>
            <a href={social.href} aria-label={social.label}>
              <svg className="icon icon--sm" aria-hidden="true">
                <use href={`#${social.icon}`} />
              </svg>
            </a>
          </TooltipTrigger>
          <TooltipContent className="ui-tooltip">{social.label}</TooltipContent>
        </Tooltip>
      ))}
    </>
  )
}
