/**
 * Demo fixture registry — mimics the shape the real flag module is expected
 * to expose (array of definitions with rollout attributes).
 */
export const FLAG_REGISTRY = [
  { key: "new-dashboard", percent: 100, enabled: true },
  { key: "beta-export", status: "off" },
  { key: "dark-mode", percent: 40 },
  { key: "legacy-widget", percent: 100 },
  { flag: "kill-switch-logs", enabled: false },
]
