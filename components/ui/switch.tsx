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
        'peer inline-flex h-5 w-9 min-w-9 shrink-0 cursor-pointer items-center rounded-full border border-muted-foreground bg-secondary p-px shadow-xs outline-none transition-colors data-[state=checked]:border-foreground data-[state=checked]:bg-primary focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={
          'pointer-events-none block size-4 shrink-0 rounded-full bg-foreground ring-0 data-[state=checked]:ml-auto data-[state=checked]:bg-[var(--neutral-11)]'
        }
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
