import { plans, type Plan } from "@/lib/pricing"

function priceLabel(plan: Plan): { main: string; note: string } {
  if (plan.price.amount === null) return { main: "Custom", note: "talk to us" }
  if (plan.price.amount === 0) return { main: "$0", note: "free forever" }
  return { main: `$${plan.price.amount}`, note: plan.price.unit }
}

function PlanCard({ plan }: { plan: Plan }) {
  const { main, note } = priceLabel(plan)
  return (
    <div className={plan.id === "hobby" ? "plan-card plan-card--free" : "plan-card"}>
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

export function PricingSection() {
  return (
    <div className="plan-cards">
      {plans.map((plan) => (
        <PlanCard key={plan.id} plan={plan} />
      ))}
    </div>
  )
}
