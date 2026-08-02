"use client";

import { useEffect, useMemo, useState } from "react";
import { deriveVercelLinkedProjectValidation } from "@/lib/vercel/validation";
import type { VercelLinkedProjectValidation } from "@/lib/vercel/validation";
import type { VercelTeamOption } from "@/lib/sandbox/settings-model";
import type { SandboxBillingMode } from "@/lib/sandbox/billing";
import type { VercelServiceErrorCode } from "@/lib/vercel/service";

export type VercelProjectOption = {
  id: string;
  name: string;
  framework?: string | null;
};

type UseVercelTargetsOptions = {
  teamScope: string;
  reconnectMessage: string;
  initialValidation?: VercelLinkedProjectValidation | null;
  validation?: {
    billingMode: SandboxBillingMode;
    source: "workspace" | "repo" | "account" | null;
    projectId?: string | null;
    teamId?: string | null;
  };
};

export type VercelTargetsValidationState = {
  billingMode: SandboxBillingMode | null;
  source: "workspace" | "repo" | "account" | null;
  projectId: string | null;
  teamId: string | null;
};

type VercelTargetsResponse = {
  error?: string;
  linkedProjectValidation?: VercelLinkedProjectValidation | null;
  projects?: VercelProjectOption[];
  project?: VercelProjectOption;
  teamId?: string;
  teams?: VercelTeamOption[];
  teamsLoadFailed?: boolean;
  validation?: {
    ok?: boolean;
    code?: VercelServiceErrorCode;
  } | null;
};

type LoadedVercelTargets = {
  ok: boolean;
  data: VercelTargetsResponse;
};

type LoadedTargetsFailure = {
  linkedProjectValidation: VercelLinkedProjectValidation | null;
  message: string;
  needsReconnect: boolean;
};

type VercelTargetsStateSetters = {
  setLinkedProjectValidation: (
    value: VercelLinkedProjectValidation | null
  ) => void;
  setNeedsVercelReconnect: (value: boolean) => void;
  setProjects: (value: VercelProjectOption[]) => void;
  setTeams: (value: VercelTeamOption[]) => void;
  setTeamsLoadFailed: (value: boolean) => void;
};

function buildVercelTargetsUrl(
  teamScope: string,
  validationState: VercelTargetsValidationState
) {
  const url = new URL("/api/vercel/targets", window.location.origin);
  url.searchParams.set("teamId", teamScope);

  if (!validationState.billingMode) {
    return url;
  }

  url.searchParams.set("validationBillingMode", validationState.billingMode);
  if (validationState.source) {
    url.searchParams.set("validationSource", validationState.source);
  }
  if (validationState.projectId) {
    url.searchParams.set("validationProjectId", validationState.projectId);
  }
  if (validationState.teamId) {
    url.searchParams.set("validationTeamId", validationState.teamId);
  }

  return url;
}

function isVercelReconnectError(error: string | undefined) {
  // VERCEL_TARGETS_FORBIDDEN (Vercel API returned 403) is almost always a
  // stale/under-scoped token — either the OAuth scopes drifted or the token
  // was scoped to a team the user no longer has access to. Reconnecting
  // re-runs the OAuth flow with current scopes, which is the right CTA.
  return (
    error === "VERCEL_AUTH_INVALID" ||
    error === "VERCEL_NOT_CONNECTED" ||
    error === "VERCEL_TARGETS_FORBIDDEN"
  );
}

export function resolveFailureTargetsValidation(
  data: VercelTargetsResponse,
  validationState: VercelTargetsValidationState
) {
  if (data.linkedProjectValidation) {
    return data.linkedProjectValidation;
  }

  return deriveVercelLinkedProjectValidation({
    billingMode: validationState.billingMode ?? "platform",
    source: validationState.source,
    projectId: validationState.projectId,
    // personalState is also coupled to error codes — currently only
    // VERCEL_NOT_CONNECTED maps to "not_linked". If a future error code
    // (e.g. VERCEL_OAUTH_REVOKED) should imply the personal account is no
    // longer linked, add a branch here too. The access mapping below has
    // its own sync-hazard note.
    personalState:
      data.error === "VERCEL_NOT_CONNECTED" ? "not_linked" : "linked",
    // Keep this access mapping in sync with isVercelReconnectError above:
    // every error code listed there must have a matching branch here, or the
    // validation state will silently fall through to access: null while the
    // reconnect banner still fires.
    access:
      data.error === "VERCEL_AUTH_INVALID"
        ? { ok: false as const, code: "AUTH_INVALID" as const }
        : data.error === "VERCEL_TARGETS_FORBIDDEN"
          ? { ok: false as const, code: "TEAM_FORBIDDEN" as const }
          : null,
  });
}

function resolveLoadedTargetsValidation(
  data: VercelTargetsResponse,
  validationState: VercelTargetsValidationState
) {
  if (data.linkedProjectValidation) {
    return data.linkedProjectValidation;
  }

  return deriveVercelLinkedProjectValidation({
    billingMode: validationState.billingMode ?? "platform",
    source: validationState.source,
    projectId: validationState.projectId,
    personalState: "linked",
    access: resolveLoadedTargetsAccess(data.validation),
  });
}

function resolveLoadedTargetsAccess(
  validation: VercelTargetsResponse["validation"]
) {
  if (validation?.ok === true) {
    return { ok: true as const };
  }

  if (validation?.ok === false && validation.code) {
    return { ok: false as const, code: validation.code };
  }

  return null;
}

