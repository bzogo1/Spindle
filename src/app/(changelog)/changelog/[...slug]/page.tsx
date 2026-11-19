import { notFound } from "next/navigation"

/** Unknown changelog URLs keep the changelog shell and theme toggle. */
export default function ChangelogCatchAll() {
  notFound()
}
