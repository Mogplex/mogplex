"use client"

import { useState, useRef, useCallback } from "react"
import type { Connection } from "@/lib/types"
import {
  CONNECTION_PRESETS,
  CONNECTION_PRESET_MANUAL_HINT,
  getConnectionPresetAuthorizationDescription,
} from "@/lib/connections/presets"
import type { ConnectionPreset } from "@/lib/connections/presets"
import type { PresetConnectionState } from "@/lib/connections/presentation"
import { getPresetIcon } from "@/components/settings/preset-icons"
import { scrollToConnectionRow } from "./settings-types"

type PresetStatus = {
  presetId: string
  type: "success" | "error" | "testing"
  message: string
}

type PresetGridProps = {
  presetStates: Record<string, PresetConnectionState>
  configuredPresetIds: Set<string>
  mutateConnections: () => Promise<unknown>
  initiateOAuth: (connection: Pick<Connection, "id" | "source_preset">) => void
}

export function PresetGrid({
  presetStates,
  configuredPresetIds,
  mutateConnections,
  initiateOAuth,
}: PresetGridProps) {
  const [activePreset, setActivePreset] = useState<ConnectionPreset | null>(null)
  const [presetCredentials, setPresetCredentials] = useState<Record<string, string>>({})
  const [presetMcpUrl, setPresetMcpUrl] = useState("")
  const [presetSaving, setPresetSaving] = useState(false)
  const presetSavingRef = useRef(false)
  const [presetStatus, setPresetStatus] = useState<PresetStatus | null>(null)

  const addPresetConnection = useCallback(async (preset: ConnectionPreset) => {
    if (presetSavingRef.current) return
    const requiresCredential = preset.auth_fields.length > 0
    if (preset.mcp_url_field && !presetMcpUrl.trim()) return
    const trimmedCredentials: Record<string, string> = {}
    for (const field of preset.auth_fields) {
      trimmedCredentials[field.key] = (presetCredentials[field.key] ?? "").trim()
    }
    if (requiresCredential && preset.auth_fields.some(f => !trimmedCredentials[f.key])) return
    if (preset.auth_fields.length > 1) {
      setPresetStatus({
        presetId: preset.id,
        type: "error",
        message: "Multi-field credentials are not supported yet.",
      })
      return
    }
    const credentialsPayload = requiresCredential
      ? trimmedCredentials[preset.auth_fields[0].key]
      : undefined
    presetSavingRef.current = true
    setPresetSaving(true)
    setPresetStatus(null)
    try {
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: preset.name,
          type: "mcp_server",
          mcp_url: preset.mcp_url_field ? presetMcpUrl.trim() : preset.mcp_url,
          mcp_transport: preset.mcp_transport,
          auth_type: preset.auth_type,
          ...(credentialsPayload !== undefined ? { credentials: credentialsPayload } : {}),
          description: preset.description,
          source_preset: preset.id,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as {
          error?: string
          connection?: Connection
        }
        if (res.status === 409) {
          await mutateConnections()
          if (preset.auth_type === "oauth" && data.connection?.id) {
            initiateOAuth(data.connection)
            return
          }
          setActivePreset(null)
          setPresetCredentials({})
          setPresetMcpUrl("")
          setPresetStatus({
            presetId: preset.id,
            type: "success",
            message: data.error || "Already connected",
          })
          scrollToConnectionRow(data.connection?.id)
          return
        }
        setPresetStatus({ presetId: preset.id, type: "error", message: data.error || "Failed to create connection" })
        return
      }
      const { connection } = await res.json() as { connection?: Connection }
      setActivePreset(null)
      setPresetCredentials({})
      setPresetMcpUrl("")
      await mutateConnections()

      if (preset.auth_type === "oauth" && connection?.id) {
        initiateOAuth(connection)
        return
      }

      if (connection?.id) {
        setPresetStatus({ presetId: preset.id, type: "testing", message: "Testing..." })
        const testRes = await fetch(`/api/connections/${connection.id}/test`, { method: "POST" })
        const testData = await testRes.json().catch(() => ({})) as {
          healthy?: boolean
          toolCount?: number
          error?: string
        }
        await mutateConnections()
        setPresetStatus({
          presetId: preset.id,
          type: testRes.ok && testData.healthy ? "success" : "error",
          message: testData.healthy
            ? `Connected${testData.toolCount != null ? ` · ${testData.toolCount} tools` : ""}`
            : testData.error || "Connection test failed",
        })
      } else {
        setPresetStatus({ presetId: preset.id, type: "success", message: "Created" })
      }
    } catch {
      setPresetStatus({ presetId: preset.id, type: "error", message: "Network error" })
    } finally {
      presetSavingRef.current = false
      setPresetSaving(false)
    }
  }, [presetMcpUrl, presetCredentials, mutateConnections, initiateOAuth])

  return (
    <div>
      <div className="ui-kicker mb-2">Quick Add — MCP Presets</div>
      <div
        data-testid="settings-preset-manual-hint"
        className="mb-3 text-[11px] text-muted-foreground"
      >
        {CONNECTION_PRESET_MANUAL_HINT}
      </div>
      <div className="grid gap-2 grid-cols-2 md:grid-cols-4">
        {CONNECTION_PRESETS.map(preset => {
          const presetState = presetStates[preset.id]
          const isConfigured = configuredPresetIds.has(preset.id)
          const isActive = activePreset?.id === preset.id
          const status = presetStatus?.presetId === preset.id ? presetStatus : null
          const isConnected = isConfigured && presetState.label === "Connected"
          const Icon = getPresetIcon(preset.id)
          return (
            <div
              key={preset.id}
              data-testid={`settings-preset-${preset.id}`}
              className={`border p-2.5 space-y-1.5 transition-colors ${
                isConfigured
                  ? isConnected
                    ? "border-accent-green/30 bg-accent-green/[0.04]"
                    : "border-amber-400/30 bg-amber-400/[0.04]"
                  : "border-border bg-background"
              }`}
            >
              <div className="flex items-start gap-2">
                <Icon
                  size={20}
                  className={`shrink-0 mt-px ${
                    isConnected
                      ? "text-accent-green"
                      : isConfigured
                        ? "text-amber-400"
                        : "text-muted-foreground"
                  }`}
                  aria-hidden="true"
                />
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs text-foreground font-medium truncate">{preset.name}</span>
                    {!isConfigured && (
                      <button
                        onClick={() => { setActivePreset(isActive ? null : preset); setPresetCredentials({}); setPresetMcpUrl(""); setPresetStatus(null) }}
                        className="text-[11px] text-accent-blue hover:underline shrink-0"
                      >
                        {isActive ? "Cancel" : "+ Add"}
                      </button>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground leading-tight">{preset.description}</div>
                </div>
              </div>
              {isConfigured && (
                <button
                  onClick={() => scrollToConnectionRow(presetState.connection?.id)}
                  className="flex items-center gap-1.5 text-[11px] hover:underline"
                >
                  <span
                    className={`size-1.5 rounded-full shrink-0 ${
                      isConnected ? "bg-accent-green" : "bg-amber-400"
                    }`}
                    aria-hidden="true"
                  />
                  <span className={isConnected ? "text-accent-green" : "text-amber-400"}>
                    {presetState.label}
                  </span>
                </button>
              )}
              {isConfigured && presetState.detail && (
                <div className="text-[11px] text-amber-400 leading-tight">{presetState.detail}</div>
              )}
              {status && !isActive && (
                <div className={`text-[11px] ${status.type === "success" ? "text-accent-green" : status.type === "error" ? "text-red-400" : "text-muted-foreground"}`}>
                  {status.message}
                </div>
              )}
              {isActive && (
                <div className="pt-1 space-y-1.5">
                  {preset.mcp_url_field && (
                    <>
                      <div className="text-[11px] text-muted-foreground leading-tight">
                        Paste the full MCP server URL from Zapier&apos;s Connect tab. This URL is secret and can be rotated from Zapier later.
                      </div>
                      <input
                        type={preset.mcp_url_field.secret ? "password" : "text"}
                        value={presetMcpUrl}
                        onChange={e => setPresetMcpUrl(e.target.value)}
                        placeholder={preset.mcp_url_field.placeholder}
                        className="w-full border border-border bg-input px-2 py-1 text-[11px] text-foreground"
                      />
                    </>
                  )}
                  {preset.auth_type === "oauth" ? (
                    <div className="text-[11px] text-muted-foreground leading-tight">
                      {getConnectionPresetAuthorizationDescription(preset)}
                    </div>
                  ) : (
                    preset.auth_fields.map(field => (
                      <input
                        key={field.key}
                        type={field.secret ? "password" : "text"}
                        value={presetCredentials[field.key] ?? ""}
                        onChange={e => {
                          const next = e.target.value
                          setPresetCredentials(prev => ({ ...prev, [field.key]: next }))
                        }}
                        placeholder={field.placeholder}
                        className="w-full border border-border bg-input px-2 py-1 text-[11px] text-foreground"
                      />
                    ))
                  )}
                  {status?.type === "error" && (
                    <div className="text-[11px] text-red-400">{status.message}</div>
                  )}
                  <div className="flex items-center justify-between">
                    <a href={preset.docs_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-muted-foreground hover:text-foreground">Docs</a>
                    <button
                      onClick={() => void addPresetConnection(preset)}
                      disabled={(!!preset.mcp_url_field && !presetMcpUrl.trim()) || (preset.auth_fields.some(f => !(presetCredentials[f.key] ?? "").trim())) || presetSaving}
                      className="px-3 py-1.5 text-[11px] bg-primary text-primary-foreground disabled:opacity-50"
                    >
                      {presetSaving ? "..." : preset.auth_type === "oauth" ? "Connect" : "Add"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
