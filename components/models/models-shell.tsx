"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { scopedHref } from "@/lib/scoped-href";
import { ModelChainProvider, useModelChainContext } from "./model-chain-context";

export const MODELS_TABS = [
  {
    subpath: "/models/catalog",
    label: "Catalog",
    description: "Every model the gateway can reach, with pricing and state.",
  },
  {
    subpath: "/models/configuration",
    label: "Configuration",
    description: "Primary model, ordered fallbacks, and catalog policy.",
  },
] as const;

function DraftIndicator() {
  const chain = useModelChainContext();
  if (!chain.dirty) return null;
  return (
    <span
      data-testid="models-draft-indicator"
      className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/8 px-3 py-1 text-[11px] font-medium text-primary"
    >
      <span aria-hidden className="size-1.5 rounded-full bg-primary motion-safe:animate-pulse" />
      Unsaved routing changes
    </span>
  );
}

function TabNav() {
  const pathname = usePathname();
  const { scope } = useParams<{ scope: string }>();
  return (
    <nav aria-label="Models sections" className="flex gap-6 border-b border-border">
      {MODELS_TABS.map((tab) => {
        const href = scopedHref(scope, tab.subpath);
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={tab.subpath}
            href={href}
            aria-current={active ? "page" : undefined}
            data-testid={`models-tab-${tab.label.toLowerCase()}`}
            className={cn(
              "relative -mb-px py-3 text-sm transition-colors",
              active
                ? "text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function ModelsShell({ children }: { children: ReactNode }) {
  return (
    <ModelChainProvider>
      <div className="min-h-full w-full max-w-[1488px] space-y-5 p-3 md:space-y-6 md:p-6">
        <header className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="ui-kicker mb-1.5">Inference</div>
              <h1 className="ui-page-title">Models</h1>
              <p className="ui-page-subtitle max-w-[60ch]">
                Choose what runs by default, what the gateway falls back to,
                and which catalog models your agents may use.
              </p>
            </div>
            <DraftIndicator />
          </div>
          <TabNav />
        </header>
        {children}
      </div>
    </ModelChainProvider>
  );
}
