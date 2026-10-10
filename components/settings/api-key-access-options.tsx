"use client";

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  isApiKeyAccess,
  type ApiKeyAccess,
} from "@/lib/mogplex-api/key-access";

export type ApiKeyAccessOption = {
  value: ApiKeyAccess;
  label: string;
  description: string;
};

/** The two choices for one key, as its owner sees them. */
export const KEY_ACCESS_OPTIONS: readonly ApiKeyAccessOption[] = [
  {
    value: "full",
    label: "Full access",
    description:
      "Starts runs and sandboxes, edits automations, and changes settings, as its scopes allow. Use it for the CLI, MCP clients, and CI that you control.",
  },
  {
    value: "automations",
    label: "Automations only",
    description:
      "Reads, and starts work only by triggering an automation that has an API trigger. Use it for servers and integrations.",
  },
];

export const KEY_ACCESS_LABELS: Record<ApiKeyAccess, string> = {
  full: "Full access",
  automations: "Automations only",
};

type ApiKeyAccessOptionsProps = {
  /** Prefixes the radio ids so two groups on one page stay distinct. */
  idPrefix: string;
  label: string;
  options: readonly ApiKeyAccessOption[];
  value: ApiKeyAccess;
  onChange: (value: ApiKeyAccess) => void;
  disabled?: boolean;
};

/** A labelled radio group with one line of explanation per choice. */
export function ApiKeyAccessOptions({
  idPrefix,
  label,
  options,
  value,
  onChange,
  disabled = false,
}: ApiKeyAccessOptionsProps) {
  return (
    <RadioGroup
      aria-label={label}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (isApiKeyAccess(next)) onChange(next);
      }}
      className="gap-2"
    >
      {options.map((option) => {
        const id = `${idPrefix}-${option.value}`;
        return (
          <label
            key={option.value}
            htmlFor={id}
            className="flex cursor-pointer items-start gap-3 border border-border bg-background/60 px-3 py-2.5 has-[button:disabled]:cursor-not-allowed"
          >
            <RadioGroupItem id={id} value={option.value} className="mt-0.5" />
            <span>
              <span className="block text-sm text-foreground">
                {option.label}
              </span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                {option.description}
              </span>
            </span>
          </label>
        );
      })}
    </RadioGroup>
  );
}
