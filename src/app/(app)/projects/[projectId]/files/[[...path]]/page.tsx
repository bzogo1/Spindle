import { FilesScreen } from "@/components/app/files-screen"

export default async function ProjectFilesPage({
  params,
}: {
  params: Promise<{ projectId: string; path?: string[] }>
}) {
  const { projectId, path } = await params
  return <FilesScreen projectId={projectId} path={path ?? []} />
}
