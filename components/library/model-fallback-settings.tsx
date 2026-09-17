"use client";

import { useState } from "react";
import useSWR from "swr";
import { useModels } from "@/hooks/use-models";
import { fetchJsonObject } from "@/lib/client-fetch";
import { ACCOUNT_FALLBACK_MODEL_MAX_COUNT } from "@/lib/models/fallback-limits";
import { Button } from "@/components/ui/button";
import { WorkflowModelSelect } from "@/components/panes/flows-pane/workflow-model-select";

type Preference = { fallback_model_ids: string[] | null };
const url = "/api/settings/model-fallbacks";

export function ModelFallbackSettings({ defaultModel }: { defaultModel: string }) {
  const { data, error, isLoading, mutate } = useSWR<Preference>(url,
    (key: string) => fetchJsonObject<Preference>(key, "Unable to load fallback models"),
    { refreshInterval: 0, shouldRetryOnError: false });
  const { catalog } = useModels();
  const [draft, setDraft] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const selected = draft ?? data?.fallback_model_ids ?? [];
  const available = catalog.filter(model => model.is_enabled && model.is_available &&
    !model.is_hidden && !model.id.startsWith("openrouter/") && model.id !== defaultModel);

  function change(next: string[]) {
    setDraft(next);
    setMessage(null);
    setSaveError(null);
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const result = await fetchJsonObject<Preference>(url, "Unable to save fallback models", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fallback_model_ids: selected }),
      });
      await mutate(result, false);
      setDraft(null);
      setMessage("Fallback models saved.");
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Unable to save fallback models");
    } finally { setSaving(false); }
  }

  return <section aria-labelledby="fallback-models-heading" className="space-y-3 border-b border-border/70 pb-5">
    <div>
      <h2 id="fallback-models-heading" className="text-sm font-medium">Fallback models</h2>
      <p className="text-muted-foreground mt-1 max-w-prose text-xs">Continue work if a model is unavailable. Choose up to {ACCOUNT_FALLBACK_MODEL_MAX_COUNT} alternatives in order.</p>
      <p className="text-muted-foreground mt-1 max-w-prose text-xs">These choices apply to requests through AI Gateway across your account. A fallback set in an automation takes priority. Each model uses its usual price.</p>
    </div>
    {isLoading ? <p role="status" className="text-xs text-muted-foreground">Loading fallback models…</p> : error ?
      <div role="alert" className="text-sm text-destructive">Unable to load fallback models. <Button size="sm" variant="outline" onClick={() => void mutate()}>Retry</Button></div> :
      <fieldset disabled={saving} className="max-w-xl space-y-2">
        {selected.length === 0 && <p className="text-xs text-muted-foreground">{data?.fallback_model_ids === null ? "No account fallbacks selected. Automations keep their current fallback policy." : "Account fallbacks are off. A fallback set in an automation still applies."}</p>}
        {selected.map((id, index) => <div key={id} className="flex items-start gap-2">
          <span aria-hidden className="pt-2 text-xs text-muted-foreground">{index + 1}.</span>
          <div className="min-w-0 flex-1"><WorkflowModelSelect ariaLabel={`Fallback ${index + 1}`} value={id}
            options={[{ value: id, label: catalog.find(model => model.id === id)?.name ?? id },
              ...available.filter(model => !selected.includes(model.id)).map(model => ({ value: model.id, label: `${model.name} · ${model.provider}` }))]}
            onValueChange={value => change(selected.map((item, at) => at === index ? value : item))} /></div>
          <Button type="button" size="sm" variant="ghost" disabled={index === 0} aria-label={`Move fallback ${index + 1} up`}
            onClick={() => { const next = [...selected]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; change(next); }}>↑</Button>
          <Button type="button" size="sm" variant="ghost" aria-label={`Remove fallback ${index + 1}`}
            onClick={() => change(selected.filter((_, at) => at !== index))}>Remove</Button>
        </div>)}
        {selected.length < ACCOUNT_FALLBACK_MODEL_MAX_COUNT && available.some(model => !selected.includes(model.id)) && <WorkflowModelSelect ariaLabel="Add fallback model" value=""
          options={[{ value: "", label: "Add fallback model", disabled: true }, ...available.filter(model => !selected.includes(model.id)).map(model => ({ value: model.id, label: `${model.name} · ${model.provider}` }))]}
          onValueChange={value => change([...selected, value])} />}
        <div className="flex gap-2 pt-1">
          <Button size="sm" disabled={draft === null} onClick={() => void save()}>{saving ? "Saving…" : "Save fallbacks"}</Button>
          {draft !== null && <Button size="sm" variant="ghost" onClick={() => { setDraft(null); setSaveError(null); }}>Cancel</Button>}
          {data?.fallback_model_ids === null && draft === null && <Button size="sm" variant="ghost" onClick={() => change([])}>Turn off account fallbacks</Button>}
        </div>
      </fieldset>}
    {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
    {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
  </section>;
}
