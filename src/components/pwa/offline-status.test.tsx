import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { OfflineIndicator } from "./offline-status"

describe("OfflineIndicator", () => {
  it("renders nothing while online", () => {
    render(<OfflineIndicator />)
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("shows the offline banner when the browser goes offline", () => {
    render(<OfflineIndicator />)

    fireEvent(window, new Event("offline"))

    const banner = screen.getByRole("status")
    expect(banner).toHaveTextContent(/offline/i)
    expect(banner).toHaveTextContent(/sync/i)
  })

  it("hides again when connectivity returns", () => {
    render(<OfflineIndicator />)

    fireEvent(window, new Event("offline"))
    expect(screen.getByRole("status")).toBeInTheDocument()

    fireEvent(window, new Event("online"))
    expect(screen.queryByRole("status")).toBeNull()
  })
})
