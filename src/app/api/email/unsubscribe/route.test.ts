import { beforeEach, describe, expect, it } from "vitest"

import { createUnsubscribeToken, isUnsubscribed } from "@/lib/email-unsubscribe"
import { clearNewsletterStore, listSubscribers, subscribe } from "@/lib/newsletter-store"

import { GET, POST } from "./route"

let ipCounter = 0

function get(params: Record<string, string>, ip?: string) {
  const search = new URLSearchParams(params).toString()
  return GET(
    new Request(`http://localhost/api/email/unsubscribe?${search}`, {
      headers: { "x-forwarded-for": ip ?? `10.7.7.${++ipCounter}` },
    }),
  )
}

function postJson(body: unknown, ip?: string) {
  return POST(
    new Request("http://localhost/api/email/unsubscribe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": ip ?? `10.7.7.${++ipCounter}`,
      },
      body: JSON.stringify(body),
    }),
  )
}

function postForm(body: string, ip?: string) {
  return POST(
    new Request("http://localhost/api/email/unsubscribe", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "x-forwarded-for": ip ?? `10.7.7.${++ipCounter}`,
      },
      body,
    }),
  )
}

function tokenFor(email: string, scope?: string) {
  return createUnsubscribeToken({ email, scope }).token
}

beforeEach(() => {
  // clearNewsletterStore also clears the opt-out store.
  clearNewsletterStore()
})

describe("GET /api/email/unsubscribe", () => {
  it("returns subscription status for a valid token", async () => {
    const token = tokenFor("reader@lab.edu")
    const response = await get({ token, email: "reader@lab.edu" })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toMatchObject({
      ok: true,
      email: "reader@lab.edu",
      scope: "marketing",
      subscribed: true,
    })
  })

  it("does not mutate state — scanners can GET safely", async () => {
    const token = tokenFor("scan@lab.edu")
    await get({ token })
    await get({ token })
    expect(isUnsubscribed("scan@lab.edu")).toBe(false)
  })

  it("rejects missing, malformed, and tampered tokens", async () => {
    expect((await get({})).status).toBe(400)
    expect((await get({ token: "nope" })).status).toBe(400)

    const token = tokenFor("a@b.c")
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`
    expect((await get({ token: tampered })).status).toBe(400)
  })

  it("rejects when the email param disagrees with the token", async () => {
    const token = tokenFor("real@lab.edu")
    const response = await get({ token, email: "other@lab.edu" })
    expect(response.status).toBe(400)
    expect((await response.json()).ok).toBe(false)
  })

  it("reports subscribed:false after unsubscribing", async () => {
    const token = tokenFor("done@lab.edu")
    await postJson({ token })
    const data = await (await get({ token })).json()
    expect(data.subscribed).toBe(false)
  })
})

describe("POST /api/email/unsubscribe", () => {
  it("unsubscribes the token's address idempotently", async () => {
    const token = tokenFor("reader@lab.edu")

    const first = await postJson({ token })
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({ ok: true, subscribed: false })
    expect(isUnsubscribed("reader@lab.edu", "marketing")).toBe(true)

    const second = await postJson({ token })
    expect(second.status).toBe(200)
    expect(await second.json()).toMatchObject({ ok: true, subscribed: false })
  })

  it("accepts the token in the query string", async () => {
    const token = tokenFor("query@lab.edu")
    const response = await POST(
      new Request(`http://localhost/api/email/unsubscribe?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "x-forwarded-for": "10.7.7.250" },
      }),
    )
    expect(response.status).toBe(200)
    expect(isUnsubscribed("query@lab.edu")).toBe(true)
  })

  it("supports RFC 8058 one-click form posts", async () => {
    const token = tokenFor("oneclick@lab.edu")
    const response = await postForm(`List-Unsubscribe=One-Click&token=${encodeURIComponent(token)}`)
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toMatchObject({ ok: true, subscribed: false })
    expect(isUnsubscribed("oneclick@lab.edu")).toBe(true)
  })

  it("supports scope-specific tokens", async () => {
    const token = tokenFor("scoped@lab.edu", "newsletter")
    await postJson({ token })
    expect(isUnsubscribed("scoped@lab.edu", "newsletter")).toBe(true)
    expect(isUnsubscribed("scoped@lab.edu", "marketing")).toBe(false)
  })

  it("marks the newsletter subscriber record unsubscribed for newsletter-scoped tokens", async () => {
    subscribe("member@lab.edu")
    const token = tokenFor("member@lab.edu", "newsletter")
    const response = await postJson({ token })
    expect(response.status).toBe(200)
    const subscriber = listSubscribers({ query: "member@lab.edu" }).items[0]
    expect(subscriber.status).toBe("unsubscribed")
    expect(subscriber.unsubscribedAt).toBeTruthy()
  })

  it("marks the subscriber record unsubscribed for 'all'-scoped tokens", async () => {
    subscribe("all@lab.edu")
    const token = tokenFor("all@lab.edu", "all")
    await postJson({ token })
    expect(listSubscribers({ query: "all@lab.edu" }).items[0].status).toBe("unsubscribed")
  })

  it("leaves the subscriber record active for unrelated scopes", async () => {
    subscribe("mktg@lab.edu")
    const token = tokenFor("mktg@lab.edu", "marketing")
    await postJson({ token })
    expect(isUnsubscribed("mktg@lab.edu", "marketing")).toBe(true)
    expect(listSubscribers({ query: "mktg@lab.edu" }).items[0].status).toBe("active")
  })

  it("cannot unsubscribe an arbitrary address", async () => {
    const token = tokenFor("mine@lab.edu")
    const response = await postJson({ token, email: "victim@lab.edu" })
    expect(response.status).toBe(400)
    expect(isUnsubscribed("victim@lab.edu")).toBe(false)
    expect(isUnsubscribed("mine@lab.edu")).toBe(false)
  })

  it("rejects invalid tokens", async () => {
    expect((await postJson({ token: "forged" })).status).toBe(400)
    expect((await postJson({})).status).toBe(400)
    expect((await postForm("List-Unsubscribe=One-Click")).status).toBe(400)
  })

  it("rejects malformed JSON", async () => {
    const response = await POST(
      new Request("http://localhost/api/email/unsubscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "10.7.7.251",
        },
        body: "{oops",
      }),
    )
    expect(response.status).toBe(400)
  })

  it("rate limits repeated attempts from one IP", async () => {
    const ip = "203.0.113.55"
    const token = tokenFor("limited@lab.edu")
    for (let i = 0; i < 30; i++) {
      const response = await postJson({ token }, ip)
      expect(response.status).toBe(200)
    }
    const blocked = await postJson({ token }, ip)
    expect(blocked.status).toBe(429)
  })
})
