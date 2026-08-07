"use client";

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
import { useSandboxStore } from "@/hooks/use-sandbox";
import { SANDBOX_LAUNCH_PRESET_MAX_PER_REPO } from "@/lib/launch-presets/shared";
import {
  hasConfiguredSandboxEnv,
  normalizeRootDirectory,
} from "@/lib/repo-settings";
import {
  isValidSandboxBranchName,
  normalizeSandboxBranchName,
  resolveSandboxLaunchPathChoice,
} from "@/lib/sandbox/launch-config";
import { LaunchOptionCard } from "./sandbox-launch-option-card";
import { SandboxLaunchPathPicker } from "./sandbox-launch-path-picker";
import type { useSandboxLaunchForm } from "./use-sandbox-launch-form";

type SandboxLaunchDialogProps = {
  form: ReturnType<typeof useSandboxLaunchForm>;
};

export function SandboxLaunchDialog({ form }: SandboxLaunchDialogProps) {
  const listSandboxesForRepo = useSandboxStore(
    (state) => state.listSandboxesForRepo
  );

  const {
    pendingPrompt,
    launchMode,
    setLaunchMode,
    branchName,
    setBranchName,
    branchError,
    setBranchError,
    pathSelection,
    setPathSelection,
    customPath,
    setCustomPath,
    pathError,
    setPathError,
    workspaceState,
    presetSaveName,
    setPresetSaveName,
    presetError,
    setPresetError,
    presetSaving,
    showPresetSaveInput,
    setShowPresetSaveInput,
    presetAppliedBaseBranch,
    setPresetAppliedBaseBranch,
    launchPresets,
    closePrompt,
    applyPreset,
    handleSavePreset,
    handleDeletePreset,
    REPO_ROOT_VALUE,
    CUSTOM_PATH_VALUE,
  } = form;

  const defaultBranch = pendingPrompt?.repo.default_branch?.trim() || "main";
  const repoDefaultPath = pendingPrompt
    ? normalizeRootDirectory(pendingPrompt.repo.root_directory)
    : null;
  const hasExistingSandbox = pendingPrompt
    ? listSandboxesForRepo(pendingPrompt.repo.id).length > 0
    : false;
  const showPathPicker = Boolean(pendingPrompt?.repo.is_monorepo);
  const showEnvWarning = pendingPrompt
    ? !hasConfiguredSandboxEnv(pendingPrompt.repo)
    : false;

  return (
    <Dialog
      open={Boolean(pendingPrompt)}
      onOpenChange={(open) => {
        if (!open) {
          closePrompt(null);
        }
      }}
    >
      <DialogContent className="border-border/80 bg-background/96 flex max-h-[calc(100vh-2rem)] max-w-xl flex-col overflow-hidden p-0 shadow-2xl backdrop-blur-sm">
        <div className="border-border/70 shrink-0 border-b px-6 py-5">
          <DialogHeader className="gap-2 text-left">
            <DialogTitle className="text-base">
              Start a new sandbox
            </DialogTitle>
            <DialogDescription className="text-xs leading-5">
              Choose how {pendingPrompt?.repo.full_name || "this repo"} should
              open. Use this when you want a clean slate — to keep working on
              an existing chat's branch, just reopen the chat.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {pendingPrompt && launchPresets.presets.length > 0 ? (
            <div className="space-y-2">
              <div className="text-muted-foreground flex items-center justify-between text-[11px] tracking-[0.2em] uppercase">
                <span>Saved Presets</span>
                <span className="font-mono tracking-normal normal-case">
                  {launchPresets.presets.length}/
                  {SANDBOX_LAUNCH_PRESET_MAX_PER_REPO}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {launchPresets.presets.map((preset) => (
                  <div
                    key={preset.id}
                    className="border-border bg-card/70 hover:border-foreground/20 group flex items-center gap-1 rounded-sm border px-2 py-1 text-[11px] transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => applyPreset(preset)}
                      className="text-foreground hover:text-foreground/90 max-w-[180px] truncate text-left"
                      title={`${preset.name} — ${preset.working_branch}${preset.root_directory ? ` · ${preset.root_directory}` : ""}`}
                    >
                      {preset.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeletePreset(preset.id)}
                      aria-label={`Delete preset ${preset.name}`}
                      className="text-muted-foreground/50 hover:text-destructive ml-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {showEnvWarning ? (
            <div
              role="status"
              className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-[11px] leading-5 text-amber-200"
            >
              <span className="font-medium">No env vars configured.</span>{" "}
              Your dev server may fail to boot. Add env vars in repo
              settings, or link a Vercel project to sync them automatically.
            </div>
          ) : null}

          {showPathPicker ? (
            <SandboxLaunchPathPicker
              pathSelection={pathSelection}
              setPathSelection={setPathSelection}
              customPath={customPath}
              setCustomPath={setCustomPath}
              pathError={pathError}
              setPathError={setPathError}
              workspaceState={workspaceState}
              repoDefaultPath={repoDefaultPath}
              REPO_ROOT_VALUE={REPO_ROOT_VALUE}
              CUSTOM_PATH_VALUE={CUSTOM_PATH_VALUE}
            />
          ) : null}

          {hasExistingSandbox ? (
            <LaunchOptionCard
              active={launchMode === "workspace"}
              title="New workspace from this repo"
              detail={`Open a sibling workspace on its own branch without touching your running sandbox. Base: ${defaultBranch}.`}
              onClick={() => {
                if (launchMode !== "workspace") {
                  setPresetAppliedBaseBranch(null);
                }
                setLaunchMode("workspace");
                setBranchError(null);
              }}
            >
              <div className="space-y-2">
                <div className="text-muted-foreground flex items-center justify-between text-[11px] tracking-[0.2em] uppercase">
                  <span>Working Branch</span>
                  <span>Base: {defaultBranch}</span>
                </div>
                <Input
                  value={branchName}
                  onChange={(event) => {
                    setBranchName(event.target.value);
                    setBranchError(null);
                    setPresetAppliedBaseBranch(null);
                  }}
                  onFocus={() => setLaunchMode("workspace")}
                  placeholder="mogplex/feature-branch"
                  className="font-mono text-[12px]"
                />
                <p className="text-muted-foreground text-[11px] leading-5">
                  Spawns in 5–10s when the repo has a baseline snapshot; falls
                  back to a fresh clone otherwise.
                </p>
              </div>
            </LaunchOptionCard>
          ) : null}

          <LaunchOptionCard
            active={launchMode === "default"}
            title="Default Branch"
            detail={`Clone and work directly on ${defaultBranch}. Best when you intentionally want sandbox edits to stay on the repo default.`}
            onClick={() => {
              if (launchMode !== "default") {
                setPresetAppliedBaseBranch(null);
              }
              setLaunchMode("default");
              setBranchError(null);
            }}
          />

          <LaunchOptionCard
            active={launchMode === "new"}
            title="Create New Branch"
            detail={`Clone ${defaultBranch}, create a fresh working branch, and push it upstream before the sandbox boots.`}
            onClick={() => {
              if (launchMode !== "new") {
                setPresetAppliedBaseBranch(null);
              }
              setLaunchMode("new");
              setBranchError(null);
            }}
          >
            <div className="space-y-2">
              <div className="text-muted-foreground flex items-center justify-between text-[11px] tracking-[0.2em] uppercase">
                <span>Working Branch</span>
                <span>Base: {defaultBranch}</span>
              </div>
              <Input
                value={branchName}
                onChange={(event) => {
                  setBranchName(event.target.value);
                  setBranchError(null);
                  setPresetAppliedBaseBranch(null);
                }}
                onFocus={() => setLaunchMode("new")}
                placeholder="mogplex/feature-branch"
                className="font-mono text-[12px]"
              />
              <p className="text-muted-foreground text-[11px] leading-5">
                Mogplex will create the branch inside the sandbox and push it
                to GitHub so restarts stay on the same branch.
              </p>
            </div>
          </LaunchOptionCard>

          {branchError ? (
            <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-[11px]">
              {branchError}
            </div>
          ) : null}

          {pendingPrompt ? (
            <div className="border-border/70 border-t pt-4">
              {showPresetSaveInput ? (
                <div className="space-y-2">
                  <div className="text-muted-foreground flex items-center justify-between text-[11px] tracking-[0.2em] uppercase">
                    <span>Save Current As Preset</span>
                    {launchPresets.presets.length >=
                    SANDBOX_LAUNCH_PRESET_MAX_PER_REPO ? (
                      <span className="text-destructive normal-case tracking-normal">
                        Cap reached ({SANDBOX_LAUNCH_PRESET_MAX_PER_REPO})
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      autoFocus
                      value={presetSaveName}
                      onChange={(event) => {
                        setPresetSaveName(event.target.value);
                        setPresetError(null);
                      }}
                      placeholder="e.g. apps/web on staging"
                      maxLength={64}
                      className="h-8 text-[12px]"
                    />
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleSavePreset()}
                      disabled={presetSaving || !presetSaveName.trim()}
                    >
                      {presetSaving ? "Saving..." : "Save"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setShowPresetSaveInput(false);
                        setPresetSaveName("");
                        setPresetError(null);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                  {presetError ? (
                    <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-[11px]">
                      {presetError}
                    </div>
                  ) : null}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setShowPresetSaveInput(true);
                    setPresetError(null);
                  }}
                  className="text-muted-foreground hover:text-foreground text-[11px] underline-offset-2 hover:underline"
                >
                  Save current as preset...
                </button>
              )}
            </div>
          ) : null}
        </div>

        <DialogFooter className="border-border/70 shrink-0 border-t px-6 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => closePrompt(null)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              let resolvedPathOverride: string | null | undefined;
              if (showPathPicker) {
                const pathChoice = resolveSandboxLaunchPathChoice(
                  pathSelection,
                  customPath,
                  repoDefaultPath
                );
                if (!pathChoice.ok) {
                  setPathError(pathChoice.error);
                  return;
                }
                resolvedPathOverride = pathChoice.value;
              } else {
                resolvedPathOverride = undefined;
              }

              const pathPayload =
                resolvedPathOverride === undefined
                  ? {}
                  : { rootDirectory: resolvedPathOverride };

              const effectiveBaseBranch =
                presetAppliedBaseBranch ?? defaultBranch;

              if (launchMode === "default") {
                closePrompt({
                  baseBranch: effectiveBaseBranch,
                  workingBranch: effectiveBaseBranch,
                  createBranch: false,
                  ...pathPayload,
                });
                return;
              }

              const normalizedBranch = normalizeSandboxBranchName(branchName);
              if (
                !normalizedBranch ||
                !isValidSandboxBranchName(normalizedBranch)
              ) {
                setBranchError(
                  "Use a valid git branch name with letters, numbers, ., _, -, or /."
                );
                return;
              }
              if (normalizedBranch === effectiveBaseBranch) {
                setBranchError(
                  "Pick a branch name different from the base branch."
                );
                return;
              }

              closePrompt({
                baseBranch: effectiveBaseBranch,
                workingBranch: normalizedBranch,
                createBranch: true,
                ...pathPayload,
              });
            }}
          >
            Start Sandbox
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
