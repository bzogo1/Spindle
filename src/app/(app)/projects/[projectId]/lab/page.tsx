import { LabScreen } from "@/components/app/lab-screen"
import { PaneBoundary } from "@/components/app/states/pane-boundary"

export default function ProjectLabPage({ params }: { params: Promise<{ projectId: string }> }) {
  return (
    <PaneBoundary screen="lab">
      {params.then(({ projectId }) => (
        <LabScreen projectId={projectId} />
      ))}
    </PaneBoundary>
  )
}
