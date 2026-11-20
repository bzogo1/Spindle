"use client"

import { useEffect, useState } from "react"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import {
  billingPeriods,
  comparisonRows,
  plans,
  pricingFaqs,
  yearlyDiscountNote,
  type BillingPeriod,
  type Plan,
} from "@/lib/pricing"

const STORAGE_KEY = "spindle:pricing-billing"

function isBillingPeriod(value: unknown): value is BillingPeriod {
  return value === "yearly" || value === "monthly"
}

function priceLabel(plan: Plan, period: BillingPeriod): { main: string; note: string } {
  const price = plan.price[period]
  if (price.amount === null) return { main: "Custom", note: "talk to us" }
  if (price.amount === 0) return { main: "$0", note: "free forever" }
  return {
    main: `$${price.amount}`,
    note: price.perSeat ? price.unit : `per ${price.unit === "/mo" ? "month" : "year"}`,
  }
}

function PlanCard({ plan, period }: { plan: Plan; period: BillingPeriod }) {
  const { main, note } = priceLabel(plan, period)
  return (
    <div className={`plan-card${plan.id === "hobby" ? "plan-card--free" : ""}`}>
      <div className="plan-head">
        <span className="plan-name">{plan.name}</span>
        {plan.badge ? <span className="plan-tag">{plan.badge}</span> : null}
      </div>
      <div className="plan-price-row">
        <span className="plan-price">{main}</span>
        <span className="plan-price-note">{note}</span>
      </div>
      <p>{plan.tagline}</p>
      <ul>
        {plan.features.map((feature) => (
          <li key={feature.text}>
            {feature.link ? (
              <>
                {feature.text} <a href={feature.link.href}>{feature.link.label}</a>
              </>
            ) : (
              feature.text
            )}
          </li>
        ))}
      </ul>
      <a href={plan.cta.href} className="btn btn--primary btn--full">
        {plan.cta.label}
      </a>
      {plan.id === "enterprise" ? (
        <a className="text-link plan-security-link" href="/security">
          Security and trust centre{" "}
          <svg className="icon icon--xs" aria-hidden="true">
            <use href="#i-arrow-right" />
          </svg>
        </a>
      ) : null}
    </div>
  )
}

function ComparisonCell({ value }: { value: string | boolean }) {
  if (value === true) {
    return (
      <td className="compare-check">
        <svg className="icon icon--sm" aria-label="Included" role="img">
          <use href="#i-check" />
        </svg>
      </td>
    )
  }
  if (value === false || value === "—") {
    return <td className="compare-empty">—</td>
  }
  return <td>{value}</td>
}

export function PricingSection({ initialBilling }: { initialBilling?: BillingPeriod }) {
  // `initialBilling` comes from the server-rendered ?billing= URL param so the
  // first client render already matches; default to monthly during SSR.
  const [billing, setBilling] = useState<BillingPeriod>(initialBilling ?? "monthly")

  // URL params and localStorage are client-only, so when the server didn't
  // supply `initialBilling` the preference can only be applied after
  // hydration. Bail out without setState when it wouldn't change anything.
  useEffect(() => {
    if (initialBilling) return
    const fromUrl = new URLSearchParams(window.location.search).get("billing")
    const stored = isBillingPeriod(fromUrl) ? fromUrl : window.localStorage.getItem(STORAGE_KEY)
    if (isBillingPeriod(stored)) {
      setBilling((current) => (current === stored ? current : stored))
    }
  }, [initialBilling])

  function selectBilling(period: BillingPeriod) {
    setBilling(period)
    window.localStorage.setItem(STORAGE_KEY, period)
    const url = new URL(window.location.href)
    if (period === "yearly") url.searchParams.set("billing", "yearly")
    else url.searchParams.delete("billing")
    window.history.replaceState(null, "", url)
  }

  return (
    <>
      <div className="billing-toggle" role="group" aria-label="Billing period">
        {billingPeriods.map((period) => (
          <button
            key={period.id}
            type="button"
            className="billing-toggle__option"
            aria-pressed={billing === period.id}
            onClick={() => selectBilling(period.id)}
          >
            {period.label}
            {period.id === "yearly" ? (
              <span className="billing-toggle__badge">{yearlyDiscountNote}</span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="plan-cards plan-cards--three">
        {plans.map((plan) => (
          <PlanCard key={plan.id} plan={plan} period={billing} />
        ))}
      </div>

      <div className="compare-wrap" role="region" aria-label="Plan comparison table" tabIndex={0}>
        <table className="compare-table">
          <caption className="compare-caption">Plan comparison</caption>
          <thead>
            <tr>
              <th scope="col" className="compare-feature-col">
                <span className="compare-sr">Feature</span>
              </th>
              {plans.map((plan) => (
                <th key={plan.id} scope="col">
                  {plan.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {comparisonRows.map((row, rowIndex) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {plans.map((plan) => (
                  <ComparisonCell key={plan.id} value={plan.comparison[rowIndex]} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pricing-faq">
        <h2 className="pricing-faq-title">Questions, answered.</h2>
        <Accordion type="single" collapsible className="ui-faq">
          {pricingFaqs.map((faq, index) => (
            <AccordionItem key={faq.question} value={`faq-${index}`} className="ui-faq-item">
              <AccordionTrigger className="ui-faq-trigger">{faq.question}</AccordionTrigger>
              <AccordionContent className="ui-faq-content">{faq.answer}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </>
  )
}
