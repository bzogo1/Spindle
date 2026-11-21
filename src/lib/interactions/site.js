/* ==========================================================================
   SPINDLE — interactions
   Small, purposeful UI behavior. No decorative motion effects.
   ========================================================================== */

/* Runs after hydration from a client component. */
let started = false

export function initSite() {
  if (started) return
  started = true

  ;("use strict")

  const doc = document
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches

  /* Page-scoped demos are wired lazily (see scanAdded near the bottom): the
     (site) layout persists across client-side navigations, so page markup
     mounts — and PageTransition can swap subtrees — after this script runs.
     Wiring state lives on the element itself (not a module-level WeakSet) so
     a re-imported module instance — e.g. after HMR — can't double-bind. */
  const WIRED_KEY = "__spindleSiteWired"

  function isWired(el) {
    return Boolean(el && el[WIRED_KEY])
  }

  function markWired(el) {
    if (el) el[WIRED_KEY] = true
  }

  function wireOnce(key, fn) {
    if (isWired(key)) return
    markWired(key)
    fn()
  }

  /* The file manager's "New" menu actions are delegated on the document once;
     each file manager instance registers its handler so revisits don't stack
     listeners that mutate detached DOM. */
  let fmActionHandler = null
  let fmActionsBound = false

  function bindFmActions() {
    if (fmActionsBound) return
    fmActionsBound = true
    doc.addEventListener("click", (e) => {
      const item = e.target.closest("[data-fm-action]")
      if (!item || !item.isConnected || !fmActionHandler) return
      fmActionHandler(item.getAttribute("data-fm-action"))
    })
  }

  /* ----------------------------------------------------------------------
     Header border on scroll
  ---------------------------------------------------------------------- */
  let scrollQueued = false

  function onScroll() {
    const header = doc.getElementById("header")
    if (header) header.classList.toggle("scrolled", window.scrollY > 12)
    scrollQueued = false
  }

  function queueScroll() {
    if (scrollQueued) return
    scrollQueued = true
    window.requestAnimationFrame(onScroll)
  }

  onScroll()
  window.addEventListener("scroll", queueScroll, { passive: true })
  window.addEventListener("resize", queueScroll)

  /* ----------------------------------------------------------------------
     Mobile navigation
  ---------------------------------------------------------------------- */
  /* The React header renders translated labels into data-label-open /
     data-label-close; read them live so a locale switch applies without a
     reload. English literals are the fallback for markup without them. */
  function menuToggleLabel(open) {
    const menuToggle = doc.getElementById("menuToggle")
    if (!menuToggle) return ""
    const key = open ? "labelClose" : "labelOpen"
    return menuToggle.dataset[key] || (open ? "Close menu" : "Open menu")
  }

  function closeMenu() {
    const menuToggle = doc.getElementById("menuToggle")
    const mobileNav = doc.getElementById("mobileNav")
    if (!menuToggle || !mobileNav) return
    mobileNav.classList.remove("open")
    menuToggle.setAttribute("aria-expanded", "false")
    menuToggle.setAttribute("aria-label", menuToggleLabel(false))
  }

  /* Bound once on the document; they resolve the current elements on every
     event so a remounted header keeps working. */
  doc.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu()
  })
  doc.addEventListener("click", (e) => {
    const mobileNav = doc.getElementById("mobileNav")
    const menuToggle = doc.getElementById("menuToggle")
    if (
      mobileNav &&
      menuToggle &&
      !mobileNav.contains(e.target) &&
      !menuToggle.contains(e.target)
    ) {
      closeMenu()
    }
  })

  function wireMobileNav() {
    const menuToggle = doc.getElementById("menuToggle")
    const mobileNav = doc.getElementById("mobileNav")
    if (!menuToggle || !mobileNav || isWired(menuToggle)) return
    wireOnce(menuToggle, () => {
      menuToggle.addEventListener("click", () => {
        const open = mobileNav.classList.toggle("open")
        menuToggle.setAttribute("aria-expanded", String(open))
        menuToggle.setAttribute("aria-label", menuToggleLabel(open))
      })

      mobileNav.querySelectorAll("a").forEach((link) =>
        link.addEventListener("click", closeMenu),
      )
    })
  }

  /* ----------------------------------------------------------------------
     Scroll reveal
  ---------------------------------------------------------------------- */
  const revealables = doc.querySelectorAll("[data-reveal]")
  const tracked = new WeakSet()

  const trackReveal = (el) => {
    if (tracked.has(el)) return
    tracked.add(el)
    const delay = el.getAttribute("data-reveal-delay")
    if (delay) el.style.setProperty("--reveal-delay", delay + "ms")
  }

  if ("IntersectionObserver" in window && !reducedMotion) {
    const revealObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return
          entry.target.classList.add("is-visible")
          observer.unobserve(entry.target)
        })
      },
      { threshold: 0.1, rootMargin: "0px 0px -36px 0px" },
    )

    const observeReveal = (el) => {
      if (tracked.has(el)) return
      trackReveal(el)
      // Hide only from here: if this script never runs, the content stays visible.
      el.classList.add("is-pending")
      revealObserver.observe(el)
    }

    revealables.forEach(observeReveal)

    // PageTransition swaps its children for a <ViewTransition> wrapper just
    // after hydration and route changes mount fresh page nodes, so the first
    // pass can miss elements that are now in the document. Pick those up
    // instead of leaving them stuck in their hidden state.
    const revealMutations = new MutationObserver((records) => {
      records.forEach((record) => {
        record.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return
          if (node.hasAttribute("data-reveal")) observeReveal(node)
          node.querySelectorAll("[data-reveal]").forEach(observeReveal)
        })
      })
    })
    revealMutations.observe(doc.body, { childList: true, subtree: true })
  } else {
    revealables.forEach((el) => {
      trackReveal(el)
      el.classList.add("is-visible")
    })
  }

  /* ----------------------------------------------------------------------
     Hero product mockup — tabbed views. The window body mounts lazily via
     IntersectionObserver in HeroAppWindow, so listeners are delegated and
     tabs/panels are queried at event time rather than at init.
  ---------------------------------------------------------------------- */
  function wireHeroTabs() {
    const heroTabs = Array.from(doc.querySelectorAll("[data-hero-tab]"))
    const heroPanels = Array.from(doc.querySelectorAll("[data-hero-panel]"))
    if (!heroTabs.length || !heroPanels.length) return

    function showHeroPanel(name) {
      heroTabs.forEach((tab) => {
        const active = tab.getAttribute("data-hero-tab") === name
        tab.classList.toggle("is-active", active)
        tab.setAttribute("aria-selected", String(active))
        tab.tabIndex = active ? 0 : -1
      })
      heroPanels.forEach((panel) => {
        const active = panel.getAttribute("data-hero-panel") === name
        panel.classList.toggle("is-active", active)
        panel.hidden = !active
      })
    }

    wireOnce(heroTabs[0], () => {
      showHeroPanel("overview")

      heroTabs.forEach((tab, index) => {
        tab.addEventListener("click", () => showHeroPanel(tab.getAttribute("data-hero-tab")))
        tab.addEventListener("keydown", (e) => {
          if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return
          e.preventDefault()
          const next =
            (index + (e.key === "ArrowRight" ? 1 : -1) + heroTabs.length) % heroTabs.length
          heroTabs[next].focus()
          heroTabs[next].click()
        })
      })
    })
  }

  /* ----------------------------------------------------------------------
     Lab — environment tabs
  ---------------------------------------------------------------------- */
  function wireLabTabs() {
    const labTabs = Array.from(doc.querySelectorAll("[data-lab-tab]"))
    const labPanels = Array.from(doc.querySelectorAll("[data-lab-panel]"))
    if (!labTabs.length || !labPanels.length) return

    function showLabPanel(tab) {
      const name = tab.getAttribute("data-lab-tab")

      labTabs.forEach((item) => {
        const active = item === tab
        item.classList.toggle("is-active", active)
        item.setAttribute("aria-selected", String(active))
        item.tabIndex = active ? 0 : -1
      })
      labPanels.forEach((panel) => {
        const active = panel.getAttribute("data-lab-panel") === name
        panel.classList.toggle("is-active", active)
        panel.hidden = !active
      })

      const labWindowTitle = doc.getElementById("labWindowTitle")
      const labWindowStatus = doc.getElementById("labWindowStatus")
      if (labWindowTitle)
        labWindowTitle.textContent = tab.getAttribute("data-lab-title") || ""
      if (labWindowStatus)
        labWindowStatus.textContent = tab.getAttribute("data-lab-status") || ""
    }

    wireOnce(labTabs[0], () => {
      labTabs.forEach((tab, index) => {
        tab.addEventListener("click", () => showLabPanel(tab))
        tab.addEventListener("keydown", (e) => {
          if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return
          e.preventDefault()
          const next = (index + (e.key === "ArrowRight" ? 1 : -1) + labTabs.length) % labTabs.length
          labTabs[next].focus()
          labTabs[next].click()
        })
      })
    })
  }

  /* ----------------------------------------------------------------------
     VS Code — file tabs within the VS Code panel
  ---------------------------------------------------------------------- */
  function wireVscodeFiles() {
    const vscodeTabs = Array.from(doc.querySelectorAll("[data-vscode-file]"))
    if (!vscodeTabs.length) return

    function showVscodeFile(tab) {
      vscodeTabs.forEach((item) => {
        const active = item === tab
        item.classList.toggle("is-active", active)
        item.setAttribute("aria-selected", String(active))
        item.tabIndex = active ? 0 : -1
      })

      const vscodeBreadcrumb = doc.getElementById("vscodeBreadcrumb")
      const vscodeCode = doc.getElementById("vscodeCode")
      if (vscodeBreadcrumb)
        vscodeBreadcrumb.textContent = tab.getAttribute("data-vscode-breadcrumb") || ""
      if (vscodeCode) vscodeCode.innerHTML = tab.getAttribute("data-vscode-code") || ""
    }

    wireOnce(vscodeTabs[0], () => {
      vscodeTabs.forEach((tab, index) => {
        tab.addEventListener("click", () => showVscodeFile(tab))
        tab.addEventListener("keydown", (e) => {
          if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return
          e.preventDefault()
          const next =
            (index + (e.key === "ArrowRight" ? 1 : -1) + vscodeTabs.length) % vscodeTabs.length
          vscodeTabs[next].focus()
          vscodeTabs[next].click()
        })
      })
    })
  }

  /* ----------------------------------------------------------------------
     Kernel selector — switches the kernel shown in the lab demos
  ---------------------------------------------------------------------- */
  const kernelSelects = Array.from(doc.querySelectorAll("[data-kernel-select]"))

  kernelSelects.forEach((select) => {
    select.addEventListener("change", () => {
      const kernel = select.value
      const suffix = select.getAttribute("data-kernel-suffix") || " · idle"

      const statusId = select.getAttribute("data-kernel-status")
      const statusEl = statusId ? doc.getElementById(statusId) : null
      if (statusEl) statusEl.textContent = `${kernel}${suffix}`

      const mirrorId = select.getAttribute("data-kernel-mirror")
      const mirrorEl = mirrorId ? doc.getElementById(mirrorId) : null
      if (mirrorEl) mirrorEl.textContent = kernel

      // Keep the lab window chrome in sync when a lab panel is active
      const panel = select.closest("[data-lab-panel]")
      const labWindowStatus = doc.getElementById("labWindowStatus")
      if (panel && panel.classList.contains("is-active") && labWindowStatus) {
        labWindowStatus.textContent = `${kernel} · idle`
        const tab = doc.querySelector(`[data-lab-tab="${panel.getAttribute("data-lab-panel")}"]`)
        if (tab) tab.setAttribute("data-lab-status", `${kernel} · idle`)
      }
    })
  })

  /* ----------------------------------------------------------------------
     Demo builders — heavy synchronous DOM work. Each demo is wired lazily:
     its section is scanned and built only when it scrolls near the viewport
     (IntersectionObserver), or when the main thread is idle as a fallback.
  ---------------------------------------------------------------------- */
  function scheduleDemoInit(anchor, init) {
    if (!anchor || isWired(anchor)) return
    markWired(anchor)

    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver(
        (entries, obs) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return
            obs.disconnect()
            init()
          })
        },
        { rootMargin: "240px 0px" },
      )
      observer.observe(anchor)
      return
    }

    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(init, { timeout: 2000 })
    } else {
      window.setTimeout(init, 0)
    }
  }

  /* ----------------------------------------------------------------------
     Search — mode switch, query, expandable results
  ---------------------------------------------------------------------- */
  function initSearchDemo() {
    const searchButtons = Array.from(doc.querySelectorAll("[data-search-mode]"))
    const engineRow = doc.getElementById("engineRow")
    const resultsList = doc.getElementById("resultsList")
    const resultsMode = doc.getElementById("resultsMode")
    const resultsCount = doc.querySelector("[data-results-count]")
    const searchInput = doc.getElementById("searchInput")
    const searchGo = doc.getElementById("searchGo")
    const searchFoot = doc.getElementById("searchFoot")
    const searchPager = doc.getElementById("searchPager")
    const searchPrevPage = doc.getElementById("searchPrevPage")
    const searchNextPage = doc.getElementById("searchNextPage")
    const searchPageStatus = doc.getElementById("searchPageStatus")
    const consoleBody = doc.querySelector(".console-body")
    const searchAlertBtn = doc.getElementById("searchAlertBtn")
    const searchAlertStatus = doc.getElementById("searchAlertStatus")
    const searchAlertLabel = searchAlertBtn
      ? searchAlertBtn.querySelector("[data-alert-label]")
      : null

    const searchModes = {
      academic: {
        label: "ACADEMIC MODE",
        engines: ["BASE", "arXiv", "Crossref", "Semantic Scholar", "OpenAlex"],
        results: [
          {
            title: "Blue carbon sequestration in restored tidal marshes",
            source: "Journal of Environmental Management · 2024",
            tag: "BASE · open access",
            abstract:
              "Restored tidal marshes recovered 62% of their reference carbon stock within nine years, with the fastest gains in the first three growing seasons.",
            keywords: ["salt", "marsh", "restoration", "blue", "carbon", "tidal"],
          },
          {
            title: "Remote sensing of coastal vegetation recovery",
            source: "arXiv · Physics · 2023",
            tag: "arXiv · preprint",
            abstract:
              "Sentinel-2 time series separate recovering marsh vegetation from bare sediment with 0.91 AUC across 14 coastal sites.",
            keywords: ["remote", "sensing", "coastal", "vegetation", "recovery", "satellite"],
          },
          {
            title: "Long-term sediment accretion after rewetting",
            source: "OpenAlex · 2025 · 118 citations",
            tag: "OpenAlex · cited by",
            abstract:
              "Accretion rates stabilised at 4.2 mm per year a decade after rewetting, roughly matching local sea-level rise.",
            keywords: ["sediment", "accretion", "rewetting", "marsh", "sea", "level"],
          },
          {
            title: "Tidal range and salinity controls on marsh productivity",
            source: "Crossref · Estuarine Science · 2022",
            tag: "Crossref · journal",
            abstract:
              "Productivity tracked the interaction of tidal range and porewater salinity, not sediment supply alone.",
            keywords: ["tidal", "salinity", "productivity", "marsh", "turbidity"],
          },
          {
            title: "A field protocol for blue carbon stock surveys",
            source: "Semantic Scholar · 2024",
            tag: "Semantic Scholar · methods",
            abstract:
              "A reproducible core-sampling protocol with a 30 cm depth interval and QA thresholds for carbon content.",
            keywords: ["field", "protocol", "carbon", "survey", "stock"],
          },
          {
            title: "Machine learning for coastal turbidity forecasting",
            source: "arXiv · 2025",
            tag: "arXiv · preprint",
            abstract:
              "A gradient-boosted model forecasts turbidity six hours ahead from tide-gauge and weather inputs.",
            keywords: ["turbidity", "machine", "learning", "forecast", "tides", "coastal"],
          },
        ],
      },
      basic: {
        label: "BASIC MODE",
        engines: ["Mojeek", "Brave", "DuckDuckGo"],
        results: [
          {
            title: "NOAA tides & currents — station data portal",
            source: "NOAA · official data",
            tag: "Mojeek · web",
            abstract:
              "Live and historical tide predictions for 3,000+ stations, downloadable as CSV.",
            keywords: ["noaa", "tides", "tidal", "currents", "station", "data"],
          },
          {
            title: "Field methods for marsh vegetation surveys",
            source: "Research field guide · 2025",
            tag: "DuckDuckGo · web",
            abstract:
              "Quadrat layout, cover estimation, and the notes a reviewer will ask for later.",
            keywords: ["field", "methods", "marsh", "vegetation", "survey", "sampling"],
          },
          {
            title: "Open source tools for coastal data visualization",
            source: "Developer guide · GitHub",
            tag: "Brave · web",
            abstract:
              "A comparison of deck.gl, Plotly, and GeoPandas for shoreline and bathymetry work.",
            keywords: ["open", "source", "tools", "coastal", "data", "visualization"],
          },
          {
            title: "Salt marsh restoration: a practical handbook",
            source: "Coastal NGO handbook · 2024",
            tag: "Mojeek · web",
            abstract:
              "Site selection, permitting, and five years of monitoring checklists in one PDF.",
            keywords: ["salt", "marsh", "restoration", "handbook", "monitoring"],
          },
          {
            title: "How tide gauges measure sea level",
            source: "Explainer · NOAA",
            tag: "DuckDuckGo · web",
            abstract:
              "From float gauges to acoustic sensors, and why the datum matters more than the sensor.",
            keywords: ["tide", "gauge", "sea", "level", "measurement"],
          },
          {
            title: "Blue carbon project registry and methodologies",
            source: "Registry · Verra",
            tag: "Brave · web",
            abstract:
              "Approved methodologies for coastal wetland carbon projects, including baseline rules.",
            keywords: ["blue", "carbon", "project", "registry", "methodology"],
          },
        ],
      },
    }

    let searchMode = "academic"
    let searchTouched = false
    let searchTimer = null
    let searchPage = 0
    let searchPageCount = 1
    const disabledEngines = new Set()

    const SEARCH_PAGE_SIZE = 4

    function searchTerms(query) {
      return String(query || "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length > 2)
    }

    function matchResults(results, query) {
      const terms = searchTerms(query)
      if (!terms.length) return results

      return results
        .map((result) => {
          const haystack = (
            result.title +
            " " +
            result.source +
            " " +
            result.tag +
            " " +
            result.keywords.join(" ")
          ).toLowerCase()
          const score = terms.reduce((total, term) => {
            return (
              total +
              (result.keywords.indexOf(term) !== -1 ? 2 : 0) +
              (haystack.indexOf(term) !== -1 ? 1 : 0)
            )
          }, 0)
          return { result, score }
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.result)
    }

    /* Result preview modal — opens a result's abstract in a dialog without
       leaving the page. Built lazily on first open and appended to <body>. */
    let previewOverlay = null
    let previewTrigger = null
    let previewCloseBtn = null
    let previewTitle = null
    let previewMeta = null
    let previewTag = null
    let previewAbstract = null

    function ensureResultPreview() {
      if (previewOverlay) return previewOverlay

      const overlay = doc.createElement("div")
      overlay.className = "result-preview-overlay"
      overlay.hidden = true

      const dialog = doc.createElement("div")
      dialog.className = "product-window result-preview"
      dialog.setAttribute("role", "dialog")
      dialog.setAttribute("aria-modal", "true")
      dialog.setAttribute("aria-labelledby", "resultPreviewTitle")

      const bar = doc.createElement("div")
      bar.className = "window-bar"

      const lights = doc.createElement("div")
      lights.className = "traffic-lights"
      lights.setAttribute("aria-hidden", "true")
      for (let i = 0; i < 3; i += 1) lights.appendChild(doc.createElement("i"))

      const barTitle = doc.createElement("span")
      barTitle.className = "window-bar-title"
      barTitle.textContent = "result preview / coastal-resilience"

      const status = doc.createElement("span")
      status.className = "window-bar-status"
      status.innerHTML = "<i></i> LOCAL"

      const closeBtn = doc.createElement("button")
      closeBtn.type = "button"
      closeBtn.className = "result-preview-close"
      closeBtn.setAttribute("aria-label", "Close preview")
      const closeIcon = doc.createElementNS("http://www.w3.org/2000/svg", "svg")
      closeIcon.setAttribute("class", "icon icon--sm")
      const closeUse = doc.createElementNS("http://www.w3.org/2000/svg", "use")
      closeUse.setAttribute("href", "#i-close")
      closeIcon.appendChild(closeUse)
      closeBtn.appendChild(closeIcon)

      bar.append(lights, barTitle, status, closeBtn)

      const body = doc.createElement("div")
      body.className = "result-preview-body"

      const title = doc.createElement("h3")
      title.id = "resultPreviewTitle"
      title.className = "result-preview-title"

      const meta = doc.createElement("p")
      meta.className = "result-preview-meta"

      const tag = doc.createElement("span")
      tag.className = "result-tag"

      const abstract = doc.createElement("p")
      abstract.className = "result-preview-abstract"

      body.append(title, meta, tag, abstract)
      dialog.append(bar, body)
      overlay.appendChild(dialog)

      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeResultPreview()
      })
      closeBtn.addEventListener("click", closeResultPreview)
      doc.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !overlay.hidden) closeResultPreview()
      })

      doc.body.appendChild(overlay)

      previewOverlay = overlay
      previewCloseBtn = closeBtn
      previewTitle = title
      previewMeta = meta
      previewTag = tag
      previewAbstract = abstract
      return overlay
    }

    function openResultPreview(result, trigger) {
      ensureResultPreview()
      previewTitle.textContent = result.title
      previewMeta.textContent = result.source
      previewTag.textContent = result.tag
      previewAbstract.textContent = result.abstract
      previewTrigger = trigger || null
      previewOverlay.hidden = false
      doc.body.style.overflow = "hidden"
      previewCloseBtn.focus()
    }

    function closeResultPreview() {
      if (!previewOverlay || previewOverlay.hidden) return
      previewOverlay.hidden = true
      doc.body.style.overflow = ""
      if (previewTrigger) {
        previewTrigger.focus()
        previewTrigger = null
      }
    }

    function buildResultItem(result, index) {
      const button = doc.createElement("button")
      button.type = "button"
      button.className = "result-item"
      button.setAttribute("aria-haspopup", "dialog")

      const num = doc.createElement("span")
      num.className = "result-index"
      num.textContent = String(index + 1).padStart(2, "0")

      const body = doc.createElement("span")
      body.className = "result-body"
      const heading = doc.createElement("span")
      heading.className = "result-title"
      heading.textContent = result.title
      const meta = doc.createElement("span")
      meta.className = "result-meta"
      meta.textContent = result.source
      const badge = doc.createElement("span")
      badge.className = "result-tag"
      badge.textContent = result.tag
      body.append(heading, meta, badge)

      const icon = doc.createElementNS("http://www.w3.org/2000/svg", "svg")
      icon.setAttribute("class", "icon icon--xs")
      const use = doc.createElementNS("http://www.w3.org/2000/svg", "use")
      use.setAttribute("href", "#i-arrow-up-right")
      icon.appendChild(use)

      button.append(num, body, icon)
      button.addEventListener("click", () => openResultPreview(result, button))

      return button
    }

    function focusResult(index) {
      if (!resultsList) return
      const items = Array.from(resultsList.querySelectorAll(".result-item"))
      const target = items[Math.max(0, Math.min(items.length - 1, index))]
      if (target) target.focus()
    }

    function goToSearchPage(page, focusIndex) {
      searchPage = page
      renderSearchResults(searchTouched && searchInput ? searchInput.value : "")
      if (focusIndex !== null && focusIndex !== undefined) focusResult(focusIndex)
    }

    function renderSearchResults(query) {
      const config = searchModes[searchMode]
      if (!config || !resultsList) return

      const trimmed = String(query || "").trim()
      const enabledResults = config.results.filter((result) => {
        const engine = result.tag.split("·")[0].trim()
        return !disabledEngines.has(engine)
      })
      const matches = trimmed ? matchResults(enabledResults, trimmed) : enabledResults

      searchPageCount = Math.max(1, Math.ceil(matches.length / SEARCH_PAGE_SIZE))
      if (searchPage >= searchPageCount) searchPage = searchPageCount - 1
      if (searchPage < 0) searchPage = 0
      const pageStart = searchPage * SEARCH_PAGE_SIZE
      const visible = matches.slice(pageStart, pageStart + SEARCH_PAGE_SIZE)

      resultsList.textContent = ""

      if (!visible.length) {
        const empty = doc.createElement("div")
        empty.className = "results-empty"
        const title = doc.createElement("strong")
        title.textContent = "No local matches"
        const text = doc.createElement("p")
        text.textContent =
          "Nothing in the demo index for “" + trimmed + "”. Try “tides”, “carbon”, or “marsh”."
        const reset = doc.createElement("button")
        reset.type = "button"
        reset.className = "results-reset"
        reset.textContent = "Reset search"
        reset.addEventListener("click", () => {
          if (searchInput) searchInput.value = ""
          searchTouched = false
          searchPage = 0
          renderSearchResults("")
          if (searchInput) searchInput.focus()
        })
        empty.append(title, text, reset)
        resultsList.appendChild(empty)
      } else {
        visible.forEach((result, index) =>
          resultsList.appendChild(buildResultItem(result, pageStart + index)),
        )
      }

      if (resultsCount) {
        resultsCount.textContent = trimmed
          ? matches.length === 1
            ? "1 result"
            : matches.length + " results"
          : "Preview results"
      }

      const hasPages = searchPageCount > 1 && visible.length > 0
      if (searchPager) searchPager.hidden = !hasPages
      if (hasPages) {
        if (searchPrevPage) searchPrevPage.disabled = searchPage === 0
        if (searchNextPage) searchNextPage.disabled = searchPage === searchPageCount - 1
        if (searchPageStatus) {
          searchPageStatus.textContent =
            "Page " + (searchPage + 1) + " of " + searchPageCount
        }
      }

      if (searchFoot) {
        searchFoot.textContent = trimmed
          ? "Local demo index · " +
            matches.length +
            " matches for “" +
            trimmed +
            "” — page " +
            (searchPage + 1) +
            " of " +
            searchPageCount +
            ", no network requests."
          : "Preview only — results come from a small local demo index."
      }
    }

    // Arrow-key navigation: ↑/↓ (and Home/End) move between results on the
    // current page; ←/→ (and PageUp/PageDown) flip pages. Enter/Space already
    // activate each result button natively.
    if (resultsList) {
      resultsList.addEventListener("keydown", (e) => {
        const items = Array.from(resultsList.querySelectorAll(".result-item"))
        if (!items.length) return

        const current = items.indexOf(doc.activeElement)

        if (e.key === "ArrowDown") {
          e.preventDefault()
          focusResult(current < 0 ? 0 : current + 1)
        } else if (e.key === "ArrowUp") {
          e.preventDefault()
          focusResult(current < 0 ? items.length - 1 : current - 1)
        } else if (e.key === "Home") {
          e.preventDefault()
          focusResult(0)
        } else if (e.key === "End") {
          e.preventDefault()
          focusResult(items.length - 1)
        } else if (
          (e.key === "ArrowRight" || e.key === "PageDown") &&
          searchPage < searchPageCount - 1
        ) {
          e.preventDefault()
          goToSearchPage(searchPage + 1, 0)
        } else if ((e.key === "ArrowLeft" || e.key === "PageUp") && searchPage > 0) {
          e.preventDefault()
          goToSearchPage(searchPage - 1, SEARCH_PAGE_SIZE - 1)
        }
      })
    }

    if (searchPrevPage) {
      searchPrevPage.addEventListener("click", () => {
        if (searchPage > 0) goToSearchPage(searchPage - 1)
      })
    }
    if (searchNextPage) {
      searchNextPage.addEventListener("click", () => {
        goToSearchPage(searchPage + 1)
      })
    }

    function renderSearchMode(mode) {
      const config = searchModes[mode]
      if (!config) return
      searchMode = mode

      searchButtons.forEach((button) => {
        const active = button.getAttribute("data-search-mode") === mode
        button.classList.toggle("is-active", active)
        button.setAttribute("aria-pressed", String(active))
      })

      if (resultsMode) resultsMode.textContent = config.label

      disabledEngines.clear()

      if (engineRow) {
        engineRow.textContent = ""
        config.engines.forEach((engine) => {
          const chip = doc.createElement("button")
          chip.type = "button"
          chip.className = "engine-chip is-active"
          chip.dataset.engine = engine
          chip.setAttribute("aria-pressed", "true")
          chip.textContent = engine
          chip.addEventListener("click", () => {
            const enabled = chip.getAttribute("aria-pressed") === "true"
            chip.setAttribute("aria-pressed", String(!enabled))
            chip.classList.toggle("is-active", !enabled)
            chip.classList.toggle("is-disabled", enabled)
            if (enabled) {
              disabledEngines.add(engine)
            } else {
              disabledEngines.delete(engine)
            }
            searchPage = 0
            renderSearchResults(searchTouched && searchInput ? searchInput.value : "")
          })
          engineRow.appendChild(chip)
        })
      }

      searchPage = 0
      renderSearchResults(searchTouched && searchInput ? searchInput.value : "")
      syncSearchAlertButton()
    }

    function runSearch() {
      if (!searchInput) return
      searchTouched = true
      const query = searchInput.value.trim()

      if (searchTimer) window.clearTimeout(searchTimer)
      if (consoleBody) consoleBody.classList.add("is-searching")
      if (resultsCount) resultsCount.textContent = "Searching local index…"
      if (searchGo) searchGo.disabled = true

      searchTimer = window.setTimeout(
        () => {
          searchTimer = null
          if (consoleBody) consoleBody.classList.remove("is-searching")
          if (searchGo) searchGo.disabled = false
          searchPage = 0
          renderSearchResults(query)
        },
        reducedMotion ? 0 : 360,
      )
    }

    searchButtons.forEach((button) => {
      button.addEventListener("click", () =>
        renderSearchMode(button.getAttribute("data-search-mode")),
      )
    })

    if (searchInput) {
      searchInput.addEventListener("input", () => {
        searchTouched = true
        if (searchTimer) window.clearTimeout(searchTimer)
        if (consoleBody) consoleBody.classList.remove("is-searching")
        if (searchGo) searchGo.disabled = false
        searchPage = 0
        renderSearchResults(searchInput.value)
        syncSearchAlertButton()
      })
      searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault()
          runSearch()
        } else if (e.key === "ArrowDown") {
          // Jump from the query field into the result list.
          const first = resultsList
            ? resultsList.querySelector(".result-item")
            : null
          if (first) {
            e.preventDefault()
            first.focus()
          }
        }
      })
    }

    if (searchGo) searchGo.addEventListener("click", runSearch)

    /* ------------------------------------------------------------------
       Search alerts — persist recurring-query email alerts in
       localStorage. Demo-only: there is no backend mailer on the
       marketing page, so alerts live on this device.
    ------------------------------------------------------------------ */
    const SEARCH_ALERTS_STORAGE_KEY = "spindle.search-alerts"

    function loadSearchAlerts() {
      try {
        const raw = window.localStorage.getItem(SEARCH_ALERTS_STORAGE_KEY)
        const parsed = raw ? JSON.parse(raw) : []
        return Array.isArray(parsed) ? parsed : []
      } catch {
        return []
      }
    }

    function saveSearchAlerts(alerts) {
      try {
        window.localStorage.setItem(SEARCH_ALERTS_STORAGE_KEY, JSON.stringify(alerts))
      } catch {
        // Storage unavailable (private mode, quota) — the alert still works
        // for this visit via the in-memory list below.
      }
    }

    function findSearchAlert(alerts, query, mode) {
      const needle = query.toLowerCase()
      return alerts.findIndex(
        (alert) =>
          alert &&
          String(alert.query || "").toLowerCase() === needle &&
          String(alert.mode || "academic") === mode,
      )
    }

    // Unlike currentSearchQuery() above (which gates on searchTouched for
    // the results pager), the alert button always reads the live input so a
    // default query can be alerted on without typing first.
    function currentAlertQuery() {
      return searchInput ? searchInput.value.trim() : ""
    }

    function syncSearchAlertButton() {
      if (!searchAlertBtn) return
      const query = currentAlertQuery()
      const active = Boolean(query) && findSearchAlert(loadSearchAlerts(), query, searchMode) !== -1
      searchAlertBtn.classList.toggle("is-active", active)
      searchAlertBtn.setAttribute("aria-pressed", String(active))
      if (searchAlertLabel) {
        searchAlertLabel.textContent = active ? "Alert set — remove" : "Create search alert"
      }
    }

    function setSearchAlertStatus(message) {
      if (searchAlertStatus) searchAlertStatus.textContent = message
    }

    if (searchAlertBtn) {
      searchAlertBtn.addEventListener("click", () => {
        const query = currentAlertQuery()
        if (!query) {
          setSearchAlertStatus("Type a query first to create an alert.")
          if (searchInput) searchInput.focus()
          return
        }

        const alerts = loadSearchAlerts()
        const existing = findSearchAlert(alerts, query, searchMode)

        if (existing !== -1) {
          alerts.splice(existing, 1)
          saveSearchAlerts(alerts)
          setSearchAlertStatus(
            "Alert removed for “" + query + "” (" + searchModes[searchMode].label.toLowerCase() + ").",
          )
        } else {
          alerts.push({
            query: query,
            mode: searchMode,
            createdAt: new Date().toISOString(),
          })
          saveSearchAlerts(alerts)
          setSearchAlertStatus(
            "Email alert set for “" + query + "” — saved on this device.",
          )
        }

        syncSearchAlertButton()
      })
    }

    renderSearchMode("academic")
    syncSearchAlertButton()
  }

  /* ----------------------------------------------------------------------
     Files — filter, upload, create, selectable rows with inline preview
  ---------------------------------------------------------------------- */
  function initFileManager() {
    const fileList = doc.getElementById("fileList")
    const fileSearch = doc.getElementById("fileSearch")
    const fmCount = doc.getElementById("fmCount")
    const fmUpload = doc.getElementById("fmUpload")
    const fmUploadInput = doc.getElementById("fmUploadInput")
    const previewFormat = doc.getElementById("previewFormat")
    const previewBody = doc.getElementById("previewBody")

    const previewMarkup = {
      csv: '<div class="preview-table"><span>site_id</span><span>salinity</span><span>turbidity</span><span>date</span><span>A-01</span><span>28.4</span><span>3.1</span><span>06/02</span><span>A-02</span><span>27.9</span><span>3.4</span><span>06/02</span></div>',
      parquet:
        '<div class="preview-table"><span>site</span><span>rows</span><span>cols</span><span>size</span><span>A-01</span><span>12,044</span><span>14</span><span>22 MB</span><span>B-03</span><span>9,812</span><span>14</span><span>18 MB</span></div>',
      ipynb: '<div class="preview-lines"><i></i><i></i><i></i><i></i><i></i></div>',
      pdf: '<div class="preview-lines"><i></i><i></i><i></i><i></i><i></i></div>',
      image: '<div class="preview-image"></div>',
      file: '<div class="preview-lines"><i></i><i></i><i></i><i></i></div>',
      folder:
        '<div class="preview-folder"><svg class="icon icon--sm"><use href="#i-folder"/></svg><span>Empty folder</span></div>',
    }

    const fileTypes = {
      csv: {
        ext: "CSV",
        cls: "file-ext--csv",
        type: "Comma-separated values",
        format: "CSV · tabular",
        kind: "csv",
      },
      parquet: {
        ext: "PQ",
        cls: "file-ext--parquet",
        type: "Apache Parquet",
        format: "Parquet · columnar",
        kind: "parquet",
      },
      ipynb: {
        ext: "IPY",
        cls: "file-ext--ipynb",
        type: "Jupyter Notebook",
        format: "Jupyter notebook",
        kind: "ipynb",
      },
      pdf: {
        ext: "PDF",
        cls: "file-ext--pdf",
        type: "Portable Document Format",
        format: "PDF · document",
        kind: "pdf",
      },
      tif: {
        ext: "TIF",
        cls: "file-ext--tif",
        type: "GeoTIFF image",
        format: "TIFF · raster image",
        kind: "image",
      },
      png: {
        ext: "IMG",
        cls: "file-ext--tif",
        type: "Image",
        format: "Image · raster",
        kind: "image",
      },
      jpg: {
        ext: "IMG",
        cls: "file-ext--tif",
        type: "Image",
        format: "Image · raster",
        kind: "image",
      },
      json: {
        ext: "JSON",
        cls: "file-ext--other",
        type: "JSON document",
        format: "JSON · data",
        kind: "file",
      },
      md: {
        ext: "MD",
        cls: "file-ext--other",
        type: "Markdown",
        format: "Markdown · text",
        kind: "file",
      },
      txt: {
        ext: "TXT",
        cls: "file-ext--other",
        type: "Plain text",
        format: "Text · plain",
        kind: "file",
      },
      zip: {
        ext: "ZIP",
        cls: "file-ext--other",
        type: "Archive",
        format: "ZIP · archive",
        kind: "file",
      },
      folder: {
        ext: "DIR",
        cls: "file-ext--folder",
        type: "Folder",
        format: "Folder",
        kind: "folder",
      },
    }

    let totalFiles = 128
    let createdFiles = 0

    function describeFile(name) {
      const dot = name.lastIndexOf(".")
      const ext = dot > -1 ? name.slice(dot + 1).toLowerCase() : ""
      const known = fileTypes[ext]
      if (known) return known

      const label = ext ? ext.slice(0, 4).toUpperCase() : "FILE"
      return {
        ext: label,
        cls: "file-ext--other",
        type: ext ? label + " file" : "File",
        format: ext ? label + " · file" : "File",
        kind: "file",
      }
    }

    function formatBytes(bytes) {
      if (!bytes && bytes !== 0) return "—"
      if (bytes < 1024) return bytes + " B"
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB"
      if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MB"
      return (bytes / 1024 / 1024 / 1024).toFixed(1) + " GB"
    }

    function renderPreview(name, format, meta, kind) {
      if (!previewBody) return
      previewBody.innerHTML =
        '<div class="preview-title"></div>' +
        (previewMarkup[kind] || previewMarkup.file) +
        '<div class="preview-meta"></div>'

      const nameEl = previewBody.querySelector(".preview-title")
      const metaEl = previewBody.querySelector(".preview-meta")
      if (nameEl) nameEl.textContent = name || "File"
      if (metaEl) metaEl.textContent = meta || ""
      if (previewFormat) previewFormat.textContent = format || "Detected format"
    }

    function selectFile(row) {
      if (!fileList || !row) return
      Array.from(fileList.querySelectorAll(".fm-row")).forEach((item) => {
        item.classList.toggle("is-selected", item === row)
      })
      renderPreview(
        row.getAttribute("data-name"),
        row.getAttribute("data-format"),
        row.getAttribute("data-meta"),
        row.getAttribute("data-kind"),
      )
    }

    function createFileRow(name, info, size, date) {
      const row = doc.createElement("button")
      row.type = "button"
      row.className = "fm-row"
      row.setAttribute("data-name", name)
      row.setAttribute("data-format", info.format)
      row.setAttribute("data-kind", info.kind)
      row.setAttribute("data-meta", size + " · modified " + date)

      const nameCell = doc.createElement("span")
      nameCell.className = "fm-name"
      const badge = doc.createElement("span")
      badge.className = "file-ext " + info.cls
      badge.textContent = info.ext
      nameCell.append(badge, doc.createTextNode(" " + name))

      const typeCell = doc.createElement("span")
      typeCell.className = "fm-type"
      typeCell.textContent = info.type

      const dateCell = doc.createElement("span")
      dateCell.className = "fm-date"
      dateCell.textContent = date

      const sizeCell = doc.createElement("span")
      sizeCell.className = "fm-size"
      sizeCell.textContent = size

      row.append(nameCell, typeCell, dateCell, sizeCell)
      return row
    }

    function applyFileFilter() {
      if (!fileList) return
      const query = fileSearch ? fileSearch.value.trim().toLowerCase() : ""
      const rows = Array.from(fileList.querySelectorAll(".fm-row"))
      let visible = 0

      rows.forEach((row) => {
        const haystack = (
          row.getAttribute("data-name") +
          " " +
          row.getAttribute("data-format")
        ).toLowerCase()
        const match = !query || haystack.indexOf(query) !== -1
        row.hidden = !match
        if (match) visible += 1
      })

      const empty = fileList.querySelector(".fm-empty")
      if (empty) {
        empty.hidden = !(query && visible === 0)
        const label = empty.querySelector("span")
        if (label)
          label.textContent =
            "No files match “" + (fileSearch ? fileSearch.value.trim() : "") + "”."
      }

      if (fmCount) {
        if (query) {
          fmCount.textContent = visible + (visible === 1 ? " match" : " matches")
        } else {
          fmCount.textContent = totalFiles + " items"
        }
      }
    }

    function addFile(name, size, date) {
      if (!fileList) return
      const info = describeFile(name)
      const row = createFileRow(name, info, size, date)
      fileList.insertBefore(row, fileList.querySelector(".fm-empty"))
      totalFiles += 1
      if (fileSearch) fileSearch.value = ""
      applyFileFilter()
      selectFile(row)
      row.scrollIntoView({ block: "nearest" })
    }

    function addFolder() {
      if (!fileList) return
      createdFiles += 1
      const row = createFileRow(
        "untitled folder " + createdFiles,
        fileTypes.folder,
        "—",
        "just now",
      )
      fileList.insertBefore(row, fileList.querySelector(".fm-empty"))
      totalFiles += 1
      if (fileSearch) fileSearch.value = ""
      applyFileFilter()
      selectFile(row)
      row.scrollIntoView({ block: "nearest" })
    }

    function addNotebook() {
      if (!fileList) return
      createdFiles += 1
      addFile("untitled-" + createdFiles + ".ipynb", "4 KB", "just now")
    }

    if (fileList) {
      const empty = doc.createElement("p")
      empty.className = "fm-empty"
      empty.hidden = true
      const emptyLabel = doc.createElement("span")
      emptyLabel.textContent = "No files match this search."
      empty.appendChild(emptyLabel)
      fileList.appendChild(empty)

      fileList.addEventListener("click", (e) => {
        const row = e.target.closest(".fm-row")
        if (row) selectFile(row)
      })
    }

    if (fileSearch) fileSearch.addEventListener("input", applyFileFilter)

    // Upload functionality disabled - button is for demo only
    // if (fmUpload && fmUploadInput) {
    //   fmUpload.addEventListener('click', () => fmUploadInput.click());
    //   fmUploadInput.addEventListener('change', () => {
    //     Array.from(fmUploadInput.files || []).forEach((file) => {
    //       addFile(file.name, formatBytes(file.size), 'just now');
    //     });
    //     fmUploadInput.value = '';
    //   });
    // }

    // "New" menu items live in the React island; delegate their actions here.
    fmActionHandler = (action) => {
      if (action === "upload") {
        // Upload disabled for demo
        return
      } else if (action === "folder") {
        addFolder()
      } else if (action === "notebook") {
        addNotebook()
      }
    }
    bindFmActions()
  }

  /* ----------------------------------------------------------------------
     Agent — example requests update the run trace
  ---------------------------------------------------------------------- */
  function initAgentExamples() {
    const agentPrompt = doc.getElementById("agentPrompt")
    const agentTrace = doc.getElementById("agentTrace")
    const suggestions = Array.from(doc.querySelectorAll("[data-agent-example]"))

    const agentExamples = {
      refactor: {
        prompt: "Refactor the data pipeline and update results.csv with the new columns.",
        steps: [
          ["Read 12 files in /data and /notebooks", "0.4s", "done"],
          ["Split cleaning logic into clean_data.py", "1.2s", "done"],
          ["Updating results.csv — added 3 columns", "2.8s", "running"],
          ["Write a short summary to project log", "—", ""],
        ],
      },
      spreadsheet: {
        prompt: "Edit the spreadsheet: normalize the site names and add a salinity column.",
        steps: [
          ["Open results.xlsx and read 3 sheets", "0.6s", "done"],
          ["Normalize 48 site names to site_id format", "1.7s", "done"],
          ["Adding salinity column from tidal-2026.csv", "2.4s", "running"],
          ["Save a review copy before replacing original", "—", ""],
        ],
      },
      summarize: {
        prompt: "Summarize the 6 newest sources into a short literature note.",
        steps: [
          ["Collect 6 PDFs from Search and /sources", "0.3s", "done"],
          ["Extract abstracts and citation details", "1.4s", "done"],
          ["Drafting themes in literature-note.md", "2.1s", "running"],
          ["Attach source links to each claim", "—", ""],
        ],
      },
      moveFiles: {
        prompt:
          "Move the 2026 field data into /data/2026, rename the exports, and fix every notebook path.",
        steps: [
          ["Scan 34 files and 2 notebooks for references", "0.5s", "done"],
          ["Create /data/2026 and move 12 files into it", "1.6s", "done"],
          ["Rewriting 8 paths in analysis.ipynb", "2.9s", "running"],
          ["Report the changes to the project log", "—", ""],
        ],
      },
    }

    let agentTyping = null

    function typeAgentPrompt(text) {
      if (!agentPrompt) return
      if (agentTyping) window.clearInterval(agentTyping)
      if (reducedMotion) {
        agentPrompt.textContent = text
        return
      }
      agentPrompt.textContent = ""
      let i = 0
      agentTyping = window.setInterval(() => {
        agentPrompt.textContent += text.charAt(i)
        i += 1
        if (i >= text.length) {
          window.clearInterval(agentTyping)
          agentTyping = null
        }
      }, 12)
    }

    function renderAgentTrace(steps) {
      if (!agentTrace) return
      agentTrace.textContent = ""

      steps.forEach(([text, time, state]) => {
        const row = doc.createElement("div")
        row.className =
          "trace-row" + (state === "done" ? " is-done" : state === "running" ? " is-running" : "")

        const icon = doc.createElement("span")
        icon.className = "trace-icon" + (state === "" ? " trace-icon--empty" : "")
        if (state === "done") {
          icon.innerHTML = '<svg class="icon icon--xs"><use href="#i-check"/></svg>'
        } else if (state === "running") {
          const pulse = doc.createElement("span")
          pulse.className = "trace-pulse"
          icon.appendChild(pulse)
        }

        const label = doc.createElement("span")
        const parts = text.split(/(`[^`]+`)/g)
        parts.forEach((part) => {
          if (part.startsWith("`") && part.endsWith("`")) {
            const strong = doc.createElement("strong")
            strong.textContent = part.slice(1, -1)
            label.appendChild(strong)
          } else {
            label.appendChild(doc.createTextNode(part))
          }
        })

        const timeEl = doc.createElement("time")
        timeEl.textContent = time

        row.append(icon, label, timeEl)
        agentTrace.appendChild(row)
      })
    }

    suggestions.forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.getAttribute("data-agent-example")
        const example = agentExamples[key]
        if (!example) return
        suggestions.forEach((item) => item.classList.toggle("is-active", item === button))
        const formatted = example.steps.map(([text, time, state]) => [
          text.replace(
            /(\/data|\/notebooks|results\.xlsx|results\.csv|clean_data\.py|literature-note\.md)/g,
            "`$1`",
          ),
          time,
          state,
        ])
        typeAgentPrompt(example.prompt)
        renderAgentTrace(formatted)
      })
    })
  }

  /* ----------------------------------------------------------------------
     Chat — channels, direct messages, composer, Anonymous mode
  ---------------------------------------------------------------------- */
  function initChat() {
    // Homepage-only: /collaboration reuses #chatMessages/#anonToggle for its
    // own collaboration.js demo and has no #chatComposer — bail before
    // attaching listeners that would fight it.
    if (!doc.getElementById("chatComposer")) return

    const anonToggle = doc.getElementById("anonToggle")
    const anonStatus = doc.getElementById("anonStatus")
    const chatRoute = doc.getElementById("chatRoute")
    const routeStrip = doc.getElementById("routeStrip")
    const chatMessages = doc.getElementById("chatMessages")
    const chatComposer = doc.getElementById("chatComposer")
    const chatInput = doc.getElementById("chatInput")
    const chatChannelName = doc.getElementById("chatChannelName")
    const chatHash = doc.getElementById("chatHash")
    const chatChannelButtons = Array.from(doc.querySelectorAll("[data-chat-channel]"))

    const chatThreads = {
      "field-notes": {
        name: "field-notes",
        route: "8 members · project channel",
        messages: [
          [
            "MR",
            "a",
            "Mara",
            "09:14",
            "New survey batch is in /data. The viewer detected it as Parquet right away.",
          ],
          [
            "JL",
            "b",
            "Jules",
            "09:18",
            "Nice. I kicked off the cron refresh and the lab still has the kernel from yesterday.",
          ],
        ],
      },
      "data-cleaning": {
        name: "data-cleaning",
        route: "5 members · project channel",
        messages: [
          [
            "TP",
            "b",
            "Theo",
            "08:52",
            "The salinity column has three different decimal formats. Cleaning script is in /notebooks.",
          ],
          [
            "MR",
            "a",
            "Mara",
            "09:03",
            "Run it on the review copy first, please. I want the row counts before and after.",
          ],
          [
            "TP",
            "b",
            "Theo",
            "09:07",
            "Row count is identical. Only the formatting changed — diff attached in the project log.",
          ],
        ],
      },
      writing: {
        name: "writing",
        route: "4 members · project channel",
        messages: [
          [
            "JL",
            "b",
            "Jules",
            "10:21",
            "Draft methods section is up. I linked the core-sampling protocol as a footnote.",
          ],
          [
            "MR",
            "a",
            "Mara",
            "10:34",
            "Reading now. Can we move the sea-level caveat into the results?",
          ],
          [
            "JL",
            "b",
            "Jules",
            "10:40",
            "Yes — I will fold it into the accretion paragraph this afternoon.",
          ],
        ],
      },
      random: {
        name: "random",
        route: "8 members · project channel",
        messages: [
          [
            "TP",
            "b",
            "Theo",
            "16:02",
            "Found a tide chart from 1968 in the archive. The annotations are beautiful.",
          ],
          ["MR", "a", "Mara", "16:09", "Add it to /sources — that belongs in the intro."],
        ],
      },
      mara: {
        name: "Mara",
        route: "Direct message · online",
        dm: true,
        messages: [
          [
            "MR",
            "a",
            "Mara",
            "11:02",
            "Can you review the new columns before the 14:00 lab meeting?",
          ],
          [
            "MR",
            "a",
            "Mara",
            "11:03",
            "No rush if the kernel is still running — just flag anything odd.",
          ],
        ],
      },
      theo: {
        name: "Theo",
        route: "Direct message · away",
        dm: true,
        messages: [
          [
            "TP",
            "b",
            "Theo",
            "09:41",
            "Kernel is free now. I re-ran the notebook after the column fix.",
          ],
          [
            "TP",
            "b",
            "Theo",
            "09:42",
            "Results are in output/clean.csv if you want to check them.",
          ],
        ],
      },
    }

    let activeThread = "field-notes"
    let anonEnabled = false

    function buildChatMessage(message) {
      const row = doc.createElement("div")
      row.className = "chat-msg" + (message.anon ? " chat-msg--anon" : "")

      const avatar = doc.createElement("span")
      avatar.className =
        "mini-avatar " +
        (message.anon ? "mini-avatar--anon" : "mini-avatar--" + (message.avatar || "a"))
      if (message.anon) {
        avatar.innerHTML = '<svg class="icon icon--xs"><use href="#i-shield"/></svg>'
      } else {
        avatar.textContent = message.initials
      }

      const body = doc.createElement("div")
      const head = doc.createElement("strong")
      head.textContent = message.name + " "
      const time = doc.createElement("time")
      time.textContent = message.time
      head.appendChild(time)
      const text = doc.createElement("p")
      text.textContent = message.text
      body.append(head, text)

      row.append(avatar, body)
      return row
    }

    function updateChatRoute() {
      const thread = chatThreads[activeThread]
      if (!chatRoute || !thread) return
      chatRoute.textContent = anonEnabled ? "Anonymous · pseudonymous" : thread.route
    }

    function renderChatThread(key) {
      const thread = chatThreads[key]
      if (!thread || !chatMessages || !chatComposer) return
      activeThread = key

      chatChannelButtons.forEach((button) => {
        const active = button.getAttribute("data-chat-channel") === key
        button.classList.toggle("is-active", active)
        if (active) button.setAttribute("aria-current", "true")
        else button.removeAttribute("aria-current")
      })

      if (chatChannelName) chatChannelName.textContent = thread.name
      if (chatHash) chatHash.hidden = Boolean(thread.dm)
      updateChatRoute()

      Array.from(chatMessages.children).forEach((child) => {
        if (child !== chatComposer) child.remove()
      })

      thread.messages.forEach(([initials, avatar, name, time, text]) => {
        chatMessages.insertBefore(
          buildChatMessage({ initials, avatar, name, time, text, anon: avatar === "anon" }),
          chatComposer,
        )
      })

      if (anonEnabled) {
        chatMessages.insertBefore(
          buildChatMessage({
            anon: true,
            name: "Anonymous",
            time: "now",
            text: "Posting anonymously in this thread…",
          }),
          chatComposer,
        )
      }

      const target = thread.dm ? thread.name : "#" + thread.name
      if (chatInput) {
        chatInput.placeholder = "Message " + target
        chatInput.setAttribute("aria-label", "Message " + target)
      }

      chatMessages.scrollTop = chatMessages.scrollHeight
    }

    chatChannelButtons.forEach((button) => {
      button.addEventListener("click", () =>
        renderChatThread(button.getAttribute("data-chat-channel")),
      )
    })

    if (chatComposer && chatInput) {
      chatComposer.addEventListener("submit", (e) => {
        e.preventDefault()
        const text = chatInput.value.trim()
        if (!text) {
          chatInput.focus()
          return
        }

        const thread = chatThreads[activeThread]
        const now = new Date()
        const time =
          String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0")

        if (anonEnabled) {
          thread.messages.push(["", "anon", "Anonymous", time, text])
        } else {
          thread.messages.push(["MR", "a", "Mara (you)", time, text])
        }

        chatInput.value = ""
        renderChatThread(activeThread)
        chatInput.focus()
      })
    }

    function setAnonymous(enabled) {
      anonEnabled = enabled
      // The click handler reads aria-pressed as its source of truth, so the
      // attribute must be written back here — otherwise the toggle can be
      // switched on but never off. Same pattern as legacy/script.js and
      // collaboration.js.
      if (anonToggle) anonToggle.setAttribute("aria-pressed", String(enabled))
      // The toggle state is exposed by the inner Switch; the wrapper div must
      // not carry aria-pressed (invalid on a role-less element).
      if (anonStatus)
        anonStatus.textContent = enabled ? "On · pseudonymous display" : "Off · normal project chat"
      if (routeStrip) routeStrip.classList.toggle("is-live", enabled)
      updateChatRoute()
      renderChatThread(activeThread)
    }

    if (anonToggle) {
      anonToggle.addEventListener("click", () =>
        setAnonymous(anonToggle.getAttribute("aria-pressed") !== "true"),
      )
    }

    renderChatThread("field-notes")
  }

  /* ----------------------------------------------------------------------
     Page demos — lazy wiring for client-side navigation

     initSite runs once when the (site) layout mounts, but page markup is
     swapped in afterwards by client-side navigations (and PageTransition can
     replace subtrees during transitions). scanAdded() wires any demo root
     that hasn't been initialized yet; a MutationObserver feeds it every added
     node, and per-element wiring marks keep each root single-initialized.
  ---------------------------------------------------------------------- */
  const DEMO_SCAN_SELECTOR =
    "[data-hero-tab],[data-lab-tab],[data-vscode-file],.counter," +
    "#resultsList,#fileList,#agentTrace,#chatMessages"

  function wireDemoAnchor(el) {
    if (el.id === "resultsList") scheduleDemoInit(el, initSearchDemo)
    else if (el.id === "fileList") scheduleDemoInit(el, initFileManager)
    else if (el.id === "agentTrace") scheduleDemoInit(el, initAgentExamples)
    // The chat demo is homepage-only: /collaboration reuses #chatMessages (and
    // #anonToggle) for its own collaboration.js demo, which uses #chatForm
    // instead of #chatComposer — requiring the composer keeps site.js from
    // clobbering that page's live thread.
    else if (el.id === "chatMessages" && doc.getElementById("chatComposer"))
      scheduleDemoInit(el, initChat)
  }

  function animateCounter(el) {
    const target = parseFloat(el.getAttribute("data-target"))
    const decimals = parseInt(el.getAttribute("data-decimals") || "0", 10)
    const duration = 1400
    const start = performance.now()

    function frame(now) {
      const progress = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 4)
      el.textContent = (target * eased).toFixed(decimals)
      if (progress < 1) window.requestAnimationFrame(frame)
      else el.textContent = target.toFixed(decimals)
    }
    window.requestAnimationFrame(frame)
  }

  let counterObserver = null

  function observeCounter(el) {
    if (isWired(el)) return
    markWired(el)

    if (reducedMotion || !("IntersectionObserver" in window)) {
      el.textContent = parseFloat(el.getAttribute("data-target")).toFixed(
        parseInt(el.getAttribute("data-decimals") || "0", 10),
      )
      return
    }

    if (!counterObserver) {
      counterObserver = new IntersectionObserver(
        (entries, observer) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return
            animateCounter(entry.target)
            observer.unobserve(entry.target)
          })
        },
        { threshold: 0.6 },
      )
    }
    counterObserver.observe(el)
  }

  function scanAdded(node) {
    if (!(node instanceof Element)) return

    wireMobileNav()

    const targets = []
    if (node.matches(DEMO_SCAN_SELECTOR)) targets.push(node)
    node.querySelectorAll(DEMO_SCAN_SELECTOR).forEach((el) => targets.push(el))

    targets.forEach((el) => {
      if (el.hasAttribute("data-hero-tab")) wireHeroTabs()
      else if (el.hasAttribute("data-lab-tab")) wireLabTabs()
      else if (el.hasAttribute("data-vscode-file")) wireVscodeFiles()
      else if (el.classList.contains("counter")) observeCounter(el)
      else wireDemoAnchor(el)
    })
  }

  wireMobileNav()
  scanAdded(doc.body)

  const demoMutations = new MutationObserver((records) => {
    records.forEach((record) => {
      record.addedNodes.forEach(scanAdded)
    })
  })
  demoMutations.observe(doc.body, { childList: true, subtree: true })
}
