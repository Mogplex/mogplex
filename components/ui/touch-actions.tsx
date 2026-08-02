"use client"

import { useState, useRef, useCallback, type ReactNode } from "react"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerClose,
} from "@/components/ui/drawer"

export type ActionItem =
  | { type: "item"; label: string; onSelect: () => void; destructive?: boolean }
  | { type: "separator" }

interface Props {
  actions: ActionItem[]
  /** Optional title shown in the mobile drawer header */
  title?: string
  children: ReactNode
}

/**
 * Renders a ContextMenu on desktop, a bottom Drawer (triggered by long-press) on mobile.
 * Pass the trigger element as children and actions as a declarative list.
 */
export function TouchActions({ actions, title, children }: Props) {
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <MobileTouchActions actions={actions} title={title}>
        {children}
      </MobileTouchActions>
    )
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        {actions.map((action, i) => {
          if (action.type === "separator") {
            return <ContextMenuSeparator key={i} />
          }
          return (
            <ContextMenuItem
              key={i}
              className={`text-xs font-mono ${action.destructive ? "text-destructive" : ""}`}
              onSelect={action.onSelect}
            >
              {action.label}
            </ContextMenuItem>
          )
        })}
      </ContextMenuContent>
    </ContextMenu>
  )
}

const LONG_PRESS_MS = 500

function MobileTouchActions({ actions, title, children }: Props) {
  const [open, setOpen] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const movedRef = useRef(false)

  const startPress = useCallback(() => {
    movedRef.current = false
    timerRef.current = setTimeout(() => {
      if (!movedRef.current) setOpen(true)
    }, LONG_PRESS_MS)
  }, [])

  const cancelPress = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const handleMove = useCallback(() => {
    movedRef.current = true
    cancelPress()
  }, [cancelPress])

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <div
        onTouchStart={startPress}
        onTouchEnd={cancelPress}
        onTouchMove={handleMove}
        onContextMenu={(e) => {
          e.preventDefault()
          setOpen(true)
        }}
      >
        {children}
      </div>
      <DrawerContent>
        {title && (
          <div className="px-4 pt-2 pb-1">
            <DrawerTitle className="text-sm">{title}</DrawerTitle>
          </div>
        )}
        <div className="flex flex-col px-2 pb-4 pt-2">
          {actions.map((action, i) => {
            if (action.type === "separator") {
              return <div key={i} className="my-1 h-px bg-border" />
            }
            return (
              <DrawerClose key={i} asChild>
                <button
                  onClick={action.onSelect}
                  className={`rounded-md px-4 py-3 text-left text-sm transition-colors hover:bg-accent ${
                    action.destructive ? "text-destructive" : "text-foreground"
                  }`}
                >
                  {action.label}
                </button>
              </DrawerClose>
            )
          })}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
