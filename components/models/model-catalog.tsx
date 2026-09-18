"use client";

import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useModels } from "@/hooks/use-models";
import { chainIncludes } from "@/components/library/model-chain";
import { ChainDraftBar } from "./chain-draft-bar";
import { useModelChainContext } from "./model-chain-context";
import { ModelCatalogTable } from "./model-catalog-table";
import {
  defaultDirectionFor,
  filterCatalog,
  sortCatalog,
  timeAgo,
  type CatalogFilters,
  type CatalogRow,
  type ModelStateFilter,
  type PricingFilter,
  type SortDirection,
  type SortKey,
} from "@/lib/models/model-catalog-view";

const CONTROL_CLASS =
  "h-9 rounded-md border border-border/70 bg-background/70 px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="min-w-0 border-l border-border/70 pl-4 first:border-l-0 first:pl-0">
      <div className="ui-kicker">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-foreground">{value}</div>
      {hint ? <div className="ui-meta mt-0.5 truncate">{hint}</div> : null}
    </div>
  );
}

export function ModelCatalog() {
  const chain = useModelChainContext();
  const defaultModel = chain.value.primary;
  const { catalog, toggleModel } = useModels();
  const [filters, setFilters] = useState<CatalogFilters>({ search: "", provider: "all", state: "all", pricing: "all" });
  const [sortKey, setSortKey] = useState<SortKey>("provider");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // Hidden models (retired by the gateway sync or a policy migration) cannot be
  // toggled or routed to, so they are excluded from the table.
  const visible = useMemo<CatalogRow[]>(
    () => catalog.filter((model): model is CatalogRow => model.is_hidden !== true && typeof model.is_enabled === "boolean"),
    [catalog]
  );
  const providers = useMemo(
    () => Array.from(new Set(visible.map((model) => model.provider))).sort((a, b) => a.localeCompare(b)),
    [visible]
  );
  const rows = useMemo(
    () => sortCatalog(filterCatalog(visible, filters, defaultModel), sortKey, sortDirection, defaultModel),
    [visible, filters, defaultModel, sortKey, sortDirection]
  );
  const enabledCount = useMemo(() => visible.filter((model) => model.is_enabled).length, [visible]);
  const inChainCount = useMemo(() => visible.filter((model) => chainIncludes(chain.value, model.id)).length, [visible, chain.value]);
  const latestRecommendation = useMemo(() => {
    const stamps = visible
      .map((model) => model.recommended_at)
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime());
    return stamps[0] ?? null;
  }, [visible]);
  const nameOf = useCallback(
    (id: string) => catalog.find((model) => model.id === id)?.name ?? id,
    [catalog]
  );

  const handleSort = (next: SortKey) => {
    if (next === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(next);
    setSortDirection(defaultDirectionFor(next));
  };
  const setFilter = <K extends keyof CatalogFilters>(key: K, value: CatalogFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  return (
    <div data-testid="models-content" className="w-full min-w-0 max-w-[1440px] space-y-5">
      <section aria-label="Catalog summary" className="grid grid-cols-2 gap-4 rounded-lg border border-border/70 bg-card px-5 py-4 md:grid-cols-4">
        <Stat label="Enabled" value={enabledCount} hint={`of ${visible.length} ${visible.length === 1 ? "model" : "models"}`} />
        <Stat label="Providers" value={providers.length} />
        <Stat label="In routing chain" value={inChainCount} hint={defaultModel ? `Primary: ${nameOf(defaultModel)}` : "No primary set"} />
        <div data-testid="models-recommendation-freshness" className="min-w-0 border-l border-border/70 pl-4">
          <div className="ui-kicker">Showing</div>
          <div className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-foreground">
            {rows.length} of {visible.length} models
          </div>
          <div className="ui-meta mt-0.5 truncate">
            {latestRecommendation ? `Recommendations refreshed ${timeAgo(latestRecommendation)}` : "Catalog synced from the gateway"}
          </div>
        </div>
      </section>

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(14rem,2fr)_repeat(3,minmax(8rem,1fr))_minmax(10rem,1fr)_auto]">
        <Input
          data-testid="models-search"
          value={filters.search}
          onChange={(event) => setFilter("search", event.target.value)}
          placeholder="Search models, providers, IDs, capabilities..."
          className="h-9 rounded-md border-border/70 bg-background/70 text-sm shadow-none md:col-span-2 xl:col-span-1"
        />
        <select data-testid="models-provider-filter" aria-label="Provider" value={filters.provider} onChange={(event) => setFilter("provider", event.target.value)} className={CONTROL_CLASS}>
          <option value="all">All providers</option>
          {providers.map((provider) => (
            <option key={provider} value={provider}>{provider}</option>
          ))}
        </select>
        <select data-testid="models-enabled-filter" aria-label="State" value={filters.state} onChange={(event) => setFilter("state", event.target.value as ModelStateFilter)} className={CONTROL_CLASS}>
          <option value="all">All states</option>
          <option value="default">Primary</option>
          <option value="enabled">Enabled</option>
          <option value="disabled">Disabled</option>
        </select>
        <select data-testid="models-pricing-filter" aria-label="Pricing" value={filters.pricing} onChange={(event) => setFilter("pricing", event.target.value as PricingFilter)} className={CONTROL_CLASS}>
          <option value="all">Any pricing</option>
          <option value="priced">Has pricing</option>
          <option value="unpriced">No pricing</option>
        </select>
        <select data-testid="models-sort-key" aria-label="Sort by" value={sortKey} onChange={(event) => handleSort(event.target.value as SortKey)} className={CONTROL_CLASS}>
          <option value="provider">Sort: provider</option>
          <option value="name">Sort: model</option>
          <option value="state">Sort: state</option>
          <option value="context_length">Sort: context</option>
          <option value="pricing_input">Sort: input price</option>
          <option value="pricing_output">Sort: output price</option>
          <option value="is_enabled">Sort: enabled</option>
        </select>
        <Button
          data-testid="models-sort-direction"
          type="button"
          variant="outline"
          onClick={() => setSortDirection((current) => (current === "asc" ? "desc" : "asc"))}
          className="h-9 rounded-md border-border/70 bg-background/70 px-4"
        >
          {sortDirection === "asc" ? "Asc" : "Desc"}
        </Button>
      </div>

      <ModelCatalogTable
        rows={rows}
        chain={chain.value}
        chainDisabled={chain.disabled}
        chainSaving={chain.saving}
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSort={handleSort}
        onChainChange={chain.onChange}
        onToggle={(id) => void toggleModel(id)}
      />

      <ChainDraftBar modelName={nameOf} />
    </div>
  );
}
