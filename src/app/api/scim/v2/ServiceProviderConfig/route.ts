import { NextResponse } from "next/server"

import { authenticateScimRequest, scimRateLimited } from "@/app/api/scim/shared"
import { buildServiceProviderConfig, SCIM_BASE_PATH } from "@/lib/scim"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/scim/v2/ServiceProviderConfig — the RFC 7643 ServiceProviderConfig
 * resource. Authenticated like every other SCIM endpoint: the response
 * describes where/how to authenticate, so it is not served anonymously.
 */
export async function GET(request: Request) {
  const limited = scimRateLimited(request)
  if (limited) return limited

  const auth = authenticateScimRequest(request)
  if (!auth.ok) return auth.response

  return NextResponse.json(buildServiceProviderConfig(`${SCIM_BASE_PATH}/ServiceProviderConfig`))
}
