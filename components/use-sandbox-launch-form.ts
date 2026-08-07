"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLaunchPresets } from "@/hooks/use-launch-presets";
import { useSandboxStore } from "@/hooks/use-sandbox";
import type { SandboxLaunchPreset } from "@/lib/launch-presets/shared";
import { normalizeRootDirectory } from "@/lib/repo-settings";
import {
  buildSuggestedSandboxBranchName,
  isValidSandboxBranchName,
  isValidSandboxRootDirectory,
  normalizeSandboxBranchName,
  resolveSandboxLaunchPathChoice,
  SANDBOX_LAUNCH_PATH_CUSTOM_VALUE,
  SANDBOX_LAUNCH_PATH_REPO_ROOT_VALUE,
  type SandboxLaunchChoice,
} from "@/lib/sandbox/launch-config";
import type {
  LaunchRepo,
  PendingLaunchPrompt,
  WorkspaceFetchState,
  WorkspaceOption,
} from "./sandbox-launch-types";

const REPO_ROOT_VALUE = SANDBOX_LAUNCH_PATH_REPO_ROOT_VALUE;
const CUSTOM_PATH_VALUE = SANDBOX_LAUNCH_PATH_CUSTOM_VALUE;

function buildInitialPathSelection(repoDefault: string | null) {
  if (!repoDefault) return REPO_ROOT_VALUE;
  return repoDefault;
}

