import type { ReactNode } from 'react'
import { ConsentManagerClient } from './provider'

type ConsentManagerProps = {
  children: ReactNode
}

export function ConsentManager({ children }: ConsentManagerProps) {
  // The c15t banner/dialog overlays public pages and blocks Playwright clicks;
  // no spec exercises consent itself, so drop the UI entirely in e2e runs.
  if (process.env.PLAYWRIGHT === '1') {
    return <>{children}</>
  }

  return (
    <ConsentManagerClient
      hostedEnabled={
        process.env.NODE_ENV === 'production' &&
        Boolean(process.env.NEXT_PUBLIC_C15T_URL)
      }
    >
      {children}
    </ConsentManagerClient>
  )
}
