"use client"

import { useState, type ReactNode } from "react"
import { NavArrowDown } from "iconoir-react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { EMPTY_SELECT_VALUE, INSPECTOR_SELECT_CLASS } from "./constants"
import type { InspectorCalloutVariant, WorkflowSelectOption } from "./types"

export function WorkflowSelect({
  value,
  options,
  onValueChange,
  ariaLabel,
  className,
  contentClassName,
  disabled,
  id,
  testId,
}: {
  value: string
  options: WorkflowSelectOption[]
  onValueChange: (value: string) => void
  ariaLabel: string
  className?: string
  contentClassName?: string
  disabled?: boolean
  id?: string
  testId?: string
}) {
  const normalizedValue = value || EMPTY_SELECT_VALUE

  return (
    <Select
      value={normalizedValue}
      onValueChange={(nextValue) =>
        onValueChange(nextValue === EMPTY_SELECT_VALUE ? "" : nextValue)
      }
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        data-testid={testId}
        data-value={value}
        className={cn(INSPECTOR_SELECT_CLASS, className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        position="popper"
        className={cn(
          "max-h-72 border-border bg-popover shadow-2xl",
          contentClassName,
        )}
      >
        {options.map((option) => (
          <SelectItem
            key={`${option.value}:${option.label}`}
            value={option.value || EMPTY_SELECT_VALUE}
            data-value={option.value}
            disabled={option.disabled}
          >
            {option.active === undefined ? (
              option.label
            ) : (
              <span className="inline-flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    option.active ? "bg-accent-green" : "bg-muted-foreground",
                  )}
                />
                <span className="truncate">{option.label}</span>
                <span className="sr-only">
                  {option.active ? " (active)" : " (inactive)"}
                </span>
              </span>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function WorkflowCombobox({
  value,
  options,
  onValueChange,
  ariaLabel,
  placeholder,
  testId,
}: {
  value: string
  options: WorkflowSelectOption[]
  onValueChange: (value: string) => void
  ariaLabel: string
  placeholder?: string
  testId?: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative">
          <Input
            role="combobox"
            aria-label={ariaLabel}
            aria-expanded={open}
            data-testid={testId}
            value={value}
            onFocus={() => setOpen(true)}
            onChange={(event) => onValueChange(event.target.value)}
            placeholder={placeholder}
            className="pr-9"
          />
          <button
            type="button"
            aria-label="Open suggestions"
            aria-haspopup="listbox"
            aria-expanded={open}
            data-state={open ? "open" : "closed"}
            onClick={() => setOpen((current) => !current)}
            className="absolute inset-y-0 right-0 grid w-9 place-items-center text-muted-foreground transition-colors hover:text-foreground"
          >
            <NavArrowDown
              className={cn("size-3.5 transition-transform", open && "rotate-180")}
            />
          </button>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="w-[var(--radix-popover-anchor-width)] border-border bg-popover p-1.5 shadow-2xl"
      >
        <div className="max-h-60 overflow-y-auto">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={value === option.value}
              onClick={() => {
                onValueChange(option.value)
                setOpen(false)
              }}
              className={cn(
                "flex w-full items-center rounded-md px-2.5 py-2 text-left text-xs transition-colors hover:bg-foreground/[0.05]",
                value === option.value && "bg-foreground/[0.06] text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function InspectorCallout({
  variant,
  icon,
  children,
  className,
  testId,
}: {
  variant: InspectorCalloutVariant
  icon?: ReactNode
  children: ReactNode
  className?: string
  testId?: string
}) {
  const styles: Record<InspectorCalloutVariant, string> = {
    hint: "border-border/60 bg-muted/30 text-muted-foreground",
    warn: "border-amber-400/30 bg-amber-400/[0.08] text-amber-700 dark:text-amber-200/90",
    info: "border-accent-blue/20 bg-accent-blue/[0.06] text-foreground/80",
  }
  return (
    <div
      data-testid={testId}
      className={cn(
        "flex items-start gap-2.5 rounded-md border p-3 text-xs leading-5",
        styles[variant],
        className,
      )}
    >
      {icon ? (
        <span className="mt-0.5 shrink-0 [&_svg]:size-3.5">{icon}</span>
      ) : null}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

export function InspectorField({
  label,
  htmlFor,
  children,
  className,
}: {
  label: ReactNode
  htmlFor?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label
        htmlFor={htmlFor}
        className="text-[11px] font-medium text-muted-foreground"
      >
        {label}
      </label>
      {children}
    </div>
  )
}

export function InspectorSummaryItem({
  label,
  children,
}: {
  label: ReactNode
  children: ReactNode
}) {
  return (
    <div className="min-w-0">
      <div className="ui-label">{label}</div>
      <div className="mt-1 text-sm break-words text-foreground">{children}</div>
    </div>
  )
}
