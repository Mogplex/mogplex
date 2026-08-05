import { NextResponse } from "next/server";
import { getUserCredentials } from "@/lib/sandbox/get-user-credentials";
import {
  createVercelProject,
  listVercelProjects,
  listVercelTeams,
  validateVercelProjectAccess,
} from "@/lib/vercel/service";
import { deriveVercelLinkedProjectValidation } from "@/lib/vercel/validation";
import type { VercelServiceError } from "@/lib/vercel/service";
import type {
  VercelLinkedProjectValidation,
  VercelLinkedProjectValidationSource,
} from "@/lib/vercel/validation";
import type { SandboxBillingMode } from "@/lib/sandbox/billing";

type TargetsRouteDeps = {
  getUserCredentials: typeof getUserCredentials;
  fetch: typeof fetch;
};

// Sign in with Vercel is an identity grant, not an API-capable integration.
// Keep every project-list/create entry point closed until Mogplex has a grant
// that explicitly includes the required Vercel API scopes.
export const PERSONAL_VERCEL_TARGETS_AVAILABLE = false;

function integrationRequiredResponse() {
  return NextResponse.json(
    {
      error: "VERCEL_INTEGRATION_REQUIRED",
      message:
        "Vercel project actions require an API-capable Vercel integration and are not available.",
    },
    { status: 501 }
  );
}

const defaultDeps: TargetsRouteDeps = {
  getUserCredentials,
  fetch,
};

type ValidationRequest = {
  billingMode: SandboxBillingMode;
  source: VercelLinkedProjectValidationSource;
  projectId: string | null;
  teamId: string | null;
};

function mapTargetsRouteError(
  error: VercelServiceError,
  fallback: string
): { error: string; status: number } {
  switch (error.code) {
    case "AUTH_INVALID":
      return { error: "VERCEL_AUTH_INVALID", status: 401 };
    case "TEAM_FORBIDDEN":
      return { error: "VERCEL_TARGETS_FORBIDDEN", status: 403 };
    case "RATE_LIMITED":
      return { error: "VERCEL_TARGETS_RATE_LIMITED", status: 429 };
    default:
      return { error: fallback, status: 500 };
  }
}

// A teams-list failure is "escalating" when it implies the personal token can't
// see team-scoped resources at all — at which point continuing with a personal-
// only picker silently hides every team-owned project (see PR #451 root cause).
// Reconnect is the right CTA. Other codes (rate limits, transient) keep the
// soft-fail behavior so a single blip doesn't lock the picker.
export function shouldEscalateTeamsLoadFailure(
  error: VercelServiceError
): boolean {
  return (
    error.code === "AUTH_INVALID" ||
    error.code === "TEAM_FORBIDDEN" ||
    error.code === "NOT_CONFIGURED"
  );
}

function parseValidationRequest(
  searchParams: URLSearchParams
): ValidationRequest | null {
  const billingModeValue = searchParams.get("validationBillingMode");
  const sourceValue = searchParams.get("validationSource");
  const projectId = searchParams.get("validationProjectId")?.trim() || null;
  const teamId = searchParams.get("validationTeamId")?.trim() || null;

  if (!billingModeValue && !projectId) {
    return null;
  }

  return {
    billingMode:
      billingModeValue === "user_vercel_project"
        ? "user_vercel_project"
        : projectId
          ? "user_vercel_project"
          : "platform",
    source:
      sourceValue === "workspace"
        ? "workspace"
        : sourceValue === "repo"
          ? "repo"
          : sourceValue === "account"
            ? "account"
            : null,
    projectId,
    teamId,
  };
}

async function resolveLinkedProjectValidation(
  request: ValidationRequest | null,
  creds: Awaited<ReturnType<typeof getUserCredentials>>,
  fetchImpl: typeof fetch
): Promise<{
  linkedProjectValidation: VercelLinkedProjectValidation | null;
  validation: { ok: boolean; code?: string } | null;
}> {
  if (!request) {
    return {
      linkedProjectValidation: null,
      validation: null,
    };
  }

  if (request.billingMode !== "user_vercel_project") {
    return {
      linkedProjectValidation: null,
      validation: null,
    };
  }

  if (!creds?.vercelToken) {
    return {
      linkedProjectValidation: deriveVercelLinkedProjectValidation({
        billingMode: request.billingMode,
        source: request.source,
        projectId: request.projectId,
        personalState: "not_linked",
        access: null,
      }),
      validation: null,
    };
  }

  if (!request.projectId) {
    return {
      linkedProjectValidation: deriveVercelLinkedProjectValidation({
        billingMode: request.billingMode,
        source: request.source,
        projectId: request.projectId,
        personalState: "linked",
        access: null,
      }),
      validation: null,
    };
  }

  const validationResult = await validateVercelProjectAccess(
    {
      authMode: "personal",
      vercelToken: creds.vercelToken,
      teamId: request.teamId,
      projectId: request.projectId,
    },
    fetchImpl
  );

  return {
    linkedProjectValidation: deriveVercelLinkedProjectValidation({
      billingMode: request.billingMode,
      source: request.source,
      projectId: request.projectId,
      personalState: "linked",
      access: validationResult.ok
        ? { ok: true }
        : { ok: false, code: validationResult.error.code },
    }),
    validation: validationResult.ok
      ? { ok: true }
      : { ok: false, code: validationResult.error.code },
  };
}

