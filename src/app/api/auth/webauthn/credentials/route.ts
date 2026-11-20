import { getAuthBackend } from "@/lib/auth/backend"
import { accessTokenFromRequest, fail, ok } from "@/lib/auth/http"
import { getCredentialStore } from "@/lib/webauthn/credential-store"
import { toCredentialView } from "@/lib/webauthn/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/auth/webauthn/credentials — lists the caller's registered
 * security keys (public metadata only: id, label, transports, timestamps).
 * The COSE public key, AAGUID, and counter never leave the server.
 */
export async function GET(request: Request) {
  const access = accessTokenFromRequest(request)
  if (!access) return fail(401, "unauthenticated", "Sign in required.")

  const user = await getAuthBackend().getUserById(access.uid)
  if (!user) return fail(401, "unauthenticated", "Sign in required.")

  const credentials = getCredentialStore().listActive(user.id).map(toCredentialView)

  return ok({ credentials })
}
