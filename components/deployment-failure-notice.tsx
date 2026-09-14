'use client'

import { useSyncExternalStore } from 'react'
import { getDeploymentFailure, getServerDeploymentFailure, setDeploymentFailure, subscribeDeploymentFailure } from '@/lib/deployment-failure-store'
import { SCHEMA_DRIFT_MESSAGE } from '@/lib/schema-drift'

export function DeploymentFailureNotice() {
  const visible = useSyncExternalStore(subscribeDeploymentFailure, getDeploymentFailure, getServerDeploymentFailure)
  if (!visible) return null

  return (
    <div role="alert" className="fixed top-4 left-1/2 z-[100] flex w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 items-start gap-4 rounded-lg border border-border bg-background p-4 text-sm text-foreground shadow-lg">
      <p className="min-w-0 flex-1">{SCHEMA_DRIFT_MESSAGE}</p>
      <button type="button" onClick={() => setDeploymentFailure(false)} className="shrink-0 rounded text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
        Dismiss
      </button>
    </div>
  )
}
