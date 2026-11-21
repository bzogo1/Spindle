"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import Link from "next/link"

import { FEATURES } from "@/components/home-islands"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { getRecentlyViewedSlugs, recordFeatureView } from "@/lib/recently-viewed"

/**
 * "Recently viewed" strip rendered below the homepage feature grid. Feature
 * cards record their slug to localStorage on click (see `recordFeatureView`
 * in `@/lib/recently-viewed`); this component reads that list after mount and
 * renders matching feature cards, most recent first. Renders nothing until
 * the visitor has viewed at least one feature.
 */
export function RecentlyViewedFeatures() {
  const [slugs, setSlugs] = useState<string[]>([])

  useEffect(() => {
    setSlugs(getRecentlyViewedSlugs())
  }, [])

  const viewed = slugs
    .map((slug) => FEATURES.find((feature) => feature.slug === slug))
    .filter((feature): feature is (typeof FEATURES)[number] => Boolean(feature))

  if (viewed.length === 0) return null

  return (
    <div className="recently-viewed">
      <div className="recently-viewed-head">
        <h3 className="recently-viewed-title">Recently viewed</h3>
        <span className="recently-viewed-note">Pick up where you left off</span>
      </div>
      <div className="recently-viewed-grid">
        {viewed.map((feature) => (
          <Link
            key={feature.slug}
            href={feature.href}
            className="ui-card-link"
            onClick={() => recordFeatureView(feature.slug)}
          >
            <Card className="ui-feature-card ui-feature-card--compact">
              <CardHeader className="ui-feature-header">
                <span className="card-icon">
                  <Image
                    src={feature.iconSrc}
                    alt=""
                    width={24}
                    height={24}
                    className="size-4"
                  />
                </span>
                <CardTitle className="ui-feature-title">{feature.title}</CardTitle>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
