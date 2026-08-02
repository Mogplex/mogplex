import type { ReactNode } from 'react'
import { ConsentManagerClient } from './provider'

type ConsentManagerProps = {
  children: ReactNode
}

export function ConsentManager({ children }: ConsentManagerProps) {
  return (
    <ConsentManagerClient hostedEnabled={Boolean(process.env.NEXT_PUBLIC_C15T_URL)}>
      {children}
    </ConsentManagerClient>
  )
}
