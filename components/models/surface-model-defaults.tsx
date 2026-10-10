"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Button } from "@/components/ui/button";
import { ModelChainPicker, type ChainCatalogModel } from "@/components/library/model-chain-picker";
import { fetchJsonObject } from "@/lib/client-fetch";
import type { ModelSettingsTargets } from "@/lib/models/settings-defaults";
import { MODEL_SURFACE_LABELS, type ModelSurface } from "@/lib/models/surface-defaults";

const url = "/api/settings/model-targets";
const followPrimary = "follow-primary";
type Surface = ModelSettingsTargets["surfaces"][number];

export function SurfaceModelDefaults({ catalog }: { catalog: ChainCatalogModel[] }) {
  const { data, error, isLoading, mutate } = useSWR<ModelSettingsTargets>(url,
    key => fetchJsonObject<ModelSettingsTargets>(key, "Unable to load surface models"),
    { refreshInterval: 0, shouldRetryOnError: false });
  const { mutate: refresh } = useSWRConfig();
  const [saving, setSaving] = useState<ModelSurface | null>(null);
  const [status, setStatus] = useState("");
  const [saveError, setSaveError] = useState("");
  const options: ChainCatalogModel[] = [
    { id: followPrimary, name: "Follow primary", provider: "", is_enabled: true, is_available: true },
    ...catalog.filter(model => model.is_enabled && model.is_available && !model.is_hidden),
  ];

  async function save(surface: ModelSurface, choice: string) {
    if (saving) return;
    setSaving(surface);
    setSaveError("");
    setStatus("");
    let result: Surface;
    try {
      result = await fetchJsonObject<Surface>(url, "Unable to save surface model", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ surface, model: choice === followPrimary ? null : choice }),
      });
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Unable to save surface model");
      setSaving(null);
      return;
    }
    setStatus(`${MODEL_SURFACE_LABELS[surface]} saved.`);
    setSaving(null);
    await mutate(current => current ? { ...current, surfaces: current.surfaces.map(row => row.id === surface ? result : row) } : current, false);
    void refresh(key => key === "/api/settings" || (typeof key === "string" && key.startsWith("/api/settings?")) || (Array.isArray(key) && key[0] === "/api/models"))
      .catch(() => setStatus(`${MODEL_SURFACE_LABELS[surface]} saved. Reload to refresh model lists.`));
  }

  return <section aria-labelledby="surface-model-heading" className="rounded-lg border border-border/70 bg-card p-5">
    <h2 id="surface-model-heading" className="ui-section-title">Defaults by surface</h2>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">Choose which model starts new conversations and runs. Follow primary uses the saved primary, including future changes. Existing conversations and configured channels, agents, or automation nodes keep their own model.</p>
    {isLoading ? <p role="status" className="mt-3 text-xs text-muted-foreground">Loading surface models...</p> : error ?
      <div role="alert" className="mt-3 text-sm text-destructive">Unable to load surface models. <Button size="sm" variant="outline" onClick={() => void mutate().catch(() => {})}>Retry</Button></div> :
      <ul className="mt-3 divide-y divide-border/60">
        {data?.surfaces.map(surface => {
          const label = MODEL_SURFACE_LABELS[surface.id];
          const name = catalog.find(model => model.id === surface.model)?.name ?? surface.model ?? "No model available";
          return <li key={surface.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
            <span className="text-xs text-muted-foreground">{label}</span>
            <div className="min-w-0 max-w-full">
              <ModelChainPicker label={`${label} model`} model={{ id: surface.model ?? "", name: surface.followsPrimary ? `Follow primary · ${name}` : name }} options={options} disabled={saving !== null} onSelect={choice => void save(surface.id, choice)} />
              <p className="px-2 text-[11px] text-muted-foreground">{saving === surface.id ? "Saving..." : surface.followsPrimary ? "Follows saved primary" : "Saved override"}</p>
            </div>
          </li>;
        })}
      </ul>}
    {saveError && <p role="alert" className="mt-2 text-xs text-destructive">{saveError}</p>}
    <p role="status" aria-live="polite" className="mt-2 min-h-5 text-xs text-muted-foreground">{status}</p>
  </section>;
}
