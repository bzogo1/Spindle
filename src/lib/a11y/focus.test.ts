import { describe, expect, it } from "vitest"

import { getFocusableElements } from "./focus"

function render(html: string) {
  const container = document.createElement("div")
  container.innerHTML = html
  document.body.appendChild(container)
  return container
}

describe("getFocusableElements", () => {
  it("returns focusable elements in DOM order", () => {
    const container = render(`
      <button id="a">A</button>
      <a href="/x" id="b">B</a>
      <input id="c" />
      <select id="d"></select>
      <textarea id="e"></textarea>
    `)
    expect(getFocusableElements(container).map((el) => el.id)).toEqual(["a", "b", "c", "d", "e"])
    container.remove()
  })

  it("excludes disabled, hidden, and tabindex=-1 elements", () => {
    const container = render(`
      <button id="ok">OK</button>
      <button id="disabled" disabled>Disabled</button>
      <input id="hidden-input" type="hidden" />
      <div id="neg" tabindex="-1">programmatic only</div>
      <div id="pos" tabindex="0">tabbable</div>
      <span aria-hidden="true"><button id="aria-hidden-btn">x</button></span>
      <div hidden><button id="hidden-btn">x</button></div>
    `)
    const ids = getFocusableElements(container).map((el) => el.id)
    expect(ids).toContain("ok")
    expect(ids).toContain("pos")
    expect(ids).not.toContain("disabled")
    expect(ids).not.toContain("hidden-input")
    expect(ids).not.toContain("neg")
    expect(ids).not.toContain("aria-hidden-btn")
    expect(ids).not.toContain("hidden-btn")
    container.remove()
  })

  it("does not include the container itself, only descendants", () => {
    const container = render(`<button id="inner">Inner</button>`)
    expect(getFocusableElements(container)).toHaveLength(1)
    container.remove()
  })
})
