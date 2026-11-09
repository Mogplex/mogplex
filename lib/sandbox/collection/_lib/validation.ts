import { NextResponse } from "next/server";
import { resolveSandboxLaunchRequest } from "@/lib/sandbox/launch-config";
import { resolveSandboxCreateContext } from "@/lib/sandbox/context";
import {
  resolveBillingLinkedProjectOwner,
  resolveBillingLinkedProjectSelection,
} from "@/lib/vercel/target-resolution";
import { deriveVercelLinkedProjectValidation } from "@/lib/vercel/validation";
import { buildPersistedVercelLinkStateFromValidation } from "@/lib/vercel/reconciliation";
import type { SandboxServiceCredentials } from "@/lib/sandbox/get-user-credentials";
import type { PersistedVercelLinkState } from "@/lib/vercel/reconciliation";
import { SANDBOX_POST_REPO_SELECT } from "./constants";
import type {
  SandboxRepoRecord,
  SandboxCreateContextResult,
  ResolvedSandboxCreateContext,
  SandboxRouteResponseResult,
  SandboxCreateContextResolution,
  SandboxRepoAccessResolution,
  SandboxLaunchRequestResolution,
  SandboxLaunchRequestInput,
  toWorkspace,
} from "./types";
import type { SandboxPostDeps } from "./deps";

export async function persistLinkedProjectState(
  deps: Pick<
    SandboxPostDeps,
    "persistRepoVercelLinkState" | "persistWorkspaceVercelLinkState"
  >,
  input: {
    repo: SandboxRepoRecord;
    userId: string;
    source: "repo" | "workspace" | "account" | null;
    state: PersistedVercelLinkState;
  },
  toWorkspaceFn: typeof toWorkspace
) {
  if (input.source === "repo") {
    await deps.persistRepoVercelLinkState(
      input.repo.id,
      input.userId,
      input.state
    );
    return;
  }

  if (input.source === "workspace") {
    const workspace = toWorkspaceFn(input.repo.workspace);
    if (workspace?.id) {
      await deps.persistWorkspaceVercelLinkState(
        workspace.id,
        input.userId,
        input.state
      );
    }
  }

  // "account" or null source: nothing to persist on the repo/workspace
  // record -- the account-default project lives on the profile and is managed
  // independently.
}

export function shouldPersistLinkedProjectAccessFailure(code: string) {
  return (
    code === "AUTH_INVALID" ||
    code === "PROJECT_NOT_FOUND" ||
    code === "PROJECT_FORBIDDEN" ||
    code === "TEAM_FORBIDDEN"
  );
}

export async function handleSandboxCreateContextFailure(input: {
  deps: SandboxPostDeps;
  creds: SandboxServiceCredentials;
  repo: SandboxRepoRecord;
  linkedProjectOwner: ReturnType<typeof resolveBillingLinkedProjectOwner>;
  linkedProject: ReturnType<typeof resolveBillingLinkedProjectSelection>;
  createContextResult: Extract<SandboxCreateContextResult, { ok: false }>;
  toWorkspaceFn: typeof toWorkspace;
}): Promise<SandboxRouteResponseResult> {
  if (
    input.linkedProject.billingMode === "user_vercel_project" &&
    (!input.linkedProject.projectId ||
      input.createContextResult.credentialSource === "user")
  ) {
    const state = buildPersistedVercelLinkStateFromValidation({
      source: input.linkedProjectOwner,
      billingMode: "user_vercel_project",
      projectId: input.linkedProject.projectId,
      personalState: input.linkedProject.projectId ? "not_linked" : "linked",
      access: null,
      checkedAt: new Date().toISOString(),
    });
    await persistLinkedProjectState(
      input.deps,
      {
        repo: input.repo,
        userId: input.creds.userId,
        source: input.linkedProjectOwner,
        state,
      },
      input.toWorkspaceFn
    );
  }

  return {
    response: NextResponse.json(
      { error: input.createContextResult.error },
      { status: input.createContextResult.status }
    ),
  };
}

