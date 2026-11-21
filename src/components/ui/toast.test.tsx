import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { Toaster, toast, useToast } from "@/components/ui/toast"

function ToastTriggers() {
  const { toast, dismiss } = useToast()
  return (
    <>
      <button onClick={() => toast("Saved successfully")}>show-default</button>
      <button
        onClick={() =>
          toast({
            title: "Upload failed",
            description: "The file is too large.",
            variant: "error",
          })
        }
      >
        show-error
      </button>
      <button onClick={() => toast({ title: "Brief notice", duration: 100 })}>show-short</button>
      <button onClick={() => dismiss()}>clear-all</button>
    </>
  )
}

function renderToaster() {
  return render(
    <>
      <ToastTriggers />
      <Toaster />
    </>,
  )
}

function renderedToasts() {
  return Array.from(document.body.querySelectorAll<HTMLElement>('[data-slot="toast"]'))
}

beforeEach(() => {
  const { result } = renderHook(() => useToast())
  act(() => result.current.dismiss())
})

afterEach(() => {
  vi.useRealTimers()
})

describe("Toaster", () => {
  it("renders a toast into a portal on document.body", async () => {
    renderToaster()

    fireEvent.click(screen.getByText("show-default"))

    await waitFor(() => {
      expect(renderedToasts()).toHaveLength(1)
    })
    expect(screen.getByText("Saved successfully")).toBeInTheDocument()
    // Portaled: the toast is not inside the render container.
    expect(renderedToasts()[0].closest("[data-testid]")).toBeNull()
  })

  it("supports the error variant with role=alert", async () => {
    renderToaster()

    fireEvent.click(screen.getByText("show-error"))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Upload failed")
    expect(alert).toHaveTextContent("The file is too large.")
    expect(alert).toHaveAttribute("data-slot", "toast")
  })

  it("uses role=status for non-error variants", async () => {
    renderToaster()

    fireEvent.click(screen.getByText("show-default"))

    await waitFor(() => {
      const statusToast = renderedToasts().find((el) => el.getAttribute("role") === "status")
      expect(statusToast).toBeDefined()
    })
  })

  it("dismisses a toast via the close button", async () => {
    renderToaster()

    fireEvent.click(screen.getByText("show-default"))
    await screen.findByText("Saved successfully")

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }))

    await waitFor(() => {
      expect(renderedToasts()).toHaveLength(0)
    })
    expect(screen.queryByText("Saved successfully")).not.toBeInTheDocument()
  })

  it("clears all toasts with dismiss()", async () => {
    renderToaster()

    fireEvent.click(screen.getByText("show-default"))
    fireEvent.click(screen.getByText("show-error"))
    await waitFor(() => {
      expect(renderedToasts()).toHaveLength(2)
    })

    fireEvent.click(screen.getByText("clear-all"))

    await waitFor(() => {
      expect(renderedToasts()).toHaveLength(0)
    })
  })

  it("auto-dismisses after the configured duration", async () => {
    vi.useFakeTimers()
    renderToaster()

    fireEvent.click(screen.getByText("show-short"))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(renderedToasts()).toHaveLength(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })

    expect(renderedToasts()).toHaveLength(0)
    expect(screen.queryByText("Brief notice")).not.toBeInTheDocument()
  })

  it("keeps toasts with duration=Infinity until dismissed", async () => {
    vi.useFakeTimers()

    function InfiniteToast() {
      const { toast } = useToast()
      return (
        <button onClick={() => toast({ title: "Sticky", duration: Infinity })}>show-sticky</button>
      )
    }

    render(
      <>
        <InfiniteToast />
        <Toaster duration={100} />
      </>,
    )

    fireEvent.click(screen.getByText("show-sticky"))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(renderedToasts()).toHaveLength(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(renderedToasts()).toHaveLength(1)
    expect(screen.getByText("Sticky")).toBeInTheDocument()
  })
})

