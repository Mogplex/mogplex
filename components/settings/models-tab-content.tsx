"use client";

type ModelCatalogItem = {
  id: string;
  name: string;
};

type ModelsTabContentProps = {
  modelsError: Error | undefined;
  canManageModels: boolean;
  busyKey: string | null;
  restrictModels: boolean;
  setRestrictModels: (value: boolean) => void;
  selectedModels: Set<string>;
  setSelectedModels: (fn: (current: Set<string>) => Set<string>) => void;
  catalog: ModelCatalogItem[];
  saveModelAllowlist: () => void;
};

export function ModelsTabContent({
  modelsError,
  canManageModels,
  busyKey,
  restrictModels,
  setRestrictModels,
  selectedModels,
  setSelectedModels,
  catalog,
  saveModelAllowlist,
}: ModelsTabContentProps) {
  return (
    <section className="border border-border/60 bg-card">
      <div className="px-5 pt-5 pb-2">
        <div className="ui-section-title">Model Allowlist</div>
        <div className="ui-section-caption">Limit which catalog models members can run in this team.</div>
      </div>
      <div className="space-y-4 px-5 pb-5">
        {modelsError && <div className="text-sm text-destructive">Unable to load model settings.</div>}
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={restrictModels}
            disabled={!canManageModels}
            onChange={(event) => setRestrictModels(event.target.checked)}
          />
          Restrict this team to selected models
        </label>
        <div className="grid max-h-[460px] gap-2 overflow-auto border border-border p-3 md:grid-cols-2">
          {catalog.map((model) => (
            <label key={model.id} className="flex items-start gap-2 rounded-md px-2 py-1 text-sm hover:bg-secondary/60">
              <input
                type="checkbox"
                disabled={!restrictModels || !canManageModels}
                checked={selectedModels.has(model.id)}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setSelectedModels((current) => {
                    const next = new Set(current);
                    if (checked) next.add(model.id);
                    else next.delete(model.id);
                    return next;
                  });
                }}
              />
              <span className="min-w-0">
                <span className="block truncate text-foreground">{model.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{model.id}</span>
              </span>
            </label>
          ))}
        </div>
        {canManageModels ? (
          <button
            type="button"
            disabled={busyKey === "models"}
            onClick={() => void saveModelAllowlist()}
            className="border border-border px-3 py-2 text-sm text-foreground hover:bg-secondary disabled:opacity-50"
          >
            {busyKey === "models" ? "Saving..." : "Save model allowlist"}
          </button>
        ) : (
          <div className="text-sm text-muted-foreground">Only owners and admins can change the allowlist.</div>
        )}
      </div>
    </section>
  );
}
