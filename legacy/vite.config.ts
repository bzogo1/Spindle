import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        platform: path.resolve(__dirname, "platform.html"),
        solutions: path.resolve(__dirname, "solutions.html"),
        pricing: path.resolve(__dirname, "pricing.html"),
        docs: path.resolve(__dirname, "docs.html"),
        about: path.resolve(__dirname, "about.html"),
        automations: path.resolve(__dirname, "automations.html"),
        agent: path.resolve(__dirname, "agent.html"),
        lab: path.resolve(__dirname, "lab.html"),
        infrastructure: path.resolve(__dirname, "infrastructure.html"),
        collaboration: path.resolve(__dirname, "collaboration.html"),
        changelog: path.resolve(__dirname, "changelog.html"),
      },
    },
  },
})