describe("toast API", () => {
  it("exposes variant helpers that set the matching variant", async () => {
    render(
      <>
        <button onClick={() => toast.success("All good")}>success</button>
        <button onClick={() => toast.error("Broken")}>error</button>
        <button onClick={() => toast.info("FYI")}>info</button>
        <button onClick={() => toast.warning("Careful")}>warning</button>
        <Toaster />
      </>,
    )

    fireEvent.click(screen.getByText("success"))
    fireEvent.click(screen.getByText("error"))
    fireEvent.click(screen.getByText("info"))
    fireEvent.click(screen.getByText("warning"))

    await waitFor(() => {
      expect(renderedToasts()).toHaveLength(4)
    })
    // Errors announce assertively; everything else politely.
    expect(screen.getByRole("alert")).toHaveTextContent("Broken")
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive")
    for (const el of renderedToasts()) {
      if (el.getAttribute("role") === "status") {
        expect(el).toHaveAttribute("aria-live", "polite")
      }
    }
  })

  it("dismisses a single toast by id", async () => {
    render(<Toaster />)

    let id = -1
    act(() => {
      id = toast("temporary")
    })
    expect(await screen.findByText("temporary")).toBeInTheDocument()

    act(() => {
      toast.dismiss(id)
    })

    await waitFor(() => {
      expect(renderedToasts()).toHaveLength(0)
    })
  })

  it("limits visible toasts with maxToasts and queues the rest", async () => {
    render(
      <>
        <button
          onClick={() => {
            toast("first")
            toast("second")
            toast("third")
          }}
        >
          spawn
        </button>
        <Toaster maxToasts={2} />
      </>,
    )

    fireEvent.click(screen.getByText("spawn"))

    await waitFor(() => {
      expect(renderedToasts()).toHaveLength(2)
    })
    expect(screen.getByText("first")).toBeInTheDocument()
    expect(screen.getByText("second")).toBeInTheDocument()
    expect(screen.queryByText("third")).not.toBeInTheDocument()

    // Freeing a slot surfaces the queued toast once the exit purge runs.
    fireEvent.click(screen.getAllByRole("button", { name: "Dismiss" })[0])
    expect(await screen.findByText("third")).toBeInTheDocument()
  })

  it("hides the close button for non-dismissible toasts", async () => {
    render(
      <>
        <button
          onClick={() => toast({ title: "Locked notice", duration: Infinity, dismissible: false })}
        >
          lock
        </button>
        <Toaster />
      </>,
    )

    fireEvent.click(screen.getByText("lock"))

    expect(await screen.findByText("Locked notice")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument()
  })

  it("renders an action node inside the toast", async () => {
    render(
      <>
        <button onClick={() => toast({ title: "File deleted", action: <button>Undo</button> })}>
          delete
        </button>
        <Toaster />
      </>,
    )

    fireEvent.click(screen.getByText("delete"))

    expect(await screen.findByText("File deleted")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument()
  })

  it("renders a declarative action as a button that runs onClick and dismisses", async () => {
    const onUndo = vi.fn()
    render(
      <>
        <button
          onClick={() =>
            toast({
              title: "File deleted",
              action: { label: "Undo", onClick: onUndo },
            })
          }
        >
          delete
        </button>
        <Toaster />
      </>,
    )

    fireEvent.click(screen.getByText("delete"))

    const undo = await screen.findByRole("button", { name: "Undo" })
    expect(undo).toHaveAttribute("data-slot", "toast-action")

    fireEvent.click(undo)

    expect(onUndo).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(renderedToasts()).toHaveLength(0)
    })
    expect(screen.queryByText("File deleted")).not.toBeInTheDocument()
  })

  it("keeps the toast open when the action sets dismissOnAction=false", async () => {
    render(
      <>
        <button
          onClick={() =>
            toast({
              title: "Changes saved",
              action: { label: "View", onClick: () => {}, dismissOnAction: false },
            })
          }
        >
          save
        </button>
        <Toaster />
      </>,
    )

    fireEvent.click(screen.getByText("save"))

    fireEvent.click(await screen.findByRole("button", { name: "View" }))

    // The toast stays visible until dismissed another way.
    await waitFor(() => {
      expect(renderedToasts()).toHaveLength(1)
    })
    expect(screen.getByText("Changes saved")).toBeInTheDocument()
  })

  it("anchors the viewport to the top when position=top", async () => {
    render(
      <>
        <button onClick={() => toast("top note")}>top</button>
        <Toaster position="top" />
      </>,
    )

    fireEvent.click(screen.getByText("top"))

    const el = await screen.findByText("top note")
    expect(el.closest("ol")?.className).toContain("top-4")
  })
})

