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
import { Dialog as DialogPrimitive, Switch as SwitchPrimitive } from "radix-ui"

import {
  COOKIE_POLICY_PATH,
  acceptAllChoices,
  consentCategories,
  consentCategoryLabel,
  cookieRegistry,
  essentialOnlyChoices,
  hasPrivacySignal,
  onConsentChange,
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
    const current = readConsent()
    // A Global Privacy Control / Do Not Track signal is an opt-out of every
    // optional category: record essential-only consent so the banner stays
    // away instead of asking again on every page.
    setConsent(
      !current.decided && hasPrivacySignal() ? writeConsent(essentialOnlyChoices()) : current,
    )
  }, [])

  // Keep the banner and dialog in sync with choices written elsewhere in this
  // tab (settings dialog, tests, future consent-aware code calling writeConsent).
  useEffect(() => onConsentChange(setConsent), [])

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
                className={styles.buttonPrimary}
                onClick={() => saveChoices(acceptAllChoices())}
              >
                Accept all
              </button>
              <button
                type="button"
                className={styles.button}
                onClick={() => saveChoices(essentialOnlyChoices())}
              >
                Reject non-essential
              </button>
              <button type="button" className={styles.linkButton} onClick={openSettings}>
                Customize
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
          <DialogPrimitive.Content
            className={styles.dialog}
            data-appearance={appearance}
            aria-modal="true"
          >
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
                  const checked = optional ? draft[optional] : true
                  const toggle = () => {
                    if (!optional) return
                    setDraft((current) => ({ ...current, [optional]: !current[optional] }))
                  }

                  return (
                    <li
                      key={category.id}
                      className={styles.category}
                      // The whole row toggles the switch; the switch itself
                      // stops propagation so one click never flips it twice.
                      onClick={optional ? toggle : undefined}
                    >
                      <SwitchPrimitive.Root
                        className={styles.switch}
                        checked={checked}
                        disabled={optional === null}
                        onCheckedChange={toggle}
                        onClick={(event) => event.stopPropagation()}
                        aria-label={category.label}
                      >
                        <SwitchPrimitive.Thumb className={styles.switchThumb} />
                      </SwitchPrimitive.Root>
                      <span className={styles.categoryBody}>
                        <span className={styles.categoryHeading}>
                          {category.label}
                          <span className={styles.categoryBadge}>
                            {category.required ? "Always on" : "Optional"}
                          </span>
                        </span>
                        <span className={styles.categoryText}>{category.description}</span>
                      </span>
                    </li>
                  )
                })}
              </ul>

              <div className={styles.policy}>
                <h3 className={styles.policyTitle}>Cookies and storage we use</h3>
                <div className={styles.policyScroll}>
                  <table className={styles.policyTable}>
                    <thead>
                      <tr>
                        <th scope="col">Name</th>
                        <th scope="col">Purpose</th>
                        <th scope="col">Category</th>
                        <th scope="col">Lifetime</th>
                        <th scope="col">Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {consentCategories.flatMap((category) =>
                        cookieRegistry
                          .filter((record) => record.category === category.id)
                          .map((record) => (
                            <tr key={record.key}>
                              <td className={styles.policyKey}>
                                <code>{record.key}</code>
                              </td>
                              <td>{record.purpose}</td>
                              <td>{consentCategoryLabel(record.category)}</td>
                              <td>{record.lifetime}</td>
                              <td>{record.storage}</td>
                            </tr>
                          )),
                      )}
                    </tbody>
                  </table>
                </div>
                <p className={styles.policyNote}>
                  Generated from the same registry the banner uses — a key is listed here before it
                  can be written.
                </p>
              </div>

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
