"use client";

import { useId, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type ChainCatalogModel = {
  id: string;
  name: string;
  provider: string;
  is_enabled: boolean;
  is_available: boolean;
  is_hidden?: boolean | null;
};

export function ModelChainPicker({ label, model, options, disabled, onSelect }: {
  label: string;
  model?: { id: string; name: string };
  options: ChainCatalogModel[];
  disabled?: boolean;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const nameId = useId();
  return <Popover open={open && !disabled} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <button type="button" aria-label={label} aria-describedby={nameId} disabled={disabled}
        className="inline-flex min-h-9 max-w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
        {!model && <Plus aria-hidden className="size-4 shrink-0" />}
        <span id={nameId} className="min-w-0 break-words font-medium">{model?.name ?? label}</span>
        {model && <ChevronDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />}
      </button>
    </PopoverTrigger>
    <PopoverContent aria-label={`${label} options`} align="start" collisionPadding={16} className="w-[min(420px,calc(100vw-32px))] p-0">
      <Command key={open ? "open" : "closed"} label={`${label} models`}>
        <CommandInput aria-label={`Search ${label.toLowerCase()}`} placeholder="Search enabled models..." />
        <CommandList>
          <CommandEmpty>No enabled models found.</CommandEmpty>
          <CommandGroup>
            {options.map(option => <CommandItem key={option.id} value={option.id} keywords={[option.name, option.provider]}
              onSelect={() => { onSelect(option.id); setOpen(false); }}>
              {option.name}
            </CommandItem>)}
          </CommandGroup>
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>;
}
