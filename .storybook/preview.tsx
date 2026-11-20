import { useEffect } from "react"

import type { Preview } from "@storybook/react-vite"

// Design tokens + Tailwind utilities. Token overrides key off `.dark` on
// <html> (same as the app's pre-paint theme script), so the decorator below
// toggles that class to switch themes.
import "../src/app/styles/index.css"
import "../src/app/styles/app.css"
import "../src/app/styles/ui.css"

const preview: Preview = {
  globalTypes: {
    theme: {
      description: "Site color theme",
      defaultValue: "dark",
      toolbar: {
        icon: "circlehollow",
        items: [
          { value: "dark", title: "Dark" },
          { value: "light", title: "Light" },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme === "light" ? "light" : "dark"
      useEffect(() => {
        document.documentElement.classList.toggle("dark", theme === "dark")
      }, [theme])
      return (
        <div className="bg-background text-foreground" style={{ minHeight: "100vh" }}>
          <div style={{ padding: "2rem" }}>
            <Story />
          </div>
        </div>
      )
    },
  ],
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: { disable: true },
    layout: "padded",
  },
}

export default preview
