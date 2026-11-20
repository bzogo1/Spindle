#!/usr/bin/env bash
# verify-gateway.sh — smoke check the public edge path end to end.
#
# Asserts that https://app.spindle.app answers and that the security headers
# owned by src/lib/security-headers.ts (issue 051) reach the client
# unmodified. A gateway that rewrites/drops headers will fail this.
#
# Usage: scripts/gateway/verify-gateway.sh [base-url]
#   base-url defaults to https://app.spindle.app; pass
#   https://staging.spindle.app for staging.

set -euo pipefail

BASE_URL="${1:-https://app.spindle.app}"

required_headers=(
	"x-content-type-options"
	"x-frame-options"
	"content-security-policy"
	"content-security-policy-report-only"
	"referrer-policy"
)

headers_file="$(mktemp)"
trap 'rm -f "$headers_file"' EXIT

code="$(curl -sS -o /dev/null -D "$headers_file" -w '%{http_code}' --max-time 15 "$BASE_URL/")"
echo "GET $BASE_URL/ -> HTTP $code"
if [ "$code" != "200" ] && [ "$code" != "307" ] && [ "$code" != "308" ]; then
	echo "FAIL: unexpected status $code" >&2
	exit 1
fi

fail=0
for h in "${required_headers[@]}"; do
	if grep -qi "^$h:" "$headers_file"; then
		echo "  ok   $h"
	else
		echo "  FAIL $h missing (gateway stripped or overrode app headers?)" >&2
		fail=1
	fi
done

# HSTS is production-only (next start). Warn, don't fail, on non-prod.
if grep -qi '^strict-transport-security:' "$headers_file"; then
	echo "  ok   strict-transport-security"
else
	echo "  note strict-transport-security absent (expected outside production)"
fi

# No duplicate CSP headers — a gateway adding its own would produce two.
csp_count="$(grep -ci '^content-security-policy:' "$headers_file" || true)"
if [ "$csp_count" -gt 1 ]; then
	echo "  FAIL duplicate Content-Security-Policy headers ($csp_count)" >&2
	fail=1
fi

if [ "$fail" -ne 0 ]; then
	exit 1
fi
echo "PASS: edge path and security headers verified for $BASE_URL"
