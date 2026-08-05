"use client";

import { useEffect, useState } from "react";
import type { Workspace } from "@/lib/types";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  buildWorkspaceSandboxSettingsPayload,
  createWorkspaceSandboxSettingsDraft,
} from "@/lib/sandbox/settings-model";
import {
  DEFAULT_SANDBOX_IDLE_TIMEOUT_MS,
  DEFAULT_SANDBOX_TIMEOUT_MS,
} from "@/lib/repo-settings";
import {
  getActiveTeamRequestHeaders,
  useActiveTeamId,
} from "@/components/active-scope-provider";

interface Props {
  workspace?: Workspace | null;
  onClose: () => void;
  onSaved: () => void;
}

export function WorkspaceDialog({ workspace, onClose, onSaved }: Props) {
  const [name, setName] = useState(workspace?.name || "");
  const [description, setDescription] = useState(workspace?.description || "");
  const [billingMode, setBillingMode] = useState(
    createWorkspaceSandboxSettingsDraft(workspace).billingMode
  );
  const [saving, setSaving] = useState(false);
  const activeTeamId = useActiveTeamId();

  useEffect(() => {
    const draft = createWorkspaceSandboxSettingsDraft(workspace);
    setName(workspace?.name || "");
    setDescription(workspace?.description || "");
    setBillingMode(draft.billingMode);
  }, [workspace]);

  const draft = {
    billingMode,
    timeoutMs: workspace?.sandbox_timeout_ms ?? DEFAULT_SANDBOX_TIMEOUT_MS,
    idleTimeoutMs:
      workspace?.sandbox_idle_timeout_ms ?? DEFAULT_SANDBOX_IDLE_TIMEOUT_MS,
    vercelTeamId: "",
    vercelProjectId: "",
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast({ title: "Project name required", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(
        workspace ? `/api/workspaces/${workspace.id}` : "/api/workspaces",
        {
          method: workspace ? "PATCH" : "POST",
          headers: getActiveTeamRequestHeaders(
            { "Content-Type": "application/json" },
            activeTeamId
          ),
          body: JSON.stringify({
            name,
            description,
            ...buildWorkspaceSandboxSettingsPayload(draft),
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to save project");
      }
      toast({
        title: workspace ? "Project updated" : "Project created",
        description: data.name,
      });
      onSaved();
      onClose();
    } catch (error) {
      toast({
        title: workspace ? "Update failed" : "Create failed",
        description: (error as Error).message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {workspace ? "Edit Project" : "New Project"}
          </DialogTitle>
          <DialogDescription>
            Projects organize repos and repo-backed workspaces.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-foreground text-xs font-medium">Name</label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Marketing site"
              className="h-9"
            />
          </div>

          <div className="space-y-2">
            <label className="text-foreground text-xs font-medium">
              Description
            </label>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional context for this project"
              rows={4}
            />
          </div>

          <div className="space-y-2">
            <label className="text-foreground text-xs font-medium">
              Default Sandbox Billing
            </label>
            <select
              aria-label="Default Sandbox Billing"
              value={billingMode}
              onChange={(event) =>
                setBillingMode(event.target.value as typeof billingMode)
              }
              className="border-border bg-input text-foreground h-9 w-full rounded-md border px-3 text-sm"
            >
              <option value="platform">Mogplex billing</option>
            </select>
            <p className="text-muted-foreground text-[11px]">
              Sandboxes use Mogplex billing. User-owned Vercel compute requires
              a future API-capable Vercel integration and is not available.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={saving || !name.trim()}
          >
            {saving
              ? workspace
                ? "Saving..."
                : "Creating..."
              : workspace
                ? "Save"
                : "Create Project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
