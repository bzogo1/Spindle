import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./card"

describe("Card", () => {
  it("renders all sections with data-slots", () => {
    const { container } = render(
      <Card>
        <CardHeader>
          <CardTitle>Title</CardTitle>
          <CardDescription>Subtitle</CardDescription>
          <CardAction>Action</CardAction>
        </CardHeader>
        <CardContent>Body</CardContent>
        <CardFooter>Footer</CardFooter>
      </Card>,
    )

    expect(screen.getByText("Title")).toHaveAttribute("data-slot", "card-title")
    expect(screen.getByText("Subtitle")).toHaveAttribute("data-slot", "card-description")
    expect(screen.getByText("Action")).toHaveAttribute("data-slot", "card-action")
    expect(screen.getByText("Body")).toHaveAttribute("data-slot", "card-content")
    expect(screen.getByText("Footer")).toHaveAttribute("data-slot", "card-footer")
    expect(container.querySelector('[data-slot="card"]')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="card-header"]')).toBeInTheDocument()
  })

  it("accepts className on the root", () => {
    render(<Card className="max-w-md" data-testid="card" />)
    expect(screen.getByTestId("card")).toHaveClass("max-w-md")
  })
})