export function createVercelTargetsGetHandler(
  overrides: Partial<TargetsRouteDeps> = {}
) {
  const deps = {
    ...defaultDeps,
    ...overrides,
  };

  return async function GET(request: Request) {
    if (!PERSONAL_VERCEL_TARGETS_AVAILABLE) {
      return integrationRequiredResponse();
    }

    const creds = await deps.getUserCredentials();
    const { searchParams } = new URL(request.url);
    const teamId = searchParams.get("teamId") || "personal";
    const validationRequest = parseValidationRequest(searchParams);
    const initialValidation = await resolveLinkedProjectValidation(
      validationRequest,
      creds,
      deps.fetch
    );

    if (!creds?.vercelToken) {
      return NextResponse.json(
        {
          error: "VERCEL_NOT_CONNECTED",
          linkedProjectValidation: initialValidation.linkedProjectValidation,
          validation: initialValidation.validation,
        },
        { status: 400 }
      );
    }

    try {
      const teams = [{ id: "personal", name: "Personal" }];
      let teamsLoadFailed = false;

      const teamsResult = await listVercelTeams(
        {
          authMode: "personal",
          vercelToken: creds.vercelToken,
        },
        deps.fetch
      );

      if (teamsResult.ok) {
        teams.push(...teamsResult.data);
      } else if (shouldEscalateTeamsLoadFailure(teamsResult.error)) {
        // Escalate: token can't list teams → it almost certainly can't see
        // team-owned projects either, so the picker would silently hide them.
        // Surface the same error the projects path would, so the hook fires
        // its existing reconnect banner.
        console.error(
          "[vercel/targets] teams call failed with reconnect-class error",
          teamsResult.error.status,
          teamsResult.error.message
        );
        const mapped = mapTargetsRouteError(
          teamsResult.error,
          "VERCEL_TARGETS_ERROR"
        );
        return NextResponse.json(
          {
            error: mapped.error,
            linkedProjectValidation: initialValidation.linkedProjectValidation,
            validation: initialValidation.validation,
          },
          { status: mapped.status }
        );
      } else {
        teamsLoadFailed = true;
        console.warn(
          "[vercel/targets] teams call failed (soft)",
          teamsResult.error.status,
          teamsResult.error.message
        );
      }

      const projectsResult = await listVercelProjects(
        {
          authMode: "personal",
          vercelToken: creds.vercelToken,
          teamId,
        },
        deps.fetch
      );

      if (!projectsResult.ok) {
        console.error(
          "Failed to load Vercel projects",
          projectsResult.error.status,
          projectsResult.error.message
        );
        const mapped = mapTargetsRouteError(
          projectsResult.error,
          "VERCEL_PROJECTS_ERROR"
        );
        return NextResponse.json(
          {
            error: mapped.error,
            linkedProjectValidation: initialValidation.linkedProjectValidation,
            validation: initialValidation.validation,
          },
          { status: mapped.status }
        );
      }

      return NextResponse.json({
        teams,
        projects: projectsResult.data,
        defaultTeamId: teams.some((team) => team.id === creds.vercelTeamId)
          ? creds.vercelTeamId
          : "personal",
        linkedProjectValidation: initialValidation.linkedProjectValidation,
        validation: initialValidation.validation,
        teamsLoadFailed,
      });
    } catch (error) {
      console.error("Failed to load Vercel targets", error);
      return NextResponse.json(
        { error: "VERCEL_TARGETS_ERROR" },
        { status: 500 }
      );
    }
  };
}

export function createVercelTargetsPostHandler(
  overrides: Partial<TargetsRouteDeps> = {}
) {
  const deps = {
    ...defaultDeps,
    ...overrides,
  };

  return async function POST(request: Request) {
    if (!PERSONAL_VERCEL_TARGETS_AVAILABLE) {
      return integrationRequiredResponse();
    }

    const creds = await deps.getUserCredentials();
    if (!creds?.vercelToken) {
      return NextResponse.json(
        { error: "VERCEL_NOT_CONNECTED" },
        { status: 400 }
      );
    }

    let body: { name?: unknown; teamId?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json(
        { error: "Project name is required" },
        { status: 400 }
      );
    }

    const teamId =
      typeof body.teamId === "string" &&
      body.teamId.trim() &&
      body.teamId !== "personal"
        ? body.teamId.trim()
        : null;

    try {
      const createResult = await createVercelProject(
        {
          authMode: "personal",
          vercelToken: creds.vercelToken,
          teamId,
          name,
        },
        deps.fetch
      );

      if (!createResult.ok) {
        if (createResult.error.code === "AUTH_INVALID") {
          return NextResponse.json(
            { error: "VERCEL_AUTH_INVALID" },
            { status: 401 }
          );
        }
        if (createResult.error.code === "TEAM_FORBIDDEN") {
          return NextResponse.json(
            { error: "VERCEL_TARGETS_FORBIDDEN" },
            { status: 403 }
          );
        }
        if (createResult.error.code === "RATE_LIMITED") {
          return NextResponse.json(
            { error: "VERCEL_TARGETS_RATE_LIMITED" },
            { status: 429 }
          );
        }
        return NextResponse.json(
          { error: "VERCEL_PROJECT_CREATE_ERROR" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        project: createResult.data,
        teamId: teamId || "personal",
      });
    } catch (error) {
      console.error("Failed to create Vercel project", error);
      return NextResponse.json(
        { error: "VERCEL_PROJECT_CREATE_ERROR" },
        { status: 500 }
      );
    }
  };
}

export const GET = createVercelTargetsGetHandler();
export const POST = createVercelTargetsPostHandler();
