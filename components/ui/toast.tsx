'use client'

import * as React from 'react'
import * as ToastPrimitives from '@radix-ui/react-toast'
import { cva, type VariantProps } from 'class-variance-authority'
import {
  CheckCircle,
  InfoCircle,
  WarningTriangle,
  WarningCircle,
  Xmark,
} from 'iconoir-react'

import { cn } from '@/lib/utils'

const ToastProvider = ToastPrimitives.Provider

const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Viewport
    ref={ref}
    data-slot="toast-viewport"
    className={cn(
      // Clear the app header, workspace actions, and task toolbar. Reserve the
      // bottom composer as well when a short viewport needs a smaller stack.
      'pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+11rem)] z-[100] flex max-h-[min(50dvh,calc(100dvh-22rem))] w-full flex-col gap-2 overflow-y-auto overscroll-y-contain p-3 sm:left-auto sm:right-3 sm:w-[390px] sm:p-0',
      className,
    )}
    {...props}
  />
))
ToastViewport.displayName = ToastPrimitives.Viewport.displayName

/**
 * Status toasts use the semantic accent tokens from DESIGN.md:
 * green = success, blue = info, amber = warning, red = failure.
 * Text stays on `foreground` for contrast in both themes; status is carried by
 * the tinted surface, accent bar, and icon (never color alone).
 */
const toastVariants = cva(
  'group pointer-events-auto relative flex w-full shrink-0 items-start gap-3 overflow-hidden rounded-lg border border-l-4 p-4 pr-14 text-popover-foreground shadow-lg transition-[transform,opacity,background-color,border-color] duration-200 ease-out data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-right-2 data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-right-2 data-[state=open]:motion-reduce:animate-none data-[state=closed]:motion-reduce:animate-none data-[swipe=end]:motion-reduce:animate-none motion-reduce:transition-none',
  {
    variants: {
      variant: {
        default: 'border-border border-l-border bg-popover',
        success:
          'border-accent-green/40 border-l-accent-green bg-[color-mix(in_oklch,var(--accent-green)_10%,var(--popover))]',
        info: 'border-accent-blue/40 border-l-accent-blue bg-[color-mix(in_oklch,var(--accent-blue)_10%,var(--popover))]',
        warning:
          'border-accent-amber/50 border-l-accent-amber bg-[color-mix(in_oklch,var(--accent-amber)_12%,var(--popover))]',
        destructive:
          'border-destructive/40 border-l-destructive bg-[color-mix(in_oklch,var(--destructive)_10%,var(--popover))]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

type ToastVariant = NonNullable<VariantProps<typeof toastVariants>['variant']>

const toastIcons: Record<
  ToastVariant,
  { Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>; label: string } | null
> = {
  default: null,
  success: { Icon: CheckCircle, label: 'Success' },
  info: { Icon: InfoCircle, label: 'Info' },
  warning: { Icon: WarningTriangle, label: 'Warning' },
  destructive: { Icon: WarningCircle, label: 'Error' },
}

/** Status icon for a toast variant. Renders nothing for `default`. */
function ToastIcon({ variant }: { variant?: ToastVariant | null }) {
  const entry = toastIcons[variant ?? 'default']
  if (!entry) return null
  const { Icon, label } = entry
  return (
    <span className="mt-0.5 shrink-0">
      <Icon aria-hidden="true" className="h-5 w-5 text-popover-foreground" strokeWidth={2} />
      <span className="sr-only">{label}:</span>
    </span>
  )
}

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> &
    VariantProps<typeof toastVariants>
>(({ className, variant, type, style, ...props }, ref) => {
  return (
    <ToastPrimitives.Root
      ref={ref}
      // Failures interrupt assistive tech; routine updates and warnings wait.
      type={type ?? (variant === 'destructive' ? 'foreground' : 'background')}
      data-variant={variant ?? 'default'}
      className={cn(toastVariants({ variant }), className)}
      // Let stacked cards scroll vertically while Radix handles horizontal swipes.
      style={{ touchAction: 'pan-y', ...style }}
      {...props}
    />
  )
})
Toast.displayName = ToastPrimitives.Root.displayName

const ToastAction = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Action
    ref={ref}
    className={cn(
      'inline-flex h-8 shrink-0 items-center justify-center self-center rounded-md border border-border bg-background/60 px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 max-sm:h-11 max-sm:min-w-11 group-data-[variant=success]:border-accent-green/50 group-data-[variant=info]:border-accent-blue/50 group-data-[variant=warning]:border-accent-amber/60 group-data-[variant=destructive]:border-destructive/50 group-data-[variant=destructive]:focus:ring-destructive',
      className,
    )}
    {...props}
  />
))
ToastAction.displayName = ToastPrimitives.Action.displayName

const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Close
    ref={ref}
    aria-label="Dismiss notification"
    className={cn(
      'absolute right-1.5 top-1.5 inline-flex size-9 items-center justify-center rounded-md text-popover-foreground/80 transition-colors hover:bg-popover-foreground/10 hover:text-popover-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-popover-foreground max-sm:size-11 motion-reduce:transition-none',
      className,
    )}
    toast-close=""
    {...props}
  >
    <Xmark aria-hidden="true" className="h-4 w-4" />
  </ToastPrimitives.Close>
))
ToastClose.displayName = ToastPrimitives.Close.displayName

const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Title
    ref={ref}
    data-slot="toast-title"
    className={cn('text-sm font-semibold leading-5 [overflow-wrap:anywhere]', className)}
    {...props}
  />
))
ToastTitle.displayName = ToastPrimitives.Title.displayName

const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Description
    ref={ref}
    data-slot="toast-description"
    className={cn('text-sm leading-5 text-popover-foreground/80 [overflow-wrap:anywhere]', className)}
    {...props}
  />
))
ToastDescription.displayName = ToastPrimitives.Description.displayName

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>

type ToastActionElement = React.ReactElement<typeof ToastAction>

export {
  type ToastProps,
  type ToastActionElement,
  type ToastVariant,
  toastVariants,
  ToastProvider,
  ToastViewport,
  Toast,
  ToastIcon,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
}
