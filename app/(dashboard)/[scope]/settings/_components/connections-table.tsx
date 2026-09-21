"use client"

import { useCallback, useState } from "react"
import {
  APPROVAL_ASK_BADGE,
  APPROVAL_ASK_HINT,
  asksBeforeRunning,
  getApprovalModeActionLabel,
  nextApprovalMode,
} from "@/lib/connections/approval"
import type { Connection } from "@/lib/types"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { getPresetIcon } from "@/components/settings/preset-icons"

type ConnectionsTableProps = {
  connections: Connection[]
  mutateConnections: () => Promise<unknown>
  initiateOAuth: (connection: Pick<Connection, "id" | "source_preset">) => void
  setConnectionError: (error: string | null) => void
}

export function ConnectionsTable({
  connections,
  mutateConnections,
  initiateOAuth,
  setConnectionError,
}: ConnectionsTableProps) {
  const [testing, setTesting] = useState<string | null>(null)

  const updateConnectionSetting = useCallback(async (
    conn: Connection,
    patch: Pick<Connection, "is_enabled"> | Pick<Connection, "approval_mode">
  ) => {
    setConnectionError(null)
    try {
      const res = await fetch("/api/connections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: conn.id, ...patch }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setConnectionError(data.error || "Failed to update connection")
        return
      }
      await mutateConnections()
    } catch {
      setConnectionError("Network error while updating connection")
    }
  }, [mutateConnections, setConnectionError])

  const removeConnection = useCallback(async (id: string) => {
    setConnectionError(null)
    try {
      const res = await fetch("/api/connections", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setConnectionError(data.error || "Failed to delete connection")
        return
      }
      await mutateConnections()
    } catch {
      setConnectionError("Network error while deleting connection")
    }
  }, [mutateConnections, setConnectionError])

  const testConnection = useCallback(async (id: string) => {
    setTesting(id)
    setConnectionError(null)
    try {
      const res = await fetch(`/api/connections/${id}/test`, { method: "POST" })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setConnectionError(data.error || "Failed to test connection")
      }
    } catch {
      setConnectionError("Network error while testing connection")
    }
    setTesting(null)
    await mutateConnections()
  }, [mutateConnections, setConnectionError])

  if (connections.length === 0) {
    return null
  }

  return (
    <div className="max-h-[40vh] overflow-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/40 text-[12px] text-muted-foreground">
            <th className="px-4 py-2 text-left">Name</th>
            <th className="px-4 py-2 text-left">Type</th>
            <th className="px-4 py-2 text-left">Status</th>
            <th className="px-4 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {connections.map(c => {
            const preset = getConnectionPreset(c.source_preset)
            const displayState = getConnectionDisplayState({
              ...c,
              needsOAuthMigration: needsNativeOAuthMigration(c),
            })
            const RowIcon = getPresetIcon(c.source_preset)
            return (
            <tr
              key={c.id}
              data-connection-id={c.id}
              className={`border-b border-border/40 hover:bg-secondary/50 ${displayState.rowMuted ? "opacity-60" : ""}`}
            >
              <td className="px-4 py-2 text-foreground">
                <div className="flex items-center gap-2">
                  <RowIcon size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span>{c.name}</span>
                  {preset && (
                    <span className="font-mono text-[11px] px-1.5 py-px rounded border text-purple-300 border-purple-400/20 bg-purple-400/[0.06]">
                      preset · {preset.name}
                    </span>
                  )}
                  {!c.is_enabled && (
                    <span className="font-mono text-[11px] px-1.5 py-px rounded border text-amber-400 border-amber-400/20 bg-amber-400/[0.06]">
                      disabled
                    </span>
                  )}
                  {asksBeforeRunning(c) && (
                    <span
                      title={APPROVAL_ASK_HINT}
                      className="font-mono text-[11px] px-1.5 py-px rounded border text-accent-blue border-accent-blue/20 bg-accent-blue/[0.06]"
                    >
                      {APPROVAL_ASK_BADGE}
                    </span>
                  )}
                </div>
              </td>
              <td className="px-4 py-2 text-muted-foreground">{c.type === "rest_api" ? "REST API" : "MCP Server"}</td>
              <td className="px-4 py-2">
                <div className="space-y-0.5">
                  <div className={`text-[11px] ${getConnectionStatusTone(c.health_status)}`}>
                    {getConnectionStatusLabel(c.health_status)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {getConnectionStatusDetail(c)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {formatConnectionLastTested(c.last_tested_at)}
                  </div>
                </div>
              </td>
              <td className="px-4 py-2 text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button aria-label="Connection actions" className="px-1.5 py-0.5 text-muted-foreground hover:text-foreground rounded hover:bg-secondary text-sm">···</button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    {displayState.oauthActionLabel && (
                      <>
                        <DropdownMenuItem onSelect={() => initiateOAuth(c)}>
                          {displayState.oauthActionLabel} OAuth
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    )}
                    <DropdownMenuItem onSelect={() => void testConnection(c.id)} disabled={testing === c.id}>
                      {testing === c.id ? "Testing..." : "Test Connection"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void updateConnectionSetting(c, { is_enabled: !c.is_enabled })}>
                      {c.is_enabled ? "Disable" : "Enable"}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      title={APPROVAL_ASK_HINT}
                      onSelect={() => void updateConnectionSetting(c, { approval_mode: nextApprovalMode(c.approval_mode) })}
                    >
                      {getApprovalModeActionLabel(c.approval_mode)}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => void removeConnection(c.id)}>
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </td>
            </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
