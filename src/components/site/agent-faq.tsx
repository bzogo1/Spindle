"use client"

import * as React from "react"
import { Accordion as AccordionPrimitive } from "radix-ui"

/**
 * Agent page FAQ.
 *
 * Built on the Radix accordion (the same primitive the pricing FAQ uses) so
 * every item can animate its own open/close instead of snapping between
 * states. The panel height is driven by the `--radix-accordion-content-height`
 * custom property Radix measures for us; the keyframes that consume it live
 * in src/app/styles/agent.css.
 */

const faqItems = [
  {
    question: "What can the agent actually change?",
    answer:
      "Files inside the project: datasets, notebooks, scripts, spreadsheets, and notes. It can edit them in place, create folders, move and rename files, and update the references that pointed at them. It cannot reach outside the project it was invoked in.",
  },
  {
    question: "How autonomous is it, really?",
    answer:
      "A single request can carry a multi-step task: read the project, write a plan, edit or move files, run the lab, check the result, and report back. It keeps going without you between steps, and pauses at approval gates rather than guessing.",
  },
  {
    question: "What counts against my 20 requests?",
    answer:
      "One task is one request, however many steps it takes. Reviewing a diff, approving it, or rolling it back is free. A retry inside the same task does not start a new request either.",
  },
  {
    question: "Do the daily 20 carry over?",
    answer:
      "Each day brings a fresh twenty. Unused daily requests do not accumulate — which is why the referral bonus is kept separate. Those 50 are added once and never expire.",
  },
  {
    question: "How do referral requests work?",
    answer:
      "Share your link from the referral panel. When a new user creates an account with it, 50 requests are added to your plan one time. They never expire and are spent after your daily requests run out.",
  },
  {
    question: "Does it work in a shared project?",
    answer:
      "Yes. A run is attributed to whoever started it, and the diff and run log stay in the project. Teammates can review the same changes, and the history makes it clear what moved and why.",
  },
] as const

export function AgentFaq() {
  return (
    <AccordionPrimitive.Root type="multiple" defaultValue={["faq-0"]} className="agent-faq">
      {faqItems.map((item, index) => (
        <AccordionPrimitive.Item
          key={item.question}
          value={`faq-${index}`}
          className="agent-faq-item"
          data-reveal
          data-reveal-delay={index * 60}
        >
          <AccordionPrimitive.Header className="agent-faq-header">
            <AccordionPrimitive.Trigger className="agent-faq-trigger">
              <span className="agent-faq-question">{item.question}</span>
              <svg className="icon icon--xs" aria-hidden="true">
                <use href="#i-plus" />
              </svg>
            </AccordionPrimitive.Trigger>
          </AccordionPrimitive.Header>
          <AccordionPrimitive.Content className="agent-faq-content">
            <p>{item.answer}</p>
          </AccordionPrimitive.Content>
        </AccordionPrimitive.Item>
      ))}
    </AccordionPrimitive.Root>
  )
}
