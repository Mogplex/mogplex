"use client";

import { memo } from "react";
import type { Agent } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const AgentCard = memo(function AgentCard({
  agent,
  categoryLabel,
  onCustomize,
  onEdit,
  onDelete,
  saving,
}: {
  agent: Agent;
  categoryLabel: string | null;
  onCustomize?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  saving?: boolean;
}) {
  const isPreset = agent.is_preset;
  const isCustom = !isPreset && !agent.source_template;
  const isForked = !isPreset && !!agent.source_template;
  const hasFork = isPreset && agent.has_fork;
  const needsCategory = !isPreset && !categoryLabel;

  return (
    <div className="bg-card border-border space-y-2 rounded-sm border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-foreground truncate text-sm font-medium">
              {agent.name}
            </span>
            {isPreset && !hasFork && (
              <Badge variant="secondary" className="px-1.5 py-0 text-[11px]">
                Default
              </Badge>
            )}
            {hasFork && (
              <Badge
                variant="outline"
                className="border-primary/40 text-primary px-1.5 py-0 text-[11px]"
              >
                Has customization
              </Badge>
            )}
            {isCustom && (
              <Badge variant="outline" className="px-1.5 py-0 text-[11px]">
                Custom
              </Badge>
            )}
            {isForked && (
              <Badge variant="outline" className="px-1.5 py-0 text-[11px]">
                Customized
              </Badge>
            )}
            {needsCategory && (
              <Badge
                variant="outline"
                className="border-amber-300/30 px-1.5 py-0 text-[11px] text-amber-300"
              >
                Needs category
              </Badge>
            )}
            {categoryLabel && (
              <Badge
                variant="outline"
                className="text-muted-foreground px-1.5 py-0 text-[11px]"
              >
                {categoryLabel}
              </Badge>
            )}
          </div>
          {agent.description && (
            <p className="text-muted-foreground mt-0.5 line-clamp-2 text-sm">
              {agent.description}
            </p>
          )}
        </div>
        {!isPreset && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Agent actions"
                className="text-muted-foreground hover:text-foreground hover:bg-secondary shrink-0 rounded px-1 py-0.5 text-sm"
              >
                ...
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
              {onEdit && (
                <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>
              )}
              {onDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="flex items-center justify-end">
        {isPreset && onCustomize && (
          <button
            onClick={onCustomize}
            disabled={saving}
            className="text-primary text-sm hover:underline disabled:opacity-50"
          >
            {hasFork ? "Edit Customization" : "Customize"}
          </button>
        )}
      </div>
    </div>
  );
});
