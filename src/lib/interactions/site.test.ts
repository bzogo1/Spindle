import { beforeEach, describe, expect, it, vi } from "vitest"

/* IntersectionObserver stub that records instances so tests can fire the
   callbacks scheduleDemoInit registered (jsdom's setup stub never intersects). */
class ControllableIO {
  static instances: ControllableIO[] = []

  callback: IntersectionObserverCallback
  observed: Element[] = []
  root: Element | Document | null = null
  rootMargin = ""
  thresholds: number[] = []

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    ControllableIO.instances.push(this)
  }

  observe(target: Element) {
    this.observed.push(target)
  }
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }

  static flush() {
    const instances = ControllableIO.instances
    ControllableIO.instances = []
    instances.forEach((inst) => {
      const entries = inst.observed.map(
        (target) =>
          ({
            isIntersecting: true,
            target,
          }) as IntersectionObserverEntry,
      )
      if (entries.length === 0) return
      inst.callback(entries, inst as unknown as IntersectionObserver)
    })
  }
}

async function initSiteFresh() {
  vi.resetModules()
  const { initSite } = await import("./site.js")
  initSite()
}

function buildHomepageChatDom() {
  document.body.innerHTML = `
    <button id="anonToggle" aria-pressed="false"></button>
    <span id="anonStatus"></span>
    <span id="chatRoute"></span>
    <div id="routeStrip"></div>
    <span id="chatChannelName"></span>
    <span id="chatHash"></span>
    <button data-chat-channel="field-notes"></button>
    <button data-chat-channel="mara"></button>
    <div id="chatMessages">
      <form id="chatComposer"><input id="chatInput" /></form>
    </div>`
}

function buildCollaborationChatDom() {
  document.body.innerHTML = `
    <button id="anonToggle" aria-pressed="false"></button>
    <div id="chatMessages">
      <div class="chat-msg" id="keepMe">live collaboration message</div>
      <div class="chat-msg chat-msg--anon" id="anonMessage" hidden></div>
      <div class="chat-typing" id="chatTyping"></div>
      <form id="chatForm"></form>
    </div>`
}

describe("initSite chat demo", () => {
  beforeEach(() => {
    ControllableIO.instances = []
    globalThis.IntersectionObserver = ControllableIO as unknown as typeof IntersectionObserver
    window.IntersectionObserver = ControllableIO as unknown as typeof IntersectionObserver
    document.body.innerHTML = ""
  })

  it("toggles anonymous mode on and off via aria-pressed", async () => {
    buildHomepageChatDom()
    await initSiteFresh()
    ControllableIO.flush()

    const anonToggle = document.getElementById("anonToggle")!
    const chatRoute = document.getElementById("chatRoute")!

    expect(anonToggle.getAttribute("aria-pressed")).toBe("false")

    anonToggle.click()
    expect(anonToggle.getAttribute("aria-pressed")).toBe("true")
    expect(chatRoute.textContent).toBe("Anonymous · pseudonymous")

    anonToggle.click()
    expect(anonToggle.getAttribute("aria-pressed")).toBe("false")
    expect(chatRoute.textContent).not.toBe("Anonymous · pseudonymous")
  })

  it("does not initialize the chat demo on /collaboration markup", async () => {
    buildCollaborationChatDom()
    await initSiteFresh()
    ControllableIO.flush()

    const chatMessages = document.getElementById("chatMessages")!
    const anonToggle = document.getElementById("anonToggle")!
    const keepMe = document.getElementById("keepMe")!
    const anonMessage = document.getElementById("anonMessage")!
    const chatTyping = document.getElementById("chatTyping")!

    // collaboration.js owns these nodes — site.js must not wipe or replace them.
    expect(chatMessages.children).toHaveLength(4)
    expect(chatMessages.contains(keepMe)).toBe(true)
    expect(chatMessages.contains(anonMessage)).toBe(true)
    expect(chatMessages.contains(chatTyping)).toBe(true)
    expect(chatMessages.querySelector(".chat-msg--anon")).toBe(anonMessage)

    // No site.js anonToggle listener: the attribute stays put and no
    // homepage thread markup is injected.
    anonToggle.click()
    expect(anonToggle.getAttribute("aria-pressed")).toBe("false")
    expect(chatMessages.querySelectorAll(".chat-msg")).toHaveLength(2)
  })
})

describe("initSite mobile nav", () => {
  beforeEach(() => {
    ControllableIO.instances = []
    globalThis.IntersectionObserver = ControllableIO as unknown as typeof IntersectionObserver
    window.IntersectionObserver = ControllableIO as unknown as typeof IntersectionObserver
    document.body.innerHTML = ""
  })

  function buildMenuDom(attrs = "") {
    document.body.innerHTML = `
      <button id="menuToggle" ${attrs}></button>
      <nav id="mobileNav"><a href="/x">x</a></nav>`
  }

  it("uses data-label-* attributes for the toggle aria-label", async () => {
    buildMenuDom('data-label-open="Відкрити меню" data-label-close="Закрити меню"')
    await initSiteFresh()

    const toggle = document.getElementById("menuToggle")!
    const nav = document.getElementById("mobileNav")!

    toggle.click()
    expect(nav.classList.contains("open")).toBe(true)
    expect(toggle.getAttribute("aria-expanded")).toBe("true")
    expect(toggle.getAttribute("aria-label")).toBe("Закрити меню")

    toggle.click()
    expect(nav.classList.contains("open")).toBe(false)
    expect(toggle.getAttribute("aria-label")).toBe("Відкрити меню")
  })

  it("falls back to English labels without data attributes", async () => {
    buildMenuDom()
    await initSiteFresh()

    const toggle = document.getElementById("menuToggle")!
    toggle.click()
    expect(toggle.getAttribute("aria-label")).toBe("Close menu")
    toggle.click()
    expect(toggle.getAttribute("aria-label")).toBe("Open menu")
  })
})
