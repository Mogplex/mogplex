"use client"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  getRunActionDescriptors,
  type FlowRunAction,
} from "@/lib/flows/run-presentation"
import type { FlowRunRecord } from "@/lib/types"

type ActionableRun = Pick<
  FlowRunRecord,
  "id" | "status" | "cancelable" | "repairable" | "requeueable"
>

export type ActiveRunActions = Partial<Record<string, FlowRunAction>>

export function RunActionButtons({
  run,
  activeRunActions,
  onRunAction,
  size = "sm",
  className,
}: {
  run: ActionableRun
  activeRunActions: ActiveRunActions
  onRunAction: (jobId: string, action: FlowRunAction) => void | Promise<void>
  size?: "sm" | "default"
  className?: string
}) {
  const actions = getRunActionDescriptors(run)

  if (actions.length === 0) return null

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {actions.map((descriptor) => {
        const activeAction = activeRunActions[run.id]
        const pending = activeAction === descriptor.action
        const disabled = activeAction !== undefined
        const variant =
          descriptor.emphasis === "primary"
            ? "default"
            : descriptor.emphasis === "destructive"
              ? "destructive"
              : "secondary"

        return (
          <Button
            key={descriptor.action}
            type="button"
            variant={variant}
            size={size}
            disabled={disabled}
            onClick={(event) => {
              event.stopPropagation()
              void Promise.resolve()
                .then(() => onRunAction(run.id, descriptor.action))
                .catch((error) => {
                  console.error("[flows] run action failed", {
                    jobId: run.id,
                    action: descriptor.action,
                    error: error instanceof Error ? error.message : "Unknown error",
                  })
                })
            }}
            className={descriptor.emphasis === "destructive" ? "shadow-none" : undefined}
          >
            {pending && <Spinner className="size-3.5" />}
            {descriptor.label}
          </Button>
        )
      })}
    </div>
  )
}
