"use client"

import { Check, X } from "lucide-react"

import { useLanguage } from "@/components/i18n/language-provider"
import { PASSWORD_MIN_LENGTH, PASSWORD_RULES, passwordRulesMet } from "./validation"

/** Live checklist of password requirements shown under the password field. */
export function PasswordRules({ password, id }: { password: string; id: string }) {
  const { t } = useLanguage()
  const met = passwordRulesMet(password)

  return (
    <ul className="auth-rules" id={id} aria-label={t("auth.passwordRequirements")}>
      {PASSWORD_RULES.map((rule) => {
        const passed = met[rule.id]
        return (
          <li key={rule.id} data-met={passed}>
            {passed ? <Check aria-hidden="true" /> : <X aria-hidden="true" />}
            <span>
              {rule.id === "length"
                ? t("auth.rule.length", { min: PASSWORD_MIN_LENGTH })
                : t(`auth.rule.${rule.id}`)}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
