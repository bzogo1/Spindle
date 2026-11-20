import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  getAvatarInitials,
} from "./avatar"

describe("Avatar", () => {
  it("renders a fallback when no image loads", () => {
    render(
      <Avatar>
        <AvatarFallback>JD</AvatarFallback>
      </Avatar>,
    )

    expect(screen.getByText("JD")).toBeInTheDocument()
    expect(screen.getByText("JD")).toHaveAttribute("data-slot", "avatar-fallback")
  })

  it("renders sizes via data-size", () => {
    const { rerender } = render(
      <Avatar size="sm">
        <AvatarFallback>AB</AvatarFallback>
      </Avatar>,
    )
    expect(screen.getByText("AB").closest("[data-slot=avatar]")).toHaveAttribute("data-size", "sm")

    rerender(
      <Avatar size="lg">
        <AvatarFallback>AB</AvatarFallback>
      </Avatar>,
    )
    expect(screen.getByText("AB").closest("[data-slot=avatar]")).toHaveAttribute("data-size", "lg")
  })

  it("renders a badge inside the root", () => {
    const { container } = render(
      <Avatar>
        <AvatarFallback>AD</AvatarFallback>
        <AvatarBadge />
      </Avatar>,
    )

    expect(container.querySelector('[data-slot="avatar-badge"]')).toBeInTheDocument()
    expect(screen.getByText("AD")).toBeInTheDocument()
  })

  it("AvatarGroup renders children and a count", () => {
    const { container } = render(
      <AvatarGroup>
        <Avatar>
          <AvatarFallback>A</AvatarFallback>
        </Avatar>
        <AvatarGroupCount>+3</AvatarGroupCount>
      </AvatarGroup>,
    )

    expect(container.querySelector('[data-slot="avatar-group"]')).toBeInTheDocument()
    expect(screen.getByText("+3")).toBeInTheDocument()
  })
})

describe("getAvatarInitials", () => {
  it("takes the first letter of the first two words", () => {
    expect(getAvatarInitials("Ada Lovelace")).toBe("AL")
    expect(getAvatarInitials("grace  hopper")).toBe("GH")
  })

  it("strips accents and diacritics", () => {
    expect(getAvatarInitials("Émile Zola")).toBe("EZ")
    expect(getAvatarInitials("Zoë García")).toBe("ZG")
    expect(getAvatarInitials("josé")).toBe("J")
  })

  it("skips emoji and symbol-only words", () => {
    expect(getAvatarInitials("😀 Bob Smith")).toBe("BS")
    expect(getAvatarInitials("Bob 🚀")).toBe("B")
  })

  it("handles single-character and single-word names", () => {
    expect(getAvatarInitials("a")).toBe("A")
    expect(getAvatarInitials("x")).toBe("X")
    expect(getAvatarInitials("Cher")).toBe("C")
  })

  it("returns ? when there are no usable letters or digits", () => {
    expect(getAvatarInitials("")).toBe("?")
    expect(getAvatarInitials("   ")).toBe("?")
    expect(getAvatarInitials("😀🎉")).toBe("?")
  })

  it("respects the max parameter", () => {
    expect(getAvatarInitials("Ada Lovelace King", 3)).toBe("ALK")
  })
})
