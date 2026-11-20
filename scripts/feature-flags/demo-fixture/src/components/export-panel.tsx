import { evaluateFlag } from "@/lib/feature-flags/evaluate"

export async function exportPanel() {
  const betaExport = evaluateFlag("beta-export")
  return { betaExport }
}
