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
        'peer group/switch relative inline-flex h-7 w-16 shrink-0 cursor-pointer items-center rounded-full border border-muted-foreground bg-secondary p-0.5 text-foreground shadow-xs outline-none transition-colors data-[state=checked]:border-foreground data-[state=checked]:bg-primary data-[state=checked]:text-[var(--neutral-11)] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-2 hidden items-center text-[11px] font-semibold group-data-[state=checked]/switch:flex">
        On
      </span>
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[11px] font-semibold group-data-[state=checked]/switch:hidden">
        Off
      </span>
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={
          'pointer-events-none block size-5 rounded-full bg-foreground ring-0 transition-transform data-[state=checked]:translate-x-[2.375rem] data-[state=checked]:bg-[var(--neutral-11)] data-[state=unchecked]:translate-x-0 motion-reduce:transition-none'
        }
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
