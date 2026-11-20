import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { AsyncSelect, type AsyncSelectOption, type SearchOptionsFn } from "./async-select"

const apple: AsyncSelectOption = { value: "apple", label: "Apple" }
const banana: AsyncSelectOption = { value: "banana", label: "Banana" }
const cherry: AsyncSelectOption = { value: "cherry", label: "Cherry" }

function ControlledSelect({
  onChange: userOnChange,
  searchOptions = vi.fn(async () => [apple, banana, cherry]),
  ...props
}: Partial<React.ComponentProps<typeof AsyncSelect>>) {
  const [value, setValue] = useState<string | string[] | null>(props.multiple ? [] : null)
  return (
    <AsyncSelect
      searchOptions={searchOptions}
      debounceMs={10}
      aria-label="Fruit"
      {...props}
      value={value}
      onChange={(v) => {
        setValue(v)
        userOnChange?.(v)
      }}
    />
  )
}

async function openSelect(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("combobox", { name: "Fruit" }))
  return screen.findByRole("combobox", { name: "Fruit search" })
}

function setQuery(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } })
}

describe("AsyncSelect", () => {
  it("debounces the query before calling searchOptions", async () => {
    const user = userEvent.setup()
    const searchOptions = vi.fn(async () => [apple])
    render(<ControlledSelect searchOptions={searchOptions} debounceMs={80} minQueryLength={1} />)

    const searchbox = await openSelect(user)
    setQuery(searchbox, "ap")

    // Still inside the debounce window.
    expect(searchOptions).not.toHaveBeenCalled()

    await waitFor(() => expect(searchOptions).toHaveBeenCalledTimes(1), { timeout: 1000 })
    expect(searchOptions).toHaveBeenCalledWith("ap", expect.any(AbortSignal))
  })

  it("does not search below minQueryLength and shows the hint", async () => {
    const user = userEvent.setup()
    const searchOptions = vi.fn(async () => [apple])
    render(<ControlledSelect searchOptions={searchOptions} minQueryLength={3} />)

    const searchbox = await openSelect(user)

    expect(await screen.findByText(/Type at least 3 characters/)).toBeInTheDocument()
    expect(searchOptions).not.toHaveBeenCalled()

    setQuery(searchbox, "ap")
    await waitFor(() => expect(screen.getByText(/Type at least 3 characters/)).toBeInTheDocument())
    expect(searchOptions).not.toHaveBeenCalled()
  })

  it("caches results per query and does not refetch within the TTL", async () => {
    const user = userEvent.setup()
    const searchOptions = vi.fn(async (q: string) =>
      q === "ap" ? [apple] : q === "ba" ? [banana] : [apple, banana],
    )
    render(<ControlledSelect searchOptions={searchOptions} minQueryLength={1} />)

    const searchbox = await openSelect(user)

    setQuery(searchbox, "ap")
    await screen.findByRole("option", { name: "Apple" })
    expect(searchOptions.mock.calls.filter((c) => c[0] === "ap")).toHaveLength(1)

    setQuery(searchbox, "ba")
    await screen.findByRole("option", { name: "Banana" })
    expect(searchOptions.mock.calls.filter((c) => c[0] === "ba")).toHaveLength(1)

    // Back to "ap" — served from cache, no additional fetch.
    setQuery(searchbox, "ap")
    await screen.findByRole("option", { name: "Apple" })
    await new Promise((r) => setTimeout(r, 30))
    expect(searchOptions.mock.calls.filter((c) => c[0] === "ap")).toHaveLength(1)
  })

  it("shows stale cached results while revalidating after the TTL", async () => {
    const user = userEvent.setup()
    let now = 1_000
    vi.spyOn(Date, "now").mockImplementation(() => now)
    const searchOptions = vi.fn(async (q: string) => (q === "ap" ? [apple] : [banana]))
    render(<ControlledSelect searchOptions={searchOptions} minQueryLength={1} cacheTtlMs={100} />)

    const searchbox = await openSelect(user)

    setQuery(searchbox, "ap")
    await screen.findByRole("option", { name: "Apple" })
    expect(searchOptions.mock.calls.filter((c) => c[0] === "ap")).toHaveLength(1)

    // Move past the TTL, query something else, then come back.
    now += 500
    setQuery(searchbox, "zz")
    await waitFor(() =>
      expect(searchOptions.mock.calls.filter((c) => c[0] === "zz")).toHaveLength(1),
    )

    setQuery(searchbox, "ap")
    // Cached "Apple" shows immediately while a background refetch happens.
    await screen.findByRole("option", { name: "Apple" })
    await waitFor(() =>
      expect(searchOptions.mock.calls.filter((c) => c[0] === "ap")).toHaveLength(2),
    )
  })

  it("aborts the previous request when the query changes", async () => {
    const user = userEvent.setup()
    const signals: AbortSignal[] = []
    const searchOptions = vi.fn(
      (_q: string, signal: AbortSignal) =>
        new Promise<AsyncSelectOption[]>((resolve) => {
          signals.push(signal)
          signal.addEventListener("abort", () => resolve([]))
          setTimeout(() => resolve([apple]), 500)
        }),
    )
    render(<ControlledSelect searchOptions={searchOptions} debounceMs={5} minQueryLength={1} />)

    const searchbox = await openSelect(user)

    setQuery(searchbox, "a")
    await waitFor(() => expect(signals.length).toBe(1))
    setQuery(searchbox, "ap")
    await waitFor(() => expect(signals.length).toBe(2))
    await waitFor(() => expect(signals[0].aborted).toBe(true))
  })

  it("selects an option and renders the label without refetching", async () => {
    const user = userEvent.setup()
    const searchOptions = vi.fn(async () => [apple, banana])
    const onChange = vi.fn()
    render(<ControlledSelect searchOptions={searchOptions} onChange={onChange} />)

    await openSelect(user)
    await user.click(await screen.findByRole("option", { name: "Apple" }))

    expect(onChange).toHaveBeenCalledWith("apple")
    expect(screen.getByRole("combobox", { name: "Fruit" })).toHaveTextContent("Apple")
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument())
  })

  it("renders chips for multi-select and removes them", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <ControlledSelect
        multiple
        searchOptions={vi.fn(async () => [apple, banana])}
        onChange={onChange}
      />,
    )

    await openSelect(user)
    await user.click(await screen.findByRole("option", { name: "Apple" }))
    await user.click(screen.getByRole("option", { name: "Banana" }))

    expect(onChange).toHaveBeenLastCalledWith(["apple", "banana"])

    const trigger = screen.getByRole("combobox", { name: "Fruit" })
    expect(within(trigger).getByText("Apple")).toBeInTheDocument()
    expect(within(trigger).getByText("Banana")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Remove Apple" }))
    expect(onChange).toHaveBeenLastCalledWith(["banana"])
    // Removing a chip must not toggle the dropdown.
    expect(screen.getByRole("listbox")).toBeInTheDocument()
  })

  it("renders selected labels from selectedOptions without a matching fetch", async () => {
    const user = userEvent.setup()
    render(
      <AsyncSelect
        searchOptions={vi.fn(async () => [])}
        value={["x1"]}
        onChange={() => {}}
        multiple
        selectedOptions={[{ value: "x1", label: "External One" }]}
        debounceMs={10}
        aria-label="Fruit"
      />,
    )

    const trigger = screen.getByRole("combobox", { name: "Fruit" })
    expect(within(trigger).getByText("External One")).toBeInTheDocument()
    await user.click(trigger)
    expect(await screen.findByText("No options.")).toBeInTheDocument()
  })

  it("navigates options with arrow keys and selects with Enter", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ControlledSelect onChange={onChange} />)

    const trigger = screen.getByRole("combobox", { name: "Fruit" })
    await user.click(trigger)
    await screen.findByRole("option", { name: "Apple" })

    // First option is active by default; ArrowDown moves to Banana.
    await user.keyboard("{ArrowDown}{Enter}")
    expect(onChange).toHaveBeenCalledWith("banana")
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it("supports Backspace to remove the last chip from the search input", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <AsyncSelect
        searchOptions={vi.fn(async () => [apple, banana])}
        value={["apple", "banana"]}
        onChange={onChange}
        multiple
        debounceMs={10}
        aria-label="Fruit"
      />,
    )

    const searchbox = await openSelect(user)
    await user.click(searchbox)
    await user.keyboard("{Backspace}")
    expect(onChange).toHaveBeenCalledWith(["apple"])
  })

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup()
    render(<ControlledSelect />)

    const trigger = screen.getByRole("combobox", { name: "Fruit" })
    await user.click(trigger)
    await screen.findByRole("listbox")

    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it("shows an error state with a working retry", async () => {
    const user = userEvent.setup()
    const searchOptions = vi
      .fn<SearchOptionsFn>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue([apple])
    render(<ControlledSelect searchOptions={searchOptions} minQueryLength={1} />)

    const searchbox = await openSelect(user)
    setQuery(searchbox, "ap")

    expect(await screen.findByText("Failed to load options.")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByRole("option", { name: "Apple" })).toBeInTheDocument()
    expect(searchOptions).toHaveBeenCalledTimes(2)
  })

  it("shows the empty state when the search resolves to no options", async () => {
    const user = userEvent.setup()
    render(<ControlledSelect searchOptions={vi.fn(async () => [])} minQueryLength={1} />)

    const searchbox = await openSelect(user)
    setQuery(searchbox, "zzz")

    expect(await screen.findByText("No results found.")).toBeInTheDocument()
    expect(screen.queryByRole("option")).not.toBeInTheDocument()
  })

  it("renders grouped results with non-selectable group headers", async () => {
    const user = userEvent.setup()
    const searchOptions = vi.fn(async () => [
      { label: "Fruits", options: [apple, banana] },
      { label: "Tropical", options: [{ value: "mango", label: "Mango" }] },
    ])
    const onChange = vi.fn()
    render(<ControlledSelect searchOptions={searchOptions} onChange={onChange} />)

    await openSelect(user)
    await screen.findByRole("option", { name: "Apple" })

    expect(screen.getByText("Fruits")).toBeInTheDocument()
    expect(screen.getByText("Tropical")).toBeInTheDocument()
    expect(screen.getAllByRole("option")).toHaveLength(3)

    await user.click(screen.getByRole("option", { name: "Mango" }))
    expect(onChange).toHaveBeenCalledWith("mango")
  })

  it("supports options carrying an inline group field", async () => {
    const user = userEvent.setup()
    const searchOptions = vi.fn(async () => [
      { ...apple, group: "Favorites" },
      { ...banana, group: "Other" },
    ])
    render(<ControlledSelect searchOptions={searchOptions} />)

    await openSelect(user)
    await screen.findByRole("option", { name: "Apple" })

    expect(screen.getByText("Favorites")).toBeInTheDocument()
    expect(screen.getByText("Other")).toBeInTheDocument()
  })

  it("marks the listbox as multiselectable in multiple mode", async () => {
    const user = userEvent.setup()
    render(<ControlledSelect multiple />)

    await user.click(screen.getByRole("combobox", { name: "Fruit" }))
    expect(await screen.findByRole("listbox")).toHaveAttribute("aria-multiselectable", "true")
  })
})
