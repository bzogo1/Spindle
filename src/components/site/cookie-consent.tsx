"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { usePathname } from "next/navigation"
import { Dialog as DialogPrimitive } from "radix-ui"

import {
  COOKIE_POLICY_PATH,
  acceptAllChoices,
  consentCategories,
  essentialOnlyChoices,
  onOpenCookieSettings,
  readConsent,
  undecidedConsent,
  writeConsent,
  type ConsentChoices,
  type ConsentState,
  type OptionalConsentCategory,
} from "@/lib/consent"

import styles from "./cookie-consent.module.css"

type ConsentContextValue = {
  consent: ConsentState
  saveChoices: (choices: ConsentChoices) => void
  openSettings: () => void
}

const ConsentContext = createContext<ConsentContextValue | null>(null)

/**
 * Reads the current consent state. Analytics and other optional runtime code
 * should prefer `hasConsent()` from `@/lib/consent` so it also works outside
 * React; this hook is for UI that should re-render when the choice changes.
 */
export function useConsent(): ConsentContextValue {
  const context = useContext(ConsentContext)
  if (!context) {
    throw new Error("useConsent must be used inside <CookieConsent>")
  }
  return context
}

function isOptional(category: string): category is OptionalConsentCategory {
  return category === "analytics" || category === "replay"
}

/**
 * Owns the consent choice for the whole shell: a bottom banner on first visit,
 * a settings dialog that can be re-opened from anywhere (footer link, cookie
 * policy page, changelog), and a context so islands can react to changes.
 *
 * Mounted by both root layouts (`(site)` and `(changelog)`) because Sentry
 * Replay loads on both.
 */
export function CookieConsent({
  appearance = "site",
  children,
}: {
  appearance?: "site" | "changelog"
  children?: ReactNode
}) {
  const pathname = usePathname()
  // Null until hydration so the server HTML and the first client render match;
  // the banner then appears based on the stored cookie, not on the server.
  const [consent, setConsent] = useState<ConsentState | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [draft, setDraft] = useState<ConsentChoices>(essentialOnlyChoices)

  useEffect(() => {
    setConsent(readConsent())
  }, [])

  const saveChoices = useCallback((choices: ConsentChoices) => {
    setConsent(writeConsent(choices))
  }, [])

  const openSettings = useCallback(() => {
    const current = consent ?? undecidedConsent()
    setDraft({ analytics: current.analytics, replay: current.replay })
    setSettingsOpen(true)
  }, [consent])

  useEffect(() => onOpenCookieSettings(openSettings), [openSettings])

  const contextValue = useMemo<ConsentContextValue>(
    () => ({ consent: consent ?? undecidedConsent(), saveChoices, openSettings }),
    [consent, saveChoices, openSettings],
  )

  const showBanner = consent !== null && !consent.decided && pathname !== COOKIE_POLICY_PATH

  return (
    <ConsentContext.Provider value={contextValue}>
      {children}

      {showBanner && (
        <section
          className={styles.banner}
          data-appearance={appearance}
          aria-labelledby="cookie-banner-title"
          aria-describedby="cookie-banner-text"
        >
          <div className={styles.bannerInner}>
            <div className={styles.bannerCopy}>
              <h2 id="cookie-banner-title" className={styles.bannerTitle}>
                Cookies on Spindle
              </h2>
              <p id="cookie-banner-text" className={styles.bannerText}>
                Essential cookies keep the site working. Analytics and masked session replay stay
                off unless you allow them. <a href={COOKIE_POLICY_PATH}>Cookie Policy</a>
              </p>
            </div>
            <div className={styles.bannerActions}>
              <button
                type="button"
                className={styles.button}
                onClick={() => saveChoices(essentialOnlyChoices())}
              >
                Reject non-essential
              </button>
              <button
                type="button"
                className={styles.buttonPrimary}
                onClick={() => saveChoices(acceptAllChoices())}
              >
                Accept all
              </button>
              <button type="button" className={styles.linkButton} onClick={openSettings}>
                Cookie settings
              </button>
            </div>
          </div>
          <p className={styles.srOnly} role="status">
            Cookie choices are available in the banner at the bottom of the page.
          </p>
        </section>
      )}

      <DialogPrimitive.Root open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className={styles.overlay} />
          <DialogPrimitive.Content className={styles.dialog} data-appearance={appearance}>
            <DialogPrimitive.Title className={styles.dialogTitle}>
              Cookie settings
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className={styles.dialogText}>
              Essential storage keeps Spindle working and is always on. Everything else is optional
              and only starts after you allow it. You can change your choice at any time — no reload
              needed.
            </DialogPrimitive.Description>

            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault()
                saveChoices(draft)
                setSettingsOpen(false)
              }}
            >
              <ul className={styles.categories}>
                {consentCategories.map((category) => {
                  const optional = isOptional(category.id) ? category.id : null

                  return (
                    <li key={category.id} className={styles.category}>
                      <label className={styles.categoryLabel}>
                        <input
                          type="checkbox"
                          className={styles.checkbox}
                          checked={optional ? draft[optional] : true}
                          disabled={optional === null}
                          onChange={(event) => {
                            if (!optional) return
                            const checked = event.target.checked
                            setDraft((current) => ({ ...current, [optional]: checked }))
                          }}
                        />
                        <span className={styles.categoryBody}>
                          <span className={styles.categoryHeading}>
                            {category.label}
                            <span className={styles.categoryBadge}>
                              {category.required ? "Always on" : "Optional"}
                            </span>
                          </span>
                          <span className={styles.categoryText}>{category.description}</span>
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>

              <div className={styles.dialogActions}>
                <DialogPrimitive.Close asChild>
                  <button type="button" className={styles.button}>
                    Cancel
                  </button>
                </DialogPrimitive.Close>
                <button type="submit" className={styles.buttonPrimary}>
                  Save choices
                </button>
              </div>
            </form>

            <p className={styles.dialogPolicy}>
              <a href={COOKIE_POLICY_PATH}>Read the Cookie Policy</a>
            </p>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </ConsentContext.Provider>
  )
}
