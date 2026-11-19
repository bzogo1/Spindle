import type { MDXComponents } from "mdx/types"

import {
  createDocHeading,
  DocCode,
  DocGuideCard,
  DocGuideGrid,
  DocLink,
  DocNote,
  DocStep,
  DocSteps,
} from "@/components/docs/doc-blocks"

const components: MDXComponents = {
  h2: createDocHeading(),
  Note: DocNote,
  Steps: DocSteps,
  Step: DocStep,
  DocLink,
  DocCode,
  GuideGrid: DocGuideGrid,
  GuideCard: DocGuideCard,
}

export function useMDXComponents(): MDXComponents {
  return components
}
