"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { scopedHref } from "@/lib/scoped-href";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { fetchJsonObject } from "@/lib/client-fetch";

type McpServer = {
  id: string;
  name: string;
  enabled: boolean;
  transport: "stdio" | "http";
  command: string | null;
  args: string[];
  envPlain: Record<string, string>;
  envSecretNames: string[];
  url: string | null;
  headerPlain: Record<string, string>;
  headerSecretNames: string[];
  extra: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type McpServersResponse = {
  servers: McpServer[];
};

type KeyValueEntry = {
  id: string;
  key: string;
  value: string;
  isSecret: boolean;
  saved: boolean;
  clearRequested: boolean;
  originalKey?: string;
};

type FormState = {
  name: string;
  enabled: boolean;
  transport: "stdio" | "http";
  command: string;
  argsText: string;
  url: string;
  extraText: string;
  envEntries: KeyValueEntry[];
  headerEntries: KeyValueEntry[];
};

const EMPTY_FORM: FormState = {
  name: "",
  enabled: true,
  transport: "stdio",
  command: "",
  argsText: "",
  url: "",
  extraText: "{}",
  envEntries: [],
  headerEntries: [],
};

function createEntry(partial?: Partial<KeyValueEntry>): KeyValueEntry {
  return {
    id: crypto.randomUUID(),
    key: "",
    value: "",
    isSecret: false,
    saved: false,
    clearRequested: false,
    ...partial,
  };
}

function sortRecordKeys(record: Record<string, string>) {
  return Object.entries(record).sort(([left], [right]) =>
    left.localeCompare(right)
  );
}

function serverToForm(server: McpServer | null): FormState {
  if (!server) {
    return EMPTY_FORM;
  }

  const envEntries = [
    ...sortRecordKeys(server.envPlain).map(([key, value]) =>
      createEntry({ key, value, isSecret: false })
    ),
    ...[...server.envSecretNames].sort((left, right) => left.localeCompare(right)).map((key) =>
      createEntry({
        key,
        isSecret: true,
        saved: true,
        originalKey: key,
      })
    ),
  ];

  const headerEntries = [
    ...sortRecordKeys(server.headerPlain).map(([key, value]) =>
      createEntry({ key, value, isSecret: false })
    ),
    ...[...server.headerSecretNames]
      .sort((left, right) => left.localeCompare(right))
      .map((key) =>
        createEntry({
          key,
          isSecret: true,
          saved: true,
          originalKey: key,
        })
      ),
  ];

  return {
    name: server.name,
    enabled: server.enabled,
    transport: server.transport,
    command: server.command ?? "",
    argsText: server.args.join("\n"),
    url: server.url ?? "",
    extraText: JSON.stringify(server.extra ?? {}, null, 2),
    envEntries,
    headerEntries,
  };
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString();
}

function summarizeServer(server: McpServer) {
  if (server.transport === "stdio") {
    const envCount =
      Object.keys(server.envPlain).length + server.envSecretNames.length;
    return `${server.command ?? "No command"} · ${server.args.length} args · ${envCount} env vars`;
  }

  const headerCount =
    Object.keys(server.headerPlain).length + server.headerSecretNames.length;
  return `${server.url ?? "No URL"} · ${headerCount} headers`;
}

function parseExtra(extraText: string) {
  const trimmed = extraText.trim();
  if (!trimmed) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("Extra JSON must be valid JSON");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Extra JSON must be an object");
  }

  return parsed as Record<string, unknown>;
}

function buildKeyValuePayload(entries: KeyValueEntry[], label: string) {
  const plain: Record<string, string> = {};
  const secrets: Record<string, string | null> = {};
  const seenKeys = new Set<string>();

  for (const entry of entries) {
    const key = entry.key.trim();
    const value = entry.value;
    const hasAnyContent =
      key.length > 0 ||
      value.trim().length > 0 ||
      entry.saved ||
      entry.clearRequested;

    if (!hasAnyContent) {
      continue;
    }

    if (!key) {
      throw new Error(`${label} entries need a key`);
    }

    if (entry.isSecret) {
      const originalKey = entry.originalKey?.trim();
      const keyChanged = Boolean(originalKey && originalKey !== key);
      const hasReplacementValue = value.trim().length > 0;

      if (keyChanged && !hasReplacementValue && !entry.clearRequested) {
        throw new Error(
          `Rename the saved ${label.toLowerCase()} secret "${originalKey}" by entering a replacement value or clearing it`
        );
      }

      if (originalKey && (entry.clearRequested || keyChanged)) {
        secrets[originalKey] = null;
      }

      if (hasReplacementValue) {
        if (seenKeys.has(key)) {
          throw new Error(`Duplicate ${label.toLowerCase()} key "${key}"`);
        }
        seenKeys.add(key);
        secrets[key] = value;
        continue;
      }

      if (entry.saved || entry.clearRequested) {
        continue;
      }

      throw new Error(`Secret ${label.toLowerCase()} "${key}" needs a value`);
    }

    if (seenKeys.has(key)) {
      throw new Error(`Duplicate ${label.toLowerCase()} key "${key}"`);
    }
    seenKeys.add(key);

    if (value.length > 0) {
      plain[key] = value;
    }
  }

  return { plain, secrets };
}

