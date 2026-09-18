"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowRight } from "iconoir-react";
import { Button } from "@/components/ui/button";
import { scopedHref } from "@/lib/scoped-href";
import { useModelChainContext } from "./model-chain-context";

/**
 * Sticky save bar for chain edits started from the catalog table. It stays
 * mounted after a save so the confirmation is announced where the edit began.
 */
export function ChainDraftBar({ modelName }: { modelName: (id: string) => string }) {
  const chain = useModelChainContext();
  const { scope } = useParams<{ scope: string }>();
  if (!chain.dirty && !chain.status) return null;
  const { primary, fallbacks } = chain.value;
  return (
    <div
      data-testid="models-chain-draft-bar"
      className="sticky bottom-3 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-card/95 px-4 py-3 shadow-[0_12px_32px_-16px_rgba(0,0,0,0.35)] backdrop-blur"
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="text-sm font-medium text-foreground">
          {chain.dirty ? "Routing chain changed" : "Routing chain"}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          <span className="text-foreground">{modelName(primary) || "No primary"}</span>
          {fallbacks.map((id) => (
            <span key={id}>
              <span aria-hidden className="mx-1.5 text-border-dim">→</span>
              {modelName(id)}
            </span>
          ))}
        </div>
      </div>
      <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
        {chain.status || (chain.dirty ? "Unsaved changes." : "")}
      </p>
      <div className="flex items-center gap-2">
        <Button asChild size="sm" variant="ghost">
          <Link href={scopedHref(scope, "/models/configuration")}>
            Review
            <ArrowRight className="size-3.5" strokeWidth={1.8} />
          </Link>
        </Button>
        <Button size="sm" variant="ghost" disabled={!chain.dirty || chain.saving} onClick={chain.onDiscard}>
          Discard
        </Button>
        <Button size="sm" disabled={!chain.dirty || chain.saving} onClick={chain.onSave}>
          {chain.saving ? "Saving..." : "Save chain"}
        </Button>
      </div>
    </div>
  );
}
