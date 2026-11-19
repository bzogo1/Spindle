"use client"

import { Check, X } from "lucide-react"

import { PASSWORD_RULES, passwordRulesMet } from "./validation"

/** Live checklist of password requirements shown under the password field. */
export function PasswordRules({ password, id }: { password: string; id: string }) {
  const met = passwordRulesMet(password)

  return (
    <ul className="auth-rules" id={id} aria-label="Password requirements">
      {PASSWORD_RULES.map((rule) => {
        const passed = met[rule.id]
        return (
          <li key={rule.id} data-met={passed}>
            {passed ? <Check aria-hidden="true" /> : <X aria-hidden="true" />}
            <span>{rule.label}</span>
          </li>
        )
      })}
    </ul>
  )
}
