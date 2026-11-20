/**
 * Example data for the code-examples gallery. Each entry is rendered through
 * the shared `CodeBlock` component (Shiki-highlighted at build time, with a
 * copy button), so snippets stay server-rendered and cheap.
 */

export type CodeExample = {
  /** Stable id, used as React key and anchor target. */
  id: string
  /** Category heading the example is grouped under. */
  category: string
  title: string
  description?: string
  /** Shiki language id, e.g. "bash", "ts", "tsx", "js". */
  language: string
  code: string
}

/** Display order for categories in the gallery. */
export const EXAMPLE_CATEGORIES = ["REST API", "TypeScript SDK", "JavaScript"] as const

export const CODE_EXAMPLES: CodeExample[] = [
  {
    id: "rest-contact-curl",
    category: "REST API",
    title: "Submit the contact form",
    description:
      "Every public form endpoint accepts JSON and returns `{ ok, message }`. Rate limits apply — a 429 means back off and retry later.",
    language: "bash",
    code: `curl -X POST https://spindle.example.com/api/contact \\
  -H "content-type: application/json" \\
  -d '{
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "topic": "support",
    "subject": "Question about exports",
    "message": "How do I export a workspace as CSV?"
  }'`,
  },
  {
    id: "rest-profile-get",
    category: "REST API",
    title: "Read the signed-in profile",
    description:
      "Authenticated endpoints read the session cookie automatically. Send credentials: include when calling cross-origin.",
    language: "bash",
    code: `curl https://spindle.example.com/api/profile \\
  -H "cookie: spindle_session=…"`,
  },
  {
    id: "sdk-setup",
    category: "TypeScript SDK",
    title: "Configure and call an endpoint",
    description:
      "The generated client in `src/generated/sdk` exposes one typed function per route. Regenerate it with `npx tsx scripts/generate-sdk.ts` after adding routes.",
    language: "ts",
    code: `import {
  configureSdk,
  postContact,
  getProfile,
} from "@/generated/sdk"

configureSdk({
  baseUrl: "https://spindle.example.com",
  headers: { authorization: \`Bearer \${token}\` },
})

const { reference } = (await postContact({
  name: "Ada Lovelace",
  email: "ada@example.com",
  topic: "support",
  subject: "Question about exports",
  message: "How do I export a workspace as CSV?",
})) as { reference: string }

console.log(\`Ticket \${reference} created\`)`,
  },
  {
    id: "sdk-path-params",
    category: "TypeScript SDK",
    title: "Dynamic path parameters",
    description:
      "Bracket segments in the route folder become `:param` placeholders. Pass them as the first argument.",
    language: "ts",
    code: `import { getAuthOauthProvider } from "@/generated/sdk"

const config = await getAuthOauthProvider(
  { provider: "google" },
  { query: { debug: false } },
)`,
  },
  {
    id: "js-fetch-contact",
    category: "JavaScript",
    title: "Plain fetch, no SDK",
    description:
      "The SDK is optional — every endpoint is plain JSON over HTTP. Handle non-2xx responses yourself when you skip it.",
    language: "js",
    code: `const response = await fetch("/api/contact", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    name: "Ada Lovelace",
    email: "ada@example.com",
    topic: "support",
    subject: "Question about exports",
    message: "How do I export a workspace as CSV?",
  }),
})

if (!response.ok) {
  throw new Error(\`Contact failed: \${response.status}\`)
}

const { message } = await response.json()
console.log(message)`,
  },
]

/** Groups examples by category in `EXAMPLE_CATEGORIES` order. */
export function groupExamplesByCategory(
  examples: CodeExample[] = CODE_EXAMPLES,
): { category: string; examples: CodeExample[] }[] {
  return EXAMPLE_CATEGORIES.map((category) => ({
    category,
    examples: examples.filter((example) => example.category === category),
  })).filter((group) => group.examples.length > 0)
}
