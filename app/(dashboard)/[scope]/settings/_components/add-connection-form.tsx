"use client"

import { useState, useCallback } from "react"
import {
  CONNECTION_AUTH_OPTIONS,
  INITIAL_CONNECTION_FORM,
  getDefaultAuthHeader,
  type ConnectionForm,
} from "./settings-types"

type AddConnectionFormProps = {
  mutateConnections: () => Promise<unknown>
  connectionError: string | null
  setConnectionError: (error: string | null) => void
}

export function AddConnectionForm({
  mutateConnections,
  connectionError,
  setConnectionError,
}: AddConnectionFormProps) {
  const [newConn, setNewConn] = useState<ConnectionForm>(INITIAL_CONNECTION_FORM)
  const [connectionSaving, setConnectionSaving] = useState(false)

  const addConnection = useCallback(async () => {
    if (!newConn.name.trim()) return
    if (newConn.type === "rest_api" && !newConn.base_url.trim()) return
    if (newConn.type === "mcp_server" && !newConn.mcp_url.trim()) return
    setConnectionSaving(true)
    setConnectionError(null)
    try {
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newConn),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setConnectionError(data.error || "Failed to add connection")
        return
      }

      setNewConn(INITIAL_CONNECTION_FORM)
      await mutateConnections()
    } catch {
      setConnectionError("Network error while adding connection")
    } finally {
      setConnectionSaving(false)
    }
  }, [newConn, mutateConnections, setConnectionError])

  return (
    <div className="mt-6 border-t border-border/40 px-5 py-5 space-y-3">
      <div className="ui-kicker mb-2">Add Connection</div>
      {connectionError && (
        <div className="text-[11px] text-red-400">
          {connectionError}
        </div>
      )}
      <div className="flex gap-2">
        <select
          value={newConn.type}
          onChange={e => setNewConn((p) => {
            const nextType = e.target.value as "rest_api" | "mcp_server"
            const nextAuthType = nextType === "mcp_server" && p.auth_type === "none"
              ? "bearer"
              : p.auth_type

            return {
              ...p,
              type: nextType,
              auth_type: nextAuthType,
              auth_header: getDefaultAuthHeader(nextAuthType),
            }
          })}
          className="border border-border bg-input px-3 py-2 text-sm text-foreground"
        >
          <option value="rest_api">REST API</option>
          <option value="mcp_server">MCP Server</option>
        </select>
        <input value={newConn.name} onChange={e => setNewConn(p => ({ ...p, name: e.target.value }))} placeholder="name" className="flex-1 border border-border bg-input px-3 py-2 text-sm text-foreground" />
        <input value={newConn.description} onChange={e => setNewConn(p => ({ ...p, description: e.target.value }))} placeholder="description (optional)" className="flex-1 border border-border bg-input px-3 py-2 text-sm text-foreground" />
      </div>
      {newConn.type === "rest_api" ? (
        <>
          <div className="flex gap-2">
            <input value={newConn.base_url} onChange={e => setNewConn(p => ({ ...p, base_url: e.target.value }))} placeholder="https://api.example.com" className="flex-1 border border-border bg-input px-3 py-2 text-sm text-foreground" />
            <select
              value={newConn.auth_type}
              onChange={e => setNewConn(p => ({
                ...p,
                auth_type: e.target.value,
                auth_header: getDefaultAuthHeader(e.target.value),
              }))}
              className="border border-border bg-input px-3 py-2 text-sm text-foreground"
            >
              {CONNECTION_AUTH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            {newConn.auth_type !== "none" && (
              <input value={newConn.credentials} onChange={e => setNewConn(p => ({ ...p, credentials: e.target.value }))} placeholder="credential" type="password" className="flex-1 border border-border bg-input px-3 py-2 text-sm text-foreground" />
            )}
          </div>
          {(newConn.auth_type === "bearer" || newConn.auth_type === "api_key") && (
            <input
              value={newConn.auth_header}
              onChange={e => setNewConn(p => ({ ...p, auth_header: e.target.value }))}
              placeholder={newConn.auth_type === "api_key" ? "X-API-Key" : "Authorization"}
              className="w-full border border-border bg-input px-3 py-2 text-sm text-foreground"
            />
          )}
        </>
      ) : (
        <>
          <div className="flex gap-2">
            <input value={newConn.mcp_url} onChange={e => setNewConn(p => ({ ...p, mcp_url: e.target.value }))} placeholder="https://mcp.example.com" className="flex-1 border border-border bg-input px-3 py-2 text-sm text-foreground" />
            <select value={newConn.mcp_transport} onChange={e => setNewConn(p => ({ ...p, mcp_transport: e.target.value as "sse" | "http" }))} className="border border-border bg-input px-3 py-2 text-sm text-foreground">
              <option value="http">HTTP</option>
              <option value="sse">SSE</option>
            </select>
            <select
              value={newConn.auth_type}
              onChange={e => setNewConn(p => ({
                ...p,
                auth_type: e.target.value,
                auth_header: getDefaultAuthHeader(e.target.value),
              }))}
              className="border border-border bg-input px-3 py-2 text-sm text-foreground"
            >
              {CONNECTION_AUTH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            {newConn.auth_type !== "none" && (
              <input value={newConn.credentials} onChange={e => setNewConn(p => ({ ...p, credentials: e.target.value }))} placeholder={newConn.auth_type === "api_key" ? "API key" : newConn.auth_type === "basic" ? "base64 user:pass" : "token"} type="password" className="flex-1 border border-border bg-input px-3 py-2 text-sm text-foreground" />
            )}
          </div>
          {(newConn.auth_type === "bearer" || newConn.auth_type === "api_key") && (
            <input
              value={newConn.auth_header}
              onChange={e => setNewConn(p => ({ ...p, auth_header: e.target.value }))}
              placeholder={newConn.auth_type === "api_key" ? "X-API-Key" : "Authorization"}
              className="w-full border border-border bg-input px-3 py-2 text-sm text-foreground"
            />
          )}
        </>
      )}
      <button
        onClick={() => void addConnection()}
        disabled={connectionSaving}
        className="border border-border px-3 py-2 text-sm text-foreground hover:bg-secondary disabled:opacity-50"
      >
        {connectionSaving ? "Adding..." : "Add Connection"}
      </button>
    </div>
  )
}
