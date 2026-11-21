/* ==========================================================================
   SPINDLE — Automations page interactions
   Three creation modes: Ask AI, visual Builder, and Cron. Interface previews
   only — nothing is scheduled or executed.
   ========================================================================== */

import { humanizeCron } from "../automations/cron"

/* Runs after hydration from a client component. */
let started = false

export function initAutomations() {
  if (started) return
  started = true

  ;("use strict")

  const doc = document
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const $ = (sel, root = doc) => root.querySelector(sel)
  const $$ = (sel, root = doc) => Array.from(root.querySelectorAll(sel))

  const MODE_LABELS = { ask: "Ask AI", build: "Builder", cron: "Cron" }

  /* ---------------------------------------------------------------------- */
  /* Shared helpers                                                          */
  /* ---------------------------------------------------------------------- */

  function setStatus(text, live) {
    const pill = $("#studioStatus")
    if (!pill) return
    pill.innerHTML = "<i></i> " + text
    pill.classList.toggle("is-live", Boolean(live))
  }

  function scrollToStudio() {
    const studio = $("#studio")
    if (!studio) return
    studio.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" })
  }

  function flashToast(el, message) {
    if (!el) return
    el.textContent = message
    el.hidden = false
    window.clearTimeout(el._hideTimer)
    el._hideTimer = window.setTimeout(() => {
      el.hidden = true
    }, 4200)
  }

  function formatTime(value) {
    const [hStr, mStr] = String(value || "17:00").split(":")
    const h = parseInt(hStr, 10)
    const m = parseInt(mStr, 10)
    if (Number.isNaN(h) || Number.isNaN(m)) return String(value)
    const suffix = h >= 12 ? "PM" : "AM"
    const hour = h % 12 || 12
    return hour + ":" + String(m).padStart(2, "0") + " " + suffix
  }

  /* ---------------------------------------------------------------------- */
  /* Mode tabs                                                               */
  /* ---------------------------------------------------------------------- */

  const tabs = $$(".mode-tab")
  const panels = $$("[data-mode-panel]")
  const pathCards = $$("[data-goto-mode]")

  function setMode(mode, options = {}) {
    if (!MODE_LABELS[mode]) return

    tabs.forEach((tab) => {
      const active = tab.dataset.mode === mode
      tab.classList.toggle("is-active", active)
      tab.setAttribute("aria-selected", String(active))
      tab.tabIndex = active ? 0 : -1
    })

    panels.forEach((panel) => {
      const active = panel.dataset.modePanel === mode
      panel.classList.toggle("is-active", active)
      panel.hidden = !active
    })

    const label = $("#studioModeLabel")
    if (label) label.textContent = MODE_LABELS[mode]

    if (options.focus) {
      const activeTab = tabs.find((tab) => tab.dataset.mode === mode)
      if (activeTab) activeTab.focus()
    }
    if (options.scroll) scrollToStudio()
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => setMode(tab.dataset.mode))
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return
      event.preventDefault()
      const index = tabs.indexOf(tab)
      const next = (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length
      setMode(tabs[next].dataset.mode, { focus: true })
    })
  })

  pathCards.forEach((card) =>
    card.addEventListener("click", () => setMode(card.dataset.gotoMode, { scroll: true })),
  )

  /* ---------------------------------------------------------------------- */
  /* ASK MODE — text an automation into existence                            */
  /* ---------------------------------------------------------------------- */

  const chatForm = $("#chatForm")
  const chatInput = $("#chatInput")
  const chatThread = $("#chatThread")
  const initialChatHTML = chatThread ? chatThread.innerHTML : ""
  const textOf = (id, fallback) => {
    const el = doc.getElementById(id)
    return el ? el.textContent : fallback
  }
  const initialAskPreview = {
    title: textOf("askTitle", "Daily study results check"),
    trigger: textOf("askTrigger", "Every day · 17:00"),
    action1: textOf("askAction1", "Scan /results for new entries"),
    action2: textOf("askAction2", "Flag outliers against baseline"),
    delivery: textOf("askDelivery", "Digest to #study-updates"),
  }
  const pendingTimers = new Set()
  let latestRequest = null

  function later(fn, ms) {
    const id = window.setTimeout(() => {
      pendingTimers.delete(id)
      fn()
    }, ms)
    pendingTimers.add(id)
    return id
  }

  const DAY_WORDS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

  function parseRequest(text) {
    const lower = text.toLowerCase()

    let hour = 17
    let minute = 0
    const time12 = lower.match(/\b(1[0-2]|[1-9])(?::([0-5]\d))?\s*(am|pm)\b/)
    const time24 = lower.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/)
    if (time12) {
      hour = (parseInt(time12[1], 10) % 12) + (time12[3] === "pm" ? 12 : 0)
      minute = parseInt(time12[2] || "0", 10)
    } else if (time24) {
      hour = parseInt(time24[1], 10)
      minute = parseInt(time24[2], 10)
    }

    let frequency = "daily"
    let weekday = 1
    const weekdayMatch = lower.match(
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
    )
    if (
      /\bevery (monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(lower) ||
      /\bweekly\b|\bevery week\b/.test(lower)
    ) {
      frequency = "weekly"
      if (weekdayMatch) {
        const dayName = weekdayMatch[1].charAt(0).toUpperCase() + weekdayMatch[1].slice(1)
        weekday = DAY_WORDS.indexOf(dayName)
      }
      if (weekday < 0) weekday = 1
    } else if (
      /\bwhen (a|the|new)|new (csv|file|upload|source)|lands? in|on upload|whenever a\b/.test(lower)
    ) {
      frequency = "file"
    }

    let subject = "results"
    if (/\bpaper|article|arxiv|source|literature\b/.test(lower)) subject = "papers"
    else if (/\bcsv|dataset|file|upload|data folder|\/data\b/.test(lower)) subject = "files"
    else if (/\btide|sensor|sample\b/.test(lower)) subject = "samples"

    const wantsFlag = /\bflag|outlier|weird|wrong|anomal|check\b/.test(lower)
    const wantsSummary = /\bsummar|digest|recap|write a note\b/.test(lower)
    const wantsClean = /\bclean|normaliz|format|tidy\b/.test(lower)

    let destination = "#study-updates"
    if (/notes\.md|project log|\blog\b/.test(lower)) destination = "notes.md"
    else if (/\bemail\b/.test(lower)) destination = "email digest"
    else if (/#[a-z-]+/.test(lower))
      destination = (lower.match(/#[a-z-]+/) || ["#study-updates"])[0]

    const steps = []
    if (frequency === "file") {
      steps.push("Watch the project folder for a new " + (subject === "files" ? "CSV" : "file"))
    } else {
      steps.push("Collect new " + subject + " since the last run")
    }
    if (wantsClean) steps.push("Clean and normalize the incoming entries")
    if (wantsFlag)
      steps.push(
        subject === "papers"
          ? "Pick out the most relevant new papers"
          : "Compare with the baseline and flag outliers",
      )
    if (wantsSummary)
      steps.push(
        subject === "papers"
          ? "Write a short summary into notes.md"
          : "Write a two-paragraph digest",
      )
    if (steps.length < 2) steps.push("Summarize what changed since the last run")
    steps.push("Send the outcome to " + destination)

    let title = "Daily " + subject + " check"
    if (frequency === "weekly") title = "Weekly " + subject + " digest"
    if (frequency === "file") {
      const singular =
        { results: "result", papers: "paper", files: "file", samples: "sample" }[subject] || subject
      title = "New " + singular + " workflow"
    }
    if (wantsSummary && subject === "papers" && frequency === "weekly")
      title = "Weekly paper summary"

    let schedule =
      "Every day at " +
      formatTime(String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0"))
    if (frequency === "weekly")
      schedule =
        "Every " +
        DAY_WORDS[weekday] +
        " at " +
        formatTime(String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0"))
    if (frequency === "file") schedule = "Whenever a new file lands in the project folder"

    let firstRun =
      "first run at " +
      formatTime(String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0"))
    if (frequency === "weekly")
      firstRun =
        "first run " +
        DAY_WORDS[weekday] +
        " at " +
        formatTime(String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0"))
    if (frequency === "file") firstRun = "first run on the next upload"

    // The delivery step is rendered in its own DELIVER row, so the preview's
    // action rows must not repeat it. In file mode the watch step is already
    // represented by the trigger row.
    let previewSteps = steps.slice(0, -1)
    if (frequency === "file" && previewSteps.length > 1) previewSteps = previewSteps.slice(1)

    return {
      title: title,
      steps: steps,
      schedule: schedule,
      firstRun: firstRun,
      trigger:
        frequency === "file"
          ? "New file in /data"
          : frequency === "weekly"
            ? "Every " +
              DAY_WORDS[weekday] +
              " · " +
              formatTime(String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0"))
            : "Every day · " +
              formatTime(String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0")),
      action1: previewSteps[0] || steps[0],
      action2: previewSteps[1] || "Log the result",
      delivery: "Send to " + destination,
    }
  }

  function updateAskPreview(request) {
    latestRequest = request
    const setText = (id, value) => {
      const el = doc.getElementById(id)
      if (el) el.textContent = value
    }
    setText("askTitle", request.title)
    setText("askTrigger", request.trigger)
    setText("askAction1", request.action1)
    setText("askAction2", request.action2)
    setText("askDelivery", request.delivery)

    const draft = $("#chatDraft")
    if (draft) {
      const list = $(".draft-steps", draft)
      if (list) {
        list.innerHTML = ""
        request.steps.forEach((step) => {
          const li = doc.createElement("li")
          li.textContent = step
          list.appendChild(li)
        })
      }
      const schedule = $(".draft-schedule", draft)
      if (schedule)
        schedule.innerHTML =
          '<svg class="icon icon--xs"><use href="#i-clock"/></svg> ' +
          request.schedule +
          " · Europe/Berlin"
    }

    const approve = $("#askApprove")
    if (approve)
      approve.innerHTML =
        '<svg class="icon icon--sm"><use href="#i-check"/></svg> Approve &amp; schedule'
    setStatus("Draft", false)
  }

  function resetAsk() {
    latestRequest = null
    if (chatThread) chatThread.innerHTML = initialChatHTML
    if (chatInput) chatInput.value = ""

    const setText = (id, value) => {
      const el = doc.getElementById(id)
      if (el) el.textContent = value
    }
    setText("askTitle", initialAskPreview.title)
    setText("askTrigger", initialAskPreview.trigger)
    setText("askAction1", initialAskPreview.action1)
    setText("askAction2", initialAskPreview.action2)
    setText("askDelivery", initialAskPreview.delivery)

    const approve = $("#askApprove")
    if (approve)
      approve.innerHTML =
        '<svg class="icon icon--sm"><use href="#i-check"/></svg> Approve &amp; schedule'
  }

  function appendMessage(html, className) {
    if (!chatThread) return
    const msg = doc.createElement("div")
    msg.className = "msg " + (className || "msg--ai")
    msg.innerHTML = html
    chatThread.appendChild(msg)
    chatThread.scrollTop = chatThread.scrollHeight
    return msg
  }

  function submitPrompt(text) {
    const request = parseRequest(text)
    const typing = appendMessage(
      '<span class="msg-avatar"><svg class="icon icon--xs"><use href="#i-sparkle"/></svg></span><div class="bubble"><span class="typing-dots"><i></i><i></i><i></i></span></div>',
    )

    later(
      () => {
        if (typing) typing.remove()
        appendMessage(
          '<span class="msg-avatar"><svg class="icon icon--xs"><use href="#i-sparkle"/></svg></span>' +
            "<div class=\"bubble bubble--draft\"><p>Got it — here's the routine I'd set up:</p>" +
            '<ol class="draft-steps">' +
            request.steps.map((step) => "<li>" + step.replace(/</g, "&lt;") + "</li>").join("") +
            "</ol>" +
            '<div class="draft-schedule"><svg class="icon icon--xs"><use href="#i-clock"/></svg> ' +
            request.schedule +
            " · Europe/Berlin</div></div>",
        )
        updateAskPreview(request)
      },
      reduced ? 0 : 480,
    )
  }

  if (chatForm) {
    chatForm.addEventListener("submit", (event) => {
      event.preventDefault()
      const text = (chatInput.value || "").trim()
      if (!text) return
      appendMessage('<div class="bubble">' + text.replace(/</g, "&lt;") + "</div>", "msg--user")
      chatInput.value = ""
      submitPrompt(text)
    })
  }

  $$("[data-prompt]").forEach((button) => {
    button.addEventListener("click", () => {
      if (chatInput) chatInput.value = button.dataset.prompt
      if (chatForm) chatForm.requestSubmit()
    })
  })

  const approveBtn = $("#askApprove")
  if (approveBtn) {
    approveBtn.addEventListener("click", () => {
      approveBtn.innerHTML =
        '<svg class="icon icon--sm"><use href="#i-check"/></svg> Scheduled · ' +
        (latestRequest ? latestRequest.firstRun : "first run at 17:00")
      setStatus("Live", true)
      appendMessage(
        '<span class="msg-avatar"><svg class="icon icon--xs"><use href="#i-sparkle"/></svg></span><div class="bubble">Approved. I\'ll keep the first run in the activity log so you can preview it before it goes out.</div>',
        "msg--ai",
      )
    })
  }

  /* ---------------------------------------------------------------------- */
  /* BUILDER MODE — friendly controls                                        */
  /* ---------------------------------------------------------------------- */

  const builderState = {
    freq: "daily",
    time: "17:00",
    tz: "Europe/Berlin",
    days: new Set([1]),
    actions: new Set(["results", "flag"]),
    channels: new Set(["Project log", "#study-updates"]),
  }

  const ACTION_LABELS = {
    results: "check study results",
    flag: "flag outliers",
    summary: "write a short summary",
    log: "append to the project log",
  }

  const FLOW_LABELS = {
    results: "Scan /results for new entries",
    flag: "Compare with baseline and flag outliers",
    summary: "Write a short digest of what changed",
    log: "Append a dated entry to notes.md",
  }

  function initialBuilderState() {
    return {
      freq: "daily",
      time: "17:00",
      tz: "Europe/Berlin",
      days: new Set([1]),
      actions: new Set(["results", "flag"]),
      channels: new Set(["Project log", "#study-updates"]),
    }
  }

  function listPhrase(items) {
    if (!items.length) return ""
    if (items.length === 1) return items[0]
    return items.slice(0, -1).join(", ") + " and " + items[items.length - 1]
  }

  function nextRunDates() {
    const [h, m] = builderState.time.split(":").map(Number)
    const now = new Date()
    const results = []

    if (builderState.freq === "file") return ["Next upload", "Immediate", "No fixed time"]

    // Start at today's scheduled time and advance from there, so the preview
    // never repeats a date and includes today when the run is still ahead.
    const cursor = new Date(now)
    cursor.setHours(h, m, 0, 0)
    if (cursor <= now) cursor.setDate(cursor.getDate() + 1)

    if (builderState.freq === "daily") {
      for (let i = 0; i < 3; i++) {
        results.push(new Date(cursor))
        cursor.setDate(cursor.getDate() + 1)
      }
    } else {
      const days = Array.from(builderState.days).sort((a, b) => a - b)
      let guard = 0
      while (results.length < 3 && guard < 400) {
        if (days.includes(cursor.getDay())) results.push(new Date(cursor))
        cursor.setDate(cursor.getDate() + 1)
        guard++
      }
    }

    return results.map(
      (d) =>
        d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" }) +
        " · " +
        formatTime(builderState.time),
    )
  }

  function updateBuilder() {
    const timeFields = $("#timeFields")
    const dayPills = $("#dayPills")
    if (timeFields) timeFields.hidden = builderState.freq === "file"
    if (dayPills) dayPills.hidden = builderState.freq !== "weekly"

    const actionList = Array.from(builderState.actions)
      .map((key) => ACTION_LABELS[key])
      .filter(Boolean)
    const channelList = Array.from(builderState.channels)
    const actionPhrase = actionList.length ? listPhrase(actionList) : "run the selected checks"
    const channelPhrase = channelList.length
      ? "Send the outcome to " + listPhrase(channelList) + "."
      : "Keep the result inside the project."

    let whenPhrase = "Every day at " + formatTime(builderState.time)
    if (builderState.freq === "weekly") {
      const dayNames = Array.from(builderState.days)
        .sort((a, b) => a - b)
        .map((d) => DAY_WORDS[d])
      whenPhrase = "Every " + listPhrase(dayNames) + " at " + formatTime(builderState.time)
    } else if (builderState.freq === "file") {
      whenPhrase = "Whenever a new file lands in /data"
    }

    const plain = $("#plainEnglish")
    if (plain)
      plain.textContent =
        whenPhrase + " (" + builderState.tz + "), " + actionPhrase + ". " + channelPhrase

    const flowList = $("#flowList")
    if (flowList) {
      const steps = []
      if (builderState.freq === "file") steps.push("Watch /data for new files")
      else if (builderState.freq === "weekly")
        steps.push(
          "Trigger on " +
            Array.from(builderState.days)
              .sort((a, b) => a - b)
              .map((d) => DAY_WORDS[d])
              .join(" + "),
        )
      else steps.push("Trigger daily at " + formatTime(builderState.time))
      ;["results", "flag", "summary", "log"].forEach((key) => {
        if (builderState.actions.has(key)) steps.push(FLOW_LABELS[key])
      })
      if (channelList.length) steps.push("Deliver to " + listPhrase(channelList))
      flowList.innerHTML = ""
      steps.forEach((step, index) => {
        const li = doc.createElement("li")
        li.innerHTML =
          "<span>" +
          String(index + 1).padStart(2, "0") +
          "</span><span>" +
          step.replace(/</g, "&lt;") +
          "</span>"
        flowList.appendChild(li)
      })
    }

    const runs = $("#nextRuns")
    if (runs) {
      runs.innerHTML = ""
      nextRunDates().forEach((label, index) => {
        const li = doc.createElement("li")
        li.innerHTML =
          "<span>" + ["Next", "Then", "After"][index] + "</span><strong>" + label + "</strong>"
        runs.appendChild(li)
      })
    }
  }

  $$("#freqGroup .seg").forEach((button) => {
    button.addEventListener("click", () => {
      builderState.freq = button.dataset.freq
      $$("#freqGroup .seg").forEach((b) => {
        const active = b === button
        b.classList.toggle("is-active", active)
        b.setAttribute("aria-pressed", String(active))
      })
      updateBuilder()
    })
  })

  $$("#dayPills .day").forEach((button) => {
    button.addEventListener("click", () => {
      const day = Number(button.dataset.day)
      if (builderState.days.has(day) && builderState.days.size === 1) return
      if (builderState.days.has(day)) builderState.days.delete(day)
      else builderState.days.add(day)
      button.classList.toggle("is-active", builderState.days.has(day))
      button.setAttribute("aria-pressed", String(builderState.days.has(day)))
      updateBuilder()
    })
  })

  const buildTime = $("#buildTime")
  if (buildTime)
    buildTime.addEventListener("input", () => {
      builderState.time = buildTime.value
      updateBuilder()
    })
  const buildTz = $("#buildTz")
  if (buildTz)
    buildTz.addEventListener("change", () => {
      builderState.tz = buildTz.value
      updateBuilder()
    })

  $$("[data-action]").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) builderState.actions.add(input.dataset.action)
      else builderState.actions.delete(input.dataset.action)
      input.closest(".option").classList.toggle("checked", input.checked)
      updateBuilder()
    })
  })

  $$("#channelGroup .channel").forEach((button) => {
    button.addEventListener("click", () => {
      const channel = button.dataset.channel
      if (builderState.channels.has(channel)) builderState.channels.delete(channel)
      else builderState.channels.add(channel)
      button.classList.toggle("active", builderState.channels.has(channel))
      button.setAttribute("aria-pressed", String(builderState.channels.has(channel)))
      updateBuilder()
    })
  })

  const buildDraftBtn = $("#buildDraft")
  if (buildDraftBtn) {
    buildDraftBtn.addEventListener("click", () => {
      setStatus("Draft", false)
      flashToast($("#buildToast"), "Draft saved — you can pick it up any time.")
    })
  }

  const buildCreateBtn = $("#buildCreate")
  if (buildCreateBtn) {
    buildCreateBtn.addEventListener("click", () => {
      setStatus("Live", true)
      flashToast($("#buildToast"), "Automation created. First run: " + nextRunDates()[0] + ".")
    })
  }

  /* ---------------------------------------------------------------------- */
  /* CRON MODE — raw expression editor                                       */
  /* ---------------------------------------------------------------------- */

  const cronExpr = $("#cronExpr")
  const cronHuman = $("#cronHuman")
  const cronFields = $("#cronFields")
  const cronValidation = $("#cronValidation")
  const cronTz = $("#cronTz")

  const FIELD_LABELS = ["MIN", "HOUR", "DAY", "MONTH", "WEEK"]

  function updateCron() {
    if (!cronExpr) return
    const expr = cronExpr.value.trim()
    const result = humanizeCron(expr)

    if (cronHuman) {
      cronHuman.textContent =
        result.valid && cronTz ? result.text + " · " + cronTz.value : result.text
    }
    cronExpr.classList.toggle("is-invalid", !result.valid)

    if (cronValidation) {
      cronValidation.classList.toggle("is-error", !result.valid)
      cronValidation.innerHTML = result.valid
        ? '<svg class="icon icon--xs"><use href="#i-check"/></svg> Valid 5-field cron'
        : '<svg class="icon icon--xs"><use href="#i-close"/></svg> ' + result.text
    }

    if (cronFields) {
      const values = result.parts || expr.split(/\s+/)
      cronFields.innerHTML = FIELD_LABELS.map(
        (label, index) =>
          '<div class="cron-field"><small>' +
          label +
          "</small><strong>" +
          (values[index] || "—").replace(/</g, "&lt;") +
          "</strong></div>",
      ).join("")
    }

    $$(".cron-presets button").forEach((button) =>
      button.classList.toggle("is-active", button.dataset.cron === expr),
    )
  }

  if (cronExpr) cronExpr.addEventListener("input", updateCron)

  $$(".cron-presets button").forEach((button) => {
    button.addEventListener("click", () => {
      if (cronExpr) cronExpr.value = button.dataset.cron
      updateCron()
    })
  })

  if (cronTz) cronTz.addEventListener("change", () => updateCron())

  $$(".code-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".code-tab").forEach((t) => {
        const active = t === tab
        t.classList.toggle("is-active", active)
        t.setAttribute("aria-selected", String(active))
      })
      $$("[data-code-panel]").forEach((panel) => {
        panel.hidden = panel.dataset.codePanel !== tab.dataset.codeTab
      })
    })
  })

  const copyBtn = $("#copyCode")
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      const visible = $("[data-code-panel]:not([hidden])")
      const text = visible ? visible.innerText : ""
      try {
        if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text)
        else {
          const helper = doc.createElement("textarea")
          helper.value = text
          helper.style.position = "fixed"
          helper.style.opacity = "0"
          doc.body.appendChild(helper)
          helper.select()
          doc.execCommand("copy")
          helper.remove()
        }
        copyBtn.innerHTML = '<svg class="icon icon--xs"><use href="#i-check"/></svg> Copied'
      } catch (error) {
        copyBtn.textContent = "Select code"
        if (window.Sentry) {
          window.Sentry.captureException(error)
        }
      }
      window.setTimeout(() => {
        copyBtn.innerHTML = '<svg class="icon icon--xs"><use href="#i-copy"/></svg> Copy'
      }, 1800)
    })
  }

  const cronDeploy = $("#cronDeploy")
  if (cronDeploy) {
    cronDeploy.addEventListener("click", () => {
      const result = humanizeCron(cronExpr ? cronExpr.value : "")
      if (!result.valid) {
        flashToast($("#cronToast"), "Fix the cron expression before deploying.")
        return
      }
      setStatus("Live", true)
      flashToast($("#cronToast"), "Job deployed. " + result.text + ".")
    })
  }

  /* ---------------------------------------------------------------------- */
  /* Reset                                                                   */
  /* ---------------------------------------------------------------------- */

  function resetBuilder() {
    Object.assign(builderState, initialBuilderState())

    $$("#freqGroup .seg").forEach((b) => {
      const active = b.dataset.freq === builderState.freq
      b.classList.toggle("is-active", active)
      b.setAttribute("aria-pressed", String(active))
    })
    $$("#dayPills .day").forEach((b) => {
      const active = builderState.days.has(Number(b.dataset.day))
      b.classList.toggle("is-active", active)
      b.setAttribute("aria-pressed", String(active))
    })
    $$("[data-action]").forEach((input) => {
      input.checked = builderState.actions.has(input.dataset.action)
      input.closest(".option").classList.toggle("checked", input.checked)
    })
    $$("#channelGroup .channel").forEach((b) => {
      const active = builderState.channels.has(b.dataset.channel)
      b.classList.toggle("active", active)
      b.setAttribute("aria-pressed", String(active))
    })
    if ($("#buildTime")) $("#buildTime").value = builderState.time
    if ($("#buildTz")) $("#buildTz").value = builderState.tz
    if ($("#buildToast")) $("#buildToast").hidden = true
    updateBuilder()
  }

  function resetCron() {
    if (cronExpr) cronExpr.value = "0 17 * * *"
    if (cronTz) cronTz.value = "Europe/Berlin"
    $$(".code-tab").forEach((t) => {
      const active = t.dataset.codeTab === "script"
      t.classList.toggle("is-active", active)
      t.setAttribute("aria-selected", String(active))
    })
    $$("[data-code-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.codePanel !== "script"
    })
    if ($("#cronToast")) $("#cronToast").hidden = true
    updateCron()
  }

  const resetBtn = $("#resetDemo")
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      pendingTimers.forEach((id) => window.clearTimeout(id))
      pendingTimers.clear()
      resetAsk()
      resetBuilder()
      resetCron()
      setStatus("Draft", false)
    })
  }

  /* ---------------------------------------------------------------------- */
  /* TIMELINE — progressive dot animation for the rhythm section             */
  /* ---------------------------------------------------------------------- */

  const timelineItems = $$(".timeline li")

  if (timelineItems.length && "IntersectionObserver" in window) {
    // Clear any static is-hot that may be set in the HTML so the animation
    // plays fresh each time the section scrolls into view.
    timelineItems.forEach((li) => {
      li.classList.remove("is-hot", "is-done")
    })

    const timelineEl = doc.querySelector(".timeline")
    let timelineAnimated = false

    function runTimelineAnimation() {
      if (timelineAnimated) return
      timelineAnimated = true

      const delay = reduced ? 0 : 480

      timelineItems.forEach((li, index) => {
        window.setTimeout(
          () => {
            // Mark all previous items as "done" (green, dimmed)
            for (let i = 0; i < index; i++) {
              timelineItems[i].classList.remove("is-hot")
              timelineItems[i].classList.add("is-done")
            }
            // Mark the current item as the active/hot one
            li.classList.add("is-hot")

          },
          reduced ? 0 : delay * index,
        )
      })
    }

    const rhythmSection = doc.querySelector(".rhythm-section")
    if (rhythmSection) {
      const tlObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              runTimelineAnimation()
              tlObserver.unobserve(entry.target)
            }
          })
        },
        { threshold: 0.25 },
      )
      tlObserver.observe(rhythmSection)
    } else {
      // Fallback: show all lit immediately
      timelineItems.forEach((li, index, arr) => {
        if (index < arr.length - 1) li.classList.add("is-done")
        else li.classList.add("is-hot")
      })
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Init                                                                    */
  /* ---------------------------------------------------------------------- */

  updateBuilder()
  updateCron()
  setMode("ask")
}
