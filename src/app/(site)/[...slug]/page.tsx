import { notFound } from "next/navigation"

/** Unknown URLs inside the marketing site render its 404 with the site shell. */
export default function SiteCatchAll() {
  notFound()
}