export function useSandboxLaunchForm() {
  const listSandboxesForRepo = useSandboxStore(
    (state) => state.listSandboxesForRepo
  );
  const [pendingPrompt, setPendingPrompt] =
    useState<PendingLaunchPrompt | null>(null);
  const [launchMode, setLaunchMode] = useState<"default" | "new" | "workspace">(
    "default"
  );
  const [branchName, setBranchName] = useState("");
  const [branchError, setBranchError] = useState<string | null>(null);
  const [pathSelection, setPathSelection] = useState(REPO_ROOT_VALUE);
  const [customPath, setCustomPath] = useState("");
  const [pathError, setPathError] = useState<string | null>(null);
  const [workspaceState, setWorkspaceState] = useState<WorkspaceFetchState>({
    status: "idle",
  });
  const fetchedWorkspacesForRepoIdRef = useRef<string | null>(null);
  const [presetSaveName, setPresetSaveName] = useState("");
  const [presetError, setPresetError] = useState<string | null>(null);
  const [presetSaving, setPresetSaving] = useState(false);
  const [showPresetSaveInput, setShowPresetSaveInput] = useState(false);
  const [presetAppliedBaseBranch, setPresetAppliedBaseBranch] = useState<
    string | null
  >(null);
  const launchPresets = useLaunchPresets(pendingPrompt?.repo.id ?? null);

  const closePrompt = useCallback((choice: SandboxLaunchChoice | null) => {
    setPendingPrompt((current) => {
      current?.resolve(choice);
      return null;
    });
    setLaunchMode("default");
    setBranchName("");
    setBranchError(null);
    setPathSelection(REPO_ROOT_VALUE);
    setCustomPath("");
    setPathError(null);
    setWorkspaceState({ status: "idle" });
    fetchedWorkspacesForRepoIdRef.current = null;
    setPresetSaveName("");
    setPresetError(null);
    setPresetSaving(false);
    setShowPresetSaveInput(false);
    setPresetAppliedBaseBranch(null);
  }, []);

  const applyPreset = useCallback((preset: SandboxLaunchPreset) => {
    if (preset.create_branch) {
      setLaunchMode("new");
    } else {
      setLaunchMode("default");
    }
    setBranchName(preset.working_branch);
    setBranchError(null);
    setPresetAppliedBaseBranch(preset.base_branch);

    if (preset.root_directory === null) {
      setPathSelection(REPO_ROOT_VALUE);
      setCustomPath("");
    } else {
      setPathSelection(CUSTOM_PATH_VALUE);
      setCustomPath(preset.root_directory);
    }
    setPathError(null);
    setShowPresetSaveInput(false);
    setPresetError(null);
  }, []);

  const requestLaunchChoice = useCallback(
    (repo: LaunchRepo) =>
      new Promise<SandboxLaunchChoice | null>((resolve) => {
        const hasExistingSandbox = listSandboxesForRepo(repo.id).length > 0;
        const repoDefault = normalizeRootDirectory(repo.root_directory);
        setLaunchMode(hasExistingSandbox ? "workspace" : "new");
        setBranchName(buildSuggestedSandboxBranchName(repo.full_name));
        setBranchError(null);
        setPathSelection(buildInitialPathSelection(repoDefault));
        setCustomPath(repoDefault ?? "");
        setPathError(null);
        setWorkspaceState({ status: "idle" });
        setPendingPrompt({ repo, resolve });
      }),
    [listSandboxesForRepo]
  );

  // Lazy-load detected monorepo workspaces when the dialog opens
  useEffect(() => {
    if (!pendingPrompt) return;
    if (!pendingPrompt.repo.is_monorepo) return;
    if (fetchedWorkspacesForRepoIdRef.current === pendingPrompt.repo.id) {
      return;
    }
    fetchedWorkspacesForRepoIdRef.current = pendingPrompt.repo.id;

    let cancelled = false;
    setWorkspaceState({ status: "loading" });

    fetch(`/api/repos/${pendingPrompt.repo.id}/monorepo`, { method: "GET" })
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data: { workspaces?: WorkspaceOption[] }) => {
        if (cancelled) return;
        const workspaces = (data.workspaces ?? []).filter(
          (ws): ws is WorkspaceOption =>
            typeof ws.path === "string" &&
            ws.path.length > 0 &&
            isValidSandboxRootDirectory(ws.path)
        );
        setWorkspaceState({ status: "ready", workspaces });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error("[sandbox-launch] monorepo workspace fetch failed", {
          repoId: pendingPrompt.repo.id,
          error,
        });
        setWorkspaceState({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [pendingPrompt]);

  const buildCurrentPresetPayload = useCallback(():
    | {
        ok: true;
        payload: {
          name: string;
          rootDirectory: string | null;
          baseBranch: string;
          workingBranch: string;
          createBranch: boolean;
        };
      }
    | { ok: false; error: string } => {
    if (!pendingPrompt) {
      return { ok: false, error: "Open the launch dialog first" };
    }
    const trimmedName = presetSaveName.trim();
    if (!trimmedName) {
      return { ok: false, error: "Name the preset before saving" };
    }

    const repoDefault = normalizeRootDirectory(
      pendingPrompt.repo.root_directory
    );
    const showPathPicker = Boolean(pendingPrompt.repo.is_monorepo);

    let rootDirectory: string | null;
    if (showPathPicker) {
      const pathChoice = resolveSandboxLaunchPathChoice(
        pathSelection,
        customPath,
        repoDefault
      );
      if (!pathChoice.ok) {
        return { ok: false, error: pathChoice.error };
      }
      rootDirectory = pathChoice.value ?? null;
    } else {
      rootDirectory = repoDefault;
    }

    const dialogDefaultBranch =
      pendingPrompt.repo.default_branch?.trim() || "main";
    const effectiveBaseBranch = presetAppliedBaseBranch ?? dialogDefaultBranch;

    if (launchMode === "default") {
      return {
        ok: true,
        payload: {
          name: trimmedName,
          rootDirectory,
          baseBranch: effectiveBaseBranch,
          workingBranch: effectiveBaseBranch,
          createBranch: false,
        },
      };
    }

    const normalizedBranch = normalizeSandboxBranchName(branchName);
    if (!normalizedBranch || !isValidSandboxBranchName(normalizedBranch)) {
      return {
        ok: false,
        error: "Use a valid git branch name before saving the preset",
      };
    }
    if (normalizedBranch === effectiveBaseBranch) {
      return {
        ok: false,
        error: "Pick a branch different from the base before saving",
      };
    }

    return {
      ok: true,
      payload: {
        name: trimmedName,
        rootDirectory,
        baseBranch: effectiveBaseBranch,
        workingBranch: normalizedBranch,
        createBranch: true,
      },
    };
  }, [
    branchName,
    customPath,
    launchMode,
    pathSelection,
    pendingPrompt,
    presetAppliedBaseBranch,
    presetSaveName,
  ]);

  const handleSavePreset = useCallback(async () => {
    setPresetError(null);
    const built = buildCurrentPresetPayload();
    if (!built.ok) {
      setPresetError(built.error);
      return;
    }
    setPresetSaving(true);
    try {
      await launchPresets.savePreset(built.payload);
      setPresetSaveName("");
      setShowPresetSaveInput(false);
    } catch (error) {
      setPresetError(
        error instanceof Error ? error.message : "Failed to save preset"
      );
    } finally {
      setPresetSaving(false);
    }
  }, [buildCurrentPresetPayload, launchPresets]);

  const handleDeletePreset = useCallback(
    async (presetId: string) => {
      setPresetError(null);
      try {
        await launchPresets.deletePreset(presetId);
      } catch (error) {
        setPresetError(
          error instanceof Error ? error.message : "Failed to delete preset"
        );
      }
    },
    [launchPresets]
  );

  return {
    // State
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
    // Actions
    closePrompt,
    applyPreset,
    requestLaunchChoice,
    handleSavePreset,
    handleDeletePreset,
    // Constants
    REPO_ROOT_VALUE,
    CUSTOM_PATH_VALUE,
  };
}
