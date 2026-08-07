"use client"

import { useState } from "react"
import { MAX_MCP_CONNECTIONS } from "@/lib/connections/constants"
import { toast } from "@/hooks/use-toast"

const AUTH_OPTIONS = [
  { value: "none", label: "None" },
  { value: "api_key", label: "API Key" },
  { value: "bearer", label: "Bearer Token" },
  { value: "basic", label: "Basic Auth" },
  { value: "oauth", label: "OAuth" },
]

export function InlineAddForm({ repoId, onCreated, onCancel, mcpCount }: {
  repoId?: string
  onCreated: () => void
  onCancel: () => void
  mcpCount: number
}) {
  const [type, setType] = useState<"rest_api" | "mcp_server">("rest_api")
  const [scope, setScope] = useState<"global" | "project">(repoId ? "project" : "global")
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [authType, setAuthType] = useState("none")
  const [mcpUrl, setMcpUrl] = useState("")
  const [mcpTransport, setMcpTransport] = useState<"http" | "sse">("http")
  const [credentials, setCredentials] = useState("")
  const [oauthClientId, setOauthClientId] = useState("")
  const [oauthAuthorizeUrl, setOauthAuthorizeUrl] = useState("")
  const [oauthTokenUrl, setOauthTokenUrl] = useState("")
  const [oauthScopes, setOauthScopes] = useState("")
  const [saving, setSaving] = useState(false)

  const mcpAtCap = mcpCount >= MAX_MCP_CONNECTIONS

  const handleCreate = async () => {
    if (!name) return
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        name,
        type,
        description: description || undefined,
        scope,
        repo_id: scope === "project" ? repoId : undefined,
        auth_type: authType,
      }

      if (type === "rest_api") {
        body.base_url = baseUrl
      } else {
        body.mcp_url = mcpUrl
        body.mcp_transport = mcpTransport
      }

      if (authType === "oauth") {
        body.oauth_client_id = oauthClientId
        body.oauth_authorize_url = oauthAuthorizeUrl
        body.oauth_token_url = oauthTokenUrl
        body.oauth_scopes = oauthScopes || undefined
        if (credentials) {
          body.credentials = JSON.stringify({ client_secret: credentials })
        }
      } else if (authType !== "none" && credentials) {
        body.credentials = credentials
      }

      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to create connection")
      }
      toast({ title: "Connection created" })
      onCreated()
    } catch (e) {
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border-b border-border bg-secondary/50 p-3 space-y-2">
      <div className="flex gap-2">
        <button
          onClick={() => setType("rest_api")}
          className={`flex-1 px-2 py-1.5 text-[11px] rounded border ${type === "rest_api" ? "border-accent-blue bg-accent-blue/10 text-accent-blue" : "border-border text-muted-foreground"}`}
        >
          REST API
        </button>
        <button
          onClick={() => !mcpAtCap && setType("mcp_server")}
          disabled={mcpAtCap}
          className={`flex-1 px-2 py-1.5 text-[11px] rounded border ${type === "mcp_server" ? "border-purple-400 bg-purple-400/10 text-purple-400" : "border-border text-muted-foreground"} disabled:opacity-40`}
          title={mcpAtCap ? `Max ${MAX_MCP_CONNECTIONS} MCPs reached` : undefined}
        >
          MCP Server{mcpAtCap ? " (at cap)" : ""}
        </button>
      </div>

      {repoId && (
        <div className="flex gap-2">
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer">
            <input type="radio" name="scope" checked={scope === "global"} onChange={() => setScope("global")} className="w-3 h-3" />
            Global
          </label>
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer">
            <input type="radio" name="scope" checked={scope === "project"} onChange={() => setScope("project")} className="w-3 h-3" />
            This Project
          </label>
        </div>
      )}

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Connection name"
        className="w-full px-2 py-1 bg-input border border-border text-[11px] text-foreground rounded"
      />
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)"
        className="w-full px-2 py-1 bg-input border border-border text-[11px] text-foreground rounded"
      />

      {type === "rest_api" ? (
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="Base URL (e.g. https://api.example.com)"
          className="w-full px-2 py-1 bg-input border border-border text-[11px] text-foreground rounded"
        />
      ) : (
        <>
          <input
            value={mcpUrl}
            onChange={(e) => setMcpUrl(e.target.value)}
            placeholder="MCP Server URL"
            className="w-full px-2 py-1 bg-input border border-border text-[11px] text-foreground rounded"
          />
          <select
            value={mcpTransport}
            onChange={(e) => setMcpTransport(e.target.value as "http" | "sse")}
            className="w-full px-2 py-1 bg-input border border-border text-[11px] text-foreground rounded"
          >
            <option value="http">HTTP</option>
            <option value="sse">SSE</option>
          </select>
        </>
      )}

      <select
        value={authType}
        onChange={(e) => setAuthType(e.target.value)}
        className="w-full px-2 py-1 bg-input border border-border text-[11px] text-foreground rounded"
      >
        {AUTH_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      {authType === "oauth" ? (
        <>
          <input value={oauthClientId} onChange={(e) => setOauthClientId(e.target.value)} placeholder="Client ID" className="w-full px-2 py-1 bg-input border border-border text-[11px] text-foreground rounded" />
          <input value={credentials} onChange={(e) => setCredentials(e.target.value)} placeholder="Client Secret" type="password" className="w-full px-2 py-1 bg-input border border-border text-[11px] text-foreground rounded" />
          <input value={oauthAuthorizeUrl} onChange={(e) => setOauthAuthorizeUrl(e.target.value)} placeholder="Authorize URL" className="w-full px-2 py-1 bg-input border border-border text-[11px] text-foreground rounded" />
          <input value={oauthTokenUrl} onChange={(e) => setOauthTokenUrl(e.target.value)} placeholder="Token URL" className="w-full px-2 py-1 bg-input border border-border text-[11px] text-foreground rounded" />
          <input value={oauthScopes} onChange={(e) => setOauthScopes(e.target.value)} placeholder="Scopes (space-separated, optional)" className="w-full px-2 py-1 bg-input border border-border text-[11px] text-foreground rounded" />
        </>
      ) : authType !== "none" ? (
        <input
          value={credentials}
          onChange={(e) => setCredentials(e.target.value)}
          placeholder={authType === "api_key" ? "API Key" : authType === "basic" ? "base64 user:pass" : "Token"}
          type="password"
          className="w-full px-2 py-1 bg-input border border-border text-[11px] text-foreground rounded"
        />
      ) : null}

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground border border-border rounded">
          Cancel
        </button>
        <button
          onClick={() => void handleCreate()}
          disabled={!name || saving}
          className="px-3 py-1.5 text-[11px] bg-primary text-primary-foreground rounded disabled:opacity-50"
        >
          {saving ? "Creating..." : "Create"}
        </button>
      </div>
    </div>
  )
}
