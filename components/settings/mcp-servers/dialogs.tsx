"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import type { McpServer, FormState } from "./types";
import { KeyValueEditor } from "./key-value-editor";

interface McpServerDialogProps {
  open: boolean;
  editingServer: McpServer | null;
  form: FormState;
  formError: string | null;
  saving: boolean;
  onFormChange: (updater: (current: FormState) => FormState) => void;
  onClose: (open: boolean) => void;
  onSave: () => void;
}

export function McpServerDialog({
  open,
  editingServer,
  form,
  formError,
  saving,
  onFormChange,
  onClose,
  onSave,
}: McpServerDialogProps) {
  const dialogTitle = editingServer ? "Edit MCP server" : "Add MCP server";
  const dialogDescription = editingServer
    ? "Update the synced server definition. Saved secrets stay masked until you overwrite or clear them."
    : "Create a synced MCP server definition for CLI and agent sessions.";

  return (
    <Dialog open={open} onOpenChange={onClose}>
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
                  onFormChange((current) => ({
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
                  onFormChange((current) => ({ ...current, enabled: checked }))
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
              onFormChange((current) => ({
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
                      onFormChange((current) => ({
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
                      onFormChange((current) => ({
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
                  onFormChange((current) => ({ ...current, envEntries }))
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
                    onFormChange((current) => ({
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
                  onFormChange((current) => ({ ...current, headerEntries }))
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
                onFormChange((current) => ({
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
            onClick={() => onClose(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="button" onClick={onSave} disabled={saving}>
            {saving
              ? "Saving..."
              : editingServer
                ? "Save changes"
                : "Create server"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface DeleteServerDialogProps {
  server: McpServer | null;
  deleting: boolean;
  onClose: () => void;
  onDelete: () => void;
}

export function DeleteServerDialog({
  server,
  deleting,
  onClose,
  onDelete,
}: DeleteServerDialogProps) {
  return (
    <AlertDialog
      open={Boolean(server)}
      onOpenChange={(open) => !open && onClose()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this MCP server?</AlertDialogTitle>
          <AlertDialogDescription>
            {server
              ? `This removes ${server.name} and deletes every Vault secret linked to it.`
              : "This removes the server definition and its linked Vault secrets."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onDelete} disabled={deleting}>
            {deleting ? "Deleting..." : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
