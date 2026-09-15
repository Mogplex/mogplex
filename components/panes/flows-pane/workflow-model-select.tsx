"use client"

import { useId, useState } from "react"
import { Check, NavArrowDown } from "iconoir-react"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { EMPTY_SELECT_VALUE, INSPECTOR_SELECT_CLASS } from "./constants"
import type { WorkflowSelectOption } from "./types"

export function WorkflowModelSelect({
  value,
  options,
  onValueChange,
  ariaLabel,
}: {
  value: string
  options: WorkflowSelectOption[]
  onValueChange: (value: string) => void
  ariaLabel: string
}) {
  const [open, setOpen] = useState(false)
  const selectedLabelId = useId()
  const selected = options.find((option) => option.value === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          aria-describedby={selectedLabelId}
          data-value={value}
          className={cn(INSPECTOR_SELECT_CLASS, "flex h-auto min-h-9 items-center justify-between gap-2 py-2 text-left")}
        >
          <span id={selectedLabelId} className="min-w-0 whitespace-normal break-words">{selected?.label ?? value}</span>
          <NavArrowDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent aria-label={`${ariaLabel} options`} align="end" collisionPadding={16} className="w-[min(520px,calc(100vw-32px))] p-0">
        <Command
          label={`${ariaLabel} options`}
          defaultValue={value || EMPTY_SELECT_VALUE}
          filter={(optionValue, search, keywords) =>
            `${optionValue} ${(keywords ?? []).join(" ")}`.toLowerCase().includes(search.trim().toLowerCase()) ? 1 : 0
          }
        >
          <CommandInput aria-label={`Search ${ariaLabel.toLowerCase()}`} placeholder="Search models..." />
          <CommandList className="max-h-[min(288px,calc(var(--radix-popover-content-available-height)-48px))]">
            <CommandEmpty>No models found.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value || EMPTY_SELECT_VALUE}
                  keywords={[option.label]}
                  disabled={option.disabled}
                  onSelect={() => {
                    onValueChange(option.value)
                    setOpen(false)
                  }}
                  className="items-start py-2"
                >
                  <span className="min-w-0 flex-1 whitespace-normal break-words">{option.label}</span>
                  <Check aria-hidden className={cn("mt-0.5 size-4 shrink-0", option.value !== value && "invisible")} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