function buildPayload(form: FormState) {
  const extra = parseExtra(form.extraText);
  const env = buildKeyValuePayload(form.envEntries, "Environment");
  const headers = buildKeyValuePayload(form.headerEntries, "Header");
  const base = {
    name: form.name,
    enabled: form.enabled,
    transport: form.transport,
    args: form.argsText
      .split("\n")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
    envPlain: env.plain,
    envSecrets: env.secrets,
    headerPlain: headers.plain,
    headerSecrets: headers.secrets,
    extra,
  };

  if (form.transport === "stdio") {
    return {
      ...base,
      command: form.command,
      url: undefined,
    };
  }

  return {
    ...base,
    command: undefined,
    url: form.url,
  };
}

function KeyValueEditor({
  entries,
  onChange,
  label,
  description,
  secretLabel,
}: {
  entries: KeyValueEntry[];
  onChange: (entries: KeyValueEntry[]) => void;
  label: string;
  description: string;
  secretLabel: string;
}) {
  const updateEntry = (
    entryId: string,
    patch: Partial<KeyValueEntry>
  ) => {
    onChange(
      entries.map((entry) =>
        entry.id === entryId ? { ...entry, ...patch } : entry
      )
    );
  };

  const removeEntry = (entryId: string) => {
    onChange(entries.filter((entry) => entry.id !== entryId));
  };

  const addEntry = (isSecret = false) => {
    onChange([...entries, createEntry({ isSecret })]);
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </Label>
        <p className="text-[11px] leading-5 text-muted-foreground">
          {description}
        </p>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-3 py-4 text-[11px] text-muted-foreground">
          No {label.toLowerCase()} configured yet.
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => {
            const showSavedBadge =
              entry.isSecret &&
              entry.saved &&
              !entry.clearRequested &&
              entry.value.trim().length === 0;

            return (
              <div
                key={entry.id}
                className="rounded-lg border border-border bg-background/50 p-3"
              >
                <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] md:items-center">
                  <Input
                    value={entry.key}
                    onChange={(event) =>
                      updateEntry(entry.id, { key: event.target.value })
                    }
                    placeholder={`${label} name`}
                  />
                  <div className="space-y-2">
                    <Input
                      type={entry.isSecret ? "password" : "text"}
                      value={entry.value}
                      onChange={(event) =>
                        updateEntry(entry.id, {
                          value: event.target.value,
                          clearRequested: false,
                        })
                      }
                      placeholder={
                        entry.isSecret
                          ? showSavedBadge
                            ? "Overwrite saved secret"
                            : "Secret value"
                          : "Value"
                      }
                    />
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={entry.isSecret}
                          onCheckedChange={(checked) =>
                            updateEntry(entry.id, {
                              isSecret: checked,
                              value: checked ? "" : entry.value,
                              clearRequested: false,
                            })
                          }
                        />
                        <span>{secretLabel}</span>
                      </div>
                      {showSavedBadge && <Badge variant="outline">Saved</Badge>}
                      {entry.isSecret && entry.saved && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[11px]"
                          onClick={() =>
                            updateEntry(entry.id, {
                              clearRequested: !entry.clearRequested,
                              value: "",
                            })
                          }
                        >
                          {entry.clearRequested ? "Keep saved secret" : "Clear saved secret"}
                        </Button>
                      )}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => removeEntry(entry.id)}
                  >
                    Remove
                  </Button>
                </div>
                {entry.clearRequested && (
                  <p className="mt-2 text-[11px] text-amber-300">
                    This saved secret will be deleted when you save.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => addEntry(false)}>
          Add plain {label.toLowerCase()}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => addEntry(true)}>
          Add secret {label.toLowerCase()}
        </Button>
      </div>
    </div>
  );
}

