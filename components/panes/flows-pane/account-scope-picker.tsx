"use client"

import { useState } from "react"
import { NavArrowDown } from "iconoir-react"
import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  describeTriggerAccounts,
  installationLoginLabel,
} from "@/lib/flows/trigger-accounts"
import type { FlowStartFilter } from "@/lib/types"
import type { Installation } from "./types"

export function installationAccountTypeLabel(accountType: string | null | undefined) {
  return accountType?.toLowerCase() === "organization"
    ? "Organization"
    : accountType?.toLowerCase() === "user"
      ? "Personal"
      : "GitHub account"
}

function scopeDataValue(
  selected: number[] | null,
  scope: FlowStartFilter["scope"],
) {
  if (selected !== null) return selected.join(",")
  return scope === "all" ? "all" : `all-${scope}`
}

/**
 * Multi-select for the GitHub accounts a GitHub event trigger runs on. No
 * selection means every connected account, including ones connected later.
 */
export function AccountScopePicker({
  installations,
  selected,
  scope = "all",
  onChange,
}: {
  installations: Installation[]
  // `null` = all connected accounts (narrowed by `scope`).
  selected: number[] | null
  scope?: FlowStartFilter["scope"]
  onChange: (installationIds: number[]) => void
}) {
  const [open, setOpen] = useState(false)
  const selectedIds = selected ?? []
  const allAccounts = selected === null && scope === "all"
  const summary = describeTriggerAccounts(selected, installations, scope)
  const detail = selected === null
    ? "Includes accounts you connect later"
    : `${selectedIds.length} of ${installations.length} connected accounts`

  const toggle = (installationId: number) => {
    onChange(
      selectedIds.includes(installationId)
        ? selectedIds.filter((id) => id !== installationId)
        : [...selectedIds, installationId],
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-label="GitHub accounts"
          aria-expanded={open}
          data-testid="flow-trigger-account"
          data-value={scopeDataValue(selected, scope)}
          disabled={installations.length === 0}
          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md border border-border bg-input/40 px-3 py-2 text-left text-foreground transition-colors hover:border-border/80 hover:bg-input/55 disabled:opacity-60"
        >
          <span className="min-w-0">
            <span className="block truncate text-xs font-medium">
              {installations.length === 0 ? "No GitHub accounts connected" : summary}
            </span>
            {installations.length > 0 ? (
              <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                {detail}
              </span>
            ) : null}
          </span>
          <NavArrowDown
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[280px] border-border bg-popover p-0 shadow-2xl"
      >
        <div className="border-b border-border px-3 py-2.5">
          <div className="text-[10px] font-semibold tracking-[0.15em] text-muted-foreground uppercase">
            GitHub accounts
          </div>
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
            Choose which connected accounts can start this workflow.
          </p>
        </div>
        <div className="max-h-60 overflow-y-auto p-1.5">
          <label
            data-testid="flow-trigger-account-option-all"
            className={cn(
              "flex w-full cursor-pointer items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-foreground/[0.05]",
              allAccounts && "bg-foreground/[0.04]",
            )}
          >
            <Checkbox
              checked={allAccounts}
              onCheckedChange={() => onChange([])}
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="block text-xs font-medium text-foreground">
                All accounts
              </span>
              <span className="mt-0.5 block text-[10px] text-muted-foreground">
                Every connected account, including ones you connect later
              </span>
            </span>
          </label>
          <div className="my-1 border-t border-border" />
          {installations.map((installation) => (
            <label
              key={installation.installation_id}
              data-testid={`flow-trigger-account-option-${installation.installation_id}`}
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-left text-xs text-foreground transition-colors hover:bg-foreground/[0.05]"
            >
              <Checkbox
                checked={selectedIds.includes(installation.installation_id)}
                onCheckedChange={() => toggle(installation.installation_id)}
              />
              <span className="truncate">
                {installationLoginLabel(installation)} · {installationAccountTypeLabel(installation.account_type)}
              </span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
