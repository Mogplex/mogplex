"use client";

import { ProviderIcon } from "@/components/provider-icon";
import { Button } from "@/components/ui/button";
import { ACCOUNT_FALLBACK_MODEL_MAX_COUNT } from "@/lib/models/fallback-limits";
import { cn } from "@/lib/utils";
import {
  addFallback,
  setChainPrimary,
  type ModelChain,
} from "@/components/library/model-chain";
import {
  formatContextLength,
  formatPerMillion,
  type CatalogRow,
  type SortDirection,
  type SortKey,
} from "@/lib/models/model-catalog-view";

const HEAD_CLASS = "px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground";

function SortHeader({
  label,
  sortKey,
  activeSortKey,
  direction,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  activeSortKey: SortKey;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sortKey === activeSortKey;
  return (
    <th scope="col" className={cn(HEAD_CLASS, align === "right" ? "text-right" : "text-left")}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : undefined}
        className={cn(
          "inline-flex items-center gap-1 uppercase tracking-[0.16em] transition-colors",
          active ? "text-foreground" : "hover:text-foreground"
        )}
      >
        <span>{label}</span>
        <span aria-hidden className="font-mono">{active ? (direction === "asc" ? "↑" : "↓") : "↕"}</span>
      </button>
    </th>
  );
}

function chainRole(chain: ModelChain, id: string) {
  if (chain.primary === id) return "Primary";
  const index = chain.fallbacks.indexOf(id);
  return index === -1 ? null : `Fallback ${index + 1}`;
}

type Props = {
  rows: CatalogRow[];
  chain: ModelChain;
  chainDisabled: boolean;
  chainSaving: boolean;
  sortKey: SortKey;
  sortDirection: SortDirection;
  onSort: (key: SortKey) => void;
  onChainChange: (chain: ModelChain) => void;
  onToggle: (id: string) => void;
};

export function ModelCatalogTable({
  rows,
  chain,
  chainDisabled,
  chainSaving,
  sortKey,
  sortDirection,
  onSort,
  onChainChange,
  onToggle,
}: Props) {
  const fallbacksFull = chain.fallbacks.length >= ACCOUNT_FALLBACK_MODEL_MAX_COUNT;
  return (
    <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
      <div className="max-h-[64vh] overflow-auto">
        <table className="w-full min-w-[960px] text-sm">
          <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur">
            <tr className="border-b border-border/70">
              <SortHeader label="Model" sortKey="name" activeSortKey={sortKey} direction={sortDirection} onSort={onSort} />
              <SortHeader label="Provider" sortKey="provider" activeSortKey={sortKey} direction={sortDirection} onSort={onSort} />
              <SortHeader label="Context" sortKey="context_length" activeSortKey={sortKey} direction={sortDirection} onSort={onSort} align="right" />
              <SortHeader label="Input / 1M" sortKey="pricing_input" activeSortKey={sortKey} direction={sortDirection} onSort={onSort} align="right" />
              <SortHeader label="Output / 1M" sortKey="pricing_output" activeSortKey={sortKey} direction={sortDirection} onSort={onSort} align="right" />
              <SortHeader label="State" sortKey="state" activeSortKey={sortKey} direction={sortDirection} onSort={onSort} />
              <th scope="col" className={cn(HEAD_CLASS, "text-right")}>Routing</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((model) => {
              const role = chainRole(chain, model.id);
              const canSelect = model.is_enabled && model.is_available && !chainDisabled;
              return (
                <tr
                  key={model.id}
                  data-testid="models-row"
                  data-in-chain={role ? "true" : "false"}
                  className={cn(
                    "group border-b border-border/50 transition-colors last:border-b-0 hover:bg-secondary/40",
                    role && "bg-primary/[0.035]"
                  )}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <ProviderIcon provider={model.provider} testId={`models-provider-icon-${model.id}`} />
                      <div className="min-w-0">
                        <div data-testid="models-row-name" className="truncate font-medium text-foreground">
                          {model.name}
                        </div>
                        <div className="truncate font-mono text-[11px] text-muted-foreground">{model.id}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs uppercase tracking-[0.14em] text-muted-foreground">{model.provider}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-foreground">{formatContextLength(model.context_length)}</td>
                  <td data-testid="models-row-pricing" className="px-4 py-3 text-right text-xs tabular-nums text-foreground">
                    In {formatPerMillion(model.pricing_input)}
                  </td>
                  <td className="px-4 py-3 text-right text-xs tabular-nums text-foreground">
                    Out {formatPerMillion(model.pricing_output)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={model.is_enabled}
                        aria-label={`${model.is_enabled ? "Disable" : "Enable"} ${model.name}`}
                        data-testid={`models-toggle-${model.id}`}
                        disabled={chainSaving}
                        onClick={() => onToggle(model.id)}
                        className={cn(
                          "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                          model.is_enabled
                            ? "border-primary/40 bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:bg-secondary"
                        )}
                      >
                        <span aria-hidden className={cn("size-1.5 rounded-full", model.is_enabled ? "bg-primary" : "bg-border-dim")} />
                        {model.is_enabled ? "Enabled" : "Disabled"}
                      </button>
                      <span className={cn("text-[11px]", model.is_available ? "text-accent-green" : "text-muted-foreground")}>
                        {model.is_available ? "Available" : "Unavailable"}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      {role ? (
                        <span
                          data-testid={`models-chain-role-${model.id}`}
                          className="inline-flex h-7 items-center rounded-md border border-primary/30 bg-primary/8 px-2 text-[11px] font-medium text-primary"
                        >
                          {role}
                        </span>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 whitespace-nowrap px-2 text-xs opacity-70 group-hover:opacity-100 focus-visible:opacity-100"
                            data-testid={`models-set-default-${model.id}`}
                            disabled={!canSelect}
                            onClick={() => onChainChange(setChainPrimary(chain, model.id))}
                          >
                            Use as primary
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 whitespace-nowrap px-2 text-xs opacity-70 group-hover:opacity-100 focus-visible:opacity-100"
                            data-testid={`models-add-fallback-${model.id}`}
                            disabled={!canSelect || model.id.startsWith("openrouter/") || fallbacksFull}
                            onClick={() => onChainChange(addFallback(chain, model.id))}
                          >
                            Add as fallback
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-14 text-center text-sm text-muted-foreground">
                  No models match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
