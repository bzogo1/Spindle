/* ==========================================================================
   SPINDLE — The Lab page interactions
   Interface previews only: no kernels or databases are shipped with this page.
   ========================================================================== */

/* Runs after hydration from a client component. */
let started = false

export function initLab() {
  if (started) return
  started = true

  ;("use strict")

  const doc = document
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms))
  const $ = (selector, root) => (root || doc).querySelector(selector)
  const $$ = (selector, root) => Array.from((root || doc).querySelectorAll(selector))

  /* ----------------------------------------------------------------------
     Restart CSS animations when a section scrolls into view, so the motion
     is seen where it happens rather than only on first paint.
     ---------------------------------------------------------------------- */

  const animatedSections = $$(".lab-section")

  function restartAnimations(root) {
    if (reducedMotion) return
    $$(
      '[style*="animation"], .r-line, .r-dots circle, .py-plot-line, .runner-logs > div, .canvas-note',
      root,
    ).forEach((el) => {
      const previous = el.style.animation
      el.style.animation = "none"
      void el.offsetWidth
      el.style.animation = previous
    })
  }

  if ("IntersectionObserver" in window && !reducedMotion) {
    const animationObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return
          restartAnimations(entry.target)
          observer.unobserve(entry.target)
        })
      },
      { threshold: 0.18 },
    )
    animatedSections.forEach((section) => animationObserver.observe(section))
  }

  /* ----------------------------------------------------------------------
     Tool bar — active section
     ---------------------------------------------------------------------- */

  const toolLinks = $$(".lab-tool-link")

  function setActiveTool(id) {
    toolLinks.forEach((link) => {
      const active = link.getAttribute("href") === "#" + id
      link.classList.toggle("is-active", active)
      if (active) link.setAttribute("aria-current", "true")
      else link.removeAttribute("aria-current")
    })
  }

  toolLinks.forEach((link) =>
    link.addEventListener("click", () => {
      setActiveTool(link.getAttribute("href").slice(1))
    }),
  )

  if ("IntersectionObserver" in window) {
    const spy = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActiveTool(entry.target.id)
        })
      },
      { rootMargin: "-42% 0px -52% 0px" },
    )
    animatedSections.forEach((section) => spy.observe(section))
  }

  /* ----------------------------------------------------------------------
     01 — Python notebook: run-all preview
     ---------------------------------------------------------------------- */

  const pyRun = $("[data-py-run]")
  const pyCells = $$(".py-cell")
  const pyOut = $("#pyOut")

  if (pyRun && pyOut) {
    let pyToken = 0
    pyRun.addEventListener("click", async () => {
      const token = ++pyToken
      pyRun.disabled = true
      pyRun.innerHTML = '<span class="stage-caret"></span> Running…'
      pyCells.forEach((cell) => cell.classList.remove("is-running"))

      for (let i = 0; i < pyCells.length; i++) {
        if (token !== pyToken) return
        pyCells[i].classList.add("is-running")
        await sleep(reducedMotion ? 40 : 420)
      }

      pyCells.forEach((cell) => cell.classList.remove("is-running"))
      // LiveRowCount (React) owns #pyOut — tell it to freeze on the final
      // message instead of clobbering its DOM with textContent.
      window.dispatchEvent(
        new CustomEvent("spindle:live-row-count-done", {
          detail: "Done · 48,102 rows × 14 columns · 3 cells in 1.3s",
        }),
      )
      pyRun.disabled = false
      pyRun.innerHTML = '<svg class="icon icon--xs"><use href="#i-play"/></svg> Run all'
    })
  }

  /* ----------------------------------------------------------------------
     02 — R console: replay the session on click
     ---------------------------------------------------------------------- */

  const rConsole = $("#rConsole")
  if (rConsole) {
    rConsole.title = "Click to replay this R session"
    rConsole.style.cursor = "pointer"
    rConsole.addEventListener("click", () => {
      if (reducedMotion) return
      rConsole.classList.remove("is-rerun")
      void rConsole.offsetWidth
      rConsole.classList.add("is-rerun")
      window.setTimeout(() => rConsole.classList.remove("is-rerun"), 1900)
    })
  }

  /* ----------------------------------------------------------------------
     03 — Script runner: pick a script and stream a fake run
     ---------------------------------------------------------------------- */

  const runnerItems = $$(".runner-item")
  const runnerFile = $("#runnerFile")
  const runnerLogs = $("#runnerLogs")
  const runnerProgress = $("#runnerProgress")
  const runnerStatus = $("#runnerStatus")
  const runnerTime = $("#runnerTime")
  const runnerRun = $("[data-runner-run]")

  const runSteps = {
    "clean_data.py": [
      [0.0, "Reading <strong>data/tidal-2026.csv</strong>"],
      [0.6, "Dropping 118 rows with null salinity"],
      [1.1, "Normalising 4 site identifiers"],
      [1.6, "✓ Wrote <strong>output/clean.csv</strong>"],
      [1.9, "✓ Run complete · 48,102 rows"],
    ],
    "tides_sync.R": [
      [0.0, "Loading pinned R 4.4 environment"],
      [0.5, "Fetching tide gauges 2026-11"],
      [1.0, "✓ 17 stations reconciled"],
      [1.5, "✓ Wrote <strong>data/tides.parquet</strong>"],
    ],
    "export.sh": [
      [0.0, "Preparing export bundle"],
      [0.4, "Compressing 128 project files"],
      [1.0, "✓ Archive verified · 42.8 MB"],
    ],
  }

  let runnerToken = 0

  function addRunnerLog(text, time) {
    if (!runnerLogs) return
    const row = doc.createElement("div")
    const stamp = doc.createElement("span")
    stamp.className = "log-time"
    stamp.textContent = time
    const label = doc.createElement("span")
    label.innerHTML = text
    row.append(stamp, label)
    runnerLogs.appendChild(row)
    runnerLogs.scrollTop = runnerLogs.scrollHeight
  }

  async function runScript() {
    if (!runnerFile || !runnerProgress) return
    const token = ++runnerToken
    const name = runnerFile.textContent
    const steps = runSteps[name] || runSteps["clean_data.py"]
    const duration = reducedMotion ? 0 : 2.1

    runnerLogs.innerHTML = ""
    runnerProgress.style.transform = "scaleX(0)"
    runnerStatus.textContent = "Running " + name
    runnerTime.textContent = "0.0s"
    runnerRun.disabled = true

    const start = performance.now()
    const timer = window.setInterval(() => {
      if (token !== runnerToken) {
        window.clearInterval(timer)
        return
      }
      const elapsed = (performance.now() - start) / 1000
      runnerTime.textContent = Math.min(elapsed, duration).toFixed(1) + "s"
      runnerProgress.style.transform = "scaleX(" + Math.min(elapsed / duration, 1) + ")"
      if (elapsed >= duration) window.clearInterval(timer)
    }, 80)

    for (const [at, text] of steps) {
      await sleep(reducedMotion ? 10 : at * 1000)
      if (token !== runnerToken) return
      addRunnerLog(text, "00:0" + Math.floor(at))
    }

    if (token !== runnerToken) return
    runnerStatus.textContent = "Run complete · no errors"
    runnerRun.disabled = false
  }

  runnerItems.forEach((item) =>
    item.addEventListener("click", () => {
      runnerToken++
      runnerItems.forEach((other) => other.classList.toggle("is-active", other === item))
      if (runnerFile) runnerFile.textContent = item.getAttribute("data-script")
      if (runnerProgress) runnerProgress.style.transform = "scaleX(0)"
      if (runnerStatus) runnerStatus.textContent = "Ready · " + item.getAttribute("data-runtime")
      if (runnerTime) runnerTime.textContent = "0.0s"
      if (runnerLogs)
        runnerLogs.innerHTML =
          '<div><span class="log-time">—</span><span>Select <strong>Run</strong> to stream this script.</span></div>'
    }),
  )

  if (runnerRun) runnerRun.addEventListener("click", runScript)

  /* ----------------------------------------------------------------------
     04 — SQL Explorer: in-browser query preview
     ---------------------------------------------------------------------- */

  const sqlRun = $("[data-sql-run]")
  const sqlStatus = $("#sqlStatus")
  const sqlTable = $(".sql-table")

  if (sqlRun && sqlStatus) {
    sqlRun.addEventListener("click", async () => {
      sqlRun.disabled = true
      sqlStatus.textContent = "RUNNING IN BROWSER…"
      if (sqlTable) {
        sqlTable.style.opacity = ".45"
        window.setTimeout(
          () => {
            sqlTable.style.opacity = "1"
          },
          reducedMotion ? 0 : 700,
        )
      }
      await sleep(reducedMotion ? 30 : 850)
      sqlStatus.textContent = "12 ROWS · 12 MS · LOCAL"
      sqlRun.disabled = false
    })
  }

  /* ----------------------------------------------------------------------
     05 — Canvas: draggable notes, keyboard nudges
     ---------------------------------------------------------------------- */

  const board = $(".canvas-board")

  if (board) {
    $$("[data-drag]", board).forEach((note) => {
      let dragging = false
      let startX = 0
      let startY = 0
      let originX = 0
      let originY = 0

      note.addEventListener("pointerdown", (event) => {
        dragging = true
        startX = event.clientX
        startY = event.clientY
        const box = note.getBoundingClientRect()
        const parent = board.getBoundingClientRect()
        originX = box.left - parent.left
        originY = box.top - parent.top
        note.style.animation = "none"
        note.style.left = originX + "px"
        note.style.top = originY + "px"
        note.style.right = "auto"
        note.style.bottom = "auto"
        note.setPointerCapture(event.pointerId)
      })

      note.addEventListener("pointermove", (event) => {
        if (!dragging) return
        const maxX = board.clientWidth - note.offsetWidth
        const maxY = board.clientHeight - note.offsetHeight
        note.style.left = Math.max(0, Math.min(maxX, originX + event.clientX - startX)) + "px"
        note.style.top = Math.max(0, Math.min(maxY, originY + event.clientY - startY)) + "px"
      })

      const stop = () => {
        dragging = false
      }
      note.addEventListener("pointerup", stop)
      note.addEventListener("pointercancel", stop)

      note.addEventListener("keydown", (event) => {
        const offsets = {
          ArrowLeft: [-8, 0],
          ArrowRight: [8, 0],
          ArrowUp: [0, -8],
          ArrowDown: [0, 8],
        }
        const move = offsets[event.key]
        if (!move) return
        event.preventDefault()
        const box = note.getBoundingClientRect()
        const parent = board.getBoundingClientRect()
        note.style.animation = "none"
        note.style.left =
          Math.max(
            0,
            Math.min(board.clientWidth - note.offsetWidth, box.left - parent.left + move[0]),
          ) + "px"
        note.style.top =
          Math.max(
            0,
            Math.min(board.clientHeight - note.offsetHeight, box.top - parent.top + move[1]),
          ) + "px"
        note.style.right = "auto"
        note.style.bottom = "auto"
      })
    })
  }

  /* ----------------------------------------------------------------------
     06 — Desmos: live slider and a marker that traces the sine curve
     ---------------------------------------------------------------------- */

  const slider = $("[data-desmos-a]")
  const curve = $("#desmosCurve")
  const marker = $("#desmosMarker")
  const coeff = $("#exprCoeff")
  const sliderOut = $("#desmosAOut")
  let markerPhase = 0

  function sinePath(a) {
    let d = ""
    for (let px = 0; px <= 400; px += 2) {
      const x = (px - 200) / 20
      const y = 150 - a * 14 * Math.sin(x)
      d += (px === 0 ? "M" : "L") + px.toFixed(1) + " " + y.toFixed(2) + " "
    }
    return d.trim()
  }

  function moveMarker() {
    if (!marker) return
    const a = parseFloat(slider ? slider.value : "1.4")
    const x = -10 + (markerPhase % 20)
    marker.setAttribute("cx", String(200 + x * 20))
    marker.setAttribute("cy", String(150 - a * 14 * Math.sin(x)))
  }

  if (slider && curve) {
    const paint = () => {
      const a = parseFloat(slider.value)
      curve.setAttribute("d", sinePath(a))
      if (coeff) coeff.textContent = a.toFixed(1)
      if (sliderOut) sliderOut.textContent = a.toFixed(1)
      const pct =
        ((a - parseFloat(slider.min)) / (parseFloat(slider.max) - parseFloat(slider.min))) * 100
      slider.style.setProperty("--fill", pct + "%")
      moveMarker()
    }
    slider.addEventListener("input", paint)
    paint()

    if (!reducedMotion) {
      const trace = (now) => {
        markerPhase = (now / 1000) * 2.6
        moveMarker()
        window.requestAnimationFrame(trace)
      }
      window.requestAnimationFrame(trace)
    }
  }

  /* ----------------------------------------------------------------------
     07 — Mathematical engine: example equations and step replay
     ---------------------------------------------------------------------- */

  const mathExpression = $("#mathExpression")
  const mathResult = $("#mathResult")
  const mathSteps = mathResult ? $(".math-steps", mathResult) : null

  const examples = {
    quadratic: {
      expression: "x² − 5x + 6 = 0",
      steps: [
        ["Factor the expression", "(x − 2)(x − 3) = 0"],
        ["Apply the zero-product rule", "x − 2 = 0 or x − 3 = 0"],
        ["Solve for x", "x = 2, x = 3"],
      ],
    },
    derivative: {
      expression: "d/dx [sin(x) · eˣ]",
      steps: [
        ["Apply the product rule", "d/dx sin(x) · eˣ + sin(x) · d/dx eˣ"],
        ["Differentiate each factor", "cos(x) · eˣ + sin(x) · eˣ"],
        ["Factor the result", "eˣ(cos(x) + sin(x))"],
      ],
    },
    integral: {
      expression: "∫ (3x² + 2x) dx",
      steps: [
        ["Split the integral", "∫ 3x² dx + ∫ 2x dx"],
        ["Apply the power rule", "x³ + x²"],
        ["Add the constant", "x³ + x² + C"],
      ],
    },
  }

  function renderMath(key) {
    const example = examples[key]
    if (!example || !mathExpression || !mathSteps) return
    mathExpression.textContent = example.expression
    mathSteps.innerHTML = ""
    example.steps.forEach(([label, answer], index) => {
      const row = doc.createElement("div")
      const num = doc.createElement("span")
      num.textContent = String(index + 1).padStart(2, "0")
      const text = doc.createElement("span")
      text.textContent = label
      const value = doc.createElement("strong")
      if (index === example.steps.length - 1) value.className = "math-answer"
      value.textContent = answer
      row.append(num, text, value)
      mathSteps.appendChild(row)
    })
  }

  $$(".math-example").forEach((button) =>
    button.addEventListener("click", () => {
      $$(".math-example").forEach((other) => other.classList.toggle("is-active", other === button))
      renderMath(button.getAttribute("data-math-example"))
    }),
  )

  const mathSolve = $("[data-math-solve]")
  if (mathSolve && mathResult) {
    mathSolve.addEventListener("click", () => {
      mathResult.classList.remove("is-solving")
      void mathResult.offsetWidth
      mathResult.classList.add("is-solving")
      window.setTimeout(() => mathResult.classList.remove("is-solving"), reducedMotion ? 0 : 1400)
    })
  }

  /* ----------------------------------------------------------------------
     08 — Visualizer: CSV parsing, SQL highlighting, drag and drop
     ---------------------------------------------------------------------- */

  const vizDrop = $("#vizDrop")
  const vizFile = $("#vizFile")
  const vizPreview = $("#vizPreview")
  const vizTable = $("#vizTable")
  const vizChart = $("#vizChart")
  const vizTitle = $("#vizTitle")
  const vizMeta = $("#vizMeta")
  const vizStatus = $("#vizStatus")

  const sampleCSV = [
    "site,salinity,turbidity,temp,sampled_at",
    "A-01,28.4,3.1,18.2,2026-06-02",
    "A-02,27.9,3.4,17.8,2026-06-02",
    "B-04,31.2,2.2,19.1,2026-06-03",
    "B-07,30.1,2.7,18.9,2026-06-03",
    "C-03,26.8,4.2,17.1,2026-06-04",
    "C-09,29.6,3.0,18.4,2026-06-04",
  ].join("\n")

  const sampleSQL = [
    "-- sites above the salinity threshold",
    "SELECT site, AVG(salinity) AS avg_salt",
    "FROM read_parquet('data/survey.parquet')",
    "WHERE sampled_at > '2026-01-01'",
    "GROUP BY site",
    "ORDER BY avg_salt DESC",
    "LIMIT 12;",
  ].join("\n")

  function escapeHTML(value) {
    return value.replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    )
  }

  function highlightSQL(code) {
    const pattern =
      /--[^\n]*|'(?:''|[^'])*'|\b(?:SELECT|FROM|WHERE|GROUP BY|ORDER BY|LIMIT|JOIN|ON|AS|AND|OR|DESC|ASC|AVG|SUM|COUNT|INSERT|UPDATE|DELETE|CREATE|TABLE|WITH|DISTINCT)\b|\b\d+(?:\.\d+)?\b/gi
    let html = ""
    let last = 0

    code.replace(pattern, (match, offset) => {
      html += escapeHTML(code.slice(last, offset))
      const cls = match.startsWith("--")
        ? "sql-com"
        : match.startsWith("'")
          ? "sql-str"
          : /^\d/.test(match)
            ? "sql-numtoken"
            : "sql-kw"
      html += '<span class="' + cls + '">' + escapeHTML(match) + "</span>"
      last = offset + match.length
      return match
    })

    return html + escapeHTML(code.slice(last))
  }

  function parseCSV(text) {
    const rows = []
    let row = []
    let cell = ""
    let quoted = false

    for (let i = 0; i < text.length; i++) {
      const char = text[i]
      if (quoted) {
        if (char === '"' && text[i + 1] === '"') {
          cell += '"'
          i++
        } else if (char === '"') quoted = false
        else cell += char
      } else if (char === '"') {
        quoted = true
      } else if (char === ",") {
        row.push(cell)
        cell = ""
      } else if (char === "\n") {
        row.push(cell.replace(/\r$/, ""))
        if (row.some((value) => value !== "")) rows.push(row)
        row = []
        cell = ""
      } else {
        cell += char
      }
    }
    if (cell !== "" || row.length) {
      row.push(cell)
      rows.push(row)
    }
    return rows
  }

  function renderCSV(text, name) {
    const rows = parseCSV(text.trim())
    if (!rows.length) return false
    const columns = Math.max.apply(
      null,
      rows.map((row) => row.length),
    )
    const header = rows[0]
    const body = rows.slice(1)

    vizTable.innerHTML = ""
    vizTable.style.gridTemplateColumns = "repeat(" + columns + ", minmax(92px, 1fr))"
    header.forEach((value) => {
      const cell = doc.createElement("span")
      cell.className = "viz-th"
      cell.textContent = value
      vizTable.appendChild(cell)
    })
    body.forEach((values, rowIndex) => {
      values.forEach((value, columnIndex) => {
        const cell = doc.createElement("span")
        cell.className = "viz-row"
        cell.style.setProperty("--r", rowIndex)
        cell.textContent = value
        if (columnIndex >= columns) cell.hidden = true
        vizTable.appendChild(cell)
      })
    })

    const numericIndex = header.findIndex(
      (_, index) =>
        body.length > 0 &&
        body.every(
          (row) =>
            row[index] !== undefined &&
            row[index].trim() !== "" &&
            !Number.isNaN(Number(row[index])),
        ),
    )
    vizChart.innerHTML = ""
    if (numericIndex >= 0) {
      const values = body.map((row) => Math.abs(Number(row[numericIndex])) || 0)
      const max = Math.max.apply(null, values.concat([1]))
      values.forEach((value, index) => {
        const bar = doc.createElement("span")
        bar.className = "viz-bar"
        bar.style.height = Math.max(12, (value / max) * 100) + "%"
        bar.style.setProperty("--b", index)
        vizChart.appendChild(bar)
      })
    }

    vizTitle.textContent = name
    vizMeta.textContent = "CSV · " + columns + " columns × " + body.length + " rows"
    vizPreview.hidden = false
    vizDrop.classList.remove("is-dragover")
    return true
  }

  function renderSQL(text, name) {
    vizTable.innerHTML = ""
    vizTable.style.gridTemplateColumns = "1fr"
    const pre = doc.createElement("pre")
    pre.className = "viz-sql"
    pre.innerHTML = highlightSQL(text.trim())
    vizTable.appendChild(pre)
    vizChart.innerHTML = ""
    vizTitle.textContent = name
    vizMeta.textContent = "SQL · " + text.trim().split("\n").length + " lines"
    vizPreview.hidden = false
    vizDrop.classList.remove("is-dragover")
  }

  function handleFile(name, text) {
    if (vizStatus) vizStatus.innerHTML = "<i></i> Building view…"
    window.setTimeout(
      () => {
        const isSQL = /\.sql$/i.test(name) || /^\s*(SELECT|WITH|INSERT|UPDATE|CREATE)\b/i.test(text)
        const ok = isSQL ? (renderSQL(text, name), true) : renderCSV(text, name)
        if (!ok && vizStatus) {
          vizStatus.innerHTML = "<i></i> Could not read that file"
          return
        }
        if (vizStatus) vizStatus.innerHTML = "<i></i> View ready · local only"
      },
      reducedMotion ? 0 : 320,
    )
  }

  if (vizFile) {
    vizFile.addEventListener("change", () => {
      const file = vizFile.files && vizFile.files[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => handleFile(file.name, String(reader.result || ""))
      reader.readAsText(file)
    })
  }

  if (vizDrop) {
    ;["dragenter", "dragover"].forEach((type) =>
      vizDrop.addEventListener(type, (event) => {
        event.preventDefault()
        vizDrop.classList.add("is-dragover")
      }),
    )
    ;["dragleave", "drop"].forEach((type) =>
      vizDrop.addEventListener(type, (event) => {
        event.preventDefault()
        vizDrop.classList.remove("is-dragover")
      }),
    )
    vizDrop.addEventListener("drop", (event) => {
      const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => handleFile(file.name, String(reader.result || ""))
      reader.readAsText(file)
    })
    vizDrop.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault()
        vizFile.click()
      }
    })
  }

  $$("[data-viz-sample]").forEach((button) =>
    button.addEventListener("click", () => {
      const kind = button.getAttribute("data-viz-sample")
      handleFile(
        kind === "sql" ? "sites-above-threshold.sql" : "tidal-2026.csv",
        kind === "sql" ? sampleSQL : sampleCSV,
      )
    }),
  )
}
