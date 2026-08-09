'use client'

import * as React from 'react'
import * as SheetPrimitive from '@radix-ui/react-dialog'
import { Xmark } from 'iconoir-react'

import { cn } from '@/lib/utils'

const SHEET_SIZE_KEY_PREFIX = 'mogplex.sheet.size'
const SHEET_DEFAULT_WIDTH = 360
const SHEET_DEFAULT_HEIGHT = 360
const SHEET_MIN_WIDTH = 280
const SHEET_MIN_HEIGHT = 180

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50',
        className,
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = 'right',
  style,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  const horizontal = side === 'left' || side === 'right'
  const storageKey = `${SHEET_SIZE_KEY_PREFIX}.${side}`
  const [size, setSize] = React.useState(
    horizontal ? SHEET_DEFAULT_WIDTH : SHEET_DEFAULT_HEIGHT,
  )
  const [resizing, setResizing] = React.useState(false)
  const activePointerId = React.useRef<number | null>(null)

  React.useEffect(() => {
    const storedSize = Number(window.localStorage.getItem(storageKey))
    if (!Number.isFinite(storedSize) || storedSize <= 0) return
    const max = horizontal ? window.innerWidth - 48 : window.innerHeight - 48
    setSize(
      horizontal
        ? clamp(storedSize, SHEET_MIN_WIDTH, max)
        : clamp(storedSize, SHEET_MIN_HEIGHT, max),
    )
  }, [horizontal, storageKey])

  React.useEffect(() => {
    if (!resizing) return

    const onPointerMove = (event: PointerEvent) => {
      if (
        activePointerId.current !== null &&
        event.pointerId !== activePointerId.current
      ) {
        return
      }

      const max = horizontal ? window.innerWidth - 48 : window.innerHeight - 48
      const rawSize =
        side === 'left'
          ? event.clientX
          : side === 'right'
            ? window.innerWidth - event.clientX
            : side === 'top'
              ? event.clientY
              : window.innerHeight - event.clientY
      const nextSize = horizontal
        ? clamp(rawSize, SHEET_MIN_WIDTH, max)
        : clamp(rawSize, SHEET_MIN_HEIGHT, max)
      setSize(nextSize)
      window.localStorage.setItem(storageKey, String(nextSize))
    }
    const stopResizing = () => {
      activePointerId.current = null
      setResizing(false)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', stopResizing)
    window.addEventListener('pointercancel', stopResizing)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', stopResizing)
      window.removeEventListener('pointercancel', stopResizing)
    }
  }, [horizontal, resizing, side, storageKey])

  const sheetStyle = {
    ...(horizontal
      ? { width: size, maxWidth: 'calc(100vw - 48px)' }
      : { height: size, maxHeight: 'calc(100vh - 48px)' }),
    ...style,
  } as React.CSSProperties

  const resetSize = () => {
    const nextSize = horizontal ? SHEET_DEFAULT_WIDTH : SHEET_DEFAULT_HEIGHT
    setSize(nextSize)
    window.localStorage.setItem(storageKey, String(nextSize))
  }

  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-resizing={resizing ? 'true' : 'false'}
        className={cn(
          'bg-background data-[state=open]:animate-in data-[state=closed]:animate-out fixed z-50 flex flex-col gap-4 shadow-lg transition-[transform,opacity] ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500',
          side === 'right' &&
            'data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm',
          side === 'left' &&
            'data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm',
          side === 'top' &&
            'data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top inset-x-0 top-0 h-auto border-b',
          side === 'bottom' &&
            'data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom inset-x-0 bottom-0 h-auto border-t',
          className,
        )}
        style={sheetStyle}
        {...props}
      >
        <div
          role="separator"
          aria-label="Resize sheet"
          aria-orientation={horizontal ? 'vertical' : 'horizontal'}
          tabIndex={0}
          onDoubleClick={resetSize}
          onPointerDown={(event) => {
            activePointerId.current = event.pointerId
            setResizing(true)
          }}
          className={cn(
            'sheet-resizer absolute z-50 touch-none outline-none',
            side === 'left' && 'inset-y-0 right-0 w-2 cursor-col-resize',
            side === 'right' && 'inset-y-0 left-0 w-2 cursor-col-resize',
            side === 'top' && 'inset-x-0 bottom-0 h-2 cursor-row-resize',
            side === 'bottom' && 'inset-x-0 top-0 h-2 cursor-row-resize',
          )}
        />
        {children}
        <SheetPrimitive.Close className="ring-offset-background focus:ring-ring data-[state=open]:bg-secondary absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none">
          <Xmark className="size-4" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('flex flex-col gap-1.5 p-4', className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn('mt-auto flex flex-col gap-2 p-4', className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('text-foreground font-semibold', className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
