"use client"

import { useState, useMemo, useCallback, useEffect } from "react"
import useSWR from "swr"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import type { Connection } from "@/lib/types"
import { fetchJsonObject } from "@/lib/client-fetch"
import {
  CONNECTION_PRESETS,
  getConnectionAuthorizationPath,
} from "@/lib/connections/presets"
import { getPresetConnectionState } from "@/lib/connections/presentation"
import { SlackFill } from "@/components/settings/icons"
import { SlackSection } from "@/components/connections/slack-section"
import { PresetGrid } from "./preset-grid"
import { ConnectionsTable } from "./connections-table"
import { AddConnectionForm } from "./add-connection-form"

const EMPTY_CONNECTIONS: Connection[] = []

export function ConnectionsSection() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [oauthStatus] = useState<string | null>(() => searchParams?.get("oauth") ?? null)

  const { data: connectionsData, error: connSWRError, mutate: mutateConnections } = useSWR<{ connections: Connection[] }>(
    "/api/connections",
    (url: string) => fetchJsonObject<{ connections: Connection[] }>(url, "Failed to load connections"),
  )
  const connections = connectionsData?.connections ?? EMPTY_CONNECTIONS
  const connError = connSWRError ? "Unable to load connections" : null
  const [connectionError, setConnectionError] = useState<string | null>(null)

  const oauthNotice = useMemo(() => {
    switch (oauthStatus) {
      case "success":
        return { tone: "text-accent-green", message: "OAuth connection established. Run a test to verify tools." }
      case "invalid_state":
        return { tone: "text-destructive", message: "OAuth sign-in could not be verified. Try connecting again." }
      case "not_found":
        return { tone: "text-destructive", message: "The connection could not be found for OAuth completion." }
      case "token_error":
        return { tone: "text-destructive", message: "OAuth token exchange failed. Try reconnecting the connection." }
      case "setup_error":
        return { tone: "text-destructive", message: "OAuth setup failed before redirect. Check the preset configuration and try again." }
      default:
        return null
    }
  }, [oauthStatus])

  useEffect(() => {
    if (oauthStatus === "success") {
      void mutateConnections()
    }
  }, [mutateConnections, oauthStatus])

  useEffect(() => {
    if (!oauthStatus) return
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    params.delete("oauth")
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [oauthStatus, pathname, router])

  const initiateOAuth = useCallback((connection: Pick<Connection, "id" | "source_preset">) => {
    window.location.href = getConnectionAuthorizationPath({
      connectionId: connection.id,
      sourcePreset: connection.source_preset,
    })
  }, [])

  const presetStates = useMemo(
    () =>
      Object.fromEntries(
        CONNECTION_PRESETS.map((preset) => [
          preset.id,
          getPresetConnectionState(
            {
              presetId: preset.id,
              requiresOAuth: preset.auth_type === "oauth",
            },
            connections
          ),
        ])
      ) as Record<string, ReturnType<typeof getPresetConnectionState>>,
    [connections]
  )

  const configuredPresetIds = useMemo(() => new Set(
    Object.entries(presetStates)
      .filter(([, state]) => !state.isAddable)
      .map(([presetId]) => presetId)
  ), [presetStates])

  return (
    <>
      <section className="border border-border/60 bg-card">
        <div className="px-5 pt-5 pb-2">
          <div className="ui-section-title">Connections</div>
          <div className="ui-section-caption">External APIs and MCP servers your agents can use.</div>
        </div>
        {oauthNotice && (
          <div className={`mx-4 mt-2 text-xs px-2 py-1 ${oauthNotice.tone}`}>
            {oauthNotice.message}
          </div>
        )}
        {connError && (
          <div className="mx-4 mt-2 text-xs text-destructive px-2 py-1">
            {connError} <button onClick={() => void mutateConnections()} className="underline">Retry</button>
          </div>
        )}
        <div className="px-5 pb-0 space-y-5">
          <PresetGrid
            presetStates={presetStates}
            configuredPresetIds={configuredPresetIds}
            mutateConnections={mutateConnections}
            initiateOAuth={initiateOAuth}
          />
        </div>
        <ConnectionsTable
          connections={connections}
          mutateConnections={mutateConnections}
          initiateOAuth={initiateOAuth}
          setConnectionError={setConnectionError}
        />
        <AddConnectionForm
          mutateConnections={mutateConnections}
          connectionError={connectionError}
          setConnectionError={setConnectionError}
        />
      </section>

      <section className="border border-border/60 bg-card mt-6">
        <div className="px-5 pt-5 pb-2">
          <div className="ui-section-title flex items-center gap-2">
            <SlackFill size={16} aria-hidden="true" className="shrink-0" />
            <span>Slack</span>
          </div>
          <div className="ui-section-caption">Install the Mogplex Slack app to @-mention agents and DM the bot. Channel-to-repo mapping happens here too.</div>
        </div>
        <div className="px-5 pb-5">
          <SlackSection />
        </div>
      </section>
    </>
  )
}
