import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { FeatureFlagsProvider } from "./feature-flags-provider"
import { useFeatureFlag } from "./use-feature-flag"

function FlagProbe({ name }: { name: "new-dashboard" | "docs-search-v2" }) {
  const enabled = useFeatureFlag(name)
  return <output data-testid="flag">{enabled ? "on" : "off"}</output>
}

describe("useFeatureFlag", () => {
  it("returns the registry default without a provider", () => {
    // NODE_ENV=test in vitest: new-dashboard defaults to true in test.
    render(<FlagProbe name="new-dashboard" />)
    expect(screen.getByTestId("flag")).toHaveTextContent("on")
  })

  it("honors provider overrides", () => {
    render(
      <FeatureFlagsProvider environment="test" overrides={{ FEATURE_FLAG_NEW_DASHBOARD: "off" }}>
        <FlagProbe name="new-dashboard" />
      </FeatureFlagsProvider>,
    )
    expect(screen.getByTestId("flag")).toHaveTextContent("off")
  })

  it("honors a custom environment name", () => {
    render(
      <FeatureFlagsProvider environment="production">
        <FlagProbe name="new-dashboard" />
      </FeatureFlagsProvider>,
    )
    expect(screen.getByTestId("flag")).toHaveTextContent("off")
  })
})
