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
    className={cn(
      'fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse gap-2 p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]',
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
  'group pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-lg border border-l-4 bg-popover p-4 pr-8 text-popover-foreground shadow-lg transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full',
  {
    variants: {
      variant: {
        default: 'border-border border-l-border',
        success:
          'success border-accent-green/40 border-l-accent-green bg-[color-mix(in_oklch,var(--accent-green)_10%,var(--popover))]',
        info: 'info border-accent-blue/40 border-l-accent-blue bg-[color-mix(in_oklch,var(--accent-blue)_10%,var(--popover))]',
        warning:
          'warning border-accent-amber/50 border-l-accent-amber bg-[color-mix(in_oklch,var(--accent-amber)_12%,var(--popover))]',
        destructive:
          'destructive border-destructive/40 border-l-destructive bg-[color-mix(in_oklch,var(--destructive)_10%,var(--popover))]',
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
  { Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>; className: string; label: string } | null
> = {
  default: null,
  success: { Icon: CheckCircle, className: 'text-accent-green', label: 'Success' },
  info: { Icon: InfoCircle, className: 'text-accent-blue', label: 'Info' },
  warning: { Icon: WarningTriangle, className: 'text-accent-amber', label: 'Warning' },
  destructive: { Icon: WarningCircle, className: 'text-destructive', label: 'Error' },
}

/** Status icon for a toast variant. Renders nothing for `default`. */
function ToastIcon({ variant }: { variant?: ToastVariant | null }) {
  const entry = toastIcons[variant ?? 'default']
  if (!entry) return null
  const { Icon, className, label } = entry
  return (
    <span className="mt-0.5 shrink-0">
      <Icon aria-hidden="true" className={cn('h-5 w-5', className)} strokeWidth={2} />
      <span className="sr-only">{label}:</span>
    </span>
  )
}

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> &
    VariantProps<typeof toastVariants>
>(({ className, variant, type, ...props }, ref) => {
  return (
    <ToastPrimitives.Root
      ref={ref}
      // Failures and warnings interrupt assistive tech; routine feedback waits.
      type={type ?? (variant === 'destructive' || variant === 'warning' ? 'foreground' : 'background')}
      data-variant={variant ?? 'default'}
      className={cn(toastVariants({ variant }), className)}
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
      'inline-flex h-8 shrink-0 items-center justify-center self-center rounded-md border border-border bg-background/60 px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 group-[.success]:border-accent-green/50 group-[.info]:border-accent-blue/50 group-[.warning]:border-accent-amber/60 group-[.destructive]:border-destructive/50 group-[.destructive]:focus:ring-destructive',
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
      'absolute right-2 top-2 rounded-md p-1 text-foreground/50 opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring group-hover:opacity-100',
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
    className={cn('text-sm font-semibold', className)}
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
    className={cn('text-sm text-muted-foreground', className)}
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
