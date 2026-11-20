/*
 * Spindle PWA — shared service-worker core (plain JavaScript, no modules).
 *
 * This file is the single source of truth for cache routing. It is loaded by
 * the service worker via `importScripts("/pwa/sw-core.js")` (see public/sw.js)
 * and by unit tests via `src/lib/pwa/sw-core.test.ts`, which evaluates this
 * file with `new Function`. Do NOT use ESM `import`/`export` syntax here —
 * `importScripts` only supports classic scripts.
 *
 * The UMD-ish wrapper also assigns the API to `module.exports` when running
 * under a CommonJS-ish test harness, but Vitest loads it through `new Function`,
 * so tests read `globalThis.SpindlePwa` / `self.SpindlePwa` instead.
 */
(function (root, factory) {
  var api = factory()
  root.SpindlePwa = api
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api
  }
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict"

  /**
   * Bump this whenever the set of precached assets or cache semantics change.
   * It is embedded in every cache name, so `activate` can delete stale caches.
   */
  var CACHE_VERSION = "spindle-pwa-1"

  /** Same-origin assets fetched once at install time so the shell boots offline. */
  var PRECACHE_URLS = ["/offline.html", "/manifest.webmanifest", "/icons/icon.svg"]

  /** Cache buckets. `pages` is network-first; `static` is content-hashed. */
  function cacheNames(version) {
    var v = version || CACHE_VERSION
    return {
      precache: v + "-precache",
      pages: v + "-pages",
      static: v + "-static",
      runtime: v + "-runtime",
    }
  }

  var STATIC_EXTENSIONS = /\.(?:js|css|mjs|map|json|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|webmanifest)$/i

  /**
   * Third-party font hosts we are allowed to cache (opaque responses are fine
   * for fonts — they carry no credentials and are content-stable per URL).
   */
  var CACHEABLE_FONT_HOSTS = ["fonts.gstatic.com", "fonts.googleapis.com"]

  /**
   * Same-origin path prefixes that must never touch the cache. This is an
   * allowlist-style denylist: anything not listed here may be cached under the
   * rules in `classifyRequest`. `/api/` covers every backend call, including
   * auth-adjacent endpoints.
   */
  var NETWORK_ONLY_PREFIXES = ["/api/"]

  /** Requests carrying these headers are always network-only (mutations with bodies in flight, RSC prefetches are handled by extension/URL rules). */
  var NETWORK_ONLY_HEADER_NAMES = ["authorization", "x-api-key"]

  function hasHeader(headers, name) {
    if (!headers) return false
    if (typeof headers.get === "function") return headers.get(name) !== null
    var lower = name.toLowerCase()
    if (Array.isArray(headers)) {
      for (var i = 0; i < headers.length; i++) {
        if (String(headers[i][0]).toLowerCase() === lower) return true
      }
      return false
    }
    for (var key in headers) {
      if (Object.prototype.hasOwnProperty.call(headers, key) && key.toLowerCase() === lower) {
        return true
      }
    }
    return false
  }

  function headerValue(headers, name) {
    if (!headers) return ""
    if (typeof headers.get === "function") return headers.get(name) || ""
    var lower = name.toLowerCase()
    if (Array.isArray(headers)) {
      for (var i = 0; i < headers.length; i++) {
        if (String(headers[i][0]).toLowerCase() === lower) return String(headers[i][1])
      }
      return ""
    }
    for (var key in headers) {
      if (Object.prototype.hasOwnProperty.call(headers, key) && key.toLowerCase() === lower) {
        return String(headers[key])
      }
    }
    return ""
  }

  function isNavigation(request) {
    if (request.mode === "navigate") return true
    var accept = headerValue(request.headers, "accept")
    return accept.indexOf("text/html") !== -1
  }

  function isBypassedPath(pathname) {
    for (var i = 0; i < NETWORK_ONLY_PREFIXES.length; i++) {
      if (pathname.indexOf(NETWORK_ONLY_PREFIXES[i]) === 0) return true
    }
    return false
  }

  function isStaticAsset(url, request) {
    if (url.pathname.indexOf("/_next/static/") === 0) return true
    if (STATIC_EXTENSIONS.test(url.pathname)) return true
    var destination = request.destination || ""
    return (
      destination === "image" ||
      destination === "font" ||
      destination === "style" ||
      destination === "script" ||
      destination === "manifest"
    )
  }

  /**
   * Decide how a request should be handled.
   *
   * @param {Request|{url:string,method?:string,mode?:string,destination?:string,headers?:any}} request
   * @param {string} [origin] expected same-origin value (defaults to self.location.origin when available)
   * @returns {"network-only"|"network-first"|"stale-while-revalidate"|"cache-first"}
   *   Navigations that end up with no cached copy fall back to /offline.html
   *   inside the fetch handler (see networkFirst in public/sw.js).
   */
  function classifyRequest(request, origin) {
    var method = String(request.method || "GET").toUpperCase()
    if (method !== "GET" && method !== "HEAD") return "network-only"

    var url
    try {
      url = new URL(request.url)
    } catch (e) {
      return "network-only"
    }

    var expectedOrigin =
      origin ||
      (typeof self !== "undefined" && self.location ? self.location.origin : url.origin)
    var sameOrigin = url.origin === expectedOrigin

    if (!sameOrigin) {
      // Cross-origin: only allowlisted font hosts may be cached (opaque).
      if (CACHEABLE_FONT_HOSTS.indexOf(url.hostname) !== -1) return "cache-first"
      return "network-only"
    }

    // Never cache API responses or credentialed/auth-header requests.
    if (isBypassedPath(url.pathname)) return "network-only"
    for (var i = 0; i < NETWORK_ONLY_HEADER_NAMES.length; i++) {
      if (hasHeader(request.headers, NETWORK_ONLY_HEADER_NAMES[i])) return "network-only"
    }

    if (isNavigation(request)) return "network-first"

    if (isStaticAsset(url, request)) return "cache-first"

    // Everything else same-origin GET: serve stale, revalidate in background.
    return "stale-while-revalidate"
  }

  /**
   * Whether a response may be written to a cache for the given request URL.
   * Opaque (cross-origin, no-cors) responses are only allowed for font hosts.
   */
  function isCacheableResponse(response, requestUrl, origin) {
    if (!response) return false
    if (response.status === 200 || response.status === 0) {
      if (response.status === 0) {
        try {
          var u = new URL(typeof requestUrl === "string" ? requestUrl : requestUrl.url)
          var expected =
            origin ||
            (typeof self !== "undefined" && self.location ? self.location.origin : u.origin)
          if (u.origin === expected) return true
          return CACHEABLE_FONT_HOSTS.indexOf(u.hostname) !== -1
        } catch (e) {
          return false
        }
      }
      return true
    }
    return false
  }

  /** Name of the outbox IndexedDB database shared with src/lib/pwa/background-sync.ts. Keep in sync. */
  var OUTBOX_DB_NAME = "spindle-outbox"
  var OUTBOX_STORE_NAME = "requests"
  var OUTBOX_SYNC_TAG = "spindle-outbox"

  /** Records are dropped after this many failed replay attempts. */
  var OUTBOX_MAX_RETRIES = 5

  /* ------------------------------------------------------------------ */
  /* Background-sync outbox replay                                       */
  /*                                                                     */
  /* IMPORTANT: every IndexedDB write happens inside its OWN awaited      */
  /* transaction. Issuing store.delete/put from fetch().then() callbacks  */
  /* while the original transaction is still open throws                  */
  /* TransactionInactiveError and silently loses the update — which is    */
  /* exactly the bug this structure avoids. Records are replayed          */
  /* sequentially in enqueue (createdAt) order because create-then-update */
  /* mutations must not overtake each other.                              */
  /* ------------------------------------------------------------------ */

  function outboxRequestToRequest(record) {
    return new Request(record.url, {
      method: record.method,
      headers: record.headers,
      body: record.method === "GET" || record.method === "HEAD" ? undefined : record.body,
      credentials: "same-origin",
    })
  }

  function openOutboxDb() {
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(OUTBOX_DB_NAME, 1)
      request.onupgradeneeded = function () {
        var db = request.result
        if (!db.objectStoreNames.contains(OUTBOX_STORE_NAME)) {
          db.createObjectStore(OUTBOX_STORE_NAME, { keyPath: "id" })
        }
      }
      request.onsuccess = function () {
        resolve(request.result)
      }
      request.onerror = function () {
        reject(request.error)
      }
    })
  }

  /** Run a single-request transaction and resolve with the request result. */
  function outboxTx(db, mode, run) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(OUTBOX_STORE_NAME, mode)
      var request = run(tx.objectStore(OUTBOX_STORE_NAME))
      request.onsuccess = function () {
        resolve(request.result)
      }
      request.onerror = function () {
        reject(request.error)
      }
      tx.onabort = function () {
        reject(tx.error || new Error("outbox transaction aborted"))
      }
    })
  }

  function closeQuietly(db) {
    try {
      db.close()
    } catch (e) {
      /* already closed */
    }
  }

  /**
   * Bump a record's retry counter inside a fresh transaction.
   * Resolves true when the record stays queued, false when it was dropped.
   */
  function bumpOutboxRecord(db, record) {
    record.retries = (record.retries || 0) + 1
    if (record.retries > OUTBOX_MAX_RETRIES) {
      return outboxTx(db, "readwrite", function (store) {
        return store.delete(record.id)
      }).then(function () {
        return false
      })
    }
    return outboxTx(db, "readwrite", function (store) {
      return store.put(record)
    }).then(function () {
      return true
    })
  }

  /**
   * Replay every queued mutation, strictly sequentially in enqueue order.
   *
   * @param {function(Request): Promise<Response>} [fetchImpl] injectable for tests
   * @returns {Promise<{sent:number, failed:number, dropped:number, remaining:number}>}
   *   sent    — delivered with a 2xx response
   *   dropped — removed without delivery (4xx permanent failure or retry budget exhausted)
   *   failed  — still queued after this attempt
   *   remaining — records left in the outbox
   */
  function replayOutbox(fetchImpl) {
    var doFetch =
      typeof fetchImpl === "function"
        ? fetchImpl
        : function (request) {
            return fetch(request)
          }

    var db
    return openOutboxDb()
      .then(function (opened) {
        db = opened
        return outboxTx(db, "readonly", function (store) {
          return store.getAll()
        })
      })
      .then(function (records) {
        // Enqueue order = creation order; getAll returns key order.
        var ordered = (records || []).slice().sort(function (a, b) {
          return (a.createdAt || 0) - (b.createdAt || 0)
        })
        var result = { sent: 0, failed: 0, dropped: 0, remaining: 0 }

        return ordered
          .reduce(function (chain, record) {
            return chain.then(function () {
              return doFetch(outboxRequestToRequest(record))
                .then(function (response) {
                  // Delivered (2xx) or permanently rejected (4xx): drop it.
                  // Only network failures and 5xx keep the record.
                  if (response && response.ok) {
                    result.sent += 1
                    return outboxTx(db, "readwrite", function (store) {
                      return store.delete(record.id)
                    })
                  }
                  if (response && response.status >= 400 && response.status < 500) {
                    result.dropped += 1
                    return outboxTx(db, "readwrite", function (store) {
                      return store.delete(record.id)
                    })
                  }
                  return bumpOutboxRecord(db, record).then(function (kept) {
                    if (kept) result.failed += 1
                    else result.dropped += 1
                  })
                })
                .catch(function () {
                  return bumpOutboxRecord(db, record).then(function (kept) {
                    if (kept) result.failed += 1
                    else result.dropped += 1
                  })
                })
            })
          }, Promise.resolve())
          .then(function () {
            return outboxTx(db, "readonly", function (store) {
              return store.count()
            }).then(function (remaining) {
              result.remaining = remaining || 0
              return result
            })
          })
      })
      .then(
        function (result) {
          closeQuietly(db)
          return result
        },
        function (error) {
          if (db) closeQuietly(db)
          throw error
        },
      )
  }

  return {
    CACHE_VERSION: CACHE_VERSION,
    PRECACHE_URLS: PRECACHE_URLS,
    OUTBOX_DB_NAME: OUTBOX_DB_NAME,
    OUTBOX_STORE_NAME: OUTBOX_STORE_NAME,
    OUTBOX_SYNC_TAG: OUTBOX_SYNC_TAG,
    OUTBOX_MAX_RETRIES: OUTBOX_MAX_RETRIES,
    outboxRequestToRequest: outboxRequestToRequest,
    replayOutbox: replayOutbox,
    cacheNames: cacheNames,
    classifyRequest: classifyRequest,
    isCacheableResponse: isCacheableResponse,
    headerValue: headerValue,
    hasHeader: hasHeader,
  }
})
