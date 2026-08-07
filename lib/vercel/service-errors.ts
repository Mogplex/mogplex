import type {
  VercelServiceErrorCode,
  VercelServiceResult,
  VercelServiceAccess,
  ResponseContext,
} from "./service-types";

const TEAM_FORBIDDEN_OPERATIONS = new Set<ResponseContext["operation"]>([
  "teams",
  "projects",
  "project_create",
]);

const PROJECT_NOT_FOUND_OPERATIONS = new Set<ResponseContext["operation"]>([
  "project_validate",
  "project_read",
  "deployment_list",
  "env_list",
  "env_upsert",
  "env_delete",
]);

export function createError(
  code: VercelServiceErrorCode,
  status: number,
  message: string
): VercelServiceResult<never> {
  return {
    ok: false,
    error: {
      code,
      status,
      message,
    },
  };
}

export function resolveAccess(input: VercelServiceAccess): VercelServiceResult<{
  headers: {
    Authorization: string;
    "Content-Type": string;
  };
  teamId: string | null;
}> {
  const vercelToken = input.vercelToken?.trim() || null;
  if (!vercelToken) {
    return input.authMode === "platform"
      ? createError(
          "NOT_CONFIGURED",
          500,
          "Mogplex platform Vercel is not configured."
        )
      : createError(
          "AUTH_INVALID",
          401,
          "Reconnect Personal Vercel to continue."
        );
  }

  return {
    ok: true,
    data: {
      headers: {
        Authorization: `Bearer ${vercelToken}`,
        "Content-Type": "application/json",
      },
      teamId: input.teamId?.trim() || null,
    },
  };
}

export function appendTeamId(url: string, teamId?: string | null) {
  if (!teamId || teamId === "personal") return url;
  const nextUrl = new URL(url);
  nextUrl.searchParams.set("teamId", teamId);
  return nextUrl.toString();
}

async function readErrorMessage(response: Response) {
  const text = await response.text();
  return text || `Vercel API (${response.status})`;
}

function getForbiddenErrorCode(
  context: ResponseContext
): VercelServiceErrorCode {
  if (!TEAM_FORBIDDEN_OPERATIONS.has(context.operation)) {
    return "PROJECT_FORBIDDEN";
  }

  return context.teamScoped ? "TEAM_FORBIDDEN" : "AUTH_INVALID";
}

function getErrorCodeForStatus(
  status: number,
  context: ResponseContext
): VercelServiceErrorCode {
  switch (status) {
    case 401:
      return "AUTH_INVALID";
    case 403:
      return getForbiddenErrorCode(context);
    case 404:
      return PROJECT_NOT_FOUND_OPERATIONS.has(context.operation)
        ? "PROJECT_NOT_FOUND"
        : "API_ERROR";
    case 429:
      return "RATE_LIMITED";
    default:
      return "API_ERROR";
  }
}

export async function mapError(
  response: Response,
  context: ResponseContext
): Promise<VercelServiceResult<never>> {
  const message = await readErrorMessage(response);
  return createError(
    getErrorCodeForStatus(response.status, context),
    response.status,
    message
  );
}
