# Edge WAF rules

Cloudflare WAF rulesets for the `spindle.app` zone, plus an nginx fallback
example. The authoritative documentation — rule table, managed-ruleset
notes, false-positive handling, testing, and rollout — is
[docs/security/waf-rules.md](../../docs/security/waf-rules.md).

| File                          | Upload as                                        |
| ----------------------------- | ------------------------------------------------ |
| `http-ruleset.custom.json`    | Ruleset for phase `http_request_firewall_custom` |
| `http-ruleset.ratelimit.json` | Ruleset for phase `http_ratelimit`               |
| `nginx-fallback.conf.example` | Not deployed; reference for origin-side fallback |

Validate before uploading:

```bash
node scripts/waf/validate-rules.mjs
```
