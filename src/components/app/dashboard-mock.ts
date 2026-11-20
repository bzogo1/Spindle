/**
 * Static extras for the dashboard overview (DEV-268). Shaped like the fields
 * the workspace dashboard endpoint will expose once automations are wired up;
 * until then they live here as constants so the page stays presentational.
 */
export const dashboardMock = {
  automations: {
    count: 3,
    activeCount: 2,
  },
} as const
