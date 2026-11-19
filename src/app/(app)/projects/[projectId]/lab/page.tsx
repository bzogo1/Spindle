import { LabScreen } from "@/components/app/lab-screen"

export default async function ProjectLabPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  return <LabScreen projectId={projectId} />
}
