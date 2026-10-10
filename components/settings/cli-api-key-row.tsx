"use client";

import { KEY_ACCESS_LABELS } from "@/components/settings/api-key-access-options";
import type { ApiKeyAccess } from "@/lib/mogplex-api/key-access";

export type CliApiKey = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  access: ApiKeyAccess;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
};

type CliApiKeyRowProps = {
  apiKey: CliApiKey;
  changingAccess: boolean;
  revoking: boolean;
  onChangeAccess: (keyId: string, next: ApiKeyAccess) => void;
  onRevoke: (keyId: string) => void;
};

function formatDate(dateStr: string | null) {
  if (!dateStr) return "Never";
  return new Date(dateStr).toLocaleDateString();
}

function formatRelativeTime(dateStr: string | null) {
  if (!dateStr) return "Never";
  const date = new Date(dateStr);
  const diffDays = Math.floor(
    (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 30) return `${diffDays} days ago`;
  return date.toLocaleDateString();
}

/** One key: its name, access, dates, and the owner's actions on it. */
export function CliApiKeyRow({
  apiKey,
  changingAccess,
  revoking,
  onChangeAccess,
  onRevoke,
}: CliApiKeyRowProps) {
  const isFull = apiKey.access === "full";
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-background/60 px-4 py-3">
      <div className="flex items-center gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            {apiKey.name}
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-normal ${isFull ? "bg-secondary text-muted-foreground" : "bg-accent-green/10 text-accent-green"}`}
            >
              {KEY_ACCESS_LABELS[apiKey.access]}
            </span>
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
            {apiKey.prefix}...
          </div>
        </div>
        <div className="text-[11px] text-muted-foreground">
          <span>Created {formatDate(apiKey.createdAt)}</span>
          {apiKey.lastUsedAt ? (
            <span className="ml-3">
              Last used {formatRelativeTime(apiKey.lastUsedAt)}
            </span>
          ) : null}
          {apiKey.expiresAt ? (
            <span className="ml-3">Expires {formatDate(apiKey.expiresAt)}</span>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() =>
            onChangeAccess(apiKey.id, isFull ? "automations" : "full")
          }
          disabled={changingAccess}
          className="rounded-sm border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {changingAccess
            ? "..."
            : isFull
              ? "Limit to automations"
              : "Allow full access"}
        </button>
        <button
          onClick={() => onRevoke(apiKey.id)}
          disabled={revoking}
          className="rounded-sm border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-accent-red disabled:opacity-50"
        >
          {revoking ? "..." : "Revoke"}
        </button>
      </div>
    </div>
  );
}
