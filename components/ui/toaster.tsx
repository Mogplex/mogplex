'use client'

import { useToast } from '@/hooks/use-toast'
import { useToastViewport } from '@/hooks/use-toast-viewport'
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastIcon,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from '@/components/ui/toast'

export function Toaster() {
  const { toasts } = useToast()
  const viewport = useToastViewport(toasts.length > 0)

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, variant, ...props }) {
        return (
          <Toast key={id} variant={variant} {...props}>
            <ToastIcon variant={variant} />
            <div className="grid min-w-0 flex-1 gap-1 group-data-[compact]/viewport:flex group-data-[compact]/viewport:items-center group-data-[compact]/viewport:gap-2">
              <div tabIndex={viewport?.compact ? 0 : undefined} role={viewport?.compact ? 'region' : undefined} aria-label={viewport?.compact ? 'Notification details' : undefined} className="grid min-w-0 flex-1 gap-1 group-data-[compact]/viewport:max-h-11 group-data-[compact]/viewport:overflow-y-auto focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring">
                {title && <ToastTitle>{title}</ToastTitle>}
                {description && <ToastDescription>{description}</ToastDescription>}
              </div>
              {action && <div className="pt-2 group-data-[compact]/viewport:shrink-0 group-data-[compact]/viewport:pt-0">{action}</div>}
            </div>
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport style={viewport ? { top: viewport.top, maxHeight: viewport.maxHeight } : undefined} data-compact={viewport?.compact ? '' : undefined} />
    </ToastProvider>
  )
}
