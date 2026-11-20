import { FilesScreen } from "@/components/app/files-screen"
import { PaneBoundary } from "@/components/app/states/pane-boundary"

export default function ProjectFilesPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; path?: string[] }>
  searchParams: Promise<{ preview?: string | string[] }>
}) {
  return (
    <PaneBoundary screen="filesTree">
      {Promise.all([params, searchParams]).then(([{ projectId, path }, { preview }]) => (
        <FilesScreen
          projectId={projectId}
          path={path ?? []}
          initialPreviewId={typeof preview === "string" ? preview : undefined}
        />
      ))}
    </PaneBoundary>
  )
}
