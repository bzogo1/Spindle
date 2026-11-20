import { writeFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { PAYLOAD_BUILDERS, serializeWebhookPayload } from "../contract/payloads"
import type { WebhookEventType } from "../contract/schemas"

/**
 * Regenerates the static JSON fixtures in ./fixtures from the contract
 * payload builders, so fixture files can never drift from the schema:
 *
 *   npx tsx scripts/webhooks/test-tools/gen-fixtures.ts
 *
 * Each fixture is one pretty-printed, contract-valid payload per event type.
 * `send.mjs`/`serve.mjs --demo` refresh `id`, `idempotencyKey` and `created`
 * at send time unless told otherwise, so fixtures stay replay-safe.
 */

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, "fixtures")
mkdirSync(outDir, { recursive: true })

const types = Object.keys(PAYLOAD_BUILDERS) as WebhookEventType[]

for (const type of types) {
  const payload = PAYLOAD_BUILDERS[type]()
  const file = join(outDir, `${type}.json`)
  writeFileSync(file, `${JSON.stringify(JSON.parse(serializeWebhookPayload(payload)), null, 2)}\n`)
  console.log(`wrote ${file}`)
}
