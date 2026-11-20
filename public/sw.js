/*
 * Spindle service worker.
 *
 * Plain classic script (no modules). All cache-routing decisions live in
 * /pwa/sw-core.js so they can be unit-tested from TypeScript — keep this file
 * to fetch-strategy plumbing, lifecycle, push and background-sync handling.
 *
 * Cache strategy summary (see classifyRequest in sw-core.js):
 *   - navigations / HTML        → network-first, offline.html fallback
 *   - /_next/static + assets    → cache-first (content-hashed)
 *   - other same-origin GET     → stale-while-revalidate
 *   - /api/*, mutations, auth   → network-only (never cached)
 */
importScripts("/pwa/sw-core.js")

var core = self.SpindlePwa
var CACHE_VERSION = core.CACHE_VERSION
var NAMES = core.cacheNames(CACHE_VERSION)
var ALL_CACHE_NAMES = [NAMES.precache, NAMES.pages, NAMES.static, NAMES.runtime]
var OFFLINE_URL = "/offline.html"

/* ------------------------------------------------------------------ */
/* Install / activate                                                  */
/* ------------------------------------------------------------------ */

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches
      .open(NAMES.precache)
      .then(function (cache) {
        // addAll rejects entirely if one asset 404s; add each independently so
        // a missing optional icon never blocks installation.
        return Promise.all(
          core.PRECACHE_URLS.map(function (url) {
            return cache.add(url).catch(function () {})
          })
        )
      })
      .then(function () {
        // First install: take control immediately so offline works at once.
        // Updates: stay in "waiting" so the page can offer a reload prompt.
        if (!self.registration.active) self.skipWaiting()
      })
  )
})

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) {
              return ALL_CACHE_NAMES.indexOf(key) === -1
            })
            .map(function (key) {
              return caches.delete(key)
            })
        )
      })
      .then(function () {
        return self.clients.claim()
      })
  )
})

/* ------------------------------------------------------------------ */
/* Fetch handling                                                      */
/* ------------------------------------------------------------------ */

function putInCache(cacheName, request, response) {
  if (!core.isCacheableResponse(response, request.url)) return
  var copy = response.clone()
  caches.open(cacheName).then(function (cache) {
    cache.put(request, copy).catch(function () {})
  })
}

function networkOnly(request) {
  return fetch(request)
}

function cacheFirst(request, cacheName) {
  return caches.match(request).then(function (cached) {
    if (cached) return cached
    return fetch(request).then(function (response) {
      putInCache(cacheName, request, response)
      return response
    })
  })
}

function staleWhileRevalidate(request, cacheName) {
  return caches.match(request).then(function (cached) {
    var network = fetch(request)
      .then(function (response) {
        putInCache(cacheName, request, response)
        return response
      })
      .catch(function () {
        return cached || Response.error()
      })
    return cached || network
  })
}

function networkFirst(request, cacheName) {
  return fetch(request)
    .then(function (response) {
      // Never cache non-OK navigations (e.g. a 500 error page).
      if (response && response.ok) putInCache(cacheName, request, response)
      return response
    })
    .catch(function () {
      return caches.match(request).then(function (cached) {
        if (cached) return cached
        if (request.mode === "navigate") {
          return caches.match(OFFLINE_URL).then(function (offline) {
            return offline || Response.error()
          })
        }
        return Response.error()
      })
    })
}

self.addEventListener("fetch", function (event) {
  var request = event.request
  var strategy = core.classifyRequest(request, self.location.origin)

  if (strategy === "network-only") {
    event.respondWith(networkOnly(request))
    return
  }

  if (strategy === "cache-first") {
    event.respondWith(cacheFirst(request, NAMES.static))
    return
  }

  if (strategy === "stale-while-revalidate") {
    event.respondWith(staleWhileRevalidate(request, NAMES.runtime))
    return
  }

  // network-first (navigations and anything unclassified same-origin GET)
  event.respondWith(networkFirst(request, NAMES.pages))
})

/* ------------------------------------------------------------------ */
/* Update flow                                                         */
/* ------------------------------------------------------------------ */

self.addEventListener("message", function (event) {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting()
  }
})

/* ------------------------------------------------------------------ */
/* Background sync outbox (see src/lib/pwa/background-sync.ts)         */
/*                                                                     */
/* Replay logic lives in /pwa/sw-core.js (`core.replayOutbox`) so it   */
/* can be unit-tested from TypeScript. It replays records sequentially */
/* in enqueue order and performs every IndexedDB write inside its own  */
/* awaited transaction — never from fetch().then() callbacks on a      */
/* stale transaction.                                                  */
/* ------------------------------------------------------------------ */

self.addEventListener("sync", function (event) {
  if (event.tag === core.OUTBOX_SYNC_TAG) {
    event.waitUntil(core.replayOutbox())
  }
})

/* ------------------------------------------------------------------ */
/* Push notifications                                                  */
/* ------------------------------------------------------------------ */

self.addEventListener("push", function (event) {
  var payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch (e) {
    payload = { title: "Spindle", body: event.data ? event.data.text() : "" }
  }

  var title = payload.title || "Spindle"
  var options = {
    body: payload.body || "",
    icon: payload.icon || "/icons/icon.svg",
    badge: payload.badge || "/icons/icon.svg",
    tag: payload.tag || "spindle-notification",
    data: { url: payload.url || "/" },
  }

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      // Mirror the payload into open tabs so the in-app notification feed
      // (bell badge + notifications page) updates in realtime. The app
      // listens for "spindle-push" messages in AppNotificationsProvider.
      self.clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then(function (clients) {
          clients.forEach(function (client) {
            client.postMessage({
              type: "spindle-push",
              payload: {
                type: payload.type || "info",
                title: title,
                body: options.body,
                href: options.data.url,
              },
            })
          })
        }),
    ])
  )
})

self.addEventListener("notificationclick", function (event) {
  event.notification.close()
  var targetUrl = (event.notification.data && event.notification.data.url) || "/"

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clients) {
      for (var i = 0; i < clients.length; i++) {
        var client = clients[i]
        if ("focus" in client) {
          client.navigate(targetUrl)
          return client.focus()
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl)
    })
  )
})
