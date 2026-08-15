"use client"

import {
  getConnectionPreset,
  needsNativeOAuthMigration,
} from "@/lib/connections/presets"
import { getConnectionDisplayState } from "@/lib/connections/presentation"
import {
  formatConnectionLastTested,
  getConnectionStatusDetail,
  getConnectionStatusLabel,
  getConnectionStatusTone,
} from "@/lib/connections/status"
import type { Connection } from "@/lib/types"

const TYPE_BADGES: Record<string, { label: string; color: string }> = {
  rest_api: { label: "REST", color: "text-accent-blue border-accent-blue/20 bg-accent-blue/[0.06]" },
  mcp_server: { label: "MCP", color: "text-purple-400 border-purple-400/20 bg-purple-400/[0.06]" },
}

const SCOPE_BADGES: Record<string, { label: string; color: string }> = {
  global: { label: "global", color: "text-muted-foreground border-border-dim bg-background" },
  project: { label: "project", color: "text-amber-400 border-amber-400/20 bg-amber-400/[0.06]" },
}

export function ConnectionRow({ conn, isExcluded, hasRepo, togglingId, deletingId, testingId, onToggleEnabled, onToggleExclude, onDelete, onTest, onOAuth }: {
  conn: Connection
  isExcluded: boolean
  hasRepo: boolean
  togglingId: string | null
  deletingId: string | null
  testingId: string | null
  onToggleEnabled: () => void
  onToggleExclude: () => void
  onDelete: () => void
  onTest: () => void
  onOAuth: () => void
}) {
  const typeBadge = TYPE_BADGES[conn.type] ?? TYPE_BADGES.rest_api
  const scopeBadge = SCOPE_BADGES[conn.scope] ?? SCOPE_BADGES.global
  const preset = getConnectionPreset(conn.source_preset)
  const displayState = getConnectionDisplayState(
    {
      ...conn,
      needsOAuthMigration: needsNativeOAuthMigration(conn),
    },
    new Set(isExcluded ? [conn.id] : [])
  )

  return (
    <div
      data-connection-id={conn.id}
      className={`flex items-center gap-2 px-3 py-2 border-b border-border-dim ${displayState.rowMuted ? "opacity-55" : ""}`}
    >
      <button
        onClick={onToggleEnabled}
        disabled={togglingId === conn.id}
        className={`w-8 h-4 rounded-full relative transition-colors shrink-0 ${
          conn.is_enabled ? "bg-accent-green" : "bg-muted"
        }`}
      >
        <span
          className={`absolute top-0.5 w-3 h-3 rounded-full bg-primary-foreground transition-transform ${
            conn.is_enabled ? "left-[18px]" : "left-0.5"
          }`}
        />
      </button>

      <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${typeBadge.color}`}>
        {typeBadge.label}
      </span>

      <span className="text-[11px] text-foreground flex-1 truncate">
        <span className="block truncate">{conn.name}</span>
        <span className="block text-[10px] text-muted-foreground truncate">
          {conn.description || getConnectionStatusDetail(conn)}
        </span>
        <span className="block text-[10px] text-muted-foreground truncate">
          {formatConnectionLastTested(conn.last_tested_at)}
        </span>
      </span>

      {preset && (
        <span className="font-mono text-[9px] px-1 py-px rounded border shrink-0 text-purple-300 border-purple-400/20 bg-purple-400/[0.06]">
          preset · {preset.name}
        </span>
      )}

      <span className={`font-mono text-[9px] px-1 py-px rounded border shrink-0 ${scopeBadge.color}`}>
        {scopeBadge.label}
      </span>

      <span className={`font-mono text-[9px] shrink-0 ${getConnectionStatusTone(conn.health_status)}`}>
        {getConnectionStatusLabel(conn.health_status)}
      </span>

      {displayState.isDisabled && (
        <span className="font-mono text-[9px] px-1 py-px rounded border shrink-0 text-amber-400 border-amber-400/20 bg-amber-400/[0.06]">
          disabled
        </span>
      )}

      {displayState.isExcluded && (
        <span className="font-mono text-[9px] px-1 py-px rounded border shrink-0 text-accent-red border-accent-red/20 bg-accent-red/[0.06]">
          excluded
        </span>
      )}

      {displayState.oauthActionLabel && (
        <button
          onClick={onOAuth}
          className="px-1.5 py-0.5 text-[10px] text-amber-400 border border-amber-400/20 rounded hover:bg-amber-400/10"
        >
          {displayState.oauthActionLabel}
        </button>
      )}

      {hasRepo && conn.scope === "global" && (
        <button
          onClick={onToggleExclude}
          disabled={togglingId === conn.id}
          className={`text-[9px] px-1 py-px rounded border shrink-0 ${
            isExcluded
              ? "text-accent-red border-accent-red/20 hover:bg-accent-red/10"
              : "text-muted-foreground border-border-dim hover:bg-muted"
          }`}
          title={isExcluded ? "Include in project" : "Exclude from project"}
        >
          {isExcluded ? "excluded" : "exclude"}
        </button>
      )}

      <button
        onClick={onTest}
        disabled={testingId === conn.id}
        className="text-muted-foreground hover:text-foreground disabled:opacity-50 text-[10px] shrink-0"
        title="Test connection"
      >
        {testingId === conn.id ? "..." : "test"}
      </button>

      <button
        onClick={onDelete}
        disabled={deletingId === conn.id}
        className="text-muted-foreground hover:text-accent-red disabled:opacity-50 text-xs shrink-0"
        title="Delete"
      >
        ×
      </button>
    </div>
  )
}
