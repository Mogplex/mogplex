import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { getRepoForScope, REPO_SELECT_WITH_WORKSPACE } from "@/lib/repos";
import {
  buildRuntimeSandboxEnv,
  hasConfiguredSandboxEnv,
  normalizeDevPort,
  resolveConfiguredDevPort,
} from "@/lib/repo-settings";
import {
  getSandboxServiceCredentials,
  isSandboxCapabilityDeniedError,
  resolveSandboxTarget,
  resolveSandboxTargetCredentials,
} from "@/lib/sandbox/get-user-credentials";
import { validateSandboxCreateRequest } from "@/lib/sandbox/client";
import {
  resolveProductResourceScope,
  type ProductResourceScope,
} from "@/lib/team-resource-scope";
import { resolveRepoSandboxEnv } from "@/lib/vercel/env-vars";
import type { Repo, Workspace } from "@/lib/types";

type SandboxTestRepo = Repo & {
  workspace?: Pick<
    Workspace,
    | "sandbox_billing_mode"
    | "sandbox_vercel_project_id"
    | "sandbox_vercel_team_id"
  > | null;
};

type SandboxTestDeps = {
  requireUserId: typeof requireUserId;
  getRepoForScope: (
    repoId: string,
    scope: ProductResourceScope,
    select?: string
  ) => Promise<SandboxTestRepo | null>;
  getSandboxServiceCredentials: typeof getSandboxServiceCredentials;
  resolveRepoSandboxEnv: typeof resolveRepoSandboxEnv;
};

const defaultDeps: SandboxTestDeps = {
  requireUserId,
  getRepoForScope,
  getSandboxServiceCredentials,
  resolveRepoSandboxEnv,
};

export function createAutomationSandboxTestPostHandler(
  overrides: Partial<SandboxTestDeps> = {}
) {
  const deps: SandboxTestDeps = { ...defaultDeps, ...overrides };

  return async function POST(request: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const scopeResolution = await resolveProductResourceScope({
      request,
      userId,
      requiredCapability: "tools.bash",
    });
    if (!scopeResolution.ok) {
      return NextResponse.json(
        { error: scopeResolution.error },
        { status: scopeResolution.status }
      );
    }

    const body = (await request.json().catch(() => null)) as {
      repoId?: unknown;
    } | null;
    const repoId = typeof body?.repoId === "string" ? body.repoId : "";
    if (!repoId) {
      return NextResponse.json(
        { error: "repoId is required" },
        { status: 400 }
      );
    }

    const repo = await deps.getRepoForScope(
      repoId,
      scopeResolution.scope,
      REPO_SELECT_WITH_WORKSPACE
    );
    if (!repo) {
      return NextResponse.json({ error: "Repo not found" }, { status: 404 });
    }

    let creds;
    try {
      creds = await deps.getSandboxServiceCredentials(request, {
        teamId: scopeResolution.scope.productTeamId,
        auditTargetId: repo.id,
        requireCapability: "tools.bash",
      });
    } catch (error) {
      if (isSandboxCapabilityDeniedError(error)) {
        return NextResponse.json(
          { error: error.message },
          { status: error.status }
        );
      }
      throw error;
    }
    if (!creds) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sandboxTarget = resolveSandboxTarget({
      workspaceBillingModeInput: repo.workspace?.sandbox_billing_mode,
      repoBillingModeOverrideInput: repo.sandbox_billing_mode_override,
      repoLinkedProjectId: repo.vercel_project_id,
      repoLinkedTeamId: repo.vercel_team_id,
      workspaceLinkedProjectId: repo.workspace?.sandbox_vercel_project_id,
      workspaceLinkedTeamId: repo.workspace?.sandbox_vercel_team_id,
      accountLinkedProjectId: creds.accountDefaultVercelProjectId,
      accountLinkedTeamId: creds.accountDefaultVercelTeamId,
    });
    if (!sandboxTarget.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: sandboxTarget.error,
          repo: { id: repo.id, full_name: repo.full_name },
        },
        { status: 200 }
      );
    }

    const targetCredentials = resolveSandboxTargetCredentials(
      creds,
      sandboxTarget
    );
    if (!targetCredentials.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: targetCredentials.error,
          repo: { id: repo.id, full_name: repo.full_name },
        },
        { status: 200 }
      );
    }

    const envResolution = await deps.resolveRepoSandboxEnv({
      repo,
      userId: creds.userId,
    });
    const runtimeEnv = buildRuntimeSandboxEnv(
      envResolution.envVars,
      envResolution.sync.mode
    );
    const devPort = normalizeDevPort(
      resolveConfiguredDevPort(repo.dev_port, repo.dev_port_auto) ??
        repo.dev_port
    );

    try {
      validateSandboxCreateRequest({
        envVars: runtimeEnv,
        ports: [devPort],
      });
    } catch (error) {
      return NextResponse.json(
        {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Sandbox create request is invalid.",
          repo: { id: repo.id, full_name: repo.full_name },
          env: {
            configured: hasConfiguredSandboxEnv(repo),
            count: Object.keys(runtimeEnv).length,
            mode: envResolution.sync.mode,
            source: envResolution.sync.source,
            warning: envResolution.sync.warning,
          },
        },
        { status: 200 }
      );
    }

    if (!repo.github_installation_id) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "GitHub App installation is required so sandbox autofix can push back to the PR branch.",
          repo: { id: repo.id, full_name: repo.full_name },
          env: {
            configured: hasConfiguredSandboxEnv(repo),
            count: Object.keys(runtimeEnv).length,
            mode: envResolution.sync.mode,
            source: envResolution.sync.source,
            warning: envResolution.sync.warning,
          },
        },
        { status: 200 }
      );
    }

    return NextResponse.json({
      ok: true,
      repo: { id: repo.id, full_name: repo.full_name },
      env: {
        configured: hasConfiguredSandboxEnv(repo),
        count: Object.keys(runtimeEnv).length,
        mode: envResolution.sync.mode,
        source: envResolution.sync.source,
        warning: envResolution.sync.warning,
      },
      sandbox: {
        billingSource: sandboxTarget.billingSource,
        credentialSource: sandboxTarget.credentialSource,
        projectId: targetCredentials.vercelProjectId,
        teamId: targetCredentials.vercelTeamId,
      },
    });
  };
}

export const POST = createAutomationSandboxTestPostHandler();
