"use client";
import useSWR from "swr";
import { useCallback, useMemo } from "react";
import type { Connection, ConnectionOverride } from "@/lib/types";
import type { ConnectionTestResult } from "@/lib/connections/status";
import { patchOverrides } from "@/lib/connections/overrides";

type ConnectionsResponse = {
  connections: Connection[];
  /** Only present on /api/repos/[id]/connections */
  overrides?: ConnectionOverride[];
  /** Only present on /api/repos/[id]/connections */
  resolved_mcp_count?: number;
};

export type CreateMcpInput = {
  name: string;
  mcp_url: string;
  mcp_transport: "http" | "sse";
  auth_type?: "none" | "api_key" | "bearer";
  credentials?: string;
  scope?: "global" | "project";
};

const fetcher = async (url: string): Promise<ConnectionsResponse> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load connections (${res.status})`);
  return res.json();
};

export function useConnections(opts: { repoId?: string } = {}) {
  const { repoId } = opts;
  const url = repoId ? `/api/repos/${repoId}/connections` : "/api/connections";

  const { data, error, isLoading, mutate } = useSWR<ConnectionsResponse>(
    url,
    fetcher,
    { revalidateOnFocus: false }
  );

  const connections = useMemo(
    () => data?.connections ?? [],
    [data?.connections]
  );
  const mcpServers = useMemo(
    () => connections.filter((c) => c.type === "mcp_server"),
    [connections]
  );

  const setEnabled = useCallback(
    async (id: string, is_enabled: boolean) => {
      await mutate(
        async (current) => {
          const res = await fetch("/api/connections", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id, is_enabled }),
          });
          if (!res.ok)
            throw new Error(
              (await res.json().catch(() => ({}))).error || "Failed to update"
            );
          if (!current) return current;
          return {
            ...current,
            connections: current.connections.map((c) =>
              c.id === id ? { ...c, is_enabled } : c
            ),
          };
        },
        {
          // Revalidate after PATCH so server-computed fields like
          // `resolved_mcp_count` refresh — otherwise the repo cap stays
          // stale after a toggle (see PR #220 review).
          revalidate: true,
          rollbackOnError: true,
          optimisticData: (
            current: ConnectionsResponse | undefined
          ): ConnectionsResponse => {
            if (!current) {
              // No cache yet — toggle UI only renders after load, so this
              // branch is defensive. Synthesize a minimal valid shape.
              return { connections: [] };
            }
            return {
              ...current,
              connections: current.connections.map((c) =>
                c.id === id ? { ...c, is_enabled } : c
              ),
            };
          },
        }
      );
    },
    [mutate]
  );

  const setExcluded = useCallback(
    async (connectionId: string, excluded: boolean) => {
      if (!repoId) throw new Error("setExcluded requires a repoId scope");
      await mutate(
        async (current) => {
          const res = await fetch(`/api/repos/${repoId}/connections`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              connection_id: connectionId,
              excluded,
            }),
          });
          if (!res.ok)
            throw new Error(
              (await res.json().catch(() => ({}))).error || "Failed to update"
            );
          if (!current) return current;
          return {
            ...current,
            overrides: patchOverrides(
              current.overrides ?? [],
              repoId,
              connectionId,
              excluded
            ),
          };
        },
        {
          revalidate: true,
          rollbackOnError: true,
          optimisticData: (
            current: ConnectionsResponse | undefined
          ): ConnectionsResponse => {
            if (!current) return { connections: [] };
            return {
              ...current,
              overrides: patchOverrides(
                current.overrides ?? [],
                repoId,
                connectionId,
                excluded
              ),
            };
          },
        }
      );
    },
    [mutate, repoId]
  );

  const testConnection = useCallback(
    async (id: string): Promise<ConnectionTestResult> => {
      const res = await fetch(`/api/connections/${id}/test`, {
        method: "POST",
      });
      const body = (await res
        .json()
        .catch(() => ({}))) as ConnectionTestResult & { error?: string };
      await mutate();
      if (!res.ok) throw new Error(body.error || "Test failed");
      return body;
    },
    [mutate]
  );

  const createMcp = useCallback(
    async (input: CreateMcpInput) => {
      const scope = input.scope ?? (repoId ? "project" : "global");
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "mcp_server",
          name: input.name,
          mcp_url: input.mcp_url,
          mcp_transport: input.mcp_transport,
          auth_type: input.auth_type ?? "none",
          credentials: input.credentials,
          scope,
          repo_id: scope === "project" ? repoId : undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to add connection");
      await mutate();
      return body.connection as Connection;
    },
    [mutate, repoId]
  );

  return {
    connections,
    mcpServers,
    overrides: data?.overrides ?? [],
    resolvedMcpCount: data?.resolved_mcp_count,
    isLoading,
    error: error as Error | undefined,
    refresh: () => mutate(),
    setEnabled,
    setExcluded,
    testConnection,
    createMcp,
  };
}
