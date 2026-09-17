"use client"

import { useMemo, useState } from "react"
import { ProviderIcon } from "@/components/provider-icon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useModels } from "@/hooks/use-models"
import { useNewModels } from "@/hooks/use-new-models"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { ModelChainEditor, addFallback, chainIncludes, setChainPrimary } from "./model-chain-editor"
import { useModelChain } from "./use-model-chain"
import { ACCOUNT_FALLBACK_MODEL_MAX_COUNT } from "@/lib/models/fallback-limits"

type SortKey = "provider" | "name" | "context_length" | "pricing_input" | "pricing_output" | "is_enabled" | "state"
type SortDirection = "asc" | "desc"
type ModelStateFilter = "all" | "default" | "enabled" | "disabled"

function formatContextLength(value: number | null | undefined) {
  if (!value) return "—"
  if (value >= 1_000_000) {
    const millions = value / 1_000_000
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`
  }
  return `${Math.round(value / 1000)}k`
}

function formatPerMillion(value: number | null | undefined) {
  if (value == null) return "—"
  const perMillion = value * 1_000_000
  const minimumFractionDigits = perMillion >= 1 && perMillion < 10
    ? 2
    : perMillion >= 0.1 && perMillion < 1
      ? 2
      : 0
  const maximumFractionDigits = perMillion >= 100
    ? 0
    : perMillion >= 10
      ? 1
      : perMillion >= 1
        ? 2
        : perMillion >= 0.01
          ? 3
          : 4

  return `$${perMillion.toLocaleString(undefined, {
    minimumFractionDigits,
    maximumFractionDigits,
  })}`
}

function compareNullableNumbers(a: number | null | undefined, b: number | null | undefined, direction: SortDirection) {
  const leftMissing = a == null
  const rightMissing = b == null
  if (leftMissing && rightMissing) return 0
  if (leftMissing) return 1
  if (rightMissing) return -1
  return direction === "asc" ? a - b : b - a
}

function compareStrings(a: string, b: string, direction: SortDirection) {
  return direction === "asc" ? a.localeCompare(b) : b.localeCompare(a)
}

function getModelStateRank(model: { id: string; is_enabled: boolean }, defaultModel: string) {
  if (model.id === defaultModel) return 2
  if (model.is_enabled) return 1
  return 0
}

function compareModelState(
  left: { id: string; name: string; is_enabled: boolean; is_available: boolean },
  right: { id: string; name: string; is_enabled: boolean; is_available: boolean },
  defaultModel: string,
  direction: SortDirection,
) {
  const stateDiff = compareNullableNumbers(
    getModelStateRank(left, defaultModel),
    getModelStateRank(right, defaultModel),
    direction,
  )
  if (stateDiff !== 0) return stateDiff

  const availabilityDiff = compareNullableNumbers(Number(left.is_available), Number(right.is_available), direction)
  if (availabilityDiff !== 0) return availabilityDiff

  return compareStrings(left.name, right.name, "asc")
}

function SortHeader({
  label,
  sortKey,
  activeSortKey,
  direction,
  onSort,
  align = "left",
}: {
  label: string
  sortKey: SortKey
  activeSortKey: SortKey
  direction: SortDirection
  onSort: (key: SortKey) => void
  align?: "left" | "right"
}) {
  const isActive = sortKey === activeSortKey
  return (
    <th className={cn("px-4 py-3", align === "right" ? "text-right" : "text-left")}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.18em]",
          isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        <span>{label}</span>
        <span className="text-[11px]">{isActive ? (direction === "asc" ? "↑" : "↓") : "↕"}</span>
      </button>
    </th>
  )
}

function timeAgo(dateStr: string | null | undefined) {
  if (!dateStr) return null
  const diff = Date.now() - new Date(dateStr).getTime()
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return "just now"
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`
  if (diff < day) return `${Math.floor(diff / hour)}h ago`
  return `${Math.floor(diff / day)}d ago`
}

export function ModelsSection() {
  const chain = useModelChain()
  const defaultModel = chain.value.primary
  const { catalog, toggleModel } = useModels()
  const { autoEnable, setAutoEnable } = useNewModels()
  const [search, setSearch] = useState("")
  const [providerFilter, setProviderFilter] = useState("all")
  const [stateFilter, setStateFilter] = useState<ModelStateFilter>("all")
  const [pricingFilter, setPricingFilter] = useState<"all" | "priced" | "unpriced">("all")
  const [sortKey, setSortKey] = useState<SortKey>("provider")
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc")

  // Hidden models (retired by the gateway sync or a policy migration) cannot be
  // toggled or set as default, so they are excluded from the preferences table.
  const visibleCatalog = useMemo(
    () => catalog.filter((model) => model.is_hidden !== true),
    [catalog],
  )

  const providers = useMemo(
    () => Array.from(new Set(visibleCatalog.map((model) => model.provider))).sort((a, b) => a.localeCompare(b)),
    [visibleCatalog],
  )
  const filteredCatalog = useMemo(() => {
    const query = search.trim().toLowerCase()

    return visibleCatalog.filter((model) => {
      const matchesSearch = !query || [
        model.provider,
        model.name,
        model.id,
        ...(model.capabilities ?? []),
      ].some((value) => value.toLowerCase().includes(query))

      const matchesProvider = providerFilter === "all" || model.provider === providerFilter
      const matchesState =
        stateFilter === "all"
          || (stateFilter === "default" ? model.id === defaultModel : stateFilter === "enabled" ? model.is_enabled : !model.is_enabled)
      const hasPricing = model.pricing_input != null || model.pricing_output != null
      const matchesPricing =
        pricingFilter === "all"
          || (pricingFilter === "priced" ? hasPricing : !hasPricing)

      return matchesSearch && matchesProvider && matchesState && matchesPricing
    })
  }, [visibleCatalog, defaultModel, pricingFilter, providerFilter, search, stateFilter])

  const sortedCatalog = useMemo(() => {
    const rows = [...filteredCatalog]
    rows.sort((left, right) => {
      switch (sortKey) {
        case "provider":
          return compareStrings(left.provider, right.provider, sortDirection)
        case "name":
          return compareStrings(left.name, right.name, sortDirection)
        case "context_length":
          return compareNullableNumbers(left.context_length, right.context_length, sortDirection)
        case "pricing_input":
          return compareNullableNumbers(left.pricing_input, right.pricing_input, sortDirection)
        case "pricing_output":
          return compareNullableNumbers(left.pricing_output, right.pricing_output, sortDirection)
        case "is_enabled":
          return compareNullableNumbers(Number(left.is_enabled), Number(right.is_enabled), sortDirection)
        case "state":
          return compareModelState(left, right, defaultModel, sortDirection)
        default:
          return 0
      }
    })
    return rows
  }, [defaultModel, filteredCatalog, sortDirection, sortKey])

  const enabledCount = useMemo(
    () => visibleCatalog.filter((model) => model.is_enabled).length,
    [visibleCatalog],
  )
  const recommendedCount = useMemo(
    () => visibleCatalog.filter((model) => model.is_recommended).length,
    [visibleCatalog],
  )
  const latestRecommendationRefresh = useMemo(() => {
    const recommended = visibleCatalog
      .map((model) => model.recommended_at)
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())

    return recommended[0] ?? null
  }, [visibleCatalog])

  const handleSort = (nextKey: SortKey) => {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"))
      return
    }
    setSortKey(nextKey)
    setSortDirection(nextKey === "name" || nextKey === "provider" ? "asc" : "desc")
  }

  return (
    <div data-testid="models-content" className="w-full max-w-[1440px] min-w-0 space-y-5">
      <ModelChainEditor {...chain} catalog={catalog} />

      <div>
        <div className="border-b border-border/70 pb-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="space-y-2">
              <h2 className="text-sm font-medium">Model catalog</h2>
              <div className="max-w-3xl ui-section-caption">
                {enabledCount} enabled · {visibleCatalog.length} {visibleCatalog.length === 1 ? "model" : "models"} · {providers.length} {providers.length === 1 ? "provider" : "providers"}
              </div>
            </div>
            <div className="flex flex-col gap-3 xl:items-end">
              <label
                htmlFor="models-auto-enable"
                className="flex items-center gap-2 text-sm text-foreground"
              >
                <Switch
                  id="models-auto-enable"
                  data-testid="models-auto-enable-toggle"
                  checked={autoEnable}
                  onCheckedChange={(checked) => void setAutoEnable(checked)}
                />
                <span>Automatically enable new models</span>
              </label>
              <div data-testid="models-recommendation-freshness" className="ui-meta">
                {recommendedCount > 0 && latestRecommendationRefresh
                  ? `Recommendations refreshed ${timeAgo(latestRecommendationRefresh)} · `
                  : ""}
                Showing {sortedCatalog.length} of {visibleCatalog.length} models
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-2 xl:grid-cols-[minmax(12rem,2fr)_repeat(3,minmax(7rem,1fr))_minmax(9rem,1fr)_auto]">
            <Input
              data-testid="models-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search models, providers, IDs, capabilities..."
              className="h-10 rounded-md border-border/70 bg-background/70 text-sm shadow-none"
            />
            <select
              data-testid="models-provider-filter"
              value={providerFilter}
              onChange={(event) => setProviderFilter(event.target.value)}
              className="h-10 rounded-md border border-border/70 bg-background/70 px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="all">All providers</option>
              {providers.map((provider) => (
                <option key={provider} value={provider}>{provider}</option>
              ))}
            </select>
            <select
              data-testid="models-enabled-filter"
              value={stateFilter}
              onChange={(event) => setStateFilter(event.target.value as ModelStateFilter)}
              className="h-10 rounded-md border border-border/70 bg-background/70 px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="all">All states</option>
              <option value="default">Default</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </select>
            <select
              data-testid="models-pricing-filter"
              value={pricingFilter}
              onChange={(event) => setPricingFilter(event.target.value as typeof pricingFilter)}
              className="h-10 rounded-md border border-border/70 bg-background/70 px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="all">Any pricing</option>
              <option value="priced">Has pricing</option>
              <option value="unpriced">No pricing</option>
            </select>
            <div className="flex gap-2">
              <select
                data-testid="models-sort-key"
                value={sortKey}
                onChange={(event) => handleSort(event.target.value as SortKey)}
                className="h-10 min-w-0 flex-1 rounded-md border border-border/70 bg-background/70 px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
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
                className="h-10 rounded-md border-border/70 bg-background/70 px-4"
              >
                {sortDirection === "asc" ? "Asc" : "Desc"}
              </Button>
            </div>
          </div>
        </div>

        <div className="max-h-[62vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur">
              <tr className="border-b border-border/70">
                <SortHeader label="Provider" sortKey="provider" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} />
                <SortHeader label="Model" sortKey="name" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} />
                <th className="px-4 py-3 text-left text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Model ID</th>
                <SortHeader label="Context" sortKey="context_length" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} align="right" />
                <SortHeader label="Input / 1M" sortKey="pricing_input" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} align="right" />
                <SortHeader label="Output / 1M" sortKey="pricing_output" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} align="right" />
                <th className="px-4 py-3 text-left text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Availability</th>
                <th className="px-4 py-3 text-right text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedCatalog.map((model) => {
                const inChain = chainIncludes(chain.value, model.id)
                const canSelect = model.is_enabled && model.is_available && !chain.disabled

                return (
                  <tr key={model.id} className="border-b border-border/50 hover:bg-secondary/20">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <ProviderIcon
                          provider={model.provider}
                          testId={`models-provider-icon-${model.id}`}
                        />
                        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{model.provider}</div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div data-testid="models-row-name" className="font-medium text-foreground">{model.name}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">
                      {model.id}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="text-foreground">{formatContextLength(model.context_length)}</div>
                    </td>
                    <td data-testid="models-row-pricing" className="px-4 py-3 text-right text-[11px] text-foreground">
                      In {formatPerMillion(model.pricing_input)}
                    </td>
                    <td className="px-4 py-3 text-right text-[11px] text-foreground">
                      Out {formatPerMillion(model.pricing_output)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("text-[11px]", model.is_available ? "text-accent-green" : "text-muted-foreground")}>
                        {model.is_available ? "Available" : "Unavailable"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        {!inChain && <>
                          <Button size="sm" variant="ghost" className="h-7 whitespace-nowrap px-2 text-xs"
                            data-testid={`models-set-default-${model.id}`} disabled={!canSelect}
                            onClick={() => chain.onChange(setChainPrimary(chain.value, model.id))}>Use as primary</Button>
                          <Button size="sm" variant="ghost" className="h-7 whitespace-nowrap px-2 text-xs"
                            data-testid={`models-add-fallback-${model.id}`}
                            disabled={!canSelect || model.id.startsWith("openrouter/") || chain.value.fallbacks.length >= ACCOUNT_FALLBACK_MODEL_MAX_COUNT}
                            onClick={() => chain.onChange(addFallback(chain.value, model.id))}>Add as fallback</Button>
                        </>}
                        <button
                          data-testid={`models-toggle-${model.id}`}
                          disabled={chain.saving}
                          onClick={() => void toggleModel(model.id)}
                          className={cn(
                            "rounded-md border px-3 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                            model.is_enabled
                              ? "border-primary/40 bg-primary/10 text-primary"
                              : "border-border text-muted-foreground hover:bg-secondary",
                          )}
                        >
                          {model.is_enabled ? "Enabled" : "Disabled"}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {sortedCatalog.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No models match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  )
}