describe("toast.promise", () => {
  it("swaps the loading toast for a success toast in place and returns the promise", async () => {
    let resolvePromise!: (value: string) => void
    const promise = new Promise<string>((resolve) => {
      resolvePromise = resolve
    })
    let returned: Promise<string> | undefined

    render(
      <>
        <button
          onClick={() => {
            returned = toast.promise(promise, {
              loading: "Saving…",
              success: (data) => `Saved ${data}`,
              error: "Save failed",
            })
          }}
        >
          save
        </button>
        <Toaster />
      </>,
    )

    fireEvent.click(screen.getByText("save"))

    expect(await screen.findByText("Saving…")).toBeInTheDocument()
    expect(renderedToasts()).toHaveLength(1)

    await act(async () => {
      resolvePromise("file.txt")
      await promise
    })

    expect(await screen.findByText("Saved file.txt")).toBeInTheDocument()
    expect(screen.queryByText("Saving…")).not.toBeInTheDocument()
    // Same toast updated in place — still exactly one toast.
    expect(renderedToasts()).toHaveLength(1)
    await expect(returned!).resolves.toBe("file.txt")
  })

  it("swaps the loading toast for an error toast on rejection", async () => {
    let rejectPromise!: (error: unknown) => void
    const promise = new Promise<string>((_resolve, reject) => {
      rejectPromise = reject
    })

    render(
      <>
        <button
          onClick={() => {
            const returned = toast.promise(promise, {
              loading: "Working…",
              success: "Done",
              error: (error) => `Failed: ${(error as Error).message}`,
            })
            returned.catch(() => {})
          }}
        >
          work
        </button>
        <Toaster />
      </>,
    )

    fireEvent.click(screen.getByText("work"))

    expect(await screen.findByText("Working…")).toBeInTheDocument()

    await act(async () => {
      rejectPromise(new Error("boom"))
      await promise.catch(() => {})
    })

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Failed: boom")
    expect(screen.queryByText("Working…")).not.toBeInTheDocument()
    expect(renderedToasts()).toHaveLength(1)
  })

  it("accepts a function that produces the promise", async () => {
    render(
      <>
        <button
          onClick={() => {
            const returned = toast.promise(() => Promise.resolve(42), {
              loading: "Loading",
              success: (data) => `Got ${data}`,
            })
            returned.catch(() => {})
          }}
        >
          lazy
        </button>
        <Toaster />
      </>,
    )

    fireEvent.click(screen.getByText("lazy"))

    expect(await screen.findByText("Got 42")).toBeInTheDocument()
  })

  it("lets the settled toast auto-dismiss with the toaster duration", async () => {
    vi.useFakeTimers()
    render(
      <>
        <button
          onClick={() => {
            const returned = toast.promise(Promise.resolve("ok"), {
              loading: "wait",
              success: "done",
            })
            returned.catch(() => {})
          }}
        >
          go
        </button>
        <Toaster duration={100} />
      </>,
    )

    fireEvent.click(screen.getByText("go"))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText("done")).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })
    // The loading toast's Infinity duration was reset on settle, so the
    // success toast auto-dismissed after the Toaster's 100ms duration.
    expect(renderedToasts()).toHaveLength(0)
  })
})