export async function validateSandboxProjectAccessOrResponse(input: {
  deps: SandboxPostDeps;
  creds: SandboxServiceCredentials;
  repo: SandboxRepoRecord;
  linkedProjectOwner: ReturnType<typeof resolveBillingLinkedProjectOwner>;
  linkedProject: ReturnType<typeof resolveBillingLinkedProjectSelection>;
  createContext: ResolvedSandboxCreateContext;
  toWorkspaceFn: typeof toWorkspace;
}): Promise<SandboxCreateContextResolution> {
  const access = await input.deps.validateVercelProjectAccess({
    authMode:
      input.createContext.ownership.credentialSource === "user"
        ? "personal"
        : "platform",
    vercelToken: input.createContext.credentials.vercelToken,
    teamId: input.createContext.credentials.vercelTeamId,
    projectId: input.createContext.credentials.vercelProjectId,
  });

  if (access.ok) {
    return { createContext: input.createContext };
  }

  if (input.createContext.ownership.credentialSource === "platform") {
    console.error("[sandbox/launch] hosted Vercel project preflight failed", {
      code: access.error.code,
      status: access.error.status,
    });
    return {
      response: NextResponse.json(
        {
          error:
            "Hosted sandbox service is temporarily unavailable. Please try again shortly.",
          code: "SANDBOX_SERVICE_UNAVAILABLE",
        },
        { status: 503 }
      ),
    };
  }

  if (shouldPersistLinkedProjectAccessFailure(access.error.code)) {
    const state = buildPersistedVercelLinkStateFromValidation({
      source: input.linkedProjectOwner,
      billingMode: "user_vercel_project",
      projectId: input.linkedProject.projectId,
      personalState: "linked",
      access: { ok: false, code: access.error.code },
      checkedAt: new Date().toISOString(),
    });
    await persistLinkedProjectState(
      input.deps,
      {
        repo: input.repo,
        userId: input.creds.userId,
        source: input.linkedProjectOwner,
        state,
      },
      input.toWorkspaceFn
    );
  }

  const linkedProjectValidation = deriveVercelLinkedProjectValidation({
    billingMode: input.linkedProject.billingMode,
    source: input.linkedProjectOwner,
    projectId: input.linkedProject.projectId,
    personalState: "linked",
    access: { ok: false, code: access.error.code },
  });

  return {
    response: NextResponse.json(
      {
        error:
          linkedProjectValidation?.message ||
          "The linked Vercel billing project is missing or inaccessible.",
        code: "VERCEL_LINKED_PROJECT_INVALID",
        linkedProjectValidation,
      },
      { status: 400 }
    ),
  };
}

export async function resolveSandboxCreateContextOrResponse(input: {
  deps: SandboxPostDeps;
  creds: SandboxServiceCredentials;
  repo: SandboxRepoRecord;
  workspace: ReturnType<typeof toWorkspace>;
  linkedProjectOwner: ReturnType<typeof resolveBillingLinkedProjectOwner>;
  linkedProject: ReturnType<typeof resolveBillingLinkedProjectSelection>;
  toWorkspaceFn: typeof toWorkspace;
}): Promise<SandboxCreateContextResolution> {
  const createContextResult = await resolveSandboxCreateContext(
    {
      sandboxCredentials: input.creds,
      workspaceBillingModeInput: input.workspace?.sandbox_billing_mode,
      repoBillingModeOverrideInput: input.repo.sandbox_billing_mode_override,
      repoLinkedProjectId: input.repo.vercel_project_id,
      repoLinkedTeamId: input.repo.vercel_team_id,
      workspaceLinkedProjectId: input.workspace?.sandbox_vercel_project_id,
      workspaceLinkedTeamId: input.workspace?.sandbox_vercel_team_id,
      accountLinkedProjectId: input.creds.accountDefaultVercelProjectId,
      accountLinkedTeamId: input.creds.accountDefaultVercelTeamId,
      includeAi: true,
    },
    {
      resolveSandboxAiAccess: input.deps.resolveSandboxAiAccess,
    }
  );

  if (!createContextResult.ok) {
    return handleSandboxCreateContextFailure({
      deps: input.deps,
      creds: input.creds,
      repo: input.repo,
      linkedProjectOwner: input.linkedProjectOwner,
      linkedProject: input.linkedProject,
      createContextResult,
      toWorkspaceFn: input.toWorkspaceFn,
    });
  }

  return validateSandboxProjectAccessOrResponse({
    deps: input.deps,
    creds: input.creds,
    repo: input.repo,
    linkedProjectOwner: input.linkedProjectOwner,
    linkedProject: input.linkedProject,
    createContext: createContextResult.context,
    toWorkspaceFn: input.toWorkspaceFn,
  });
}

export async function loadSandboxLaunchRepoAccess(input: {
  deps: SandboxPostDeps;
  creds: SandboxServiceCredentials;
  repoId: string;
  productTeamId: string | null;
}): Promise<SandboxRepoAccessResolution> {
  const { repo, githubToken } =
    await input.deps.getOwnedRepoWithGithubAccessToken(
      input.repoId,
      input.creds.userId,
      {
        select: SANDBOX_POST_REPO_SELECT,
        productTeamId: input.productTeamId,
      }
    );

  if (!repo) {
    return {
      response: NextResponse.json({ error: "Repo not found" }, { status: 404 }),
    };
  }

  if (!githubToken) {
    return {
      response: NextResponse.json(
        { error: "Connect GitHub account first" },
        { status: 400 }
      ),
    };
  }

  return { repo, githubToken };
}

export function resolveSandboxLaunchRequestOrResponse(input: {
  requestBody: SandboxLaunchRequestInput;
  repoDefaultBranch: string | null;
}): SandboxLaunchRequestResolution {
  const launchRequest = resolveSandboxLaunchRequest({
    body: input.requestBody,
    repoDefaultBranch: input.repoDefaultBranch,
  });

  if (!launchRequest.ok) {
    return {
      response: NextResponse.json(
        { error: launchRequest.error },
        { status: 400 }
      ),
    };
  }

  return { launchRequest: launchRequest.value };
}

export function resolveSandboxLaunchRepoIdOrResponse(
  requestBody: SandboxLaunchRequestInput
): SandboxRouteResponseResult | { repoId: string } {
  if (!requestBody.repoId) {
    return {
      response: NextResponse.json(
        { error: "repoId required" },
        { status: 400 }
      ),
    };
  }

  return { repoId: requestBody.repoId };
}
