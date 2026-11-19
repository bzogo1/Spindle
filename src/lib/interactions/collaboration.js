/* ==========================================================================
   SPINDLE — Collaboration page interactions
   Small, purposeful demos: chat, anonymity routing, live typing, and roles.
   ========================================================================== */

/* Runs after hydration from a client component. */
let started = false

export function initCollaboration() {
  if (started) return
  started = true

  ;("use strict")

  const doc = document
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches

  /* ----------------------------------------------------------------------
     Anonymous mode — shared by the sidebar switch and the explainer card
     ---------------------------------------------------------------------- */

  const anonToggle = doc.getElementById("anonToggle")
  const anonExplainToggle = doc.getElementById("anonExplainToggle")
  const anonStatus = doc.getElementById("anonStatus")
  const anonMessage = doc.getElementById("anonMessage")
  const anonCard = doc.getElementById("anonCard")
  const chatRoute = doc.getElementById("chatRoute")
  const routeStrip = doc.getElementById("routeStrip")

  function setAnonymous(enabled) {
    if (!anonToggle) return
    anonToggle.setAttribute("aria-pressed", String(enabled))
    if (anonStatus)
      anonStatus.textContent = enabled ? "On · Nym Mixnet" : "Off · normal project chat"
    if (chatRoute) chatRoute.textContent = enabled ? "Anonymous · Nym Mixnet" : currentRouteMeta()
    if (anonMessage) anonMessage.hidden = !enabled
    if (routeStrip) routeStrip.classList.toggle("is-live", enabled)
    if (anonCard) anonCard.classList.toggle("is-on", enabled)
    if (anonExplainToggle) {
      anonExplainToggle.firstChild.textContent = enabled
        ? "Switch Anonymous mode off "
        : "Switch Anonymous mode on "
    }
  }

  if (anonToggle) {
    // script.js also wires this switch for the homepage preview; read the
    // state it just set so the two demos never disagree.
    anonToggle.addEventListener("click", () => {
      setAnonymous(anonToggle.getAttribute("aria-pressed") === "true")
    })
  }
  if (anonExplainToggle) {
    anonExplainToggle.addEventListener("click", () => {
      if (!anonToggle) return
      setAnonymous(anonToggle.getAttribute("aria-pressed") !== "true")
    })
  }

  /* ----------------------------------------------------------------------
     Chat — channels, sending, and the anonymous route preview
     ---------------------------------------------------------------------- */

  const channels = doc.querySelectorAll("[data-channel]")
  const channelName = doc.getElementById("chatChannelName")
  const messages = doc.getElementById("chatMessages")
  const chatForm = doc.getElementById("chatForm")
  const chatInput = doc.getElementById("chatInput")

  const channelData = {
    "field-notes": {
      meta: "8 members · project channel",
      placeholder: "Message #field-notes",
      messages: [
        [
          "MR",
          "chat-avatar--lime",
          "Mara",
          "09:14",
          "New survey batch is in /data. The viewer detected it as Parquet right away.",
        ],
        [
          "TJ",
          "chat-avatar--mint",
          "Theo",
          "09:18",
          "Nice. I kicked off the cron refresh and the lab still has the kernel from yesterday.",
        ],
        [
          "JL",
          "chat-avatar--teal",
          "Jules",
          "09:21",
          "Adding the site IDs to the shared note now — you'll see my cursor in the second block.",
        ],
      ],
    },
    "data-cleaning": {
      meta: "6 members · project channel",
      placeholder: "Message #data-cleaning",
      messages: [
        [
          "TJ",
          "chat-avatar--mint",
          "Theo",
          "08:52",
          "Dropping rows with null salinity into /output/rejected.csv so the original stays untouched.",
        ],
        [
          "MR",
          "chat-avatar--lime",
          "Mara",
          "09:03",
          "Good. Can the agent add a short note to project-log.md when it finishes?",
        ],
      ],
    },
    writing: {
      meta: "4 members · project channel",
      placeholder: "Message #writing",
      messages: [
        [
          "JL",
          "chat-avatar--teal",
          "Jules",
          "10:02",
          "First draft of the methods section is in notes.md. Comments on paragraph two, please.",
        ],
        [
          "MR",
          "chat-avatar--lime",
          "Mara",
          "10:11",
          "Left two comments inline — the sampling interval needs the exact date.",
        ],
      ],
    },
    random: {
      meta: "8 members · project channel",
      placeholder: "Message #random",
      messages: [
        [
          "TJ",
          "chat-avatar--mint",
          "Theo",
          "11:40",
          "The field coffee situation has improved dramatically. This is important research.",
        ],
        ["JL", "chat-avatar--teal", "Jules", "11:42", "I will document this in the final report."],
      ],
    },
  }

  let activeChannel = "field-notes"

  function currentRouteMeta() {
    const channel = channelData[activeChannel]
    return channel ? channel.meta : "8 members · project channel"
  }

  function makeMessage(initials, avatarClass, name, time, text) {
    const row = doc.createElement("div")
    row.className = "chat-msg"

    const avatar = doc.createElement("span")
    avatar.className = "chat-avatar " + avatarClass
    avatar.textContent = initials

    const body = doc.createElement("div")
    body.className = "chat-msg-body"

    const meta = doc.createElement("div")
    meta.className = "chat-msg-meta"
    const strong = doc.createElement("strong")
    strong.textContent = name
    const timeEl = doc.createElement("time")
    timeEl.textContent = time
    meta.append(strong, timeEl)

    const paragraph = doc.createElement("p")
    paragraph.textContent = text
    body.append(meta, paragraph)
    row.append(avatar, body)
    return row
  }

  function scrollMessages() {
    if (messages) messages.scrollTop = messages.scrollHeight
  }

  function renderChannel(name) {
    const channel = channelData[name]
    if (!channel || !messages) return
    activeChannel = name

    channels.forEach((button) => {
      button.classList.toggle("is-active", button.getAttribute("data-channel") === name)
    })
    if (channelName) channelName.textContent = name
    if (chatInput) chatInput.placeholder = channel.placeholder
    if (chatRoute && !(anonToggle && anonToggle.getAttribute("aria-pressed") === "true")) {
      chatRoute.textContent = channel.meta
    }

    const typing = doc.getElementById("chatTyping")
    messages.textContent = ""
    channel.messages.forEach(([initials, avatarClass, author, time, text]) => {
      messages.appendChild(makeMessage(initials, avatarClass, author, time, text))
    })
    if (anonMessage) {
      anonMessage.hidden = !(anonToggle && anonToggle.getAttribute("aria-pressed") === "true")
      messages.appendChild(anonMessage)
    }
    if (typing) messages.appendChild(typing)
    scrollMessages()
  }

  channels.forEach((button) => {
    button.addEventListener("click", () => renderChannel(button.getAttribute("data-channel")))
  })

  if (chatForm) {
    chatForm.addEventListener("submit", (event) => {
      event.preventDefault()
      if (!chatInput || !messages) return
      const text = chatInput.value.trim()
      if (!text) return

      const anonymous = anonToggle && anonToggle.getAttribute("aria-pressed") === "true"
      const now = new Date()
      const time =
        String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0")
      const typing = doc.getElementById("chatTyping")
      const message = anonymous
        ? makeMessage("", "chat-avatar--anon", "Anonymous", time + " · via Nym", text)
        : makeMessage("YO", "chat-avatar--lime", "You", time, text)

      if (typing) messages.insertBefore(message, typing)
      else messages.appendChild(message)
      chatInput.value = ""
      scrollMessages()
    })
  }

  /* ----------------------------------------------------------------------
     Shared document — an Editar-style typing loop
     ---------------------------------------------------------------------- */

  const typingTarget = doc.getElementById("docTyping")
  const typingPhrases = [
    "the second reading at 14:35.",
    "a duplicate station in the export.",
    "the turbidity spike from yesterday.",
  ]

  if (typingTarget && !reducedMotion) {
    let phraseIndex = 0
    let charIndex = 0
    let deleting = false

    window.setInterval(() => {
      const phrase = typingPhrases[phraseIndex]
      typingTarget.textContent = phrase.slice(0, charIndex)

      if (!deleting) {
        charIndex += 1
        if (charIndex > phrase.length) {
          deleting = true
          charIndex = phrase.length
        }
      } else {
        charIndex -= 1
        if (charIndex <= 0) {
          deleting = false
          phraseIndex = (phraseIndex + 1) % typingPhrases.length
          charIndex = 0
        }
      }
    }, 62)
  } else if (typingTarget) {
    typingTarget.textContent = typingPhrases[0]
  }

  /* ----------------------------------------------------------------------
     Roles — invite, change, remove, and inspect permissions
     ---------------------------------------------------------------------- */

  const inviteForm = doc.getElementById("inviteForm")
  const inviteEmail = doc.getElementById("inviteEmail")
  const inviteRole = doc.getElementById("inviteRole")
  const memberList = doc.getElementById("memberList")
  const roleToast = doc.getElementById("roleToast")
  const memberCount = doc.querySelector(".roles-window .window-bar-status")
  let toastTimer = null

  function toast(text) {
    if (!roleToast) return
    roleToast.textContent = text
    roleToast.classList.add("is-visible")
    window.clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => {
      roleToast.classList.remove("is-visible")
      roleToast.textContent = ""
    }, 3200)
  }

  function updateMemberCount() {
    if (!memberList || !memberCount) return
    const total = memberList.querySelectorAll(".member-row").length
    memberCount.innerHTML = ""
    const dot = doc.createElement("i")
    memberCount.append(
      dot,
      doc.createTextNode(" " + total + (total === 1 ? " member" : " members")),
    )
  }

  function initialsFromEmail(email) {
    const local = email.split("@")[0] || "new"
    const parts = local.split(/[._-]+/).filter(Boolean)
    const letters = parts.length > 1 ? parts[0].charAt(0) + parts[1].charAt(0) : local.slice(0, 2)
    return letters.toUpperCase()
  }

  function nameFromEmail(email) {
    const local = (email.split("@")[0] || "new teammate").split(/[._-]+/).filter(Boolean)
    return local.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ")
  }

  const avatarColors = [
    "member-avatar--lime",
    "member-avatar--mint",
    "member-avatar--teal",
    "member-avatar--violet",
  ]

  if (inviteForm) {
    inviteForm.addEventListener("submit", (event) => {
      event.preventDefault()
      if (!inviteEmail || !memberList) return
      const email = inviteEmail.value.trim()
      if (!email) return

      const name = nameFromEmail(email)
      const role = inviteRole ? inviteRole.value : "editor"
      const row = doc.createElement("div")
      row.className = "member-row"
      row.setAttribute("data-member", name)

      const identity = doc.createElement("span")
      identity.className = "member-identity"
      const avatar = doc.createElement("span")
      avatar.className =
        "member-avatar " + avatarColors[memberList.children.length % avatarColors.length]
      avatar.textContent = initialsFromEmail(email)
      const detail = doc.createElement("span")
      const strong = doc.createElement("strong")
      strong.textContent = name
      const small = doc.createElement("small")
      small.textContent = email
      detail.append(strong, small)
      identity.append(avatar, detail)

      const roleCell = doc.createElement("span")
      const select = doc.createElement("select")
      select.className = "member-role"
      select.setAttribute("aria-label", "Role for " + name)
      ;["manager", "editor", "viewer"].forEach((value) => {
        const option = doc.createElement("option")
        option.value = value
        option.textContent = value.charAt(0).toUpperCase() + value.slice(1)
        if (value === role) option.selected = true
        select.appendChild(option)
      })
      roleCell.appendChild(select)

      const status = doc.createElement("span")
      status.className = "member-status member-status--pending"
      const statusDot = doc.createElement("i")
      status.append(statusDot, doc.createTextNode(" Invited"))

      const remove = doc.createElement("button")
      remove.type = "button"
      remove.className = "member-remove"
      remove.setAttribute("aria-label", "Remove " + name)
      remove.innerHTML = '<svg class="icon icon--xs"><use href="#i-trash"/></svg>'

      row.append(identity, roleCell, status, remove)
      memberList.appendChild(row)
      updateMemberCount()
      inviteEmail.value = ""
      toast("Invite sent to " + email + " as " + role + ".")
    })
  }

  if (memberList) {
    memberList.addEventListener("change", (event) => {
      const select = event.target.closest(".member-role")
      if (!select) return
      const row = select.closest(".member-row")
      const name = row ? row.getAttribute("data-member") : "Member"
      toast(name + " is now a " + select.value + ".")
    })

    memberList.addEventListener("click", (event) => {
      const button = event.target.closest(".member-remove")
      if (!button || button.disabled) return
      const row = button.closest(".member-row")
      const name = row ? row.getAttribute("data-member") : "Member"
      if (row) row.remove()
      updateMemberCount()
      toast(name + " was removed from the project.")
    })
  }

  const permissions = {
    manager: [
      ["Read every project file", "read"],
      ["Comment on files and cells", "comment"],
      ["Edit files, notes, and datasets", "edit"],
      ["Run lab sessions and automations", "run"],
      ["Invite and remove members", "invite"],
      ["Change roles and permissions", "roles"],
      ["Delete the project", "delete"],
    ],
    editor: [
      ["Read every project file", "read"],
      ["Comment on files and cells", "comment"],
      ["Edit files, notes, and datasets", "edit"],
      ["Run lab sessions and automations", "run"],
      ["Invite and remove members", "invite"],
      ["Change roles and permissions", "roles"],
      ["Delete the project", "delete"],
    ],
    viewer: [
      ["Read every project file", "read"],
      ["Comment on files and cells", "comment"],
      ["Edit files, notes, and datasets", "edit"],
      ["Run lab sessions and automations", "run"],
      ["Invite and remove members", "invite"],
      ["Change roles and permissions", "roles"],
      ["Delete the project", "delete"],
    ],
  }

  const permissionGrants = {
    manager: ["read", "comment", "edit", "run", "invite", "roles"],
    editor: ["read", "comment", "edit", "run"],
    viewer: ["read", "comment"],
  }

  const permissionList = doc.getElementById("permissionList")
  const roleTabs = doc.querySelectorAll("[data-role-tab]")

  function renderPermissions(role) {
    if (!permissionList || !permissions[role]) return
    permissionList.textContent = ""
    const grants = permissionGrants[role]

    permissions[role].forEach(([label, key]) => {
      const allowed = grants.includes(key)
      const row = doc.createElement("div")
      row.className = "permission-row"

      const mark = doc.createElement("span")
      mark.className = "perm-mark" + (allowed ? "" : " perm-mark--off")
      mark.innerHTML = allowed
        ? '<svg class="icon icon--xs"><use href="#i-check"/></svg>'
        : '<svg class="icon icon--xs"><use href="#i-close"/></svg>'

      const text = doc.createElement("span")
      text.textContent = label
      const tag = doc.createElement("small")
      tag.textContent = allowed ? "ALLOWED" : "BLOCKED"

      row.append(mark, text, tag)
      permissionList.appendChild(row)
    })

    roleTabs.forEach((tab) => {
      const active = tab.getAttribute("data-role-tab") === role
      tab.classList.toggle("is-active", active)
      tab.setAttribute("aria-selected", String(active))
    })
  }

  roleTabs.forEach((tab) => {
    tab.addEventListener("click", () => renderPermissions(tab.getAttribute("data-role-tab")))
  })

  renderPermissions("editor")
  updateMemberCount()
}
