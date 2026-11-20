import { render } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"

import { ReferralTracker } from "./referral-tracker"
import { REFERRAL_STORAGE_KEY } from "@/lib/referral"

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState(null, "", "/")
})

describe("ReferralTracker", () => {
  it("stores a valid ?ref= code", () => {
    window.history.replaceState(null, "", "/referral?ref=SPN-ABCD-EFGH")
    render(<ReferralTracker />)
    expect(localStorage.getItem(REFERRAL_STORAGE_KEY)).toBe("SPN-ABCD-EFGH")
  })

  it("ignores missing or invalid codes", () => {
    window.history.replaceState(null, "", "/referral?ref=bogus")
    render(<ReferralTracker />)
    expect(localStorage.getItem(REFERRAL_STORAGE_KEY)).toBeNull()

    window.history.replaceState(null, "", "/referral")
    render(<ReferralTracker />)
    expect(localStorage.getItem(REFERRAL_STORAGE_KEY)).toBeNull()
  })

  it("does not store a self-referral", () => {
    localStorage.setItem("spindle.referral-code", "SPN-ABCD-EFGH")
    window.history.replaceState(null, "", "/referral?ref=SPN-ABCD-EFGH")
    render(<ReferralTracker />)
    expect(localStorage.getItem(REFERRAL_STORAGE_KEY)).toBeNull()
  })
})
