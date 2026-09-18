"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo } from "react";
import { ModelChainEditor } from "@/components/library/model-chain-editor";
import { ProviderIcon } from "@/components/provider-icon";
import { Switch } from "@/components/ui/switch";
import { useModels } from "@/hooks/use-models";
import { useNewModels } from "@/hooks/use-new-models";
import { scopedHref } from "@/lib/scoped-href";
import { cn } from "@/lib/utils";
import { useModelChainContext } from "./model-chain-context";

type Step = {
  id: string;
  label: string;
  name: string;
  provider: string | null;
  state: "ready" | "disabled" | "unavailable" | "empty";
};

const STATE_LABEL: Record<Step["state"], string> = {
  ready: "Ready",
  disabled: "Disabled in catalog",
  unavailable: "Unavailable",
  empty: "Not set",
};

function RoutingPreview({ steps }: { steps: Step[] }) {
  return (
    <ol data-testid="models-routing-preview" className="relative space-y-0">
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        const ok = step.state === "ready";
        return (
          <li key={`${step.label}-${step.id}`} className="relative flex gap-3 pb-4 last:pb-0">
            {!last && <span aria-hidden className="absolute left-[13px] top-7 h-[calc(100%-12px)] w-px bg-border" />}
            <span
              aria-hidden
              className={cn(
                "relative z-10 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] tabular-nums",
                index === 0
                  ? "border-primary bg-primary text-primary-foreground"
                  : ok
                    ? "border-border bg-card text-foreground"
                    : "border-dashed border-border-dim bg-card text-muted-foreground"
              )}
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="ui-kicker">{step.label}</div>
              <div className="mt-0.5 flex items-center gap-2">
                {step.provider ? <ProviderIcon provider={step.provider} className="size-5" /> : null}
                <span className={cn("truncate text-sm font-medium", step.state === "empty" ? "text-muted-foreground" : "text-foreground")}>
                  {step.name}
                </span>
              </div>
              <div className={cn("mt-0.5 text-[11px]", ok ? "text-accent-green" : step.state === "empty" ? "text-muted-foreground" : "text-primary")}>
                {STATE_LABEL[step.state]}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function ModelConfiguration() {
  const chain = useModelChainContext();
  const { catalog } = useModels();
  const { autoEnable, setAutoEnable } = useNewModels();
  const { scope } = useParams<{ scope: string }>();

  const steps = useMemo<Step[]>(() => {
    const describe = (id: string, label: string): Step => {
      if (!id) return { id, label, name: "Choose a model", provider: null, state: "empty" };
      const model = catalog.find((item) => item.id === id);
      const state: Step["state"] = !model || !model.is_available || model.is_hidden
        ? "unavailable"
        : model.is_enabled
          ? "ready"
          : "disabled";
      return { id, label, name: model?.name ?? id, provider: model?.provider ?? null, state };
    };
    return [
      describe(chain.value.primary, "Primary"),
      ...chain.value.fallbacks.map((id, index) => describe(id, `Fallback ${index + 1}`)),
    ];
  }, [catalog, chain.value]);

  const enabledCount = catalog.filter((model) => model.is_enabled && model.is_hidden !== true).length;
  const visibleCount = catalog.filter((model) => model.is_hidden !== true).length;

  return (
    <div data-testid="models-configuration" className="grid w-full min-w-0 max-w-[1440px] gap-6 lg:grid-cols-[minmax(0,760px)_minmax(280px,1fr)]">
      <div className="self-start rounded-lg border border-border/70 bg-card p-5">
        <ModelChainEditor {...chain} catalog={catalog} />
      </div>

      <div className="space-y-4">
        <section aria-labelledby="routing-preview-heading" className="rounded-lg border border-border/70 bg-card p-5">
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h2 id="routing-preview-heading" className="ui-section-title">Request order</h2>
            <span className="ui-meta tabular-nums">{steps.length} {steps.length === 1 ? "step" : "steps"}</span>
          </div>
          <RoutingPreview steps={steps} />
          <p className="mt-4 text-[11px] leading-5 text-muted-foreground">
            Each request starts at step 01. A failed step hands off to the next one. Unsaved edits show here immediately.
          </p>
        </section>

        <section aria-labelledby="catalog-policy-heading" className="rounded-lg border border-border/70 bg-card p-5">
          <h2 id="catalog-policy-heading" className="ui-section-title">Catalog policy</h2>
          <label htmlFor="models-auto-enable" className="mt-4 flex items-start justify-between gap-4 text-sm text-foreground">
            <span>
              <span className="block">Automatically enable new models</span>
              <span className="ui-section-caption block">Models the gateway adds become available without a manual toggle.</span>
            </span>
            <Switch
              id="models-auto-enable"
              data-testid="models-auto-enable-toggle"
              checked={autoEnable}
              onCheckedChange={(checked) => void setAutoEnable(checked)}
            />
          </label>
          <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-4 text-xs">
            <span className="text-muted-foreground">
              <span className="font-medium tabular-nums text-foreground">{enabledCount}</span> of {visibleCount} models enabled
            </span>
            <Link href={scopedHref(scope, "/models/catalog")} className="text-primary hover:underline">
              Open catalog
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
