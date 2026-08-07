import { Suspense } from "react"
import { ControlShell } from "@/components/control/control-shell"
import { getControlSeedData } from "@/lib/control/seed"

type Props = {
  params: Promise<{ scope: string }>
  searchParams: Promise<{ mission?: string }>
}

export default async function ControlPage({ params, searchParams }: Props) {
  const { scope: _scope } = await params
  const { mission } = await searchParams
  const seedData = getControlSeedData()

  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <div className="size-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
        </div>
      }
    >
      <ControlShell initialData={seedData} initialMissionId={mission} />
    </Suspense>
  )
}
