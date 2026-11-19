"use client"

import { useEffect } from "react"

import { initSite } from "@/lib/interactions/site"

/** Header, mobile menu, scroll reveal, and the homepage demos. */
export function SiteInteractions() {
  useEffect(() => {
    initSite()
  }, [])

  return null
}
