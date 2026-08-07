import { Suspense } from "react"
import { ControlShell } from "@/components/control/control-shell"
import { emptyControlData } from "@/lib/control/utils"

type Props = {
  params: Promise<{ scope: string }>
  searchParams: Promise<{ mission?: string }>
}

export default async function ControlPage({ params, searchParams }: Props) {
  const { scope: _scope } = await params
  const { mission } = await searchParams
  // Missions are not DB-backed yet (lib/orchestrations); until they are, the
  // surface starts empty instead of rendering demo content.
  const initialData = emptyControlData()

  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <div className="size-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
        </div>
      }
    >
      <ControlShell initialData={initialData} initialMissionId={mission} />
    </Suspense>
  )
}
