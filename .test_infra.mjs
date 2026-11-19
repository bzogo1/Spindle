import { chromium } from "playwright-core"

const errors = []
const warnings = []
const pageErrors = []
const failures = []

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()

page.on("console", (msg) => {
  if (msg.type() === "error") {
    errors.push(`ERROR: ${msg.text()}`)
  } else if (msg.type() === "warning") {
    warnings.push(`WARNING: ${msg.text()}`)
  }
})
page.on("pageerror", (e) => pageErrors.push(e.message))

const url = process.env.INFRA_URL || "http://127.0.0.1:3000/infrastructure"

try {
  const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
  console.log("STATUS:", res ? res.status() : "no-response", "URL:", url)
  if (!res || res.status() !== 200) {
    failures.push(`Expected a 200 response, got ${res ? res.status() : "no response"}`)
  }
  await page.waitForTimeout(2500)

  const targets = {
    "main nav": ".ui-main-nav",
    "mobile nav": ".ui-mobile-nav",
    "sign-in trigger": ".ui-signin-trigger",
    socials: ".socials",
    "infrastructure trace": ".infra-trace-steps",
  }

  const contents = {}
  for (const [label, selector] of Object.entries(targets)) {
    const html = await page
      .locator(selector)
      .innerHTML()
      .catch(() => null)
    contents[label] = html
    if (!html) {
      failures.push(`Missing UI element: ${label} (${selector})`)
    }
  }

  for (const [label, html] of Object.entries(contents)) {
    console.log(`--- ${label} length:`, html ? html.length : "MISSING/NULLED")
  }

  const activeStep = await page.locator(".infra-trace-step.is-active").count()
  const activeNode = await page.locator(".infra-node.is-active").count()
  console.log("--- active trace steps:", activeStep, " active nodes:", activeNode)

  if (activeStep === 0) failures.push("Infrastructure trace has no active step")
  if (activeNode === 0) failures.push("Infrastructure trace has no active node")

  console.log("=== CONSOLE ERRORS ===")
  console.log(errors.join("\n") || "(none)")
  console.log("=== CONSOLE WARNINGS ===")
  console.log(warnings.join("\n") || "(none)")
  console.log("=== PAGE ERRORS ===")
  console.log(pageErrors.join("\n") || "(none)")

  if (errors.length) failures.push(`${errors.length} console error(s)`)
  if (pageErrors.length) failures.push(`${pageErrors.length} page error(s)`)
} catch (e) {
  failures.push(`Exception: ${e.message}`)
  console.log("EXCEPTION:", e.message)
} finally {
  await browser.close()
}

console.log("=== RESULT ===")
if (failures.length) {
  console.error("FAILED:")
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exitCode = 1
} else {
  console.log("PASS: infrastructure page rendered with no console or page errors.")
}
