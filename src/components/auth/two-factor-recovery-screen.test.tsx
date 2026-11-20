import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { TwoFactorRecoveryScreen } from "./two-factor-recovery-screen"

const searchParamsGet = vi.fn()

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: searchParamsGet }),
}))

vi.mock("@/lib/api/client", () => ({
  request: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(init: { message: string }) {
      super(init.message)
    }
  },
}))

beforeEach(() => {
  searchParamsGet.mockReset()
})

describe("TwoFactorRecoveryScreen", () => {
  it("shows a missing-token error when the link has no token param", () => {
    searchParamsGet.mockReturnValue(null)
    render(<TwoFactorRecoveryScreen />)
    expect(screen.getByRole("alert")).toHaveTextContent(/missing its token/)
  })

  it("renders the confirm step with the token from the URL", () => {
    searchParamsGet.mockImplementation((key: string) => (key === "token" ? "tok-abc" : null))
    render(<TwoFactorRecoveryScreen />)
    expect(screen.getByText("Two-factor recovery")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Confirm recovery" })).toBeInTheDocument()
  })
})
