"use client";

import { useCallback, useState } from "react";
import type { KeyedMutator } from "swr";
import { toast } from "@/hooks/use-toast";
import type { ConnectionPreset } from "@/lib/connections/presets";
import { getConnectionAuthorizationPath } from "@/lib/connections/presets";
import type { ConnectionHealthStatus } from "@/lib/connections/status";
import { getConnectionStatusLabel } from "@/lib/connections/status";
import type { Connection, ConnectionOverride } from "@/lib/types";

type ResolvedData = {
  connections: Connection[];
  overrides: ConnectionOverride[];
  resolved_mcp_count?: number;
};

type PresetStatus = {
  presetId: string;
  type: "testing" | "success" | "error";
  message: string;
};

export function useConnectionActions({
  activeRepoId,
  mutate,
  excludedSet,
  setPresetStatus,
  setActivePreset,
  setPresetCredential,
  setPresetMcpUrl,
}: {
  activeRepoId: string | undefined;
  mutate: KeyedMutator<ResolvedData | { connections: Connection[] }>;
  excludedSet: Set<string>;
  setPresetStatus: (status: PresetStatus | null) => void;
  setActivePreset: (preset: ConnectionPreset | null) => void;
  setPresetCredential: (value: string) => void;
  setPresetMcpUrl: (value: string) => void;
}) {
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [presetSaving, setPresetSaving] = useState(false);

  const scrollToConnectionRow = useCallback(
    (connectionId: string | null | undefined) => {
      if (!connectionId) return;
      document
        .querySelector<HTMLElement>(`[data-connection-id="${connectionId}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    },
    []
  );

  const initiateOAuth = useCallback((conn: Pick<Connection, "id">) => {
    window.location.href = getConnectionAuthorizationPath({
      connectionId: conn.id,
    });
  }, []);

  const addPresetConnection = useCallback(
    async (
      preset: ConnectionPreset,
      presetCredential: string,
      presetMcpUrl: string
    ) => {
      const requiresCredential = preset.auth_fields.length > 0;
      if (preset.mcp_url_field && !presetMcpUrl.trim()) return;
      if (requiresCredential && !presetCredential.trim()) return;
      setPresetSaving(true);
      setPresetStatus(null);
      try {
        const res = await fetch("/api/connections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: preset.name,
            type: "mcp_server",
            mcp_url: preset.mcp_url_field
              ? presetMcpUrl.trim()
              : preset.mcp_url,
            mcp_transport: preset.mcp_transport,
            auth_type: preset.auth_type,
            ...(requiresCredential
              ? { credentials: presetCredential.trim() }
              : {}),
            description: preset.description,
            source_preset: preset.id,
          }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
            connection?: Connection;
          };
          if (res.status === 409) {
            await mutate();
            if (preset.auth_type === "oauth" && data.connection?.id) {
              initiateOAuth(data.connection);
              return;
            }
            setActivePreset(null);
            setPresetCredential("");
            setPresetMcpUrl("");
            setPresetStatus({
              presetId: preset.id,
              type: "success",
              message: data.error || "Already connected",
            });
            scrollToConnectionRow(
              (data.connection as Connection | undefined)?.id
            );
            return;
          }
          setPresetStatus({
            presetId: preset.id,
            type: "error",
            message: data.error || "Failed to create connection",
          });
          return;
        }
        const { connection } = (await res.json()) as {
          connection?: Connection;
        };
        setActivePreset(null);
        setPresetCredential("");
        setPresetMcpUrl("");
        await mutate();

        if (preset.auth_type === "oauth" && connection?.id) {
          initiateOAuth(connection);
          return;
        }

        if (connection?.id) {
          setPresetStatus({
            presetId: preset.id,
            type: "testing",
            message: "Testing...",
          });
          const testRes = await fetch(
            `/api/connections/${connection.id}/test`,
            { method: "POST" }
          );
          const testData = (await testRes.json().catch(() => ({}))) as {
            healthy?: boolean;
            toolCount?: number;
            error?: string;
            code?: string;
          };
          await mutate();
          setPresetStatus({
            presetId: preset.id,
            type: testRes.ok && testData.healthy ? "success" : "error",
            message: testData.healthy
              ? `Connected${testData.toolCount == null ? "" : ` · ${testData.toolCount} tools`}`
              : testData.error || "Connection test failed",
          });
        } else {
          setPresetStatus({
            presetId: preset.id,
            type: "success",
            message: "Connected",
          });
        }

        toast({ title: `${preset.name} connected` });
      } catch (e) {
        const message = (e as Error).message || "Network error";
        setPresetStatus({ presetId: preset.id, type: "error", message });
        toast({ title: "Error", description: message, variant: "destructive" });
      } finally {
        setPresetSaving(false);
      }
    },
    [
      mutate,
      setPresetStatus,
      setActivePreset,
      setPresetCredential,
      setPresetMcpUrl,
      scrollToConnectionRow,
      initiateOAuth,
    ]
  );

  const toggleExclude = useCallback(
    async (conn: Connection) => {
      if (!activeRepoId) return;
      setTogglingId(conn.id);
      try {
        const isExcluded = excludedSet.has(conn.id);
        const res = await fetch(`/api/repos/${activeRepoId}/connections`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            connection_id: conn.id,
            excluded: !isExcluded,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to update override");
        }
        await mutate();
      } catch (e) {
        toast({
          title: "Error",
          description: (e as Error).message,
          variant: "destructive",
        });
      } finally {
        setTogglingId(null);
      }
    },
    [activeRepoId, excludedSet, mutate]
  );

  const toggleEnabled = useCallback(
    async (conn: Connection) => {
      setTogglingId(conn.id);
      try {
        const res = await fetch("/api/connections", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: conn.id, is_enabled: !conn.is_enabled }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to toggle connection");
        }
        await mutate();
      } catch (e) {
        toast({
          title: "Error",
          description: (e as Error).message,
          variant: "destructive",
        });
      } finally {
        setTogglingId(null);
      }
    },
    [mutate]
  );

  const deleteConnection = useCallback(
    async (id: string) => {
      setDeletingId(id);
      try {
        const res = await fetch("/api/connections", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to delete connection");
        }
        await mutate();
        toast({ title: "Connection deleted" });
      } catch (e) {
        toast({
          title: "Error",
          description: (e as Error).message,
          variant: "destructive",
        });
      } finally {
        setDeletingId(null);
      }
    },
    [mutate]
  );

  const testConnection = useCallback(
    async (conn: Connection) => {
      setTestingId(conn.id);
      try {
        const res = await fetch(`/api/connections/${conn.id}/test`, {
          method: "POST",
        });
        const data = (await res.json().catch(() => ({}))) as {
          healthy?: boolean;
          status?: ConnectionHealthStatus;
          summary?: string;
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error || "Connection test failed");
        }
        if (data.healthy) {
          toast({ title: data.summary || "Connection healthy" });
        } else {
          toast({
            title: getConnectionStatusLabel(data.status || "error"),
            description: data.summary || data.error,
            variant: "destructive",
          });
        }
        await mutate();
      } catch {
        toast({ title: "Test failed", variant: "destructive" });
      } finally {
        setTestingId(null);
      }
    },
    [mutate]
  );

  return {
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
  };
}
