"use client";

import { useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Installation } from "./triggers-pane-types";
import {
  getInstallationAccountScope,
  getInstallationLabel,
  getInstallationRepoSummary,
} from "./triggers-pane-types";

interface InstallationComboboxProps {
  installations: Installation[];
  value: string;
  onChange: (value: string) => void;
  emptyMessage?: string;
}

export function InstallationCombobox({
  installations,
  value,
  onChange,
  emptyMessage = "No installations found.",
}: InstallationComboboxProps) {
  const [open, setOpen] = useState(false);
  const selected =
    installations.find(
      (installation) => String(installation.installation_id) === value
    ) || null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          data-testid="trigger-installation-combobox"
          className="w-full rounded border border-border bg-input px-3 py-2 text-left text-sm text-foreground transition-colors hover:border-border/80"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div
                className={selected ? "truncate" : "text-muted-foreground"}
              >
                {selected
                  ? getInstallationLabel(selected)
                  : "Select installation..."}
              </div>
              {selected && (
                <div className="truncate text-xs text-muted-foreground mt-0.5">
                  {getInstallationAccountScope(selected)} ·{" "}
                  {getInstallationRepoSummary(selected)}
                </div>
              )}
            </div>
            <span className="shrink-0 text-muted-foreground">
              {open ? "▴" : "▾"}
            </span>
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[420px] p-0">
        <Command>
          <CommandInput placeholder="Search installations or repos..." />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {installations.map((installation) => {
                const scope = getInstallationAccountScope(installation);
                const selectedInstallation =
                  String(installation.installation_id) === value;
                return (
                  <CommandItem
                    key={installation.id}
                    value={[
                      getInstallationLabel(installation),
                      scope,
                      installation.repositories
                        .map((repo) => repo.full_name)
                        .join(" "),
                    ].join(" ")}
                    onSelect={() => {
                      onChange(String(installation.installation_id));
                      setOpen(false);
                    }}
                    className="items-start py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm">
                          {getInstallationLabel(installation)}
                        </span>
                        <span className="rounded border border-border px-1 py-px font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                          {scope}
                        </span>
                        <span className="rounded border border-border px-1 py-px font-mono text-[9px] text-muted-foreground">
                          {installation.repositories.length} repo
                          {installation.repositories.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      <div className="mt-1 text-[10px] leading-tight text-muted-foreground">
                        {getInstallationRepoSummary(installation)}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 text-xs ${
                        selectedInstallation
                          ? "text-accent-green"
                          : "text-transparent"
                      }`}
                    >
                      &#10003;
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
