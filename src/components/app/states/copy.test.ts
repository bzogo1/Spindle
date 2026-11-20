import { describe, expect, it } from "vitest"

import { appScreenCopy, appStateCopy, type AppScreenKey } from "./copy"

const screens = Object.keys(appScreenCopy) as AppScreenKey[]
const copyFields = [
  "loadingLabel",
  "emptyTitle",
  "emptyBody",
  "errorTitle",
  "errorMessage",
] as const

describe("appScreenCopy", () => {
  it("provides non-empty copy for every app screen", () => {
    for (const screen of screens) {
      const copy = appScreenCopy[screen]
      for (const field of copyFields) {
        expect(copy[field], `${screen}.${field}`).toBeTruthy()
      }
    }
  })

  it("uses a unique loading label and a valid skeleton variant per screen", () => {
    const loadingLabels = screens.map((screen) => appScreenCopy[screen].loadingLabel)
    expect(new Set(loadingLabels).size).toBe(screens.length)

    for (const screen of screens) {
      expect(appScreenCopy[screen].skeleton).toBe(screen)
    }
  })
})

describe("appStateCopy", () => {
  it("keeps the shared loading, empty, error, and inline-error defaults", () => {
    expect(appStateCopy.loading.default).toBe("Loading")
    expect(appStateCopy.error.retry).toBe("Try again")
    expect(appStateCopy.error.retrying).toBe("Trying again…")
    expect(appStateCopy.error.supportHref).toBe("/about#contact")
    expect(appStateCopy.empty.defaultTitle).toBe("Nothing here yet")
    expect(appStateCopy.inlineError.defaultTitle).toBe("Could not save")
  })
})
