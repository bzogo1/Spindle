"use client"

import { useEffect } from "react"

import { initChangelog } from "@/lib/interactions/changelog"

export function ChangelogInteractions() {
  useEffect(() => {
    initChangelog()
  }, [])

  return null
}
