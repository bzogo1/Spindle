"use client"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { pricingFaqs } from "@/lib/pricing"

export function PricingFaq() {
  return (
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
  )
}
