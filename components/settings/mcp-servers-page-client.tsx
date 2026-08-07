"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { scopedHref } from "@/lib/scoped-href";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchJsonObject } from "@/lib/client-fetch";

import type { McpServer, McpServersResponse, FormState } from "./mcp-servers/types";
import { EMPTY_FORM } from "./mcp-servers/types";
import { serverToForm, buildPayload } from "./mcp-servers/helpers";
import { ServerCard } from "./mcp-servers/server-card";
import { McpServerDialog, DeleteServerDialog } from "./mcp-servers/dialogs";

export function McpServersPageClient() {
  const { scope } = useParams<{ scope: string }>();
  const { data, mutate } = useSWR<McpServersResponse>(
    "/api/mcp-servers",
    (url: string) =>
      fetchJsonObject<McpServersResponse>(url, "Failed to load MCP servers")
  );
  // Memoized so the identity is stable across renders - a fresh `[]` fallback
  // would invalidate every downstream useMemo on each render.
  const servers = useMemo(() => data?.servers ?? [], [data]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<McpServer | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<McpServer | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  const stats = useMemo(
    () => ({
      enabled: servers.filter((server) => server.enabled).length,
      stdio: servers.filter((server) => server.transport === "stdio").length,
      http: servers.filter((server) => server.transport === "http").length,
    }),
    [servers]
  );

  const openCreateDialog = () => {
    setEditingServer(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setDialogOpen(true);
  };

  const openEditDialog = (server: McpServer) => {
    setEditingServer(server);
    setForm(serverToForm(server));
    setFormError(null);
    setDialogOpen(true);
  };

  const closeDialog = (open: boolean) => {
    setDialogOpen(open);
    if (!open && !saving) {
      setEditingServer(null);
      setForm(EMPTY_FORM);
      setFormError(null);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setFormError(null);
    setPageError(null);

    try {
      const payload = buildPayload(form);
      const response = await fetch(
        editingServer ? `/api/mcp-servers/${editingServer.id}` : "/api/mcp-servers",
        {
          method: editingServer ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(body.error || "Failed to save MCP server");
      }

      await mutate();
      setDialogOpen(false);
      setEditingServer(null);
      setForm(EMPTY_FORM);
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;

    setDeleting(true);
    setPageError(null);
    try {
      const response = await fetch(`/api/mcp-servers/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(body.error || "Failed to delete MCP server");
      }

      await mutate();
      setDeleteTarget(null);
    } catch (error) {
      setPageError((error as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="min-h-full space-y-4 p-3 md:space-y-6 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="ui-page-title">MCP Servers</h1>
          <div className="ui-page-subtitle">
            Sync CLI-ready MCP server definitions without exposing stored secrets
            back to the browser.
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={scopedHref(scope, "/settings")}>Back to Settings</Link>
        </Button>
      </div>

      <section className="border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="ui-section-title">Server Definitions</div>
            <div className="ui-section-caption">
              Mogplex resolves Vault-backed secrets only when the CLI fetches
              `/api/mcp-servers?format=cli`.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{stats.enabled} enabled</Badge>
            <Badge variant="outline">{stats.stdio} stdio</Badge>
            <Badge variant="outline">{stats.http} http</Badge>
            <Button size="sm" onClick={openCreateDialog}>
              Add server
            </Button>
          </div>
        </div>

        <div className="space-y-4 p-4">
          {pageError && (
            <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
              {pageError}
            </div>
          )}

          {servers.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              No synced MCP servers yet.
            </div>
          ) : (
            <div className="space-y-3">
              {servers.map((server) => (
                <ServerCard
                  key={server.id}
                  server={server}
                  onEdit={openEditDialog}
                  onDelete={setDeleteTarget}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <McpServerDialog
        open={dialogOpen}
        editingServer={editingServer}
        form={form}
        formError={formError}
        saving={saving}
        onFormChange={setForm}
        onClose={closeDialog}
        onSave={() => void handleSave()}
      />

      <DeleteServerDialog
        server={deleteTarget}
        deleting={deleting}
        onClose={() => setDeleteTarget(null)}
        onDelete={() => void handleDelete()}
      />
    </div>
  );
}
