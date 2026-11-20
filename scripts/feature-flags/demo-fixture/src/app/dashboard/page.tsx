import { useFeatureFlag } from "@/components/feature-flags/use-feature-flag"

export function Dashboard() {
  const newDashboard = useFeatureFlag("new-dashboard")
  const darkMode = useFeatureFlag("dark-mode")
  const mystery = useFeatureFlag("not-a-real-flag")

  return (
    <div className={darkMode ? "dark" : "light"}>
      {newDashboard ? <NewDashboard /> : <OldDashboard />}
      {mystery ? <Experimental /> : null}
    </div>
  )
}

function NewDashboard() {
  return null
}
function OldDashboard() {
  return null
}
function Experimental() {
  return null
}
