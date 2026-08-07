"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type LaunchOptionCardProps = {
  active: boolean;
  title: string;
  detail: string;
  onClick: () => void;
  children?: ReactNode;
};

export function LaunchOptionCard({
  active,
  title,
  detail,
  onClick,
  children,
}: LaunchOptionCardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "rounded-lg border px-4 py-4 text-left transition-colors",
        active
          ? "text-foreground border-emerald-400/70 bg-emerald-400/8 ring-1 ring-emerald-300/20"
          : "border-border bg-card/70 text-muted-foreground hover:border-foreground/20 hover:bg-accent/30"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-foreground text-sm font-medium">{title}</div>
          <div className="text-muted-foreground mt-1 text-xs leading-5">
            {detail}
          </div>
        </div>
        <span
          className={cn(
            "mt-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full border px-1.5 text-[10px] font-medium tracking-[0.18em] uppercase",
            active
              ? "border-emerald-400/70 bg-emerald-400/12 text-emerald-300"
              : "border-border text-muted-foreground"
          )}
        >
          {active ? "On" : "Off"}
        </span>
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}
