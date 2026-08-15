"use client"
import { useCallback, useMemo, useState } from "react"
import useSWR from "swr"
import { useSessionsStore } from "@/hooks/use-sessions"
import { useRealtimeRouteRefresh } from "@/hooks/use-realtime-route-refresh"
import { MAX_MCP_CONNECTIONS } from "@/lib/connections/constants"
import {
  CONNECTION_PRESETS,
  CONNECTION_PRESET_MANUAL_HINT,
  getConnectionPresetAuthorizationDescription,
} from "@/lib/connections/presets"
import type { ConnectionPreset } from "@/lib/connections/presets"
import { getPresetConnectionState } from "@/lib/connections/presentation"
import type { Connection, ConnectionOverride } from "@/lib/types"
import { SlackSection } from "@/components/connections/slack-section"

import { ConnectionRow } from "./connections-pane/connection-row"
import { InlineAddForm } from "./connections-pane/inline-add-form"
import { useConnectionActions } from "./connections-pane/use-connection-actions"

const fetcher = async (url: string) => {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`API error: ${r.status}`)
  return r.json()
}

type ResolvedData = {
  connections: Connection[]
  overrides: ConnectionOverride[]
  resolved_mcp_count?: number
}

type PresetStatus = {
  presetId: string
  type: "testing" | "success" | "error"
  message: string
}

const EMPTY_CONNECTIONS: Connection[] = []
const EMPTY_OVERRIDES: ConnectionOverride[] = []

