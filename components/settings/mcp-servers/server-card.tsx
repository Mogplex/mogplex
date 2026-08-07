"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { McpServer } from "./types";
import { formatTimestamp, summarizeServer } from "./helpers";

interface ServerCardProps {
  server: McpServer;
  onEdit: (server: McpServer) => void;
  onDelete: (server: McpServer) => void;
}

export function ServerCard({ server, onEdit, onDelete }: ServerCardProps) {
  return (
    <div className="rounded-lg border border-border bg-background/60 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-medium text-foreground">
              {server.name}
            </div>
            <Badge variant="outline" className="uppercase">
              {server.transport}
            </Badge>
            <Badge variant="outline">
              {server.enabled ? "Enabled" : "Disabled"}
            </Badge>
          </div>
          <p className="text-[11px] leading-5 text-muted-foreground">
            {summarizeServer(server)}
          </p>
          <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            <span className="rounded-full border border-border px-2 py-0.5">
              {Object.keys(server.extra ?? {}).length} extra fields
            </span>
            {server.transport === "stdio" ? (
              <span className="rounded-full border border-border px-2 py-0.5">
                {server.envSecretNames.length} saved secrets
              </span>
            ) : (
              <span className="rounded-full border border-border px-2 py-0.5">
                {server.headerSecretNames.length} saved secrets
              </span>
            )}
            <span className="rounded-full border border-border px-2 py-0.5">
              Updated {formatTimestamp(server.updatedAt)}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onEdit(server)}
          >
            Edit
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onDelete(server)}
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
