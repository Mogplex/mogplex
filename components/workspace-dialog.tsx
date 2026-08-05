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
  buildWorkspaceSandboxSettingsModel,
  buildWorkspaceSandboxSettingsPayload,
  createWorkspaceSandboxSettingsDraft,
} from "@/lib/sandbox/settings-model";
import {
  DEFAULT_SANDBOX_IDLE_TIMEOUT_MS,
  DEFAULT_SANDBOX_TIMEOUT_MS,
} from "@/lib/repo-settings";
import { useVercelTargets } from "@/hooks/use-vercel-targets";
import { useUser } from "@/hooks/use-user";
import { VercelLinkedProjectValidationBanner } from "@/components/vercel-linked-project-validation-banner";
import { derivePersistedVercelLinkedProjectValidation } from "@/lib/vercel/validation";
import { trackActivation } from "@/lib/activation-tracking";
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
  const [vercelTeamId, setVercelTeamId] = useState(
    createWorkspaceSandboxSettingsDraft(workspace).vercelTeamId
  );
  const [vercelProjectId, setVercelProjectId] = useState(
    createWorkspaceSandboxSettingsDraft(workspace).vercelProjectId
  );
  const [saving, setSaving] = useState(false);
  const { user } = useUser();
  const activeTeamId = useActiveTeamId();
  const accountDefaultProjectId = user?.account_vercel_project_id ?? null;

  useEffect(() => {
    const draft = createWorkspaceSandboxSettingsDraft(workspace);
    setName(workspace?.name || "");
    setDescription(workspace?.description || "");
    setBillingMode(draft.billingMode);
    setVercelTeamId(draft.vercelTeamId);
    setVercelProjectId(draft.vercelProjectId);
  }, [workspace]);

  const draft = {
    billingMode,
    timeoutMs:
      workspace?.sandbox_timeout_ms ?? DEFAULT_SANDBOX_TIMEOUT_MS,
    idleTimeoutMs:
      workspace?.sandbox_idle_timeout_ms ?? DEFAULT_SANDBOX_IDLE_TIMEOUT_MS,
    vercelTeamId,
    vercelProjectId,
  };
  const sandboxModel = buildWorkspaceSandboxSettingsModel(draft);
  const initialLinkedProjectValidation =
    workspace &&
    billingMode === (workspace.sandbox_billing_mode || "platform") &&
    vercelTeamId === (workspace.sandbox_vercel_team_id || "") &&
    vercelProjectId === (workspace.sandbox_vercel_project_id || "")
      ? derivePersistedVercelLinkedProjectValidation({
          status: workspace.vercel_link_status,
          source: "workspace",
          message: workspace.vercel_link_message,
          errorCode: workspace.vercel_link_error_code,
        })
      : null;
  const {
    teams,
    projects,
    loadingTargets,
    creatingProject,
    targetsError,
    needsVercelReconnect,
    linkedProjectValidation,
    createProject,
  } = useVercelTargets({
    teamScope: sandboxModel.teamScope,
    reconnectMessage:
      "Link Personal Vercel to choose your own project for sandbox billing.",
    initialValidation: initialLinkedProjectValidation,
    validation: {
      billingMode: billingMode,
      source: "workspace",
      projectId: sandboxModel.effectiveLinkedProjectId,
      teamId: sandboxModel.effectiveLinkedTeamId,
    },
  });

  const createProjectDefaultName = (name.trim() || "mogplex-workspace")
    .replace(/\s+/g, "-")
    .toLowerCase();

  const handleCreateProject = async () => {
    const result = await createProject(createProjectDefaultName);
    if (result.ok) {
      setVercelProjectId(result.project.id);
      setVercelTeamId(result.teamId === "personal" ? "" : result.teamId);
    }
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
      const previousProjectId = workspace?.sandbox_vercel_project_id || "";
      if (
        draft.billingMode === "user_vercel_project" &&
        vercelProjectId &&
        vercelProjectId !== previousProjectId
      ) {
        trackActivation("vercel_project_linked", {
          source: "workspace_dialog",
          action: workspace ? "updated" : "created",
        });
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
              <option value="user_vercel_project">
                Your Vercel project billing
              </option>
            </select>
            <p className="text-muted-foreground text-[11px]">
              Repos in this project inherit this billing mode unless they
              explicitly override it. Effective owner:{" "}
              {sandboxModel.effectiveOwnerLabel}.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-foreground text-xs font-medium">
              Workspace Vercel Team
            </label>
            <select
              aria-label="Workspace Vercel Team"
              value={vercelTeamId || "personal"}
              onChange={(event) =>
                setVercelTeamId(
                  event.target.value === "personal" ? "" : event.target.value
                )
              }
              disabled={loadingTargets}
              className="border-border bg-input text-foreground h-9 w-full rounded-md border px-3 text-sm disabled:opacity-50"
            >
              <option value="personal">Personal</option>
              {teams
                .filter((team) => team.id !== "personal")
                .map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-foreground text-xs font-medium">
              Workspace Vercel Project
            </label>
            <select
              aria-label="Workspace Vercel Project"
              value={vercelProjectId}
              onChange={(event) => setVercelProjectId(event.target.value)}
              disabled={loadingTargets}
              className="border-border bg-input text-foreground h-9 w-full rounded-md border px-3 text-sm disabled:opacity-50"
            >
              {/* Falls back to the raw project ID when the account-default project
                  is not in the currently-scoped team's list (loading, or different team). */}
              <option value="">
                {accountDefaultProjectId
                  ? `Use account default (${
                      projects.find((p) => p.id === accountDefaultProjectId)
                        ?.name ?? accountDefaultProjectId
                    })`
                  : "No workspace Vercel project"}
              </option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                  {project.framework ? ` (${project.framework})` : ""}
                </option>
              ))}
            </select>
            <div className="text-muted-foreground flex items-center justify-between gap-3 text-[11px]">
              <span>
                Used when this project is set to your own billing and a repo
                does not link a different Vercel project.
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleCreateProject()}
                disabled={loadingTargets || creatingProject}
                className="h-7 shrink-0 rounded-sm text-[11px]"
              >
                {creatingProject
                  ? "Creating..."
                  : `Create ${createProjectDefaultName}`}
              </Button>
            </div>
          </div>

          {linkedProjectValidation && (
            <VercelLinkedProjectValidationBanner
              validation={linkedProjectValidation}
              className="rounded-md"
            />
          )}

          {targetsError &&
            linkedProjectValidation?.state !== "auth_invalid" && (
              <div className="border-border text-muted-foreground rounded-md border px-3 py-2 text-[11px]">
                {targetsError}
                {needsVercelReconnect ? (
                  <>
                    {" "}
                    {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- OAuth start endpoint, needs full-page navigation */}
                    <a
                      href="/api/auth/vercel"
                      className="text-foreground underline underline-offset-2"
                    >
                      Reconnect Personal Vercel
                    </a>
                  </>
                ) : null}
              </div>
            )}
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
