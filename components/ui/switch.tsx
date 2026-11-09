'use client'

import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'

import { cn } from '@/lib/utils'

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer relative inline-flex h-5 w-9 min-w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-border bg-secondary p-px outline-none transition-colors before:absolute before:-inset-1 data-[state=checked]:border-switch-on data-[state=checked]:bg-switch-on focus-visible:ring-ring/50 focus-visible:ring-[3px] motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={
          'pointer-events-none block size-3.5 shrink-0 rounded-full bg-[var(--neutral-5)] ring-0 transition-colors data-[state=checked]:ml-auto data-[state=checked]:bg-white motion-reduce:transition-none'
        }
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