function buildLoadedTargetsFailure(
  data: VercelTargetsResponse,
  validationState: VercelTargetsValidationState,
  reconnectMessage: string
): LoadedTargetsFailure {
  const needsReconnect = isVercelReconnectError(data.error);

  return {
    linkedProjectValidation: resolveFailureTargetsValidation(
      data,
      validationState
    ),
    message: needsReconnect
      ? reconnectMessage
      : (data.error ?? "Failed to load Vercel targets"),
    needsReconnect,
  };
}

function applyLoadedTargetsFailureState(
  failure: LoadedTargetsFailure,
  setters: Pick<
    VercelTargetsStateSetters,
    "setLinkedProjectValidation" | "setNeedsVercelReconnect"
  >
) {
  if (failure.linkedProjectValidation) {
    setters.setLinkedProjectValidation(failure.linkedProjectValidation);
  }
  if (failure.needsReconnect) {
    setters.setNeedsVercelReconnect(true);
  }
}

function applyLoadedTargetsSuccessState(
  loadedTargets: LoadedVercelTargets,
  validationState: VercelTargetsValidationState,
  setters: Pick<
    VercelTargetsStateSetters,
    | "setLinkedProjectValidation"
    | "setProjects"
    | "setTeams"
    | "setTeamsLoadFailed"
  >
) {
  setters.setTeams(loadedTargets.data.teams || []);
  setters.setProjects(loadedTargets.data.projects || []);
  setters.setTeamsLoadFailed(loadedTargets.data.teamsLoadFailed === true);
  setters.setLinkedProjectValidation(
    resolveLoadedTargetsValidation(loadedTargets.data, validationState)
  );
}

async function loadVercelTargets(
  teamScope: string,
  validationState: VercelTargetsValidationState
): Promise<LoadedVercelTargets> {
  const response = await fetch(
    buildVercelTargetsUrl(teamScope, validationState).toString()
  );
  const data = (await response.json()) as VercelTargetsResponse;

  return {
    ok: response.ok,
    data,
  };
}

function sortProjectsByName(projects: VercelProjectOption[]) {
  return [...projects].sort((a, b) => a.name.localeCompare(b.name));
}

function upsertProject(
  current: VercelProjectOption[],
  project: VercelProjectOption
) {
  return sortProjectsByName([
    ...current.filter((candidate) => candidate.id !== project.id),
    project,
  ]);
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function useVercelTargets(options: UseVercelTargetsOptions) {
  const [teams, setTeams] = useState<VercelTeamOption[]>([]);
  const [projects, setProjects] = useState<VercelProjectOption[]>([]);
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [targetsError, setTargetsError] = useState<string | null>(null);
  const [needsVercelReconnect, setNeedsVercelReconnect] = useState(false);
  const [teamsLoadFailed, setTeamsLoadFailed] = useState(false);
  const [linkedProjectValidation, setLinkedProjectValidation] = useState(
    options.initialValidation ?? null
  );
  const validationBillingMode = options.validation?.billingMode ?? null;
  const validationSource = options.validation?.source ?? null;
  const validationProjectId = options.validation?.projectId ?? null;
  const validationTeamId = options.validation?.teamId ?? null;
  const validationState = useMemo<VercelTargetsValidationState>(
    () => ({
      billingMode: validationBillingMode,
      source: validationSource,
      projectId: validationProjectId,
      teamId: validationTeamId,
    }),
    [
      validationBillingMode,
      validationProjectId,
      validationSource,
      validationTeamId,
    ]
  );

  useEffect(() => {
    let active = true;

    const loadTargets = async () => {
      setLoadingTargets(true);
      setTargetsError(null);
      setNeedsVercelReconnect(false);
      setTeamsLoadFailed(false);
      setLinkedProjectValidation(options.initialValidation ?? null);
      try {
        const loadedTargets = await loadVercelTargets(
          options.teamScope,
          validationState
        );
        if (!active) return;

        if (!loadedTargets.ok) {
          const failure = buildLoadedTargetsFailure(
            loadedTargets.data,
            validationState,
            options.reconnectMessage
          );
          applyLoadedTargetsFailureState(failure, {
            setLinkedProjectValidation,
            setNeedsVercelReconnect,
          });
          throw new Error(failure.message);
        }

        applyLoadedTargetsSuccessState(loadedTargets, validationState, {
          setLinkedProjectValidation,
          setProjects,
          setTeams,
          setTeamsLoadFailed,
        });
      } catch (error) {
        if (!active) return;
        setTeams([{ id: "personal", name: "Personal" }]);
        setProjects([]);
        setTargetsError(
          getErrorMessage(error, "Failed to load Vercel targets")
        );
      } finally {
        if (active) {
          setLoadingTargets(false);
        }
      }
    };

    void loadTargets();

    return () => {
      active = false;
    };
  }, [
    options.reconnectMessage,
    options.teamScope,
    validationBillingMode,
    validationProjectId,
    validationSource,
    validationTeamId,
    options.initialValidation,
    validationState,
  ]);

  const createProject = async (name: string) => {
    setTargetsError(null);
    setCreatingProject(true);
    try {
      const response = await fetch("/api/vercel/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          teamId: options.teamScope,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (isVercelReconnectError(data.error)) {
          setNeedsVercelReconnect(true);
        }
        throw new Error(data.error || "Failed to create Vercel project");
      }

      setProjects((current) =>
        upsertProject(current, data.project as VercelProjectOption)
      );

      return {
        ok: true as const,
        project: data.project as VercelProjectOption,
        teamId: data.teamId as string,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to create Vercel project";
      setTargetsError(message);
      return {
        ok: false as const,
        error: message,
      };
    } finally {
      setCreatingProject(false);
    }
  };

  return {
    teams,
    projects,
    loadingTargets,
    creatingProject,
    targetsError,
    needsVercelReconnect,
    teamsLoadFailed,
    linkedProjectValidation,
    setTargetsError,
    createProject,
  };
}
