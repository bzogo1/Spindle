"use client"

import type { CSSProperties, ReactNode } from "react"

import { useLanguage } from "@/components/i18n/language-provider"
import type { PublicWorkspaceBranding } from "@/lib/workspace-branding"

import { AuthBrand } from "./auth-brand"

type AuthPageCopy = {
  eyebrowKey: string
  titleKey: string
  descriptionKey: string
  switchPromptKey: string
  switchHref: string
  switchLabelKey: string
}

const PAGE_COPY: Record<"sign-in" | "sign-up", AuthPageCopy> = {
  "sign-in": {
    eyebrowKey: "auth.shell.signIn.eyebrow",
    titleKey: "auth.shell.signIn.title",
    descriptionKey: "auth.shell.signIn.description",
    switchPromptKey: "auth.shell.signIn.switchPrompt",
    switchHref: "/sign-up",
    switchLabelKey: "auth.shell.signIn.switchLabel",
  },
  "sign-up": {
    eyebrowKey: "auth.shell.signUp.eyebrow",
    titleKey: "auth.shell.signUp.title",
    descriptionKey: "auth.shell.signUp.description",
    switchPromptKey: "auth.shell.signUp.switchPrompt",
    switchHref: "/sign-in",
    switchLabelKey: "auth.shell.signUp.switchLabel",
  },
}

type AuthSplitShellProps = {
  mode: "sign-in" | "sign-up"
  children: ReactNode
  /**
   * Optional per-workspace branding (public safe subset). When present the
   * wordmark shows the workspace logo/name and `accentColor`/`backgroundColor`
   * are applied as CSS custom properties scoped to this shell only.
   */
  branding?: PublicWorkspaceBranding | null
}

/**
 * Split-screen shell for the standalone sign-in / sign-up pages.
 *
 * Layout:
 *   - Left column: the sign-in / sign-up form (email, plus Google and GitHub).
 *   - Right column: a sleek, intentionally blank panel reserved for a future
 *     element (illustration, announcement, feature callout). Kept empty by
 *     design so it stays a clean placeholder.
 */
export function AuthSplitShell({ mode, children, branding }: AuthSplitShellProps) {
  const { t } = useLanguage()
  const copy = PAGE_COPY[mode]

  // Workspace colors: both token systems used by the auth surfaces
  // (`--accent*` for the classic auth CSS, `--ui-primary`/`--color-primary`
  // for the Tailwind theme, `--ui-background` for `bg-background`) are
  // overridden via inline custom properties so the branding never leaks
  // into the rest of the app.
  const accent = branding?.accentColor?.trim() ?? ""
  const background = branding?.backgroundColor?.trim() ?? ""
  const shellStyle: CSSProperties | undefined =
    accent || background
      ? ({
          ...(accent ? { "--accent": accent, "--ui-primary": accent } : {}),
          ...(background ? { "--ui-background": background } : {}),
        } as CSSProperties)
      : undefined
  const brandName = branding?.logoText.trim() || branding?.displayName.trim() || undefined
  const brandLogo = branding?.logoUrl.trim() || undefined

  return (
    <main
      id="main-content"
      tabIndex={-1}
      style={shellStyle}
      className="bg-background text-foreground relative z-10 min-h-svh overflow-hidden lg:grid-cols-[minmax(0,0.47fr)_minmax(360px,0.72fr)]"
    >
      {/* Right side — sleek reserved space for a future element (kept blank). */}
      <section
        aria-hidden="true"
        className="hidden w-full flex-col items-center justify-center lg:flex"
      >
        <div className="h-full w-full">
          <div className="relative h-full w-full px-14">
            <div className="from-primary/10 via-background to-secondary/10 absolute inset-0 bg-gradient-to-br" />
            <div
              className="bg-primary/25 absolute inset-0 [mask-image:radial-gradient(800px_800px_at_50%_-20%,white,transparent)] opacity-[0.35]"
              aria-hidden="true"
            />
            <div className="relative z-10 flex h-full items-center justify-center">
              <div
                className="border-border/60 bg-background/40 flex aspect-[4/5] w-full max-w-[380px] items-center justify-center rounded-[44px] border backdrop-blur-lg"
                aria-hidden="true"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Left side — the form panel (email + Google / GitHub). */}
      <section className="flex min-h-svh items-center justify-center px-5 py-10 sm:px-8 lg:px-16">
        <div className="w-full max-w-[430px]">
          <div className="mb-9 flex justify-center">
            <AuthBrand name={brandName} logoUrl={brandLogo} />
          </div>

          <div className="border-border/80 bg-card/90 grid gap-7 rounded-[36px] border p-8 shadow-[0_40px_120px_-42px_rgba(0,0,0,0.9)] backdrop-blur sm:p-10">
            <header className="grid gap-3 text-center sm:text-left">
              <span className="text-primary font-mono text-[10px] tracking-[0.14em] uppercase">
                {t(copy.eyebrowKey)}
              </span>
              <h1 className="text-foreground text-[clamp(1.85rem,4.2vw,2.5rem)] leading-[1.04] font-semibold tracking-[-0.03em]">
                {t(copy.titleKey)}
              </h1>
              <p className="text-muted-foreground text-sm leading-7">{t(copy.descriptionKey)}</p>
            </header>

            {children}
          </div>

          <footer className="mt-9 grid gap-4 text-center">
            <p className="text-muted-foreground text-[13px]">
              {t(copy.switchPromptKey)}{" "}
              <a
                href={copy.switchHref}
                className="text-foreground hover:text-primary font-medium underline-offset-4 hover:underline"
              >
                {t(copy.switchLabelKey)}
              </a>
            </p>
            <p className="text-muted-foreground/80 flex flex-wrap items-center justify-center gap-2 font-mono text-[10px] tracking-[0.08em] uppercase">
              <a href="/privacy" className="hover:text-foreground">
                {t("footer.privacy")}
              </a>
              <span aria-hidden="true">·</span>
              <a href="/terms" className="hover:text-foreground">
                {t("auth.shell.terms")}
              </a>
              <span aria-hidden="true">·</span>
              <a href="/about#contact" className="hover:text-foreground">
                {t("auth.contactSupport")}
              </a>
            </p>
          </footer>
        </div>
      </section>
    </main>
  )
}
