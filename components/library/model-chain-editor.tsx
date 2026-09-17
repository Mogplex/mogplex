"use client";

import { ArrowDown, ArrowUp, Pin, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ACCOUNT_FALLBACK_MODEL_MAX_COUNT } from "@/lib/models/fallback-limits";
import { ModelChainPicker, type ChainCatalogModel } from "./model-chain-picker";
import { addFallback, chainIncludes, moveFallback, removeFallback, replaceFallback, setChainPrimary, type ModelChain } from "./model-chain";

export { addFallback, chainIncludes, chainsEqual, moveFallback, removeFallback, replaceFallback, setChainPrimary } from "./model-chain";
export type { ModelChain } from "./model-chain";

type Props = {
  value: ModelChain;
  catalog: ChainCatalogModel[];
  onChange: (chain: ModelChain) => void;
  onSave: () => void;
  onDiscard: () => void;
  onRetry: () => void;
  dirty: boolean;
  saving: boolean;
  loading: boolean;
  loadError: boolean;
  status: string;
};

export function ModelChainEditor({ value, catalog, onChange, onSave, onDiscard, onRetry, dirty, saving, loading, loadError, status }: Props) {
  const enabled = catalog.filter(model => model.is_enabled && model.is_available && !model.is_hidden);
  const unused = enabled.filter(model => !chainIncludes(value, model.id));
  const fallbackOptions = unused.filter(model => !model.id.startsWith("openrouter/"));
  const invalid = [value.primary, ...value.fallbacks].some(id => !enabled.some(model => model.id === id));

  function row(id: string, index: number) {
    const primary = index === -1;
    const model = catalog.find(item => item.id === id);
    const warning = model && !model.is_enabled ? "Disabled in catalog" : id && (!model || !model.is_available || model.is_hidden) ? "Unavailable in catalog" : null;
    const label = primary ? "Primary" : `Fallback ${index + 1}`;
    return <li key={primary ? "primary" : id} className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/60 py-2.5">
      <span className="flex w-24 shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        {primary && <Pin aria-hidden className="size-3" />}{label}
      </span>
      <div className="flex min-w-0 max-w-full items-center gap-1">
        <ModelChainPicker label={label} model={id ? { id, name: model?.name ?? id } : undefined} disabled={saving}
          options={primary ? enabled : enabled.filter(item => !item.id.startsWith("openrouter/") && (item.id === id || !chainIncludes(value, item.id)))}
          onSelect={next => onChange(primary ? setChainPrimary(value, next) : replaceFallback(value, index, next))} />
        {!primary && <div className="flex shrink-0 items-center">
          <Button type="button" size="icon" variant="ghost" className="size-8" disabled={saving || index === 0} aria-label={`Move fallback ${index + 1} up`} onClick={() => onChange(moveFallback(value, index, -1))}><ArrowUp className="size-3.5" /></Button>
          <Button type="button" size="icon" variant="ghost" className="size-8" disabled={saving || index === value.fallbacks.length - 1} aria-label={`Move fallback ${index + 1} down`} onClick={() => onChange(moveFallback(value, index, 1))}><ArrowDown className="size-3.5" /></Button>
          <Button type="button" size="icon" variant="ghost" className="size-8" disabled={saving} aria-label={`Remove fallback ${index + 1}`} onClick={() => onChange(removeFallback(value, index))}><X className="size-3.5" /></Button>
        </div>}
      </div>
      {warning && <span className="text-xs text-primary">{warning}</span>}
    </li>;
  }

  return <section aria-labelledby="model-chain-heading" className="w-full max-w-[760px] space-y-3" data-testid="model-routing-settings">
    <div>
      <h2 id="model-chain-heading" className="text-sm font-medium">Default and fallbacks</h2>
      <p className="mt-1 max-w-[75ch] text-xs leading-5 text-muted-foreground">New automation nodes start on the primary. If a request fails, the gateway tries fallbacks in order. Nodes with their own model are not affected.</p>
    </div>
    {loading ? <p role="status" className="text-xs text-muted-foreground">Loading model chain...</p> : loadError ?
      <div role="alert" className="text-sm text-destructive">Unable to load model chain. <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button></div> : <>
        <ol className="border-t border-border/60">
          {row(value.primary, -1)}
          {value.fallbacks.map((id, index) => row(id, index))}
          <li className="flex items-center gap-2 border-b border-border/60 py-2.5">
            <ModelChainPicker label="Add a fallback" options={fallbackOptions} disabled={saving || value.fallbacks.length >= ACCOUNT_FALLBACK_MODEL_MAX_COUNT || fallbackOptions.length === 0}
              onSelect={id => onChange(addFallback(value, id))} />
            <span className="text-xs tabular-nums text-muted-foreground">{value.fallbacks.length}/{ACCOUNT_FALLBACK_MODEL_MAX_COUNT}</span>
          </li>
        </ol>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={!dirty || saving || invalid} onClick={onSave}>{saving ? "Saving..." : "Save chain"}</Button>
          <Button size="sm" variant="ghost" disabled={!dirty || saving} onClick={onDiscard}>Discard</Button>
        </div>
        <p role="status" aria-live="polite" className="min-h-5 text-xs text-muted-foreground">{status || (dirty ? "Unsaved changes." : "")}</p>
      </>}
  </section>;
}
