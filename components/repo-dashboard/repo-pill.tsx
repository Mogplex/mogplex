"use client";

import { cn } from "@/lib/utils";

export function RepoPill({
  children,
  className,
  dotClassName,
}: {
  children: React.ReactNode;
  className?: string;
  dotClassName?: string;
}) {
  return (
    <span
      className={cn(
        "border-border bg-accent/70 text-muted-foreground inline-flex cursor-default items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[11px] font-medium",
        className
      )}
    >
      {dotClassName ? (
        <span className={cn("size-1.5 rounded-full", dotClassName)} />
      ) : null}
      {children}
    </span>
  );
}