export function ConnectionsPane() {
  const activeRepo = useSessionsStore((s) => {
    const session = s.sessions.find((sess) => sess.id === s.activeSessionId) || s.sessions[0]
    return session?.activeRepo ?? null
  })

  const apiUrl = activeRepo?.id
    ? `/api/repos/${activeRepo.id}/connections`
    : "/api/connections"

  const { data, mutate, isLoading } = useSWR<ResolvedData | { connections: Connection[] }>(
    apiUrl,
    fetcher
  )

  const [showForm, setShowForm] = useState(false)
  const [activePreset, setActivePreset] = useState<ConnectionPreset | null>(null)
  const [presetCredential, setPresetCredential] = useState("")
  const [presetMcpUrl, setPresetMcpUrl] = useState("")
  const [presetStatus, setPresetStatus] = useState<PresetStatus | null>(null)

  const connections = data?.connections ?? EMPTY_CONNECTIONS
  const overrides = "overrides" in (data ?? {}) ? (data as ResolvedData).overrides : EMPTY_OVERRIDES

  const realtimeSpecs = useMemo(() => {
    const specs = [{ table: "connections", filter: "user_id=eq.$USER_ID" }]
    if (activeRepo?.id) {
      specs.push({ table: "repo_connection_overrides", filter: `repo_id=eq.${activeRepo.id}` })
    }
    return specs
  }, [activeRepo?.id])

  const refreshConnections = useCallback(() => mutate(), [mutate])
  useRealtimeRouteRefresh({
    channelName: `connections-pane:${activeRepo?.id ?? "global"}`,
    specs: realtimeSpecs,
    onInvalidate: refreshConnections,
  })

  const excludedSet = useMemo(() => new Set(
    overrides.filter(o => o.excluded && o.connection_id).map(o => o.connection_id!)
  ), [overrides])

  const presetStates = useMemo(() => Object.fromEntries(
    CONNECTION_PRESETS.map((preset) => [
      preset.id,
      getPresetConnectionState(
        {
          presetId: preset.id,
          requiresOAuth: preset.auth_type === "oauth",
        },
        connections,
        excludedSet
      ),
    ])
  ) as Record<string, ReturnType<typeof getPresetConnectionState>>, [connections, excludedSet])

  const configuredPresetIds = new Set(
    Object.entries(presetStates)
      .filter(([, state]) => !state.isAddable)
      .map(([presetId]) => presetId)
  )

  const resolvedMcpCount = "resolved_mcp_count" in (data ?? {})
    ? (data as ResolvedData).resolved_mcp_count
    : undefined

  const mcpCount = typeof resolvedMcpCount === "number"
    ? resolvedMcpCount
    : connections.filter(c => c.type === "mcp_server").length

  const {
    togglingId,
    deletingId,
    testingId,
    presetSaving,
    scrollToConnectionRow,
    initiateOAuth,
    addPresetConnection,
    toggleExclude,
    toggleEnabled,
    deleteConnection,
    testConnection,
  } = useConnectionActions({
    activeRepoId: activeRepo?.id,
    mutate,
    excludedSet,
    setPresetStatus,
    setActivePreset,
    setPresetCredential,
    setPresetMcpUrl,
  })

  if (isLoading) {
    return <div className="flex-1 p-3 text-xs text-muted-foreground">Loading connections...</div>
  }

  const globalConns = connections.filter(c => c.scope === "global")
  const projectConns = connections.filter(c => c.scope === "project")

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border-dim">
        <span className="text-[11px] text-muted-foreground">
          {connections.length} connection{connections.length !== 1 ? "s" : ""}
          <span className="ml-2 text-purple-400">{mcpCount}/{MAX_MCP_CONNECTIONS} MCPs</span>
        </span>
        <button
          onClick={() => setShowForm((f) => !f)}
          className="px-2.5 py-1 text-[11px] text-accent-blue hover:bg-accent-blue/10 rounded border border-accent-blue/20"
        >
          {showForm ? "Close form" : "Add connection"}
        </button>
      </div>

      {showForm && (
        <InlineAddForm
          repoId={activeRepo?.id}
          mcpCount={mcpCount}
          onCreated={() => { setShowForm(false); void mutate() }}
          onCancel={() => setShowForm(false)}
        />
      )}

      <div className="px-3 py-2 border-b border-border-dim space-y-1.5">
        <div className="text-[11px] text-muted-foreground font-medium">Slack</div>
        <SlackSection />
      </div>

      <div className="px-3 py-1.5 border-b border-border-dim space-y-1.5">
        <div
          data-testid="connections-preset-manual-hint"
          className="text-[11px] text-muted-foreground"
        >
          {CONNECTION_PRESET_MANUAL_HINT}
        </div>
        <div className="flex flex-wrap gap-1">
          {CONNECTION_PRESETS.map(preset => {
            const presetState = presetStates[preset.id]
            const isConfigured = configuredPresetIds.has(preset.id)
            const isActive = activePreset?.id === preset.id
            const status = presetStatus?.presetId === preset.id ? presetStatus : null
            return (
              <div key={preset.id} data-testid={`connections-preset-${preset.id}`} className="space-y-1">
                <button
                  onClick={() => {
                    if (isConfigured) {
                      scrollToConnectionRow(presetState.connection?.id)
                      return
                    }
                    setActivePreset(isActive ? null : preset)
                    setPresetCredential("")
                    setPresetMcpUrl("")
                    setPresetStatus(null)
                  }}
                  className={`px-2 py-1 text-[11px] rounded border ${
                    isConfigured
                      ? presetState.label === "Connected"
                        ? "border-accent-green/20 text-accent-green bg-accent-green/[0.06]"
                        : "border-amber-400/20 text-amber-400 bg-amber-400/[0.06]"
                      : isActive
                      ? "border-purple-400 text-purple-400 bg-purple-400/10"
                      : "border-border text-muted-foreground hover:text-foreground hover:border-border"
                  }`}
                  title={isConfigured
                    ? `${preset.name} ${presetState.label.toLowerCase()}`
                    : preset.description}
                >
                  {isConfigured ? `${preset.name} · ${presetState.label}` : `+ ${preset.name}`}
                </button>
                {isConfigured && presetState.detail && (
                  <div className="text-[11px] leading-tight text-amber-400">
                    {presetState.detail}
                  </div>
                )}
                {status && !isActive && (
                  <div className={`text-[11px] leading-tight ${
                    status.type === "success"
                      ? "text-accent-green"
                      : status.type === "error"
                      ? "text-red-400"
                      : "text-muted-foreground"
                  }`}>
                    {status.message}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        {activePreset && (
          <div className="space-y-1.5">
            <div className="flex gap-1.5 items-center">
              {activePreset.mcp_url_field ? (
                <div className="flex-1 space-y-1">
                  <div className="text-[11px] text-muted-foreground">
                    Paste the full MCP server URL from Zapier&apos;s Connect tab. This URL is secret and can be rotated from Zapier later.
                  </div>
                  <input
                    type={activePreset.mcp_url_field.secret ? "password" : "text"}
                    value={presetMcpUrl}
                    onChange={e => setPresetMcpUrl(e.target.value)}
                    placeholder={activePreset.mcp_url_field.placeholder}
                    className="w-full px-2 py-1 bg-input border border-border text-[11px] text-foreground rounded"
                    autoFocus
                  />
                </div>
              ) : activePreset.auth_type === "oauth" ? (
                <div className="flex-1 text-[11px] text-muted-foreground">
                  {getConnectionPresetAuthorizationDescription()}
                </div>
              ) : (
                <input
                  type="password"
                  value={presetCredential}
                  onChange={e => setPresetCredential(e.target.value)}
                  placeholder={activePreset.auth_fields[0]?.placeholder ?? "Credential"}
                  className="flex-1 px-2 py-1 bg-input border border-border text-[11px] text-foreground rounded"
                  autoFocus
                />
              )}
              <a href={activePreset.docs_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-muted-foreground hover:text-foreground shrink-0">
                docs
              </a>
              <button
                onClick={() => void addPresetConnection(activePreset, presetCredential, presetMcpUrl)}
                disabled={(!!activePreset.mcp_url_field && !presetMcpUrl.trim()) || ((activePreset.auth_fields.length > 0 && !presetCredential.trim()) || presetSaving)}
                className="px-3 py-1.5 text-[11px] bg-primary text-primary-foreground rounded disabled:opacity-50 shrink-0"
              >
                {presetSaving ? "..." : activePreset.auth_type === "oauth" ? "Connect" : "Add"}
              </button>
            </div>
            {presetStatus?.presetId === activePreset.id && presetStatus.type === "error" && (
              <div className="text-[11px] text-red-400">{presetStatus.message}</div>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {connections.length === 0 && !showForm && (
          <div className="flex items-center justify-center h-full p-4 text-xs text-muted-foreground">
            No connections configured. Add REST APIs or MCP servers to extend agent capabilities.
          </div>
        )}

        {globalConns.length > 0 && (
          <>
            <div className="px-3 py-2 text-[11px] text-muted-foreground bg-secondary/30 border-b border-border-dim">
              Global
            </div>
            {globalConns.map((conn) => (
              <ConnectionRow
                key={conn.id}
                conn={conn}
                isExcluded={excludedSet.has(conn.id)}
                hasRepo={!!activeRepo?.id}
                togglingId={togglingId}
                deletingId={deletingId}
                testingId={testingId}
                onToggleEnabled={() => void toggleEnabled(conn)}
                onToggleExclude={() => void toggleExclude(conn)}
                onDelete={() => void deleteConnection(conn.id)}
                onTest={() => void testConnection(conn)}
                onOAuth={() => initiateOAuth(conn)}
              />
            ))}
          </>
        )}

        {projectConns.length > 0 && (
          <>
            <div className="px-3 py-1 text-[10px] text-muted-foreground bg-secondary/30 border-b border-border-dim">
              Project
            </div>
            {projectConns.map((conn) => (
              <ConnectionRow
                key={conn.id}
                conn={conn}
                isExcluded={false}
                hasRepo={!!activeRepo?.id}
                togglingId={togglingId}
                deletingId={deletingId}
                testingId={testingId}
                onToggleEnabled={() => void toggleEnabled(conn)}
                onToggleExclude={() => {}}
                onDelete={() => void deleteConnection(conn.id)}
                onTest={() => void testConnection(conn)}
                onOAuth={() => initiateOAuth(conn)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