export function McpServersPageClient() {
  const { scope } = useParams<{ scope: string }>();
  const { data, mutate } = useSWR<McpServersResponse>(
    "/api/mcp-servers",
    (url: string) =>
      fetchJsonObject<McpServersResponse>(url, "Failed to load MCP servers")
  );
  // Memoized so the identity is stable across renders — a fresh `[]` fallback
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

  const dialogTitle = editingServer ? "Edit MCP server" : "Add MCP server";
  const dialogDescription = editingServer
    ? "Update the synced server definition. Saved secrets stay masked until you overwrite or clear them."
    : "Create a synced MCP server definition for CLI and agent sessions.";

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
                <div
                  key={server.id}
                  className="rounded-lg border border-border bg-background/60 p-4"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-medium text-foreground">
                          {server.name}
                        </div>
                        <Badge variant="outline" className="uppercase">
                          {server.transport}
                        </Badge>
                        <Badge variant="outline">
                          {server.enabled ? "Enabled" : "Disabled"}
                        </Badge>
                      </div>
                      <p className="text-[11px] leading-5 text-muted-foreground">
                        {summarizeServer(server)}
                      </p>
                      <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                        <span className="rounded-full border border-border px-2 py-0.5">
                          {Object.keys(server.extra ?? {}).length} extra fields
                        </span>
                        {server.transport === "stdio" ? (
                          <span className="rounded-full border border-border px-2 py-0.5">
                            {server.envSecretNames.length} saved secrets
                          </span>
                        ) : (
                          <span className="rounded-full border border-border px-2 py-0.5">
                            {server.headerSecretNames.length} saved secrets
                          </span>
                        )}
                        <span className="rounded-full border border-border px-2 py-0.5">
                          Updated {formatTimestamp(server.updatedAt)}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => openEditDialog(server)}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setDeleteTarget(server)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <Dialog open={dialogOpen} onOpenChange={closeDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>{dialogDescription}</DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {formError && (
              <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
                {formError}
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <div className="space-y-2">
                <Label htmlFor="mcp-server-name">Name</Label>
                <Input
                  id="mcp-server-name"
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="supabase"
                />
              </div>

              <div className="flex items-center gap-3 rounded-lg border border-border bg-background/60 px-3 py-2">
                <Switch
                  checked={form.enabled}
                  onCheckedChange={(checked) =>
                    setForm((current) => ({ ...current, enabled: checked }))
                  }
                />
                <div className="space-y-0.5">
                  <div className="text-sm text-foreground">Enabled</div>
                  <div className="text-[11px] text-muted-foreground">
                    Disabled servers stay stored but do not sync into the CLI
                    cache.
                  </div>
                </div>
              </div>
            </div>

            <Tabs
              value={form.transport}
              onValueChange={(value) =>
                setForm((current) => ({
                  ...current,
                  transport: value === "http" ? "http" : "stdio",
                }))
              }
              className="space-y-4"
            >
              <TabsList className="h-9">
                <TabsTrigger value="stdio">stdio</TabsTrigger>
                <TabsTrigger value="http">http</TabsTrigger>
              </TabsList>

              <TabsContent value="stdio" className="space-y-4">
                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="space-y-2">
                    <Label htmlFor="mcp-server-command">Command</Label>
                    <Input
                      id="mcp-server-command"
                      value={form.command}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          command: event.target.value,
                        }))
                      }
                      placeholder="npx"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mcp-server-args">Args</Label>
                    <Textarea
                      id="mcp-server-args"
                      value={form.argsText}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          argsText: event.target.value,
                        }))
                      }
                      className="min-h-24 font-mono text-xs"
                      placeholder="-y&#10;@supabase/mcp-server-supabase@latest"
                    />
                  </div>
                </div>

                <KeyValueEditor
                  entries={form.envEntries}
                  onChange={(envEntries) =>
                    setForm((current) => ({ ...current, envEntries }))
                  }
                  label="Environment"
                  description="Use secret environment values for tokens and access keys. Saved secrets stay masked until you overwrite or clear them."
                  secretLabel="Store in Vault"
                />
              </TabsContent>

              <TabsContent value="http" className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="mcp-server-url">URL</Label>
                  <Input
                    id="mcp-server-url"
                    value={form.url}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        url: event.target.value,
                      }))
                    }
                    placeholder="https://mcp.linear.app/sse"
                  />
                </div>

                <KeyValueEditor
                  entries={form.headerEntries}
                  onChange={(headerEntries) =>
                    setForm((current) => ({ ...current, headerEntries }))
                  }
                  label="Header"
                  description="Store authorization headers as secrets. Plain headers are useful for transport metadata or custom protocol flags."
                  secretLabel="Store in Vault"
                />
              </TabsContent>
            </Tabs>

            <div className="space-y-2">
              <Label htmlFor="mcp-server-extra">Extra JSON</Label>
              <Textarea
                id="mcp-server-extra"
                value={form.extraText}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    extraText: event.target.value,
                  }))
                }
                className="min-h-32 font-mono text-xs"
                placeholder={`{\n  "cwd": "/repo",\n  "startup_timeout_ms": 15000\n}`}
              />
              <p className="text-[11px] leading-5 text-muted-foreground">
                Additional config fields are passed through untouched in the CLI
                response as long as they do not override the core transport keys.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => closeDialog(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleSave()} disabled={saving}>
              {saving ? "Saving..." : editingServer ? "Save changes" : "Create server"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this MCP server?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `This removes ${deleteTarget.name} and deletes every Vault secret linked to it.`
                : "This removes the server definition and its linked Vault secrets."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()} disabled={deleting}>
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
